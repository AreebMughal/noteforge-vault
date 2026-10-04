/**
 * Core tests, run in Node with `npm test`. hash-wasm stands in for the native
 * Argon2 module (Node supports WASM; Hermes doesn't). A cross-check at the end
 * proves both give identical output for the same inputs.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as kdbxweb from 'kdbxweb';
import { argon2id, argon2d } from 'hash-wasm';
import {
  installArgon2, credentialsFromPassword, credentialsFromPasswordHash, exportPasswordHash,
  openVault, readKdfParams, isWrongPasswordError, looksLikeKdbx,
} from '../src/core/kdbx';
import { customIconUris, iconMime, createEntry, findEntry, listEntries, updateEntry, fieldText, hiddenExtras, generatePassword, deleteEntry, addCustomIcon, iconChoiceOf } from '../src/core/entries';
import { encodePng } from '../src/core/png';
import { VaultSession, VaultRemote, OfflineError, VaultCache, ReadOnlyError } from '../src/core/sync';

const hashWasmArgon2: Parameters<typeof installArgon2>[0] = async (password, salt, memory, iterations, length, parallelism, type, version) => {
  const fn = type === 2 ? argon2id : argon2d;
  const out = await fn({
    password: new Uint8Array(password), salt: new Uint8Array(salt), memorySize: memory,
    iterations, hashLength: length, parallelism, outputType: 'binary',
  });
  if (version !== 0x13) throw new Error('only v1.3 in tests');
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
};
installArgon2(hashWasmArgon2);

class FakeRemote implements VaultRemote {
  row: { data: Uint8Array; revision: string; name: string } | null = null;
  offline = false;
  writes = 0;
  async fetch() {
    if (this.offline) throw new OfflineError();
    return this.row && { ...this.row, data: this.row.data.slice() };
  }
  async insert(data: Uint8Array, name: string) {
    if (this.row) throw new Error('duplicate');
    this.row = { data, revision: '1', name };
    return '1';
  }
  async update(data: Uint8Array, expected: string) {
    if (this.offline) throw new OfflineError();
    if (!this.row || this.row.revision !== expected) return null;
    this.writes++;
    this.row = { ...this.row, data, revision: String(Number(expected) + 1) };
    return this.row.revision;
  }
  async remove() { this.row = null; }
}
class MemCache implements VaultCache {
  v: { data: Uint8Array; revision: string } | null = null;
  async read() { return this.v; }
  async write(data: Uint8Array, revision: string) { this.v = { data, revision }; }
  async clear() { this.v = null; }
}
const blank = { title: '', username: '', password: '', url: '', notes: '' };

test('new vault uses Argon2id 64 MiB / 4 / 2 and survives a round trip', async () => {
  const remote = new FakeRemote();
  const s = await VaultSession.create(remote, null, credentialsFromPassword('correct horse'));
  const bytes = remote.row!.data;
  assert.ok(looksLikeKdbx(bytes));
  const db = await openVault(bytes, credentialsFromPassword('correct horse'));
  const kdf = readKdfParams(db);
  assert.equal(kdf.uuid, kdbxweb.Consts.KdfId.Argon2id);
  assert.deepEqual([kdf.memory, kdf.iterations, kdf.parallelism], [64 * 1024 * 1024, 4, 2]);
  assert.equal(db.header.versionMajor, 4);
  assert.equal(s.revision, '1');
});

test('wrong password is reported as such', async () => {
  const remote = new FakeRemote();
  await VaultSession.create(remote, null, credentialsFromPassword('a'));
  await assert.rejects(VaultSession.unlock(remote, null, credentialsFromPassword('b')), (e) => isWrongPasswordError(e));
});

test('custom fields, attachments and history are preserved through an edit', async () => {
  const remote = new FakeRemote();
  const s = await VaultSession.create(remote, null, credentialsFromPassword('pw'));
  const e = createEntry(s.db, null, { ...blank, title: 'Bank', password: 'old' });
  e.fields.set('otp', kdbxweb.ProtectedValue.fromString('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP'));
  e.fields.set('PIN', kdbxweb.ProtectedValue.fromString('1234'));
  const bin = await s.db.createBinary(kdbxweb.ProtectedValue.fromString('attachment body'));
  e.binaries.set('note.txt', bin);
  e.autoType.items.push({ window: 'Bank*', keystrokeSequence: '{USERNAME}{TAB}{PASSWORD}{ENTER}' });
  await s.save();

  const s2 = await VaultSession.unlock(remote, null, credentialsFromPassword('pw'));
  const e2 = findEntry(s2.db, e.uuid.id)!;
  updateEntry(e2, { password: 'new' });
  await s2.save();

  const db = await openVault(remote.row!.data, credentialsFromPassword('pw'));
  const e3 = findEntry(db, e.uuid.id)!;
  assert.equal(fieldText(e3, 'Password'), 'new');
  assert.equal(fieldText(e3, 'PIN'), '1234');
  assert.match(fieldText(e3, 'otp'), /^otpauth:/);
  assert.equal(e3.binaries.size, 1);
  assert.equal(e3.autoType.items[0]?.window, 'Bank*');
  assert.equal(e3.history.length, 1);
  assert.equal(fieldText(e3.history[0], 'Password'), 'old');
  assert.deepEqual(hiddenExtras(e3).attachments, ['note.txt']);
});

test('write conflict → merge → both devices\u2019 changes survive', async () => {
  const remote = new FakeRemote();
  const phone = await VaultSession.create(remote, null, credentialsFromPassword('pw'));
  const shared = createEntry(phone.db, null, { ...blank, title: 'Shared', username: 'u' });
  await phone.save();

  const web = await VaultSession.unlock(remote, null, credentialsFromPassword('pw'));
  createEntry(web.db, null, { ...blank, title: 'Added on web' });
  await new Promise((r) => setTimeout(r, 5));
  await web.save(); // web wins the race; phone's version is now stale

  createEntry(phone.db, null, { ...blank, title: 'Added on phone' });
  await new Promise((r) => setTimeout(r, 5));
  updateEntry(findEntry(phone.db, shared.uuid.id)!, { username: 'renamed on phone' });
  const res = await phone.save();
  assert.equal(res.merged, true);

  const final = await openVault(remote.row!.data, credentialsFromPassword('pw'));
  const titles = listEntries(final).map((e) => e.title).sort();
  assert.deepEqual(titles, ['Added on phone', 'Added on web', 'Shared']);
  assert.equal(fieldText(findEntry(final, shared.uuid.id)!, 'UserName'), 'renamed on phone');
  assert.equal(remote.row!.revision, '4');
});

test('deletion on one device is not resurrected by the other', async () => {
  const remote = new FakeRemote();
  const a = await VaultSession.create(remote, null, credentialsFromPassword('pw'));
  a.db.createRecycleBin();
  const doomed = createEntry(a.db, null, { ...blank, title: 'Doomed' });
  await a.save();
  const b = await VaultSession.unlock(remote, null, credentialsFromPassword('pw'));
  // KDBX 4 stores times in whole seconds, so KeePass-style merging (here and in
  // KeePassXC) can't order two changes to the same entry within one second.
  await new Promise((r) => setTimeout(r, 1100));
  deleteEntry(b.db, findEntry(b.db, doomed.uuid.id)!);
  await b.save();
  await new Promise((r) => setTimeout(r, 5));
  createEntry(a.db, null, { ...blank, title: 'Other' });
  await a.save();
  const final = await openVault(remote.row!.data, credentialsFromPassword('pw'));
  assert.deepEqual(listEntries(final).map((e) => e.title), ['Other']);
});

test('offline unlock uses the encrypted cache read-only, then becomes writable', async () => {
  const remote = new FakeRemote();
  const cache = new MemCache();
  const s = await VaultSession.create(remote, cache, credentialsFromPassword('pw'));
  createEntry(s.db, null, { ...blank, title: 'Cached' });
  await s.save();
  assert.ok(looksLikeKdbx(cache.v!.data)); // cache holds ciphertext only
  remote.offline = true;
  const off = await VaultSession.unlock(remote, cache, credentialsFromPassword('pw'));
  assert.equal(off.readOnly, true);
  assert.deepEqual(listEntries(off.db).map((e) => e.title), ['Cached']);
  await assert.rejects(off.save(), ReadOnlyError);
  remote.offline = false;
  await off.refresh();
  assert.equal(off.readOnly, false);
  createEntry(off.db, null, { ...blank, title: 'After reconnect' });
  await off.save();
});

test('biometric path: cached password hash reopens the vault after a salt-rotating save', async () => {
  const remote = new FakeRemote();
  const creds = credentialsFromPassword('pw');
  const s = await VaultSession.create(remote, null, creds);
  const hash = await exportPasswordHash(creds);
  createEntry(s.db, null, { ...blank, title: 'x' });
  await s.save(); // rotates the KDF salt
  const s2 = await VaultSession.unlock(remote, null, await credentialsFromPasswordHash(hash));
  assert.equal(listEntries(s2.db).length, 1);
});

test('password generator', () => {
  const p = generatePassword(32);
  assert.equal(p.length, 32);
  assert.notEqual(p, generatePassword(32));
});

test('self-test passes with a correct crypto stack', async () => {
  const { runSelfTest } = await import('../src/core/selftest');
  const r = await runSelfTest();
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('self-test catches a broken Argon2', async () => {
  const { runSelfTest } = await import('../src/core/selftest');
  installArgon2(async () => new ArrayBuffer(32));
  const r = await runSelfTest();
  assert.equal(r.ok, false);
  installArgon2(hashWasmArgon2);
});

test('custom icons stored in the vault surface as data URIs; unknown formats fall back', async () => {
  const remote = new FakeRemote();
  const s = await VaultSession.create(remote, null, credentialsFromPassword('pw'));
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
  const ico = Uint8Array.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 0, 0, 0]);
  const pngId = kdbxweb.KdbxUuid.random(), icoId = kdbxweb.KdbxUuid.random();
  s.db.meta.customIcons.set(pngId.id, { data: png.buffer });
  s.db.meta.customIcons.set(icoId.id, { data: ico.buffer });
  const withIcon = createEntry(s.db, null, { ...blank, title: 'With icon' });
  withIcon.customIcon = pngId;
  const withIco = createEntry(s.db, null, { ...blank, title: 'Ico' });
  withIco.customIcon = icoId;
  createEntry(s.db, null, { ...blank, title: 'Plain' });
  await s.save();
  const db = await openVault(remote.row!.data, credentialsFromPassword('pw'));
  const uris = customIconUris(db);
  const byTitle = Object.fromEntries(listEntries(db).map((e) => [e.title, e.customIconId]));
  assert.ok(byTitle['With icon'] && uris.get(byTitle['With icon'])!.startsWith('data:image/png;base64,'));
  assert.ok(byTitle['Ico'] && !uris.has(byTitle['Ico']));   // stored, but shown as the initial
  assert.equal(byTitle['Plain'], null);
  assert.equal(iconMime(ico), null);
});

test('icons picked on the phone are stored once, survive save and merge, and keep history', async () => {
  const remote = new FakeRemote();
  const s = await VaultSession.create(remote, null, credentialsFromPassword('pw'));
  const png = encodePng(1, 1, Uint8Array.from([255, 0, 0, 255]));
  const e = createEntry(s.db, null, { ...blank, title: 'Site' }, { standard: 37 });
  assert.deepEqual(iconChoiceOf(s.db, e), { standard: 37 });
  const id = addCustomIcon(s.db, png);
  assert.equal(addCustomIcon(s.db, png.slice()), id); // identical bytes reuse the icon
  assert.throws(() => addCustomIcon(s.db, Uint8Array.from([1, 2, 3])));
  assert.equal(updateEntry(e, { icon: { customId: id } }, s.db), true);
  assert.equal(updateEntry(e, { icon: { customId: id } }, s.db), false); // no-op is not a change
  assert.equal(e.history.length, 1);
  assert.equal(e.history[0].icon, 37);
  await s.save();

  // A concurrent write elsewhere forces a merge; the icon must come through it.
  const other = await VaultSession.unlock(remote, null, credentialsFromPassword('pw'));
  createEntry(other.db, null, { ...blank, title: 'Other' });
  await other.save();
  await new Promise((r) => setTimeout(r, 1100));
  createEntry(s.db, null, { ...blank, title: 'Local' });
  assert.equal((await s.save()).merged, true);

  const db = await openVault(remote.row!.data, credentialsFromPassword('pw'));
  const site = listEntries(db).find((x) => x.title === 'Site')!;
  assert.equal(site.customIconId, id);
  assert.equal(new Uint8Array(db.meta.customIcons.get(id)!.data).length, png.length);
  assert.ok(customIconUris(db).get(id)!.startsWith('data:image/png;base64,'));

  // Back to a standard icon clears the custom one.
  const again = findEntry(db, site.id)!;
  updateEntry(again, { icon: { standard: 0 } }, db);
  assert.equal(again.customIcon, undefined);
  assert.deepEqual(iconChoiceOf(db, again), { standard: 0 });
});

test('list model says whether a password exists without carrying it', async () => {
  const remote = new FakeRemote();
  const s = await VaultSession.create(remote, null, credentialsFromPassword('pw'));
  createEntry(s.db, null, { ...blank, title: 'With', password: 'hunter2' });
  createEntry(s.db, null, { ...blank, title: 'Without' });
  const rows = Object.fromEntries(listEntries(s.db).map((e) => [e.title, e]));
  assert.equal(rows.With.hasPassword, true);
  assert.equal(rows.Without.hasPassword, false);
  assert.ok(!JSON.stringify(rows).includes('hunter2'));
});
