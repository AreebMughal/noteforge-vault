import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useApp } from '../state/app';
import { isConfigured } from '../lib/config';
import { Body, Screen, Title, Banner } from '../ui/components';
import { useTheme } from '../ui/theme';

/** Shown only while booting, or when the app must refuse to run. */
export default function Status() {
  const app = useApp();
  const t = useTheme();
  if (app.selfTestError) {
    return (
      <Screen>
        <Title>Encryption check failed</Title>
        <Body>
          This phone’s encryption didn’t match the expected results, so the vault stays closed to keep it from being
          damaged. Nothing was read or changed.
        </Body>
        <Banner tone="danger">{app.selfTestError}</Banner>
        <Body muted>Report this with your phone model and Android version.</Body>
      </Screen>
    );
  }
  if (!app.booting && !isConfigured) {
    return (
      <Screen>
        <Title>Server not configured</Title>
        <Body>This build is missing its Supabase URL and anon key. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY and rebuild.</Body>
      </Screen>
    );
  }
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
      <ActivityIndicator color={t.accent} size="large" />
    </View>
  );
}
