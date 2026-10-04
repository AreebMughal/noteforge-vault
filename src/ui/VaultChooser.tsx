import React, { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useApp } from '../state/app';
import type { VaultFile } from '../core/onedrive';
import { Banner, Body, Button, Card, Field, Screen, Small, Title, errorText } from './components';
import { space, type, useTheme } from './theme';

/**
 * First run (nothing chosen on any device yet), or "Use a different vault".
 * The same two choices as the web app; whichever is unlocked first is saved
 * to the account, so the web app skips its chooser too.
 */
export function VaultChooser({ email, onSignOut, canGoBack, onBack }: {
  email: string; onSignOut: () => void; canGoBack?: boolean; onBack?: () => void;
}) {
  const app = useApp();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opened via "Use a different vault": Back returns to the unlock screen instead of leaving the app.
  useEffect(() => {
    if (!canGoBack || picking) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack?.(); return true; });
    return () => sub.remove();
  }, [canGoBack, picking, onBack]);

  async function oneDrive() {
    setError(null);
    if (!app.microsoftAccount) {
      setBusy(true);
      try {
        if (!(await app.connectMicrosoft())) return;
      } catch (e) {
        setError(errorText(e));
        return;
      } finally {
        setBusy(false);
      }
    }
    setPicking(true);
  }

  if (picking) return <OneDriveFilePicker onBack={() => setPicking(false)} />;

  return (
    <Screen style={{ paddingTop: 72 }}>
      <Title>Where is your vault?</Title>
      <Body muted>{email}</Body>
      <Choice
        glyph="shield-key-outline"
        title="In my NoteForge account"
        body="Encrypted on this phone, stored in your account. Also opens on the NoteForge web app, and exports to KeePassXC."
        onPress={() => app.chooseAccountVault()}
      />
      <Choice
        glyph="microsoft-onedrive"
        title="My KeePassXC file on OneDrive"
        body="Open the same .kdbx KeePassXC uses. Changes go straight to OneDrive, so KeePassXC and the web app see them."
        onPress={oneDrive}
        busy={busy}
      />
      {error && <Banner tone="danger">{error}</Banner>}
      <Small>Your choice is saved to your NoteForge account, so the web app opens the same vault.</Small>
      {canGoBack && <Button kind="secondary" label="Back" onPress={onBack!} />}
      <Button kind="quiet" label={`Sign out of ${email}`} onPress={onSignOut} />
    </Screen>
  );
}

function Choice({ glyph, title, body, onPress, busy }: {
  glyph: React.ComponentProps<typeof MaterialCommunityIcons>['name']; title: string; body: string; onPress: () => void; busy?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => ({
        flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: 14,
        backgroundColor: pressed ? t.sunken : t.surface, alignItems: 'flex-start',
      })}
    >
      <MaterialCommunityIcons name={glyph} size={28} color={t.accent} />
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={[type.body, { color: t.ink, fontWeight: '600' }]}>{title}</Text>
        <Text style={[type.small, { color: t.muted }]}>{body}</Text>
      </View>
      {busy && <ActivityIndicator color={t.accent} />}
    </Pressable>
  );
}

/** KeePass databases in the connected OneDrive, or a typed path. */
export function OneDriveFilePicker({ onBack }: { onBack: () => void }) {
  const app = useApp();
  const t = useTheme();
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);
  const [files, setFiles] = useState<VaultFile[] | null>(null);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    setError(null);
    setFiles(null);
    try {
      setFiles(await app.listOneDriveFiles());
    } catch (e) {
      setFiles([]);
      setError(errorText(e));
    }
  }
  useEffect(() => { scan(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function openPath() {
    setBusy(true);
    setError(null);
    try {
      app.chooseOneDriveFile(await app.findOneDriveFile(path));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen style={{ paddingTop: 72 }}>
      <Title>Choose your vault</Title>
      <Body muted>KeePass databases in {app.microsoftAccount ?? 'your OneDrive'}.</Body>
      {files === null ? (
        <ActivityIndicator color={t.accent} />
      ) : files.length === 0 ? (
        <Card><Body muted>No .kdbx files turned up. OneDrive search can miss recently moved files, so type the path below.</Body></Card>
      ) : (
        <View style={{ gap: space.sm }}>
          {files.map((f) => (
            <Pressable
              key={f.id}
              accessibilityRole="button"
              onPress={() => app.chooseOneDriveFile(f)}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: 14,
                backgroundColor: pressed ? t.sunken : t.surface,
              })}
            >
              <MaterialCommunityIcons name="file-key-outline" size={26} color={t.accent} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={[type.body, { color: t.ink, fontWeight: '600' }]}>{f.name}</Text>
                <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>{f.path}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
      <Field label="Or open a path, relative to your OneDrive root" value={path} onChangeText={setPath} placeholder="Documents/Passwords.kdbx" onSubmitEditing={openPath} />
      {error && <Banner tone="danger">{error}</Banner>}
      <Button kind="secondary" label="Open path" onPress={openPath} busy={busy} disabled={!path.trim()} />
      <Button kind="quiet" label="Rescan" onPress={scan} />
      <Button kind="quiet" label="Back" onPress={onBack} />
    </Screen>
  );
}

/** The account says "OneDrive, this file", but this phone isn't signed in to Microsoft. */
export function ConnectOneDrive({ path, onSignOut, onSwitch }: { path: string; onSignOut: () => void; onSwitch: () => void }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function connect() {
    setBusy(true);
    setError(null);
    try {
      await app.connectMicrosoft();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen style={{ paddingTop: 72 }}>
      <Title>Connect OneDrive</Title>
      <Body>
        Your vault is the KeePassXC file <Text style={type.mono}>{path}</Text> on OneDrive. Sign in to Microsoft once
        on this phone to open it.
      </Body>
      <Body muted>
        The file travels straight between this phone and Microsoft, still encrypted. Your master password never
        leaves the phone.
      </Body>
      {error && <Banner tone="danger">{error}</Banner>}
      <Button label="Connect OneDrive" onPress={connect} busy={busy} />
      <Button kind="quiet" label="Use a different vault" onPress={onSwitch} />
      <Button kind="quiet" label="Sign out" onPress={onSignOut} />
    </Screen>
  );
}
