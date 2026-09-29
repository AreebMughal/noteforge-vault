import { requireOptionalNativeModule } from 'expo-modules-core';

interface VaultNativeModule {
  argon2(passwordB64: string, saltB64: string, memoryKiB: number, iterations: number,
    length: number, parallelism: number, type: number, version: number): Promise<string>;
  copySensitive(text: string, clearAfterMs: number): Promise<void>;
  clearClipboardNow(): Promise<void>;
}

/** null on platforms where the module isn't built yet (iOS, web, Expo Go). */
export default requireOptionalNativeModule<VaultNativeModule>('VaultNative');
