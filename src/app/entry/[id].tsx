import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useApp } from '../../state/app';
import {
  addCustomIcon, createEntry, customIconUris, deleteEntry, entryIconId, fieldText, findEntry, generatePassword, hiddenExtras, iconChoiceOf,
  listGroups, moveEntry, updateEntry, type EntryFields, type IconChoice,
} from '../../core/entries';
import { copyPlain, copySecret } from '../../lib/clipboard';
import { EntryIcon } from '../../ui/EntryIcon';
import { IconPicker, draftUri, type IconDraft } from '../../ui/IconPicker';
import { Banner, Body, Button, Card, Choice, Field, Screen, Small, errorText, HeaderLink, hostOf } from '../../ui/components';
import { space, type, useTheme } from '../../ui/theme';

const EMPTY: EntryFields = { title: '', username: '', password: '', url: '', notes: '' };

export default function EntryScreen() {
  const { id, group } = useLocalSearchParams<{ id: string; group?: string }>();
  const app = useApp();
  const router = useRouter();
  const nav = useNavigation();
  const db = app.session?.db;
  const isNew = id === 'new';
  const entry = useMemo(() => (db && !isNew ? findEntry(db, id) : undefined), [db, id, isNew, app.revision]);
  const [editing, setEditing] = useState(isNew);

  useLayoutEffect(() => {
    nav.setOptions({
      title: isNew ? 'New login' : editing ? 'Edit' : '',
      headerRight: () =>
        !isNew && !editing && !app.session?.readOnly ? <HeaderLink label="Edit" onPress={() => setEditing(true)} /> : null,
    });
  }, [nav, isNew, editing, app.session?.readOnly]);

  if (!db) return null;
  if (!isNew && !entry) {
    return (
      <Screen>
        <Body>This entry no longer exists. It may have been deleted on another device.</Body>
        <Button kind="secondary" label="Back to vault" onPress={() => router.back()} />
      </Screen>
    );
  }
  if (editing) {
    return <EntryEditor entryId={isNew ? null : id} defaultGroup={group || null} onDone={(newId) => {
      if (isNew) newId ? router.replace({ pathname: '/entry/[id]', params: { id: newId } }) : router.back();
      else setEditing(false);
    }} />;
  }
  return <EntryView entryId={id} />;
}

function EntryView({ entryId }: { entryId: string }) {
  const app = useApp();
  const t = useTheme();
  const db = app.session!.db;
  const entry = findEntry(db, entryId)!;
  const iconId = entryIconId(db, entry);
  const iconUri = iconId ? customIconUris(db).get(iconId) : null;
  // Reveal-on-demand: decrypted only while shown, dropped when hidden or the screen goes away.
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => () => setRevealed(null), []);
  useEffect(() => {
    if (!copied) return;
    const h = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(h);
  }, [copied]);

  const title = fieldText(entry, 'Title');
  const username = fieldText(entry, 'UserName');
  const url = fieldText(entry, 'URL');
  const notes = fieldText(entry, 'Notes');
  const extras = hiddenExtras(entry);
  const hasPassword = entry.fields.has('Password') && fieldText(entry, 'Password') !== '';

  const copyPassword = async () => {
    try {
      await copySecret(fieldText(entry, 'Password'));
      setCopied('Password copied. It clears from the clipboard in 15 seconds.');
    } catch (e) {
      Alert.alert('Couldn’t copy', errorText(e));
    }
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <EntryIcon uri={iconUri} standard={entry.icon} seed={hostOf(url) || title} label={title} size={56} />
        <Text style={[type.title, { color: t.ink, flex: 1 }]} numberOfLines={2}>{title || 'Untitled'}</Text>
      </View>
      {copied && <Banner tone="info">{copied}</Banner>}
      <Card>
        {username !== '' && (
          <Row label="Username" value={username} action="Copy" onAction={async () => { await copyPlain(username); setCopied('Username copied.'); }} />
        )}
        {hasPassword && (
          <View style={{ gap: space.xs }}>
            <Small>Password</Small>
            <Text selectable={false} style={[type.mono, { color: t.ink }]}>{revealed ?? '••••••••••••'}</Text>
            <View style={{ flexDirection: 'row', gap: space.lg, marginTop: space.xs }}>
              <HeaderLink label={revealed ? 'Hide' : 'Show'} onPress={() => setRevealed(revealed ? null : fieldText(entry, 'Password'))} />
              <HeaderLink label="Copy" onPress={copyPassword} />
            </View>
          </View>
        )}
        {url !== '' && <Row label="Website" value={url} action="Open" onAction={() => Linking.openURL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`)} />}
        {notes !== '' && (
          <View style={{ gap: space.xs }}>
            <Small>Notes</Small>
            <Body>{notes}</Body>
          </View>
        )}
      </Card>
      {(extras.customFields.length > 0 || extras.attachments.length > 0) && (
        <Small>
          Also stored with this entry and kept unchanged:{' '}
          {[
            extras.hasTotp && 'a one-time-code (TOTP) secret',
            extras.customFields.filter((f) => !/otp/i.test(f)).length > 0 &&
              `${extras.customFields.filter((f) => !/otp/i.test(f)).length} custom field(s)`,
            extras.attachments.length > 0 && `${extras.attachments.length} attachment(s)`,
          ].filter(Boolean).join(', ')}. Open them in KeePassXC.
        </Small>
      )}
      <Small>In “{entry.parentGroup?.name}” · changed {entry.times.lastModTime?.toLocaleString() ?? 'unknown'}</Small>
    </Screen>
  );
}

function Row({ label, value, action, onAction }: { label: string; value: string; action: string; onAction: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.md }}>
      <View style={{ flex: 1, gap: space.xs }}>
        <Small>{label}</Small>
        <Text style={[type.body, { color: t.ink }]} numberOfLines={2}>{value}</Text>
      </View>
      <HeaderLink label={action} onPress={onAction} />
    </View>
  );
}

function EntryEditor({ entryId, defaultGroup, onDone }: { entryId: string | null; defaultGroup: string | null; onDone: (id?: string) => void }) {
  const app = useApp();
  const t = useTheme();
  const db = app.session!.db;
  const existing = entryId ? findEntry(db, entryId) : undefined;
  const [f, setF] = useState<EntryFields>(() =>
    existing
      ? { title: fieldText(existing, 'Title'), username: fieldText(existing, 'UserName'), password: fieldText(existing, 'Password'),
          url: fieldText(existing, 'URL'), notes: fieldText(existing, 'Notes') }
      : EMPTY,
  );
  const groups = listGroups(db);
  const [groupId, setGroupId] = useState(existing?.parentGroup?.uuid.id ?? defaultGroup ?? groups[0]?.id);
  const vaultIcons = useMemo(() => customIconUris(db), [db, app.revision]);
  const [icon, setIcon] = useState<IconDraft>(() => (existing ? iconChoiceOf(db, existing) : { standard: 0 }));
  const [picking, setPicking] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof EntryFields) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    let newId: string | undefined;
    try {
      await app.mutate((d) => {
        // A new image joins the vault only now, on Save (identical images are reused).
        const choice: IconChoice = 'newPng' in icon ? { customId: addCustomIcon(d, icon.newPng) } : icon;
        if (existing) {
          updateEntry(existing, { ...f, icon: choice }, d);
          if (groupId) moveEntry(d, existing, groupId);
        } else {
          newId = createEntry(d, groupId ?? null, f, choice).uuid.id;
        }
      });
      onDone(newId);
    } catch (e) {
      // The edit is kept in memory; the vault list shows a Retry banner.
      setError(errorText(e));
      if (newId) onDone(newId);
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (!existing) return;
    Alert.alert('Delete this login?', 'It moves to the recycle bin, the same as in KeePassXC.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await app.mutate((d) => deleteEntry(d, existing));
          } catch (e) {
            setError(errorText(e));
          }
        },
      },
    ]);
  }

  const seed = hostOf(f.url) || f.title;
  if (picking) {
    return (
      <IconPicker
        value={icon} url={f.url} seed={seed} label={f.title} vaultIcons={vaultIcons}
        onPick={(d) => { setIcon(d); setPicking(false); }}
        onCancel={() => setPicking(false)}
      />
    );
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <EntryIcon
          key={'newPng' in icon ? 'new' : JSON.stringify(icon)}
          uri={draftUri(icon, vaultIcons)}
          standard={'standard' in icon ? icon.standard : 0}
          seed={seed} label={f.title} size={56}
        />
        <HeaderLink label="Change icon" onPress={() => setPicking(true)} />
      </View>
      <Field label="Title" value={f.title} onChangeText={set('title')} autoCapitalize="sentences" autoFocus={!existing} />
      <Field label="Username" value={f.username} onChangeText={set('username')} />
      <Field
        label="Password"
        value={f.password}
        onChangeText={set('password')}
        secret={!showPw}
        mono
        right={
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Pressable onPress={() => setShowPw(!showPw)} hitSlop={8}>
              <Text style={[type.small, { color: t.accent, fontWeight: '600' }]}>{showPw ? 'Hide' : 'Show'}</Text>
            </Pressable>
            <Pressable onPress={() => { set('password')(generatePassword(20)); setShowPw(true); }} hitSlop={8}>
              <Text style={[type.small, { color: t.accent, fontWeight: '600' }]}>Generate</Text>
            </Pressable>
          </View>
        }
      />
      <Field label="Website" value={f.url} onChangeText={set('url')} keyboardType="url" />
      <Field label="Notes" value={f.notes} onChangeText={set('notes')} multiline autoCapitalize="sentences" style={[type.body, { color: t.ink, minHeight: 90, textAlignVertical: 'top', paddingVertical: space.md, flex: 1 }]} />
      {groups.length > 1 && (
        <View style={{ gap: space.xs }}>
          <Small>Group</Small>
          <Choice options={groups.map((g) => ({ label: g.name || 'Untitled', value: g.id }))} value={groupId ?? ''} onChange={setGroupId} />
        </View>
      )}
      {error && <Banner tone="danger">{error}</Banner>}
      <Button label={existing ? 'Save changes' : 'Add login'} onPress={save} busy={busy} disabled={!f.title.trim()} />
      <Button kind="secondary" label="Cancel" onPress={() => onDone()} disabled={busy} />
      {existing && <Button kind="quiet" label="Delete login" onPress={remove} />}
    </Screen>
  );
}
