import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Settings {
  /** Minutes of inactivity before locking. 0 = lock as soon as the app leaves the screen. */
  autoLockMinutes: number;
  /** Days a biometric quick-unlock stays valid before the master password is required again. */
  biometricDays: number;
}
export const DEFAULT_SETTINGS: Settings = { autoLockMinutes: 5, biometricDays: 7 };
const KEY = 'nf-settings-v1';

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export async function saveSettings(s: Settings) {
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
}
