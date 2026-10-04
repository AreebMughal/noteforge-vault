/**
 * OneDrive (Microsoft Graph) access to a KeePassXC .kdbx — a port of the web
 * app's `lib/vault/onedrive.ts`, minus MSAL: the token comes from a provider
 * (src/lib/microsoft.ts on device, a fake in tests).
 *
 * The file goes phone ⇄ Microsoft directly; NoteForge's servers never see it.
 * Conflicts use the file's cTag with `If-Match`: if KeePassXC (via the
 * OneDrive desktop client) or the web app saved since we downloaded, Graph
 * answers 412 instead of overwriting, and the sync engine merges and retries.
 */
import { OfflineError, type RemoteVault, type VaultRemote } from './sync';

export const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
/** Same delegated scopes as the web app, plus a refresh token for the phone. */
export const GRAPH_SCOPES = ['Files.ReadWrite', 'User.Read', 'offline_access'];

export interface VaultFile {
  id: string;
  name: string;
  /** Path relative to the drive root, e.g. `Documents/Passwords.kdbx`. */
  path: string;
  size: number;
  /** cTag (content tag) when available, else eTag. */
  tag: string | null;
  lastModified: string;
}

export class GraphError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'GraphError';
  }
}
/** The Microsoft sign-in on this phone expired or was revoked; connect again. */
export class MicrosoftSignInRequired extends Error {
  constructor() {
    super('Sign in to Microsoft again to reach your OneDrive.');
    this.name = 'MicrosoftSignInRequired';
  }
}

/** `force` asks for a fresh token after a 401. */
export type TokenProvider = (force?: boolean) => Promise<string>;
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  eTag?: string;
  cTag?: string;
  lastModifiedDateTime?: string;
  folder?: unknown;
  deleted?: unknown;
  parentReference?: { path?: string };
  '@microsoft.graph.downloadUrl'?: string;
}

export function toVaultFile(item: DriveItem): VaultFile {
  // parentReference.path looks like "/drive/root:/Documents/Vaults".
  const parent = item.parentReference?.path ?? '';
  const folder = decodeURIComponent(parent.split('root:')[1] ?? '').replace(/^\/+|\/+$/g, '');
  return {
    id: item.id,
    name: item.name,
    path: folder ? `${folder}/${item.name}` : item.name,
    size: item.size ?? 0,
    tag: item.cTag ?? item.eTag ?? null,
    lastModified: item.lastModifiedDateTime ?? '',
  };
}

function encodePath(path: string) {
  return path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
}

/** Graph's cutoff for a plain PUT; larger files need an upload session. */
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;
/** Upload-session chunks must be a multiple of 320 KiB. */
const CHUNK_SIZE = 320 * 1024 * 16;

export class GraphClient {
  constructor(private token: TokenProvider, private fetcher: Fetch = fetch) {}

  private async raw(url: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await this.fetcher(url, init);
    } catch (e) {
      // RN: TypeError('Network request failed'); Node: TypeError('fetch failed').
      if (e instanceof TypeError) throw new OfflineError();
      throw e;
    }
  }

  async request(path: string, init: RequestInit = {}, attempt = 0, refreshed = false): Promise<Response> {
    const url = path.startsWith('http') ? path : `${GRAPH_ROOT}${path}`;
    const token = await this.token(refreshed);
    const res = await this.raw(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
    if (res.status === 401 && !refreshed) return this.request(path, init, attempt, true);
    if (res.status === 401) throw new MicrosoftSignInRequired();
    // Graph throttles per user and says how long to wait.
    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      const wait = Math.min(Number(res.headers.get('Retry-After') ?? 2), 10) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      return this.request(path, init, attempt + 1, refreshed);
    }
    return res;
  }

  async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.request(path, init);
    if (!res.ok) throw await graphError(res);
    return (await res.json()) as T;
  }

  /** The signed-in account's email/UPN, for display and as a sign-in hint. */
  async me(): Promise<string> {
    const me = await this.json<{ userPrincipalName?: string; mail?: string; displayName?: string }>('/me');
    return me.mail || me.userPrincipalName || me.displayName || 'Microsoft account';
  }

  /** Everything that looks like a KeePass database, newest first. */
  async findKdbxFiles(): Promise<VaultFile[]> {
    const r = await this.json<{ value: DriveItem[] }>("/me/drive/root/search(q='.kdbx')?$top=50");
    return r.value
      .filter((i) => !i.folder && i.name.toLowerCase().endsWith('.kdbx'))
      .map(toVaultFile)
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  }

  async getFileByPath(path: string): Promise<VaultFile> {
    const item = await this.json<DriveItem>(`/me/drive/root:/${encodePath(path)}`);
    if (item.folder) throw new Error(`${path} is a folder, not a .kdbx file.`);
    return toVaultFile(item);
  }

  /** Null when the item no longer exists (deleted, or not visible to this account). */
  async getFileById(id: string): Promise<(VaultFile & { downloadUrl?: string }) | null> {
    const res = await this.request(`/me/drive/items/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw await graphError(res);
    const item = (await res.json()) as DriveItem;
    if (item.deleted) return null;
    return { ...toVaultFile(item), downloadUrl: item['@microsoft.graph.downloadUrl'] };
  }

  /**
   * Metadata first, then the bytes from the pre-authenticated downloadUrl, so
   * the tag returned belongs to exactly these bytes (the web app's ordering).
   */
  async download(id: string): Promise<{ file: VaultFile; bytes: Uint8Array } | null> {
    const meta = await this.getFileById(id);
    if (!meta) return null;
    if (!meta.downloadUrl) throw new Error('OneDrive did not return a download link.');
    const res = await this.raw(meta.downloadUrl); // pre-authenticated: no bearer token
    if (!res.ok) throw new GraphError(res.status, 'Could not download the vault file.');
    const { downloadUrl: _ignored, ...file } = meta;
    return { file, bytes: new Uint8Array(await res.arrayBuffer()) };
  }

  /** Write unless the file moved on. Returns the new file, or null on 412 (someone else saved). */
  async upload(id: string, tag: string, bytes: Uint8Array): Promise<VaultFile | null> {
    if (bytes.byteLength > SIMPLE_UPLOAD_LIMIT) return this.uploadLarge(id, tag, bytes);
    const res = await this.request(`/me/drive/items/${encodeURIComponent(id)}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'If-Match': tag },
      body: bytes as unknown as BodyInit,
    });
    if (res.status === 412) return null;
    if (!res.ok) throw await graphError(res);
    return toVaultFile((await res.json()) as DriveItem);
  }

  /**
   * Upload sessions have no If-Match, so the tag is checked just before the
   * session opens (same small window as the web app; the next save's merge
   * still catches anything that slips through).
   */
  private async uploadLarge(id: string, tag: string, bytes: Uint8Array): Promise<VaultFile | null> {
    const current = await this.getFileById(id);
    if (!current) throw new Error('The vault file is no longer in OneDrive.');
    if (current.tag !== tag) return null;
    const session = await this.json<{ uploadUrl: string }>(`/me/drive/items/${encodeURIComponent(id)}/createUploadSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
    });
    const total = bytes.byteLength;
    let finished: DriveItem | null = null;
    for (let offset = 0; offset < total; ) {
      const end = Math.min(offset + CHUNK_SIZE, total);
      const res = await this.raw(session.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${total}` },
        body: bytes.slice(offset, end) as unknown as BodyInit,
      });
      if (!res.ok) throw await graphError(res);
      if (res.status === 200 || res.status === 201) finished = (await res.json()) as DriveItem;
      offset = end;
    }
    return finished ? toVaultFile(finished) : (await this.getFileById(id));
  }
}

async function graphError(res: Response): Promise<GraphError> {
  let message = res.statusText || `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) message = body.error.message;
  } catch {
    // Some gateway errors are HTML; the status text will do.
  }
  if (res.status === 404) message = `${message} (the path is relative to your OneDrive root)`;
  return new GraphError(res.status, message);
}

/**
 * The sync engine's view of a OneDrive file. Creating and deleting aren't
 * offered: the file belongs to KeePassXC, and "forgot master password" must
 * never delete someone's KeePass database.
 */
export function oneDriveRemote(graph: GraphClient, fileId: string): VaultRemote {
  return {
    async fetch(): Promise<RemoteVault | null> {
      const got = await graph.download(fileId);
      if (!got) return null;
      if (!got.file.tag) throw new Error('OneDrive did not report a version for the vault file.');
      return { data: got.bytes, revision: got.file.tag, name: got.file.name };
    },
    async revision() {
      const f = await graph.getFileById(fileId);
      return f ? f.tag : null;
    },
    async insert() {
      throw new Error('New vaults are created in KeePassXC; this app opens existing OneDrive files.');
    },
    async update(data, expected) {
      const f = await graph.upload(fileId, expected, data);
      if (!f) return null;
      if (!f.tag) throw new Error('OneDrive did not report a version for the saved file.');
      return f.tag;
    },
    async remove() {
      throw new Error('This app never deletes your KeePass file. Remove it in OneDrive if you mean to.');
    },
  };
}
