import type { ExpoConfig } from 'expo/config';

// Change before your first public release — Android treats a new package id as a different app.
const PACKAGE = process.env.APP_PACKAGE || 'com.noteforge.vault';

const config: ExpoConfig = {
  name: 'NoteForge Vault',
  slug: 'noteforge-vault',
  version: process.env.APP_VERSION || '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'noteforgevault',
  userInterfaceStyle: 'automatic',
  android: {
    package: PACKAGE,
    versionCode: Number(process.env.APP_VERSION_CODE || 1),
    // Keeps the encrypted cache, session and fingerprint key out of cloud/adb backups.
    allowBackup: false,
    adaptiveIcon: {
      backgroundColor: '#2B5C8F',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['android.permission.USE_BIOMETRIC', 'android.permission.USE_FINGERPRINT'],
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW'],
    predictiveBackGestureEnabled: false,
  },
  ios: { bundleIdentifier: PACKAGE, supportsTablet: false },
  plugins: [
    'expo-router',
    ['expo-secure-store', { configureAndroidBackup: false }],
    'expo-sharing',
    './plugins/with-release-signing.js',
  ],
  experiments: { typedRoutes: false },
};

export default config;
