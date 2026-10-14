import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from 'expo-router';
import { useApp } from '../state/app';
import { customIconUris, fieldText, findEntry, listEntries, listGroups, type EntrySummary } from '../core/entries';
import { copyPlain, copySecret } from '../lib/clipboard';
import { useSafePush } from '../lib/navigation';
import { EntryIcon } from '../ui/EntryIcon';
import { Banner, Choice, Field, HeaderLink, IconButton, Small, errorText, hostOf } from '../ui/components';
import { space, type, useTheme } from '../ui/theme';

export default function VaultList() {
  const app = useApp();
  const t = useTheme();
  const push = useSafePush();
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

  // HeaderActions reads live state itself, so this only needs setting once.
  useLayoutEffect(() => {
    nav.setOptions({ headerRight: () => <HeaderActions /> });
  }, [nav]);

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
            onPress={() => push({ pathname: '/entry/[id]', params: { id: item.id } })}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md,
              borderRadius: 14, backgroundColor: pressed ? t.sunken : t.surface, borderWidth: 1, borderColor: t.line,
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
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: space.xl, gap: space.md, alignItems: 'flex-end' }}
        >
          {copied && <View style={{ alignSelf: 'stretch' }}><Banner tone={copied.tone}>{copied.text}</Banner></View>}
          {!readOnly && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add login"
              onPress={() => push({ pathname: '/entry/[id]', params: { id: 'new', group: group === 'all' ? '' : group } })}
              style={({ pressed }) => ({
                width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center',
                backgroundColor: t.accent, opacity: pressed ? 0.85 : 1, elevation: 6,
                shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
              })}
            >
              <MaterialCommunityIcons name="plus" size={30} color={t.accentInk} />
            </Pressable>
          )}
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

type Sync = 'synced' | 'syncing' | 'offline' | 'error';

/**
 * Header: cloud (sync status; tap to check for changes or retry), lock, settings.
 * The cloud is "synced" only when nothing is saving, nothing failed to save, and
 * this isn't a read-only offline copy.
 */
function HeaderActions() {
  const app = useApp();
  const t = useTheme();
  const push = useSafePush();
  const [checking, setChecking] = useState(false);
  const readOnly = !!app.session?.readOnly;
  const state: Sync =
    app.saveState.status === 'error' ? 'error'
      : app.saveState.status === 'saving' || checking ? 'syncing'
        : readOnly ? 'offline' : 'synced';

  const look: Record<Sync, { glyph: React.ComponentProps<typeof MaterialCommunityIcons>['name']; color: string; label: string }> = {
    synced: { glyph: 'cloud-check-outline', color: t.accent, label: 'Synced. Tap to check for changes' },
    syncing: { glyph: 'cloud-sync-outline', color: t.muted, label: 'Syncing' },
    offline: { glyph: 'cloud-off-outline', color: t.warn, label: 'Offline, read-only copy. Tap to reconnect' },
    error: { glyph: 'cloud-alert-outline', color: t.danger, label: 'Not saved. Tap to retry' },
  };

  async function onSync() {
    if (state === 'syncing') return;
    setChecking(true);
    try {
      if (state === 'error') await app.retrySave();
      else await app.refresh();
    } catch (e) {
      Alert.alert(state === 'error' ? 'Couldn’t save' : 'Couldn’t reach your vault', errorText(e));
    } finally {
      setChecking(false);
    }
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <IconButton glyph={look[state].glyph} color={look[state].color} label={look[state].label} onPress={onSync} />
      <IconButton glyph="lock-outline" label="Lock vault" onPress={app.lock} />
      <IconButton glyph="cog-outline" label="Settings" onPress={() => push('/settings')} />
    </View>
  );
}
