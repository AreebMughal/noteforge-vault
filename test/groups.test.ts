import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as kdbxweb from 'kdbxweb';
import { argon2id } from 'hash-wasm';
import { installArgon2, credentialsFromPassword } from '../src/core/kdbx';
import { createGroup, deleteGroup, findGroup, listGroups, renameGroup } from '../src/core/entries';

installArgon2(async (password, salt, memory, iterations, length, parallelism) => {
  const out = await argon2id({
    password: new Uint8Array(password), salt: new Uint8Array(salt), memorySize: memory,
    iterations, hashLength: length, parallelism, outputType: 'binary',
  });
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
});

test('groups can be created, renamed and deleted', () => {
  const db = kdbxweb.Kdbx.create(credentialsFromPassword('x'), 'Vault');
  const g = createGroup(db, null, 'Work');
  assert.deepEqual(listGroups(db).map((x) => x.name), ['Vault', 'Work']);
  renameGroup(g, 'Office');
  assert.equal(listGroups(db)[1].name, 'Office');
  deleteGroup(db, findGroup(db, g.uuid.id)!);
  assert.deepEqual(listGroups(db).map((x) => x.name), ['Vault']);
});
