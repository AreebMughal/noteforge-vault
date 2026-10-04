/**
 * Offline cache: the same KDBX ciphertext the remote holds, per user and per
 * vault, in the app's private document directory (android:allowBackup is off).
 * `vaultKey` is the Supabase user id for the account vault, or user id + the
 * OneDrive item id for a KeePassXC file.
 */
import { File, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { VaultCache } from '../core/sync';

export function fileCache(vaultKey: string): VaultCache {
  const safe = vaultKey.replace(/[^A-Za-z0-9-]/g, '');
  const file = () => new File(Paths.document, `vault-${safe}.kdbx`);
  // Name kept from when this was a version number; the value is now any revision string.
  const versionKey = `vault-cache-version-${safe}`;
  return {
    async read() {
      const f = file();
      const v = await AsyncStorage.getItem(versionKey);
      if (!f.exists || !v) return null;
      return { data: await f.bytes(), revision: v };
    },
    async write(data, revision) {
      const f = file();
      if (!f.exists) f.create();
      f.write(data);
      await AsyncStorage.setItem(versionKey, revision);
    },
    async clear() {
      const f = file();
      if (f.exists) f.delete();
      await AsyncStorage.removeItem(versionKey);
    },
  };
}
