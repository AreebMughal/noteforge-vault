import { Buffer } from 'react-native-quick-crypto';
import { argon2 as qcArgon2 } from 'react-native-quick-crypto';
import VaultNative from '../../modules/vault-native/src';
import { installArgon2, type Argon2Impl } from '../core/kdbx';

const b64 = (ab: ArrayBuffer) => Buffer.from(new Uint8Array(ab)).toString('base64');

/** Android: argon2kt (reference C implementation over JNI, off the JS thread). */
const nativeImpl: Argon2Impl = async (password, salt, memoryKiB, iterations, length, parallelism, type, version) => {
  const out = await VaultNative!.argon2(b64(password), b64(salt), memoryKiB, iterations, length, parallelism, type, version);
  const bytes = Buffer.from(out, 'base64');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

/** Fallback (future iOS): quick-crypto's OpenSSL Argon2, if its OpenSSL build has it. */
const quickCryptoImpl: Argon2Impl = (password, salt, memoryKiB, iterations, length, parallelism, type, version) =>
  new Promise((resolve, reject) => {
    const algo = type === 2 ? 'argon2id' : 'argon2d';
    qcArgon2(algo, { message: new Uint8Array(password), nonce: new Uint8Array(salt), memory: memoryKiB,
      passes: iterations, tagLength: length, parallelism, version }, (err, result) => {
      if (err) return reject(err);
      resolve(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) as ArrayBuffer);
    });
  });

export function setupArgon2() {
  installArgon2(VaultNative ? nativeImpl : quickCryptoImpl);
}
