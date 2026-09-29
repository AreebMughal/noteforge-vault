/**
 * Offline cache: the same KDBX ciphertext Supabase holds, per user, in the
 * app's private document directory (android:allowBackup is off).
 */
import { File, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { VaultCache } from '../core/sync';

export function fileCache(ownerId: string): VaultCache {
  const safe = ownerId.replace(/[^A-Za-z0-9-]/g, '');
  const file = () => new File(Paths.document, `vault-${safe}.kdbx`);
  const versionKey = `vault-cache-version-${safe}`;
  return {
    async read() {
      const f = file();
      const v = await AsyncStorage.getItem(versionKey);
      if (!f.exists || !v) return null;
      return { data: await f.bytes(), version: Number(v) };
    },
    async write(data, version) {
      const f = file();
      if (!f.exists) f.create();
      f.write(data);
      await AsyncStorage.setItem(versionKey, String(version));
    },
    async clear() {
      const f = file();
      if (f.exists) f.delete();
      await AsyncStorage.removeItem(versionKey);
    },
  };
}
