/**
 * Sync engine. Transport-agnostic: the remote is the account row in Supabase
 * (src/lib/supabase-remote.ts) or a KeePassXC file in OneDrive
 * (src/core/onedrive.ts); tests use an in-memory fake.
 *
 * Every remote offers compare-and-swap on an opaque revision string:
 *  - Supabase: the row's `version` int, written `where version = <last seen>`;
 *  - OneDrive: the file's cTag, written with `If-Match` (412 when stale).
 * A refused write means someone else wrote first → download, decrypt,
 * local.merge(remote), retry.
 */
import * as kdbxweb from 'kdbxweb';
import { createVault, openVault, serializeVault } from './kdbx';

export interface RemoteVault {
  data: Uint8Array;
  /** Opaque compare-and-swap token (Supabase version as text, or a OneDrive cTag). */
  revision: string;
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
  /** Cheap "what revision is it now?" without downloading. Null when the vault is gone. */
  revision?(): Promise<string | null>;
  /** Create the vault. Returns its revision. Throws if one already exists or the remote can't create. */
  insert(data: Uint8Array, name: string): Promise<string>;
  /** Conditional write. Returns the new revision, or null when `expected` is stale. */
  update(data: Uint8Array, expected: string): Promise<string | null>;
  remove(): Promise<void>;
}

/** Stores the last-synced ciphertext (still fully KDBX-encrypted). */
export interface VaultCache {
  read(): Promise<{ data: Uint8Array; revision: string } | null>;
  write(data: Uint8Array, revision: string): Promise<void>;
  clear(): Promise<void>;
}

const MAX_SAVE_ATTEMPTS = 4;

export class VaultSession {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(
    public db: kdbxweb.Kdbx,
    private creds: kdbxweb.KdbxCredentials,
    public revision: string,
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
      // Revision alone when the remote can (OneDrive): no need to download the file to know it's there.
      const there = remote.revision ? (await remote.revision()) !== null : (await remote.fetch()) !== null;
      return there ? 'exists' : 'missing';
    } catch (e) {
      if (!(e instanceof OfflineError)) throw e;
      return (await cache?.read()) ? 'offline-cached' : 'offline-empty';
    }
  }

  static async create(remote: VaultRemote, cache: VaultCache | null, creds: kdbxweb.KdbxCredentials, name?: string) {
    const db = createVault(creds, name);
    const data = await serializeVault(db);
    const revision = await remote.insert(data, db.meta.name ?? 'NoteForge Vault');
    await cache?.write(data, revision);
    return new VaultSession(db, creds, revision, remote, cache, false);
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
      return new VaultSession(db, creds, cached.revision, remote, cache, true);
    }
    if (!row) throw new Error('No vault exists for this account yet');
    const db = await openVault(row.data, creds);
    await cache?.write(row.data, row.revision);
    return new VaultSession(db, creds, row.revision, remote, cache, false);
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
      const next = await this.remote.update(data, this.revision);
      if (next !== null) {
        this.revision = next;
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
    this.revision = row.revision;
  }

  /**
   * Pull newer changes (e.g. app returned to foreground, or came back online).
   * If this session was opened offline, it becomes writable once this works.
   */
  refresh(): Promise<'unchanged' | 'updated'> {
    const run = this.queue.then(async () => {
      // Ask for the revision alone first, so an unchanged vault isn't downloaded.
      if (this.remote.revision) {
        const now = await this.remote.revision();
        if (now === null) throw new Error('The vault was deleted on another device');
        if (now === this.revision) {
          this.readOnly = false;
          return 'unchanged' as const;
        }
      }
      const row = await this.remote.fetch();
      if (!row) throw new Error('The vault was deleted on another device');
      this.readOnly = false;
      if (row.revision === this.revision) return 'unchanged' as const;
      const remoteDb = await openVault(row.data, this.creds);
      this.db.merge(remoteDb);
      this.revision = row.revision;
      await this.cache?.write(row.data, row.revision).catch(() => undefined);
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
