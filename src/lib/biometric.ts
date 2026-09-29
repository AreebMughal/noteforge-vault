/**
 * Opt-in biometric quick-unlock. Stores kdbxweb's SHA-256 password hash —
 * never the master password — in the Android Keystore behind a biometric
 * prompt. It expires after the chosen number of days, and is dropped on
 * sign-out, on "forgot password", and whenever the user turns it off.
 */
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'react-native-quick-crypto';

const keyFor = (owner: string) => `bio-hash-${owner.replace(/[^A-Za-z0-9-]/g, '')}`;
const metaFor = (owner: string) => `bio-meta-${owner}`;
const secureOpts = (prompt?: string): SecureStore.SecureStoreOptions => ({
  requireAuthentication: true,
  authenticationPrompt: prompt ?? 'Unlock NoteForge Vault',
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
});

export async function biometricsAvailable() {
  const [hw, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
  return hw && enrolled && SecureStore.canUseBiometricAuthentication();
}

export async function hasBiometricUnlock(owner: string) {
  const raw = await AsyncStorage.getItem(metaFor(owner));
  if (!raw) return false;
  const { expiresAt } = JSON.parse(raw) as { expiresAt: number };
  if (Date.now() > expiresAt) {
    await disableBiometricUnlock(owner);
    return false;
  }
  return true;
}

export async function enableBiometricUnlock(owner: string, passwordHash: Uint8Array, days: number) {
  await SecureStore.setItemAsync(keyFor(owner), Buffer.from(passwordHash).toString('base64'), secureOpts('Confirm to turn on fingerprint unlock'));
  await AsyncStorage.setItem(metaFor(owner), JSON.stringify({ expiresAt: Date.now() + days * 86_400_000 }));
}

/** Shows the system biometric prompt. Returns null if cancelled or expired. */
export async function readBiometricHash(owner: string): Promise<Uint8Array | null> {
  if (!(await hasBiometricUnlock(owner))) return null;
  try {
    const v = await SecureStore.getItemAsync(keyFor(owner), secureOpts());
    return v ? new Uint8Array(Buffer.from(v, 'base64')) : null;
  } catch {
    return null; // cancelled, or keystore key invalidated by a new fingerprint enrolment
  }
}

export async function disableBiometricUnlock(owner: string) {
  await AsyncStorage.removeItem(metaFor(owner));
  try {
    await SecureStore.deleteItemAsync(keyFor(owner), secureOpts());
  } catch {
    /* already gone */
  }
}
