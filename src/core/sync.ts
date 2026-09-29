/**
 * Account-mode sync engine. Transport-agnostic (Supabase adapter lives in
 * src/lib/supabase-remote.ts; tests use an in-memory fake).
 *
 * Contract with the web app:
 *  - one row per user, `data` = base64 of the full .kdbx, `version` bumped on
 *    every write;
 *  - write with `where version = <last seen>`; zero rows means someone else
 *    wrote first → download, decrypt, local.merge(remote), retry.
 */
import * as kdbxweb from 'kdbxweb';
import { createVault, openVault, serializeVault } from './kdbx';

export interface RemoteVault {
  data: Uint8Array;
  version: number;
  name: string;
}

/** Thrown by a remote when the device is offline / the server is unreachable. */
export class OfflineError extends Error {
  constructor(message = 'You are offline') {
    super(message);
    this.name = 'OfflineError';
  }
}
export class ConflictExhaustedError extends Error {
  constructor() {
    super('The vault kept changing on another device while saving. Try again.');
    this.name = 'ConflictExhaustedError';
  }
}
export class ReadOnlyError extends Error {
  constructor() {
    super('Offline copy is read-only. Reconnect to make changes.');
    this.name = 'ReadOnlyError';
  }
}

export interface VaultRemote {
  fetch(): Promise<RemoteVault | null>;
  /** Insert the first row. Returns the new version. Throws if a row already exists. */
  insert(data: Uint8Array, name: string): Promise<number>;
  /** Conditional update. Returns the new version, or null when `expectedVersion` is stale. */
  update(data: Uint8Array, expectedVersion: number): Promise<number | null>;
  remove(): Promise<void>;
}

/** Stores the last-synced ciphertext (still fully KDBX-encrypted). */
export interface VaultCache {
  read(): Promise<{ data: Uint8Array; version: number } | null>;
  write(data: Uint8Array, version: number): Promise<void>;
  clear(): Promise<void>;
}

const MAX_SAVE_ATTEMPTS = 4;

export class VaultSession {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(
    public db: kdbxweb.Kdbx,
    private creds: kdbxweb.KdbxCredentials,
    public version: number,
    private remote: VaultRemote,
    private cache: VaultCache | null,
    /** True when opened from the offline cache; edits are refused until reconnect. */
    public readOnly: boolean,
  ) {}

  get credentials() {
    return this.creds;
  }

  /** Does the account already have a vault row? Falls back to the cache when offline. */
  static async probe(remote: VaultRemote, cache: VaultCache | null): Promise<'exists' | 'missing' | 'offline-cached' | 'offline-empty'> {
    try {
      return (await remote.fetch()) ? 'exists' : 'missing';
    } catch (e) {
      if (!(e instanceof OfflineError)) throw e;
      return (await cache?.read()) ? 'offline-cached' : 'offline-empty';
    }
  }

  static async create(remote: VaultRemote, cache: VaultCache | null, creds: kdbxweb.KdbxCredentials, name?: string) {
    const db = createVault(creds, name);
    const data = await serializeVault(db);
    const version = await remote.insert(data, db.meta.name ?? 'NoteForge Vault');
    await cache?.write(data, version);
    return new VaultSession(db, creds, version, remote, cache, false);
  }

  /**
   * Download + decrypt. Offline, decrypt the cached copy read-only. Wrong
   * passwords surface as kdbxweb InvalidKey errors (see isWrongPasswordError).
   */
  static async unlock(remote: VaultRemote, cache: VaultCache | null, creds: kdbxweb.KdbxCredentials) {
    let row: RemoteVault | null;
    try {
      row = await remote.fetch();
    } catch (e) {
      if (!(e instanceof OfflineError) || !cache) throw e;
      const cached = await cache.read();
      if (!cached) throw e;
      const db = await openVault(cached.data, creds);
      return new VaultSession(db, creds, cached.version, remote, cache, true);
    }
    if (!row) throw new Error('No vault exists for this account yet');
    const db = await openVault(row.data, creds);
    await cache?.write(row.data, row.version);
    return new VaultSession(db, creds, row.version, remote, cache, false);
  }

  /** Serialize saves so two quick edits never race each other. */
  save(): Promise<{ merged: boolean }> {
    const run = this.queue.then(() => this.saveNow());
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async saveNow(): Promise<{ merged: boolean }> {
    if (this.readOnly) throw new ReadOnlyError();
    let merged = false;
    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt++) {
      const data = await serializeVault(this.db);
      const next = await this.remote.update(data, this.version);
      if (next !== null) {
        this.version = next;
        this.db.removeLocalEditState();
        await this.cache?.write(data, next).catch(() => undefined);
        return { merged };
      }
      await this.pullAndMerge();
      merged = true;
    }
    throw new ConflictExhaustedError();
  }

  private async pullAndMerge() {
    const row = await this.remote.fetch();
    if (!row) throw new Error('The vault was deleted on another device');
    const remoteDb = await openVault(row.data, this.creds);
    this.db.merge(remoteDb);
    this.version = row.version;
  }

  /**
   * Pull newer changes (e.g. app returned to foreground, or came back online).
   * If this session was opened offline, it becomes writable once this works.
   */
  refresh(): Promise<'unchanged' | 'updated'> {
    const run = this.queue.then(async () => {
      const row = await this.remote.fetch();
      if (!row) throw new Error('The vault was deleted on another device');
      this.readOnly = false;
      if (row.version === this.version) return 'unchanged' as const;
      const remoteDb = await openVault(row.data, this.creds);
      this.db.merge(remoteDb);
      this.version = row.version;
      await this.cache?.write(row.data, row.version).catch(() => undefined);
      return 'updated' as const;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Bytes for Export/Share: a fresh save of the current state. */
  exportBytes() {
    return serializeVault(this.db);
  }
}

/** "Forgot master password": nothing can recover it, so start over. */
export async function destroyVault(remote: VaultRemote, cache: VaultCache | null) {
  await remote.remove();
  await cache?.clear();
}
