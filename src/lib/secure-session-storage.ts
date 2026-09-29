/**
 * Supabase session storage: the session JSON is AES-256-GCM encrypted in
 * AsyncStorage with a random key held in the Android Keystore via SecureStore
 * (Supabase's recommended "LargeSecureStore" pattern — sessions can exceed
 * what SecureStore should hold directly).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { createCipheriv, createDecipheriv, randomBytes } from 'react-native-quick-crypto';
import { Buffer } from 'react-native-quick-crypto';

const opts: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const keyName = (k: string) => `sess-key-${k.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export const secureSessionStorage = {
  async getItem(key: string) {
    const [blob, k] = await Promise.all([AsyncStorage.getItem(key), SecureStore.getItemAsync(keyName(key), opts)]);
    if (!blob || !k) return null;
    try {
      const raw = Buffer.from(blob, 'base64');
      const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), ct = raw.subarray(28);
      const d = createDecipheriv('aes-256-gcm', Buffer.from(k, 'base64'), iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string) {
    const k = randomBytes(32);
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', k, iv);
    const ct = Buffer.concat([c.update(Buffer.from(value, 'utf8')), c.final()]);
    const blob = Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
    await SecureStore.setItemAsync(keyName(key), Buffer.from(k).toString('base64'), opts);
    await AsyncStorage.setItem(key, blob);
  },
  async removeItem(key: string) {
    await Promise.all([AsyncStorage.removeItem(key), SecureStore.deleteItemAsync(keyName(key), opts)]);
  },
};
