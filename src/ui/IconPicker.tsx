import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, Text, View } from 'react-native';
import type { IconChoice } from '../core/entries';
import { fetchIconForSite, pickIconFromDevice, pngDataUri } from '../lib/icons';
import { EntryIcon } from './EntryIcon';
import { Banner, Body, Button, Card, Screen, Small, errorText, hostOf } from './components';
import { STANDARD_ICONS } from './standardIcons';
import { space, type, useTheme } from './theme';

/** What the editor holds until Save: an existing choice, or a new image not yet in the vault. */
export type IconDraft = IconChoice | { newPng: Uint8Array };

export function draftUri(draft: IconDraft, vaultIcons: Map<string, string>) {
  if ('newPng' in draft) return pngDataUri(draft.newPng);
  if ('customId' in draft) return vaultIcons.get(draft.customId) ?? null;
  return null;
}

const TILE = 48;

export function IconPicker({ value, url, seed, label, vaultIcons, onPick, onCancel }: {
  value: IconDraft; url: string; seed: string; label: string;
  vaultIcons: Map<string, string>;
  onPick: (d: IconDraft) => void; onCancel: () => void;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState<'site' | 'device' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const host = hostOf(url);

  // Back closes the picker instead of leaving the editor (and its unsaved edits).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (busy === null) onCancel(); return true; });
    return () => sub.remove();
  }, [onCancel, busy]);

  async function run(kind: 'site' | 'device') {
    setBusy(kind);
    setError(null);
    try {
      const png = kind === 'site' ? await fetchIconForSite(url) : await pickIconFromDevice();
      if (png) onPick({ newPng: png });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const isSelected = (c: IconChoice) =>
    'customId' in c ? 'customId' in value && value.customId === c.customId : 'standard' in value && value.standard === c.standard;

  const tile = (key: string, c: IconChoice, a11y: string, icon: React.ReactNode) => {
    const on = isSelected(c);
    return (
      <Pressable
        key={key}
        accessibilityRole="radio"
        accessibilityLabel={a11y}
        accessibilityState={{ selected: on }}
        onPress={() => onPick(c)}
        style={({ pressed }) => ({
          padding: 3, borderRadius: TILE * 0.32, borderWidth: 2,
          borderColor: on ? t.accent : 'transparent', opacity: pressed ? 0.7 : 1,
        })}
      >
        {icon}
      </Pressable>
    );
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <EntryIcon
          key={JSON.stringify('newPng' in value ? 'new' : value)}
          uri={draftUri(value, vaultIcons)}
          standard={'standard' in value ? value.standard : 0}
          seed={seed} label={label} size={56}
        />
        <Text style={[type.heading, { color: t.ink, flex: 1 }]}>Choose an icon</Text>
      </View>

      <Card>
        <Small>From the website</Small>
        {host ? (
          <>
            <Body muted>Downloads the icon {host} publishes. Only {host} is contacted, and only now.</Body>
            <Button kind="secondary" label={`Get icon from ${host}`} onPress={() => run('site')} busy={busy === 'site'} disabled={busy !== null} />
          </>
        ) : (
          <Body muted>Add the website address to the login first, then you can fetch its icon.</Body>
        )}
      </Card>

      <Card>
        <Small>From this phone</Small>
        <Button kind="secondary" label="Choose a picture" onPress={() => run('device')} busy={busy === 'device'} disabled={busy !== null} />
      </Card>

      {error && <Banner tone="danger">{error}</Banner>}

      {vaultIcons.size > 0 && (
        <View style={{ gap: space.sm }}>
          <Small>Already in this vault</Small>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {[...vaultIcons].map(([id, uri], i) =>
              tile(id, { customId: id }, `Vault icon ${i + 1}`, <EntryIcon uri={uri} seed={seed} label={label} size={TILE} />),
            )}
          </View>
        </View>
      )}

      <View style={{ gap: space.sm }}>
        <Small>Standard icons (the same ones KeePassXC offers)</Small>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {STANDARD_ICONS.map((s, i) =>
            tile(`s${i}`, { standard: i }, i === 0 ? 'Initial letter' : s.label, <EntryIcon standard={i} seed={seed} label={label} size={TILE} />),
          )}
        </View>
        <Small>The first one is the default: the login’s initial on its colour.</Small>
      </View>

      <Button kind="secondary" label="Cancel" onPress={onCancel} disabled={busy !== null} />
    </Screen>
  );
}
