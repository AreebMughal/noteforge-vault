import React, { useEffect, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import Constants from 'expo-constants';
import { useApp } from '../state/app';
import { biometricsAvailable } from '../lib/biometric';
import { describeKdf } from '../core/kdbx';
import { Banner, Body, Button, Card, Choice, Screen, Small, errorText } from '../ui/components';
import { space, useTheme } from '../ui/theme';

export default function Settings() {
  const app = useApp();
  const t = useTheme();
  const router = useRouter();
  const [bioAvailable, setBioAvailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { biometricsAvailable().then(setBioAvailable, () => setBioAvailable(false)); }, []);
  const kdf = app.session ? describeKdf(app.session.db) : null;

  async function toggleBiometric(on: boolean) {
    setError(null);
    if (!on) return app.disableBiometric();
    Alert.alert(
      'Turn on fingerprint unlock?',
      'Normally only your master password, slowed down by Argon2, protects the vault. With fingerprint unlock, a key ' +
        'equivalent to your master password is kept in this phone’s secure hardware, released only by your fingerprint. ' +
        'Anyone who can pass your phone’s fingerprint check could open the vault. It expires after the period you choose, ' +
        'and your master password is still needed after that.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn on', onPress: () => app.enableBiometric().catch((e) => setError(errorText(e))) },
      ],
    );
  }

  async function exportVault() {
    setBusy('export');
    setError(null);
    const file = new File(Paths.cache, 'NoteForge Vault.kdbx');
    try {
      const bytes = await app.session!.exportBytes();
      if (file.exists) file.delete();
      file.create();
      file.write(bytes);
      await Sharing.shareAsync(file.uri, { mimeType: 'application/octet-stream', dialogTitle: 'Export vault (.kdbx)' });
    } catch (e) {
      setError(errorText(e));
    } finally {
      if (file.exists) file.delete();
      setBusy(null);
    }
  }

  async function sync() {
    setBusy('sync');
    setError(null);
    setNotice(null);
    try {
      await app.refresh();
      setNotice('Up to date with the server.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      {error && <Banner tone="danger">{error}</Banner>}
      {notice && <Banner tone="info">{notice}</Banner>}

      <Card>
        <Body style={{ fontWeight: '600' }}>Lock the vault after</Body>
        <Choice
          options={[
            { label: 'Leaving the app', value: 0 }, { label: '1 min', value: 1 }, { label: '5 min', value: 5 },
            { label: '15 min', value: 15 }, { label: '30 min', value: 30 },
          ]}
          value={app.settings.autoLockMinutes}
          onChange={(v) => app.updateSettings({ autoLockMinutes: v })}
        />
        <Small>Counts time without touching the screen, including time spent in other apps.</Small>
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Body style={{ fontWeight: '600', flex: 1 }}>Unlock with fingerprint</Body>
          <Switch
            value={app.biometricReady}
            onValueChange={toggleBiometric}
            disabled={!bioAvailable}
            trackColor={{ true: t.accent, false: t.line }}
          />
        </View>
        {!bioAvailable && <Small>Set up a fingerprint or face unlock in Android settings to use this.</Small>}
        <Small>Ask for the master password again after</Small>
        <Choice
          options={[{ label: '1 day', value: 1 }, { label: '7 days', value: 7 }, { label: '30 days', value: 30 }]}
          value={app.settings.biometricDays}
          onChange={(v) => {
            app.updateSettings({ biometricDays: v });
            if (app.biometricReady) setNotice('Turn fingerprint unlock off and on again to apply the new period.');
          }}
        />
      </Card>

      <Card>
        <Body style={{ fontWeight: '600' }}>Vault</Body>
        {app.vault.kind === 'onedrive' ? (
          <Small>
            KeePassXC file {app.vault.file.path} on OneDrive ({app.microsoftAccount ?? 'not connected'}). Changes go
            straight to OneDrive; KeePassXC and the web app pick them up from there.
          </Small>
        ) : (
          <Small>Stored in your NoteForge account. The web app opens the same vault.</Small>
        )}
        <Button kind="secondary" label="Groups" onPress={() => router.push('/groups')} />
        <Button kind="secondary" label="Check for changes" onPress={sync} busy={busy === 'sync'} />
        <Button kind="secondary" label="Export .kdbx file" onPress={exportVault} busy={busy === 'export'} />
        <Small>The exported file is encrypted with your master password and opens in KeePassXC.</Small>
        {app.vault.kind === 'onedrive' && (
          <Button kind="quiet" label="Disconnect OneDrive on this phone" onPress={() =>
            Alert.alert(
              'Disconnect OneDrive?',
              'This phone signs out of Microsoft and locks. Your KeePassXC file and your choice on other devices stay as they are; connect again to reopen it.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Disconnect', style: 'destructive', onPress: () => app.disconnectMicrosoft().catch((e) => setError(errorText(e))) },
              ],
            )} />
        )}
      </Card>

      <Card>
        <Button label="Lock now" onPress={app.lock} />
        <Button kind="quiet" label="Sign out" onPress={() =>
          Alert.alert('Sign out?', 'This removes the offline copy and fingerprint unlock from this phone.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: () => app.signOut() },
          ])} />
      </Card>

      <View style={{ gap: space.xs }}>
        <Small>Signed in as {app.auth?.user.email}</Small>
        {kdf && (
          <Small>
            Encryption: {kdf}
            {app.session && app.vault.kind === 'account' ? ` · version ${app.session.revision}` : ''}
          </Small>
        )}
        <Small>NoteForge Vault {Constants.expoConfig?.version}</Small>
      </View>
      <View style={{ height: space.xl }}>{/* spacer */}</View>
    </Screen>
  );
}
