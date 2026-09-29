import 'react-native-url-polyfill/auto';
import { install } from 'react-native-quick-crypto';

// Sets global.crypto (WebCrypto: subtle + getRandomValues) and global.Buffer,
// both backed by native OpenSSL via JSI. kdbxweb detects global.crypto.subtle
// and uses it for SHA-256/512, HMAC and AES-CBC.
install();

// Hermes on RN 0.74+ ships TextEncoder, TextDecoder, atob and btoa. Fail loudly
// rather than silently producing corrupt vaults if that ever regresses.
for (const name of ['TextEncoder', 'TextDecoder', 'atob', 'btoa'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[name] === 'undefined') {
    throw new Error(`Missing runtime global: ${name}`);
  }
}
