import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { KeyTag } from './components';
import { useTheme } from './theme';

/** The entry's stored icon on a white tile; its coloured initial when there is none or it fails to load. */
export function EntryIcon({ uri, seed, label, size = 40 }: { uri?: string | null; seed: string; label: string; size?: number }) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  if (!uri || failed) return <KeyTag seed={seed} label={label} size={size} />;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size, height: size, borderRadius: size * 0.28, borderTopRightRadius: size * 0.5,
        backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: t.line,
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}
    >
      <Image source={{ uri }} onError={() => setFailed(true)} style={{ width: size * 0.6, height: size * 0.6 }} resizeMode="contain" />
    </View>
  );
}
