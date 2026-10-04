import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { space, type } from './theme';

/**
 * "Sign in with Google", sized like the app's own buttons. Follows Google's
 * branding rules for custom buttons: the light theme (white fill, #747775
 * border, #1F1F1F text), the full-colour "G" unaltered, and Google's wording.
 */
export function GoogleButton({ onPress, busy, disabled }: { onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sign in with Google"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.button, { opacity: disabled ? 0.45 : 1, backgroundColor: pressed ? '#F2F2F2' : '#FFFFFF' }]}
    >
      {busy ? (
        <ActivityIndicator color="#1F1F1F" />
      ) : (
        <View style={styles.row}>
          <GoogleG size={20} />
          <Text style={[type.body, styles.label]}>Sign in with Google</Text>
        </View>
      )}
    </Pressable>
  );
}

/** Google's "G" logo, from Google's own sign-in button artwork. */
function GoogleG({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  // Same size and shape as components.tsx Button.
  button: {
    minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg,
    borderWidth: 1, borderColor: '#747775',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  label: { color: '#1F1F1F', fontWeight: '600' },
});
