import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { AppProvider, useApp } from '../state/app';
import { isConfigured } from '../lib/config';
import { useTheme } from '../ui/theme';

export default function RootLayout() {
  // FLAG_SECURE: no screenshots, no screen recording, blank recents thumbnail.
  usePreventScreenCapture();
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Navigator />
      </AppProvider>
    </SafeAreaProvider>
  );
}

function Navigator() {
  const app = useApp();
  const t = useTheme();
  const ready = !app.booting && !app.selfTestError && isConfigured;
  const signedIn = ready && !!app.auth;
  const unlocked = signedIn && !!app.session;
  return (
    // Any touch counts as activity for the auto-lock timer.
    <View style={{ flex: 1, backgroundColor: t.bg }} onStartShouldSetResponderCapture={() => { app.touch(); return false; }}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.bg },
          headerTintColor: t.ink,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Protected guard={!ready}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={ready && !signedIn}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !unlocked}>
          <Stack.Screen name="unlock" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={unlocked}>
          <Stack.Screen name="vault" options={{ title: 'Vault' }} />
          <Stack.Screen name="entry/[id]" options={{ title: '' }} />
          <Stack.Screen name="groups" options={{ title: 'Groups' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        </Stack.Protected>
      </Stack>
    </View>
  );
}
