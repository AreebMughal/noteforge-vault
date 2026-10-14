import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Settings {
  /** Minutes of inactivity before locking. 0 = lock as soon as the app leaves the screen. */
  autoLockMinutes: number;
  /** Days a biometric quick-unlock stays valid before the master password is required again. */
  biometricDays: number;
}
export const DEFAULT_SETTINGS: Settings = { autoLockMinutes: 5, biometricDays: 7 };
const KEY = 'nf-settings-v1';

/** 'system' follows Android's light/dark setting. Only affects this app, never the web app. */
export type ThemeMode = 'system' | 'light' | 'dark';
const isThemeMode = (v: unknown): v is ThemeMode => v === 'system' || v === 'light' || v === 'dark';
// Kept per signed-in user on this phone (not in the database), plus the last one used,
// so the sign-in screen already matches before anyone is signed in.
const themeKey = (owner: string | null) => (owner ? `nf-theme-${owner}` : 'nf-theme-last');

export async function loadTheme(owner: string | null): Promise<ThemeMode | null> {
  try {
    const v = await AsyncStorage.getItem(themeKey(owner));
    return isThemeMode(v) ? v : null;
  } catch {
    return null;
  }
}
export async function saveTheme(owner: string | null, mode: ThemeMode) {
  await AsyncStorage.setItem(themeKey(null), mode).catch(() => undefined);
  if (owner) await AsyncStorage.setItem(themeKey(owner), mode).catch(() => undefined);
}

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
