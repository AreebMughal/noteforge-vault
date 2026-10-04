import React, { useState } from 'react';
import { Image, View, useColorScheme } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { KeyTag } from './components';
import { STANDARD_ICONS } from './standardIcons';
import { tagColor, useTheme } from './theme';

/**
 * The entry's stored image on a white tile; else its standard KeePass icon on
 * a coloured tile; else (standard icon 0, the default) its coloured initial.
 */
export function EntryIcon({ uri, standard = 0, seed, label, size = 40 }: {
  uri?: string | null; standard?: number; seed: string; label: string; size?: number;
}) {
  const t = useTheme();
  const scheme = useColorScheme();
  const [failed, setFailed] = useState(false);
  const shape = { width: size, height: size, borderRadius: size * 0.28, borderTopRightRadius: size * 0.5 };
  if (uri && !failed) {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ ...shape, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
      >
        <Image source={{ uri }} onError={() => setFailed(true)} style={{ width: size * 0.6, height: size * 0.6 }} resizeMode="contain" />
      </View>
    );
  }
  const glyph = standard > 0 ? STANDARD_ICONS[standard]?.glyph : undefined;
  if (!glyph) return <KeyTag seed={seed} label={label} size={size} />;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ ...shape, backgroundColor: tagColor(seed || label, scheme), alignItems: 'center', justifyContent: 'center' }}
    >
      <MaterialCommunityIcons name={glyph} size={size * 0.55} color="#FFFFFF" />
    </View>
  );
}
