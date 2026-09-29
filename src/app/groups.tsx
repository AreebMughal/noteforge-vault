import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useApp } from '../state/app';
import { createGroup, deleteGroup, findGroup, listGroups, renameGroup } from '../core/entries';
import { Banner, Button, Card, Field, Screen, Small, errorText, HeaderLink } from '../ui/components';
import { space, type, useTheme } from '../ui/theme';

export default function Groups() {
  const app = useApp();
  const t = useTheme();
  const db = app.session!.db;
  const groups = listGroups(db);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => void) => app.mutate(fn).catch((e) => setError(errorText(e)));
  const readOnly = app.session?.readOnly;

  return (
    <Screen>
      {error && <Banner tone="danger">{error}</Banner>}
      <Card>
        {groups.map((g, i) => (
          <View key={g.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: g.depth * space.lg }}>
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { color: t.ink }]}>{g.name || 'Untitled'}</Text>
              <Small>{g.entryCount} {g.entryCount === 1 ? 'login' : 'logins'}{i === 0 ? ' · top level' : ''}</Small>
            </View>
            {!readOnly && <HeaderLink label="Rename" onPress={() => setRenaming({ id: g.id, name: g.name })} />}
            {!readOnly && i > 0 && (
              <HeaderLink
                label="Delete"
                onPress={() =>
                  Alert.alert(`Delete “${g.name}”?`, 'The group and its logins move to the recycle bin.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => run(() => deleteGroup(db, findGroup(db, g.id)!)) },
                  ])
                }
              />
            )}
          </View>
        ))}
      </Card>
      {renaming && (
        <Card>
          <Field label="New name" value={renaming.name} onChangeText={(v) => setRenaming({ ...renaming, name: v })} autoCapitalize="sentences" autoFocus />
          <Button label="Save name" disabled={!renaming.name.trim()} onPress={() => {
            const g = findGroup(db, renaming.id);
            if (g) run(() => renameGroup(g, renaming.name.trim()));
            setRenaming(null);
          }} />
          <Button kind="secondary" label="Cancel" onPress={() => setRenaming(null)} />
        </Card>
      )}
      {!readOnly && (
        <>
          <Field label="New group" value={name} onChangeText={setName} autoCapitalize="sentences" placeholder="e.g. Work" />
          <Button label="Add group" disabled={!name.trim()} onPress={() => { run(() => createGroup(db, null, name.trim())); setName(''); }} />
        </>
      )}
    </Screen>
  );
}
