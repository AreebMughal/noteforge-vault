import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRouter } from 'expo-router';
import { useApp } from '../state/app';
import { customIconUris, fieldText, findEntry, listEntries, listGroups, type EntrySummary } from '../core/entries';
import { copyPlain, copySecret } from '../lib/clipboard';
import { EntryIcon } from '../ui/EntryIcon';
import { Banner, Button, Choice, Field, HeaderLink, Small, errorText, hostOf } from '../ui/components';
import { space, type, useTheme } from '../ui/theme';

export default function VaultList() {
  const app = useApp();
  const t = useTheme();
  const router = useRouter();
  const nav = useNavigation();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string>('all');
  const db = app.session?.db;
  const [copied, setCopied] = useState<{ text: string; tone: 'info' | 'danger' } | null>(null);
  useEffect(() => {
    if (!copied) return;
    const h = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(h);
  }, [copied]);

  async function copy(item: EntrySummary, what: 'username' | 'password') {
    try {
      if (what === 'username') {
        await copyPlain(item.username);
        setCopied({ text: `Username for ${item.title || 'Untitled'} copied.`, tone: 'info' });
      } else {
        // Read from the open vault only now; the list model never holds passwords.
        const entry = db && findEntry(db, item.id);
        if (!entry) throw new Error('This entry no longer exists.');
        await copySecret(fieldText(entry, 'Password'));
        setCopied({ text: 'Password copied. It clears from the clipboard in 15 seconds.', tone: 'info' });
      }
    } catch (e) {
      setCopied({ text: `Couldn’t copy: ${errorText(e)}`, tone: 'danger' });
    }
  }

  // Recomputed on every revision (edit, merge, refresh). No passwords in here.
  const entries = useMemo(() => (db ? listEntries(db) : []), [db, app.revision]);
  const groups = useMemo(() => (db ? listGroups(db) : []), [db, app.revision]);
  const icons = useMemo(() => (db ? customIconUris(db) : new Map<string, string>()), [db, app.revision]);

  useLayoutEffect(() => {
    nav.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: space.lg }}>
          <HeaderLink label="Lock" onPress={app.lock} />
          <HeaderLink label="Settings" onPress={() => router.push('/settings')} />
        </View>
      ),
    });
  }, [nav, app.lock, router]);

  const q = query.trim().toLowerCase();
  const shown = entries.filter(
    (e) => (group === 'all' || e.groupId === group) &&
      (!q || e.title.toLowerCase().includes(q) || e.username.toLowerCase().includes(q) || e.url.toLowerCase().includes(q)),
  );
  const readOnly = app.session?.readOnly;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={shown}
        keyExtractor={(e) => e.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 110 }}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.sm }}>
            {readOnly && (
              <Banner action={<HeaderLink label="Retry" onPress={() => app.refresh().catch(() => undefined)} />}>
                Offline copy — read-only until you reconnect.
              </Banner>
            )}
            {app.saveState.status === 'error' && (
              <Banner tone="danger" action={<HeaderLink label="Retry" onPress={() => app.retrySave().catch(() => undefined)} />}>
                Not saved: {app.saveState.error}
              </Banner>
            )}
            {app.saveState.status === 'saving' && <Small>Saving…</Small>}
            {app.saveState.merged && app.saveState.status === 'idle' && (
              <Small>Merged with changes made on another device.</Small>
            )}
            <Field label="Search" value={query} onChangeText={setQuery} placeholder="Title, username or website" />
            {groups.length > 1 && (
              <Choice
                options={[{ label: 'All', value: 'all' }, ...groups.slice(1).map((g) => ({ label: g.name || 'Untitled', value: g.id }))]}
                value={group}
                onChange={setGroup}
              />
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={{ paddingVertical: space.xxl, gap: space.md }}>
            <Text style={[type.heading, { color: t.ink }]}>{entries.length ? 'No matches' : 'Your vault is empty'}</Text>
            <Text style={[type.body, { color: t.muted }]}>
              {entries.length ? 'Try a different search or group.' : 'Add your first login. It appears on the web app and in KeePassXC too.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/entry/[id]', params: { id: item.id } })}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md,
              borderRadius: 14, backgroundColor: pressed ? t.sunken : t.surface,
            })}
          >
            <EntryIcon uri={item.customIconId ? icons.get(item.customIconId) : null} standard={item.icon} seed={hostOf(item.url) || item.title} label={item.title} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={[type.body, { color: t.ink, fontWeight: '600' }]}>{item.title || 'Untitled'}</Text>
              <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
                {[item.username, hostOf(item.url)].filter(Boolean).join('  ·  ') || item.groupName}
              </Text>
            </View>
            {item.username !== '' && (
              <CopyButton glyph="account-outline" label={`Copy username for ${item.title || 'Untitled'}`} onPress={() => copy(item, 'username')} />
            )}
            {item.hasPassword && (
              <CopyButton glyph="key-variant" label={`Copy password for ${item.title || 'Untitled'}`} onPress={() => copy(item, 'password')} />
            )}
          </Pressable>
        )}
      />
      {(copied || !readOnly) && (
        <View style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: space.xl, gap: space.sm }}>
          {copied && <Banner tone={copied.tone}>{copied.text}</Banner>}
          {!readOnly && <Button
            label="Add login"
            onPress={() => router.push({ pathname: '/entry/[id]', params: { id: 'new', group: group === 'all' ? '' : group } })}
          />}
        </View>
      )}
    </View>
  );
}

function CopyButton({ glyph, label, onPress }: {
  glyph: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: pressed ? t.sunken : 'transparent',
      })}
    >
      <MaterialCommunityIcons name={glyph} size={22} color={t.accent} />
    </Pressable>
  );
}

