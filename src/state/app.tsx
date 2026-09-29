import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import type * as kdbxweb from 'kdbxweb';
import { supabase } from '../lib/supabase';
import { supabaseRemote } from '../lib/supabase-remote';
import { fileCache } from '../lib/cache';
import { setupArgon2 } from '../lib/argon2';
import { clearClipboard } from '../lib/clipboard';
import { signOutOfGoogle } from '../lib/google';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../lib/settings';
import * as bio from '../lib/biometric';
import { runSelfTest } from '../core/selftest';
import { credentialsFromPassword, credentialsFromPasswordHash, exportPasswordHash } from '../core/kdbx';
import { VaultSession, destroyVault } from '../core/sync';

export type Probe = 'unknown' | 'exists' | 'missing' | 'offline-cached' | 'offline-empty';
type SaveState = { status: 'idle' | 'saving' | 'error'; error?: string; merged?: boolean };

interface AppCtx {
  booting: boolean;
  selfTestError: string | null;
  auth: Session | null;
  probe: Probe;
  session: VaultSession | null;
  revision: number;
  saveState: SaveState;
  settings: Settings;
  biometricReady: boolean;
  touch(): void;
  reprobe(): Promise<void>;
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

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [selfTestError, setSelfTestError] = useState<string | null>(null);
  const [auth, setAuth] = useState<Session | null>(null);
  const [probe, setProbe] = useState<Probe>('unknown');
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
  const remote = useMemo(() => (ownerId ? supabaseRemote(ownerId) : null), [ownerId]);
  const cache = useMemo(() => (ownerId ? fileCache(ownerId) : null), [ownerId]);
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

  const reprobe = useCallback(async () => {
    if (!remote) return setProbe('unknown');
    setProbe('unknown');
    try {
      setProbe(await VaultSession.probe(remote, cache));
    } catch {
      setProbe('offline-empty');
    }
    if (ownerId) setBiometricReady(await bio.hasBiometricUnlock(ownerId));
  }, [remote, cache, ownerId]);

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

  const open = (s: VaultSession) => {
    lastActivity.current = Date.now();
    setSaveState({ status: 'idle' });
    setSession(s);
    bump();
  };

  const value: AppCtx = {
    booting, selfTestError, auth, probe, session, revision, saveState, settings, biometricReady,
    touch, reprobe, lock,
    async createVault(password) {
      if (!remote) throw new Error('Not signed in');
      const s = await VaultSession.create(remote, cache, credentialsFromPassword(password));
      setProbe('exists');
      open(s);
    },
    async unlock(password) {
      if (!remote) throw new Error('Not signed in');
      open(await VaultSession.unlock(remote, cache, credentialsFromPassword(password)));
    },
    async unlockWithBiometric() {
      if (!remote || !ownerId) return false;
      const hash = await bio.readBiometricHash(ownerId);
      if (!hash) {
        setBiometricReady(await bio.hasBiometricUnlock(ownerId));
        return false;
      }
      try {
        open(await VaultSession.unlock(remote, cache, await credentialsFromPasswordHash(hash)));
        return true;
      } catch (e) {
        // The master password was changed elsewhere: the cached hash is useless.
        await bio.disableBiometricUnlock(ownerId);
        setBiometricReady(false);
        throw e;
      }
    },
    async enableBiometric() {
      if (!session || !ownerId) return;
      await bio.enableBiometricUnlock(ownerId, await exportPasswordHash(session.credentials), settings.biometricDays);
      setBiometricReady(true);
    },
    async disableBiometric() {
      if (!ownerId) return;
      await bio.disableBiometricUnlock(ownerId);
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
      if (!remote || !ownerId) return;
      await destroyVault(remote, cache);
      await bio.disableBiometricUnlock(ownerId);
      setSession(null);
      setBiometricReady(false);
      setProbe('missing');
    },
    async signOut() {
      lock();
      if (ownerId) await bio.disableBiometricUnlock(ownerId);
      await cache?.clear();
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
