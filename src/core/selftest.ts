/**
 * On-device known-answer test of the whole crypto stack (Argon2id, AES-CBC,
 * HMAC-SHA256, SHA-256/512, gzip, XML). Runs once per app start before any
 * real vault is touched, so a broken polyfill can never corrupt user data.
 */
import * as kdbxweb from 'kdbxweb';
import { credentialsFromPassword, openVault, serializeVault } from './kdbx';
import { fieldText, listEntries, findEntry } from './entries';
import { ARGON2ID_KAT_HEX, SELFTEST_ENTRY_PASSWORD, SELFTEST_KDBX_B64, SELFTEST_PASSWORD } from './selftest-fixture';

export async function runSelfTest(): Promise<{ ok: true; ms: number } | { ok: false; step: string; error: string }> {
  const t0 = Date.now();
  let step = 'argon2id known answer';
  try {
    const kat = await kdbxweb.CryptoEngine.argon2(
      new Uint8Array(32).fill(7).buffer, new Uint8Array(32).fill(9).buffer, 64, 3, 32, 2,
      kdbxweb.CryptoEngine.Argon2TypeArgon2id, 0x13,
    );
    if (kdbxweb.ByteUtils.bytesToHex(kat) !== ARGON2ID_KAT_HEX) throw new Error('Argon2id output mismatch');

    step = 'open reference .kdbx';
    const bytes = new Uint8Array(kdbxweb.ByteUtils.base64ToBytes(SELFTEST_KDBX_B64));
    const db = await openVault(bytes, credentialsFromPassword(SELFTEST_PASSWORD));
    const summary = listEntries(db)[0];
    if (!summary || fieldText(findEntry(db, summary.id)!, 'Password') !== SELFTEST_ENTRY_PASSWORD)
      throw new Error('Decrypted content mismatch');

    step = 'save and reopen';
    const again = await openVault(await serializeVault(db), credentialsFromPassword(SELFTEST_PASSWORD));
    if (listEntries(again).length !== 1) throw new Error('Round trip lost data');
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, step, error: e instanceof Error ? e.message : String(e) };
  }
}
