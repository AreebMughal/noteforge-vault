import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import type * as kdbxweb from 'kdbxweb';
import { supabase } from '../lib/supabase';
import { supabaseRemote } from '../lib/supabase-remote';
import { fileCache } from '../lib/cache';
import { setupArgon2 } from '../lib/argon2';
import { clearClipboard } from '../lib/clipboard';
import { signOutOfGoogle } from '../lib/google';
import { MicrosoftConnection } from '../lib/microsoft';
import { readPreference, writePreference } from '../lib/preference';
import { oneDriveEnabled } from '../lib/config';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../lib/settings';
import * as bio from '../lib/biometric';
import { runSelfTest } from '../core/selftest';
import { credentialsFromPassword, credentialsFromPasswordHash, exportPasswordHash } from '../core/kdbx';
import { VaultSession, destroyVault, type VaultCache, type VaultRemote } from '../core/sync';
import { MicrosoftSignInRequired, oneDriveRemote, type VaultFile } from '../core/onedrive';
import {
  accountPreference, oneDrivePreference, parsePreference, type OneDriveRef, type VaultPreference,
} from '../core/preference';

/**
 * Which vault this phone opens. Comes from the choice saved to the NoteForge
 * account (shared with the web app), so a user who picked OneDrive on the
 * web lands on the same file here, and the other way round.
 */
export type VaultTarget =
  | { kind: 'loading' }
  /** Nothing chosen on any device yet, and no account vault: ask. */
  | { kind: 'choose' }
  | { kind: 'account' }
  | { kind: 'onedrive'; file: OneDriveRef };

export type Probe =
  | 'unknown' | 'exists' | 'missing' | 'offline-cached' | 'offline-empty'
  /** OneDrive vault, but this phone isn't signed in to Microsoft (yet, or any more). */
  | 'needs-microsoft';
type SaveState = { status: 'idle' | 'saving' | 'error'; error?: string; merged?: boolean };

interface AppCtx {
  booting: boolean;
  selfTestError: string | null;
  auth: Session | null;
  vault: VaultTarget;
  probe: Probe;
  /** The Microsoft account this phone is connected to, if any. */
  microsoftAccount: string | null;
  session: VaultSession | null;
  revision: number;
  saveState: SaveState;
  settings: Settings;
  biometricReady: boolean;
  touch(): void;
  reprobe(): Promise<void>;
  /** Vault-source choice (first run, or "Use a different vault"). Saved to the account on unlock. */
  chooseAccountVault(): void;
  chooseOneDriveFile(file: VaultFile): void;
  connectMicrosoft(): Promise<boolean>;
  disconnectMicrosoft(): Promise<void>;
  listOneDriveFiles(): Promise<VaultFile[]>;
  findOneDriveFile(path: string): Promise<VaultFile>;
  createVault(password: string): Promise<void>;
  unlock(password: string): Promise<void>;
  unlockWithBiometric(): Promise<boolean>;
  enableBiometric(): Promise<void>;
  disableBiometric(): Promise<void>;
  lock(): void;
  mutate(fn: (db: kdbxweb.Kdbx) => void): Promise<void>;
  retrySave(): Promise<void>;
  refresh(): Promise<void>;
  forgetVault(): Promise<void>;
  signOut(): Promise<void>;
  updateSettings(s: Partial<Settings>): Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
};

/** Last known choice on this phone, so an offline start still knows which vault to open. */
const localPrefKey = (owner: string) => `vault-pref-${owner}`;
async function readLocalPref(owner: string) {
  try {
    return parsePreference(JSON.parse((await AsyncStorage.getItem(localPrefKey(owner))) ?? 'null'));
  } catch {
    return null;
  }
}
async function rememberPref(owner: string, pref: VaultPreference) {
  await AsyncStorage.setItem(localPrefKey(owner), JSON.stringify(pref)).catch(() => undefined);
  await writePreference(pref);
}
function targetOf(pref: VaultPreference): VaultTarget {
  if (pref.source === 'onedrive' && oneDriveEnabled) return { kind: 'onedrive', file: pref.onedrive };
  return { kind: 'account' };
}
/** Cache, biometric and offline copy are kept per vault, not just per user. */
function vaultKey(owner: string, t: VaultTarget) {
  return t.kind === 'onedrive' ? `${owner}-od-${t.file.fileId}` : owner;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [selfTestError, setSelfTestError] = useState<string | null>(null);
  const [auth, setAuth] = useState<Session | null>(null);
  const [vault, setVault] = useState<VaultTarget>({ kind: 'loading' });
  const [probe, setProbe] = useState<Probe>('unknown');
  const [microsoftAccount, setMicrosoftAccount] = useState<string | null>(null);
  const [session, setSession] = useState<VaultSession | null>(null);
  const [revision, setRevision] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [biometricReady, setBiometricReady] = useState(false);
  const lastActivity = useRef(Date.now());
  const sessionRef = useRef<VaultSession | null>(null);
  sessionRef.current = session;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const ownerId = auth?.user.id ?? null;
  const microsoft = useMemo(() => (ownerId ? new MicrosoftConnection(ownerId) : null), [ownerId]);
  const key = ownerId && vault.kind !== 'loading' && vault.kind !== 'choose' ? vaultKey(ownerId, vault) : null;
  const remote = useMemo<VaultRemote | null>(() => {
    if (!ownerId) return null;
    if (vault.kind === 'account') return supabaseRemote(ownerId);
    if (vault.kind === 'onedrive' && microsoft) return oneDriveRemote(microsoft.graph, vault.file.fileId);
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, microsoft, vault.kind, vault.kind === 'onedrive' ? vault.file.fileId : null]);
  const cache = useMemo<VaultCache | null>(() => (key ? fileCache(key) : null), [key]);
  const bump = () => setRevision((r) => r + 1);

  // Boot: install Argon2, run the crypto known-answer test, restore auth.
  useEffect(() => {
    (async () => {
      setupArgon2();
      const r = await runSelfTest();
      if (!r.ok) setSelfTestError(`${r.step}: ${r.error}`);
      setSettings(await loadSettings());
      const { data } = await supabase.auth.getSession();
      setAuth(data.session);
      setBooting(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setAuth(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Which vault? The account's saved choice, else an existing account vault, else ask.
  useEffect(() => {
    setSession(null);
    if (!ownerId) return setVault({ kind: 'loading' });
    let live = true;
    (async () => {
      setVault({ kind: 'loading' });
      setMicrosoftAccount((await microsoft?.account()) ?? null);
      const local = await readLocalPref(ownerId);
      let pref: VaultPreference | null;
      try {
        pref = await readPreference();
      } catch {
        // Offline: last choice seen on this phone, else the account vault (its offline cache).
        if (live) setVault(local ? targetOf(local) : { kind: 'account' });
        return;
      }
      if (pref) {
        await AsyncStorage.setItem(localPrefKey(ownerId), JSON.stringify(pref)).catch(() => undefined);
        if (live) setVault(targetOf(pref));
        return;
      }
      // No choice saved yet (account made before this existed, or brand new).
      const existing = await VaultSession.probe(supabaseRemote(ownerId), null).catch(() => 'offline-empty' as const);
      if (!live) return;
      if (existing === 'exists' || existing === 'offline-empty') setVault({ kind: 'account' });
      else setVault(oneDriveEnabled ? { kind: 'choose' } : { kind: 'account' });
    })();
    return () => { live = false; };
  }, [ownerId, microsoft]);

  const reprobe = useCallback(async () => {
    if (!ownerId || !key) return setProbe('unknown');
    setProbe('unknown');
    if (vault.kind === 'onedrive' && !(await microsoft?.account())) {
      setMicrosoftAccount(null);
      setProbe('needs-microsoft');
      return;
    }
    if (!remote) return;
    try {
      setProbe(await VaultSession.probe(remote, cache));
    } catch (e) {
      setProbe(e instanceof MicrosoftSignInRequired ? 'needs-microsoft' : 'offline-empty');
    }
    setBiometricReady(await bio.hasBiometricUnlock(key));
  }, [remote, cache, ownerId, key, vault.kind, microsoft]);

  useEffect(() => {
    setSession(null);
    reprobe();
  }, [reprobe]);

  const lock = useCallback(() => {
    if (!sessionRef.current) return;
    setSession(null);
    setSaveState({ status: 'idle' });
    clearClipboard().catch(() => undefined);
  }, []);

  const touch = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  // Inactivity auto-lock, including time spent in the background.
  useEffect(() => {
    const limit = () => settingsRef.current.autoLockMinutes * 60_000;
    const iv = setInterval(() => {
      if (sessionRef.current && settingsRef.current.autoLockMinutes > 0 && Date.now() - lastActivity.current > limit()) lock();
    }, 10_000);
    const sub = AppState.addEventListener('change', (state) => {
      const s = sessionRef.current;
      if (!s) return;
      if (state !== 'active') {
        if (settingsRef.current.autoLockMinutes === 0) lock();
        return;
      }
      if (Date.now() - lastActivity.current > limit()) return lock();
      lastActivity.current = Date.now();
      s.refresh().then((r) => r === 'updated' && bump(), () => undefined);
    });
    return () => {
      clearInterval(iv);
      sub.remove();
    };
  }, [lock]);

  /** Opened successfully: this is the user's vault now, on every device. */
  const open = (s: VaultSession) => {
    lastActivity.current = Date.now();
    setSaveState({ status: 'idle' });
    setSession(s);
    bump();
    if (ownerId && !s.readOnly) {
      const pref = vault.kind === 'onedrive'
        ? oneDrivePreference({ ...vault.file, account: microsoftAccount ?? vault.file.account })
        : accountPreference();
      rememberPref(ownerId, pref).catch(() => undefined);
    }
  };

  /** A OneDrive call said the Microsoft sign-in is gone: show the connect step. */
  const signInLost = (e: unknown) => {
    if (e instanceof MicrosoftSignInRequired) {
      setMicrosoftAccount(null);
      setProbe('needs-microsoft');
    }
  };

  const value: AppCtx = {
    booting, selfTestError, auth, vault, probe, microsoftAccount, session, revision, saveState, settings, biometricReady,
    touch, reprobe, lock,
    chooseAccountVault() {
      setVault({ kind: 'account' });
    },
    chooseOneDriveFile(file) {
      setVault({ kind: 'onedrive', file: { fileId: file.id, path: file.path, ...(microsoftAccount ? { account: microsoftAccount } : {}) } });
    },
    async connectMicrosoft() {
      if (!microsoft) return false;
      const hint = vault.kind === 'onedrive' ? vault.file.account : undefined;
      const account = await microsoft.connect(hint);
      if (!account) return false;
      setMicrosoftAccount(account);
      if (vault.kind === 'onedrive') await reprobe();
      return true;
    },
    async disconnectMicrosoft() {
      lock();
      await microsoft?.disconnect();
      setMicrosoftAccount(null);
      if (vault.kind === 'onedrive') setProbe('needs-microsoft');
    },
    async listOneDriveFiles() {
      if (!microsoft) return [];
      try {
        return await microsoft.graph.findKdbxFiles();
      } catch (e) {
        signInLost(e);
        throw e;
      }
    },
    async findOneDriveFile(path) {
      if (!microsoft) throw new Error('Not signed in');
      return microsoft.graph.getFileByPath(path.trim());
    },
    async createVault(password) {
      if (!remote || vault.kind !== 'account') throw new Error('New vaults are created in your NoteForge account');
      const s = await VaultSession.create(remote, cache, credentialsFromPassword(password));
      setProbe('exists');
      open(s);
    },
    async unlock(password) {
      if (!remote) throw new Error('Not signed in');
      try {
        open(await VaultSession.unlock(remote, cache, credentialsFromPassword(password)));
      } catch (e) {
        signInLost(e);
        throw e;
      }
    },
    async unlockWithBiometric() {
      if (!remote || !key) return false;
      const hash = await bio.readBiometricHash(key);
      if (!hash) {
        setBiometricReady(await bio.hasBiometricUnlock(key));
        return false;
      }
      try {
        open(await VaultSession.unlock(remote, cache, await credentialsFromPasswordHash(hash)));
        return true;
      } catch (e) {
        if (e instanceof MicrosoftSignInRequired) {
          signInLost(e);
          throw e;
        }
        // The master password was changed elsewhere: the cached hash is useless.
        await bio.disableBiometricUnlock(key);
        setBiometricReady(false);
        throw e;
      }
    },
    async enableBiometric() {
      if (!session || !key) return;
      await bio.enableBiometricUnlock(key, await exportPasswordHash(session.credentials), settings.biometricDays);
      setBiometricReady(true);
    },
    async disableBiometric() {
      if (!key) return;
      await bio.disableBiometricUnlock(key);
      setBiometricReady(false);
    },
    async mutate(fn) {
      const s = sessionRef.current;
      if (!s) throw new Error('Vault is locked');
      if (s.readOnly) throw new Error('Offline copy is read-only. Reconnect to make changes.');
      fn(s.db);
      bump();
      await value.retrySave();
    },
    async retrySave() {
      const s = sessionRef.current;
      if (!s) return;
      setSaveState({ status: 'saving' });
      try {
        const r = await s.save();
        setSaveState({ status: 'idle', merged: r.merged });
        if (r.merged) bump();
      } catch (e) {
        setSaveState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
        if (e instanceof MicrosoftSignInRequired) setMicrosoftAccount(null);
        throw e;
      }
    },
    async refresh() {
      const s = sessionRef.current;
      if (!s) return;
      const r = await s.refresh();
      bump();
      if (r === 'updated') setSaveState({ status: 'idle' });
    },
    async forgetVault() {
      // Only the account vault can be deleted; a KeePassXC file is never touched.
      if (!remote || !ownerId || !key || vault.kind !== 'account') return;
      await destroyVault(remote, cache);
      await bio.disableBiometricUnlock(key);
      setSession(null);
      setBiometricReady(false);
      setProbe('missing');
      if ((await readLocalPref(ownerId))?.source === 'account') {
        await AsyncStorage.removeItem(localPrefKey(ownerId)).catch(() => undefined);
        await writePreference(null);
      }
    },
    async signOut() {
      lock();
      if (ownerId) {
        await bio.disableBiometricUnlock(ownerId);
        await fileCache(ownerId).clear();
        if (vault.kind === 'onedrive') {
          await bio.disableBiometricUnlock(vaultKey(ownerId, vault));
          await fileCache(vaultKey(ownerId, vault)).clear();
        }
        await AsyncStorage.removeItem(localPrefKey(ownerId)).catch(() => undefined);
      }
      await microsoft?.disconnect();
      await supabase.auth.signOut();
      await signOutOfGoogle();
    },
    async updateSettings(patch) {
      const next = { ...settings, ...patch };
      setSettings(next);
      await saveSettings(next);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
