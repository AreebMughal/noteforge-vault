import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { useApp } from '../state/app';
import { isWrongPasswordError } from '../core/kdbx';
import { Banner, Body, Button, Field, Screen, Small, Title, errorText } from '../ui/components';
import { useTheme } from '../ui/theme';

export default function Unlock() {
  const app = useApp();
  const t = useTheme();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [typed, setTyped] = useState('');

  // Offer the fingerprint prompt straight away when it's set up.
  useEffect(() => {
    if (app.biometricReady && (app.probe === 'exists' || app.probe === 'offline-cached')) tryBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.biometricReady, app.probe]);

  async function tryBiometric() {
    setBusy(true);
    setError(null);
    try {
      await app.unlockWithBiometric();
    } catch (e) {
      setError(isWrongPasswordError(e) ? 'The master password was changed on another device. Enter the new one.' : errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      await app.unlock(password);
      setPassword('');
    } catch (e) {
      setError(isWrongPasswordError(e) ? 'That master password is incorrect.' : errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await app.createVault(password);
      setPassword('');
      setConfirm('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    setBusy(true);
    try {
      await app.forgetVault();
      setForgetting(false);
      setTyped('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const email = app.auth?.user.email ?? '';
  const signOut = () =>
    Alert.alert('Sign out?', 'This removes the offline copy and fingerprint unlock from this phone. Your vault stays on the server.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => app.signOut() },
    ]);

  if (app.probe === 'unknown') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
        <ActivityIndicator color={t.accent} size="large" />
      </View>
    );
  }

  if (app.probe === 'offline-empty') {
    return (
      <Screen style={{ paddingTop: 72 }}>
        <Title>You’re offline</Title>
        <Body>This phone has no saved copy of your vault yet. Connect to the internet once to download it.</Body>
        <Button label="Try again" onPress={app.reprobe} />
        <Button kind="quiet" label={`Sign out of ${email}`} onPress={signOut} />
      </Screen>
    );
  }

  if (app.probe === 'missing') {
    const tooShort = password.length > 0 && password.length < 10;
    const mismatch = confirm.length > 0 && confirm !== password;
    return (
      <Screen style={{ paddingTop: 72 }}>
        <Title>Choose a master password</Title>
        <Body>
          It encrypts your vault on this phone and is never sent anywhere. There is no reset: if you forget it, the
          vault can’t be recovered by anyone, including NoteForge.
        </Body>
        <Field label="Master password" value={password} onChangeText={setPassword} secret autoComplete="off" />
        {tooShort && <Small color={t.warn}>Use at least 10 characters. A few random words works well.</Small>}
        <Field label="Repeat master password" value={confirm} onChangeText={setConfirm} secret autoComplete="off" />
        {mismatch && <Small color={t.danger}>The passwords don’t match.</Small>}
        {error && <Banner tone="danger">{error}</Banner>}
        <Button label="Create vault" onPress={create} busy={busy} disabled={password.length < 10 || confirm !== password} />
        {busy && <Small>Deriving the key takes a few seconds on purpose — it’s what makes guessing slow.</Small>}
        <Button kind="quiet" label={`Sign out of ${email}`} onPress={signOut} />
      </Screen>
    );
  }

  if (forgetting) {
    return (
      <Screen style={{ paddingTop: 72 }}>
        <Title>Start over with an empty vault</Title>
        <Body>
          Your master password can’t be recovered. Starting over permanently deletes the encrypted vault from your
          account — on this phone, on the web app, everywhere — and every password in it.
        </Body>
        <Body muted>If you have an exported .kdbx backup that you can open, you can import it into KeePassXC instead.</Body>
        <Field label="Type DELETE to confirm" value={typed} onChangeText={setTyped} autoCapitalize="characters" />
        {error && <Banner tone="danger">{error}</Banner>}
        <Button kind="danger" label="Delete vault and start over" onPress={forget} busy={busy} disabled={typed !== 'DELETE'} />
        <Button kind="secondary" label="Cancel" onPress={() => { setForgetting(false); setTyped(''); }} />
      </Screen>
    );
  }

  return (
    <Screen style={{ paddingTop: 72 }}>
      <Title>Unlock vault</Title>
      <Body muted>{email}</Body>
      {app.probe === 'offline-cached' && (
        <Banner>You’re offline. You can view the copy saved on this phone; changes need a connection.</Banner>
      )}
      <Field label="Master password" value={password} onChangeText={setPassword} secret autoComplete="off" autoFocus onSubmitEditing={unlock} />
      {error && <Banner tone="danger">{error}</Banner>}
      <Button label="Unlock" onPress={unlock} busy={busy} disabled={!password} />
      {app.biometricReady && <Button kind="secondary" label="Unlock with fingerprint" onPress={tryBiometric} disabled={busy} />}
      <Button kind="quiet" label="Forgot master password?" onPress={() => setForgetting(true)} />
      <Button kind="quiet" label="Sign out" onPress={signOut} />
    </Screen>
  );
}
