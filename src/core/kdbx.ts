/**
 * KDBX format helpers. Pure TypeScript on top of kdbxweb — no React Native
 * imports, so this file is unit-tested in Node (see test/core.test.ts).
 *
 * Compatibility contract with the NoteForge web app and KeePassXC:
 *  - KDBX 4, AES-256 data cipher, Argon2id KDF at 64 MiB / 4 passes / p=2.
 *  - We never rebuild entries from a view model: edits mutate the kdbxweb
 *    entry in place, so custom fields, attachments, TOTP seeds, auto-type
 *    rules and history survive every save untouched.
 */
import * as kdbxweb from 'kdbxweb';

export const ARGON2_MEMORY_BYTES = 64 * 1024 * 1024;
export const ARGON2_ITERATIONS = 4;
export const ARGON2_PARALLELISM = 2;

export type Argon2Impl = kdbxweb.CryptoEngine.Argon2Fn;

let argon2Installed = false;
export function installArgon2(impl: Argon2Impl) {
  kdbxweb.CryptoEngine.setArgon2Impl(impl);
  argon2Installed = true;
}
function assertArgon2() {
  if (!argon2Installed) throw new Error('Argon2 implementation not installed');
}

export function credentialsFromPassword(password: string): kdbxweb.KdbxCredentials {
  return new kdbxweb.KdbxCredentials(kdbxweb.ProtectedValue.fromString(password));
}

/**
 * Rebuild credentials from a cached SHA-256 password hash (biometric unlock).
 * This is the value kdbxweb itself keeps in memory while a vault is open. It
 * is NOT the master password, but it is password-equivalent for this vault.
 * (We cannot cache the Argon2 output instead: kdbxweb rotates the KDF salt on
 * every save, so a cached Argon2 key would stop working after the next write.)
 */
export async function credentialsFromPasswordHash(hash: Uint8Array): Promise<kdbxweb.KdbxCredentials> {
  const creds = new kdbxweb.KdbxCredentials(null);
  await creds.ready;
  creds.passwordHash = kdbxweb.ProtectedValue.fromBinary(toArrayBuffer(hash));
  return creds;
}

export async function exportPasswordHash(creds: kdbxweb.KdbxCredentials): Promise<Uint8Array> {
  await creds.ready;
  if (!creds.passwordHash) throw new Error('No password hash');
  return creds.passwordHash.getBinary();
}

export function applyStrongKdf(db: kdbxweb.Kdbx) {
  db.setKdf(kdbxweb.Consts.KdfId.Argon2id);
  const p = db.header.kdfParameters!;
  const VT = kdbxweb.VarDictionary.ValueType;
  p.set('M', VT.UInt64, kdbxweb.Int64.from(ARGON2_MEMORY_BYTES));
  p.set('I', VT.UInt64, kdbxweb.Int64.from(ARGON2_ITERATIONS));
  p.set('P', VT.UInt32, ARGON2_PARALLELISM);
}

export function readKdfParams(db: kdbxweb.Kdbx) {
  const p = db.header.kdfParameters!;
  const num = (v: unknown) => (v instanceof kdbxweb.Int64 ? v.value : Number(v));
  return {
    uuid: String(p.get('$UUID') ? kdbxweb.ByteUtils.bytesToBase64(p.get('$UUID') as ArrayBuffer) : ''),
    memory: num(p.get('M')),
    iterations: num(p.get('I')),
    parallelism: num(p.get('P')),
  };
}

export function createVault(creds: kdbxweb.KdbxCredentials, name = 'NoteForge Vault'): kdbxweb.Kdbx {
  assertArgon2();
  const db = kdbxweb.Kdbx.create(creds, name);
  applyStrongKdf(db);
  return db;
}

export async function openVault(bytes: Uint8Array, creds: kdbxweb.KdbxCredentials): Promise<kdbxweb.Kdbx> {
  assertArgon2();
  return kdbxweb.Kdbx.load(toArrayBuffer(bytes), creds);
}

export async function serializeVault(db: kdbxweb.Kdbx): Promise<Uint8Array> {
  return new Uint8Array(await db.save());
}

export function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** KDBX signature check that doesn't need the password. */
export function looksLikeKdbx(bytes: Uint8Array) {
  return bytes.length > 8 && bytes[0] === 0x03 && bytes[1] === 0xd9 && bytes[2] === 0xa2 && bytes[3] === 0x9a;
}

export function isWrongPasswordError(e: unknown) {
  return e instanceof kdbxweb.KdbxError && e.code === kdbxweb.Consts.ErrorCodes.InvalidKey;
}
