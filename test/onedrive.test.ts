/**
 * OneDrive remote against an in-memory fake of the Graph endpoints it uses,
 * plus the shared vault preference format. Runs offline.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { argon2id, argon2d } from 'hash-wasm';
import { installArgon2, credentialsFromPassword, createVault, openVault, serializeVault } from '../src/core/kdbx';
import { createEntry, listEntries } from '../src/core/entries';
import { VaultSession, OfflineError } from '../src/core/sync';
import { GraphClient, MicrosoftSignInRequired, oneDriveRemote, toVaultFile, type Fetch } from '../src/core/onedrive';
import { parsePreference, oneDrivePreference, accountPreference } from '../src/core/preference';

installArgon2(async (password, salt, memory, iterations, length, parallelism, type) => {
  const fn = type === 2 ? argon2id : argon2d;
  const out = await fn({
    password: new Uint8Array(password), salt: new Uint8Array(salt), memorySize: memory,
    iterations, hashLength: length, parallelism, outputType: 'binary',
  });
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
});

const blank = { title: '', username: '', password: '', url: '', notes: '' };

/** One file in a fake drive. Bumps cTag on every write, honours If-Match. */
class FakeDrive {
  bytes = new Uint8Array();
  tag = 1;
  deleted = false;
  offline = false;
  validToken = 'tok-1';
  calls: string[] = [];
  readonly id = 'FILE!1';

  fetch: Fetch = async (url, init = {}) => {
    if (this.offline) throw new TypeError('Network request failed');
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    this.calls.push(`${method} ${url.replace('https://graph.microsoft.com/v1.0', '')}`);
    if (url === 'https://download.example/file') {
      return new Response(this.bytes.slice() as unknown as BodyInit, { status: 200 });
    }
    if (headers.Authorization !== `Bearer ${this.validToken}`) return json(401, { error: { message: 'expired' } });
    const item = `/me/drive/items/${encodeURIComponent(this.id)}`;
    if (url.endsWith(item) && method === 'GET') {
      if (this.deleted) return json(404, { error: { message: 'itemNotFound' } });
      return json(200, {
        id: this.id, name: 'Passwords.kdbx', size: this.bytes.length, cTag: `c${this.tag}`,
        parentReference: { path: '/drive/root:/Documents' },
        '@microsoft.graph.downloadUrl': 'https://download.example/file',
      });
    }
    if (url.endsWith(`${item}/content`) && method === 'PUT') {
      if (headers['If-Match'] !== `c${this.tag}`) return json(412, { error: { message: 'precondition failed' } });
      this.bytes = new Uint8Array(init.body as Uint8Array).slice();
      this.tag++;
      return json(200, { id: this.id, name: 'Passwords.kdbx', cTag: `c${this.tag}`, parentReference: { path: '/drive/root:/Documents' } });
    }
    return json(404, { error: { message: `no route ${method} ${url}` } });
  };
}
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('preference format: round trip, tolerant of junk (same shape as the web app)', () => {
  const od = oneDrivePreference({ fileId: 'F1', path: 'Documents/P.kdbx', account: 'me@outlook.com' }, new Date(0));
  assert.deepEqual(parsePreference(JSON.parse(JSON.stringify(od))), od);
  assert.deepEqual(parsePreference(accountPreference(new Date(0))), { v: 1, source: 'account', updatedAt: '1970-01-01T00:00:00.000Z' });
  assert.deepEqual(parsePreference({ source: 'onedrive', onedrive: { fileId: 'F', path: 'p' } }),
    { v: 1, source: 'onedrive', onedrive: { fileId: 'F', path: 'p' }, updatedAt: '' });
  for (const junk of [null, undefined, 'x', 1, {}, { source: 'dropbox' }, { source: 'onedrive' }, { source: 'onedrive', onedrive: { fileId: 3 } }]) {
    assert.equal(parsePreference(junk), null);
  }
});

test('drive item paths are relative to the drive root', () => {
  assert.equal(toVaultFile({ id: '1', name: 'a.kdbx', parentReference: { path: '/drive/root:/My%20Docs/Vaults' } }).path, 'My Docs/Vaults/a.kdbx');
  assert.equal(toVaultFile({ id: '1', name: 'a.kdbx', parentReference: { path: '/drive/root:' } }).path, 'a.kdbx');
});

test('OneDrive vault: open, save with If-Match, merge a KeePassXC edit on 412', async () => {
  const drive = new FakeDrive();
  // "KeePassXC" made the file: a normal vault, written straight into the drive.
  const creds = () => credentialsFromPassword('kp pass');
  const desktop = createVault(creds(), 'Passwords');
  createEntry(desktop, null, { ...blank, title: 'From KeePassXC' });
  drive.bytes = await serializeVault(desktop);

  let tokens = 0;
  const graph = new GraphClient(async (force) => {
    tokens++;
    return force || tokens > 1 ? drive.validToken : 'stale-token'; // first token is stale → 401 → refresh
  }, drive.fetch);
  const remote = oneDriveRemote(graph, drive.id);

  const phone = await VaultSession.unlock(remote, null, creds());
  assert.equal(phone.revision, 'c1');
  assert.deepEqual(listEntries(phone.db).map((e) => e.title), ['From KeePassXC']);

  // Meanwhile KeePassXC saves (tag moves to c2).
  await new Promise((r) => setTimeout(r, 1100));
  const desktop2 = await openVault(drive.bytes, creds());
  createEntry(desktop2, null, { ...blank, title: 'Desktop later' });
  drive.bytes = await serializeVault(desktop2);
  drive.tag++;

  createEntry(phone.db, null, { ...blank, title: 'From phone' });
  const r = await phone.save();
  assert.equal(r.merged, true);              // first PUT got 412, merged, retried
  assert.equal(phone.revision, `c${drive.tag}`);
  const final = await openVault(drive.bytes, creds());
  assert.deepEqual(listEntries(final).map((e) => e.title).sort(), ['Desktop later', 'From KeePassXC', 'From phone']);
  assert.ok(drive.calls.filter((c) => c.startsWith('PUT')).length === 2);

  // refresh() with no change asks only for metadata, no download.
  drive.calls = [];
  assert.equal(await phone.refresh(), 'unchanged');
  assert.deepEqual(drive.calls, [`GET /me/drive/items/${encodeURIComponent(drive.id)}`]);

  // Offline and deleted files surface as such.
  drive.offline = true;
  await assert.rejects(remote.fetch(), OfflineError);
  drive.offline = false;
  drive.deleted = true;
  assert.equal(await remote.fetch(), null);
  assert.equal(await remote.revision!(), null);

  // Creating or deleting KeePass files is refused.
  await assert.rejects(remote.insert(new Uint8Array(), 'x'));
  await assert.rejects(remote.remove());
});

test('a token that stays invalid asks the user to sign in to Microsoft again', async () => {
  const drive = new FakeDrive();
  const graph = new GraphClient(async () => 'never-valid', drive.fetch);
  await assert.rejects(graph.getFileById(drive.id), MicrosoftSignInRequired);
});
