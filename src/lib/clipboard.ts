import VaultNative from '../../modules/vault-native/src';
import { CLIPBOARD_CLEAR_MS } from './config';

/** Copies marked sensitive; a native timer clears it after 15 s (best effort). */
export async function copySecret(text: string) {
  await native().copySensitive(text, CLIPBOARD_CLEAR_MS);
}
/** Same as copySecret but never auto-cleared (usernames aren't secret). Fails loudly, never silently. */
export async function copyPlain(text: string) {
  await native().copySensitive(text, 0);
}
function native() {
  if (!VaultNative) throw new Error('Clipboard module unavailable on this platform');
  return VaultNative;
}
export async function clearClipboard() {
  await VaultNative?.clearClipboardNow();
}
