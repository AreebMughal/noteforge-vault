import VaultNative from '../../modules/vault-native/src';
import { CLIPBOARD_CLEAR_MS } from './config';

/** Copies marked sensitive; a native timer clears it after 15 s (best effort). */
export async function copySecret(text: string) {
  if (!VaultNative) throw new Error('Clipboard module unavailable on this platform');
  await VaultNative.copySensitive(text, CLIPBOARD_CLEAR_MS);
}
export async function copyPlain(text: string) {
  if (!VaultNative) return;
  await VaultNative.copySensitive(text, 0);
}
export async function clearClipboard() {
  await VaultNative?.clearClipboardNow();
}
