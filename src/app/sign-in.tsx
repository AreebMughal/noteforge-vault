import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { googleEnabled } from '../lib/config';
import { signInWithGoogle } from '../lib/google';
import { space, type, useTheme } from '../ui/theme';
import { Banner, Body, Button, Field, Screen, Title, errorText } from '../ui/components';
import { GoogleButton } from '../ui/GoogleButton';

export default function SignIn() {
  const t = useTheme();
  const [googleBusy, setGoogleBusy] = useState(false);
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (!data.session) setNotice('Check your email to confirm your account, then sign in.');
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setGoogleBusy(true);
    setError(null);
    setNotice(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <Screen style={{ paddingTop: 72 }}>
      <Title>NoteForge Vault</Title>
      <Body muted>Sign in with your NoteForge account. Your vault is encrypted on this phone before anything is sent.</Body>
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
      <Field label="Account password" value={password} onChangeText={setPassword} secret autoComplete="password" onSubmitEditing={submit} />
      {error && <Banner tone="danger">{error}</Banner>}
      {notice && <Banner tone="info">{notice}</Banner>}
      <Button label={mode === 'in' ? 'Sign in' : 'Create account'} onPress={submit} busy={busy} disabled={!email || !password} />
      {googleEnabled && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1, height: 1, backgroundColor: t.line }} />
            <Text style={[type.small, { color: t.muted }]}>or</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: t.line }} />
          </View>
          <GoogleButton onPress={google} busy={googleBusy} disabled={busy} />
        </>
      )}
      <Button
        kind="quiet"
        label={mode === 'in' ? 'New to NoteForge? Create an account' : 'Already have an account? Sign in'}
        onPress={() => setMode(mode === 'in' ? 'up' : 'in')}
      />
      <Body muted>Your account password signs you in. Your master password, set next, is separate and unlocks the vault.</Body>
    </Screen>
  );
}
