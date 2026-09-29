import React from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme,
  type TextInputProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { space, tagColor, type, useTheme } from './theme';

export function Screen({ children, scroll = true, style }: { children: React.ReactNode; scroll?: boolean; style?: ViewStyle }) {
  const t = useTheme();
  const inner = <View style={[{ padding: space.lg, gap: space.lg }, style]}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['bottom', 'left', 'right']}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled">{inner}</ScrollView> : inner}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[type.title, { color: t.ink }]}>{children}</Text>;
}
export function Body({ children, muted, style }: { children: React.ReactNode; muted?: boolean; style?: object }) {
  const t = useTheme();
  return <Text style={[type.body, { color: muted ? t.muted : t.ink }, style]}>{children}</Text>;
}
export function Small({ children, color }: { children: React.ReactNode; color?: string }) {
  const t = useTheme();
  return <Text style={[type.small, { color: color ?? t.muted }]}>{children}</Text>;
}

type Kind = 'primary' | 'secondary' | 'danger' | 'quiet';
export function Button({ label, onPress, kind = 'primary', busy, disabled }: {
  label: string; onPress: () => void; kind?: Kind; busy?: boolean; disabled?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : kind === 'danger' ? t.danger : kind === 'secondary' ? t.surface : 'transparent';
  const fg = kind === 'primary' ? t.accentInk : kind === 'danger' ? '#FFFFFF' : kind === 'quiet' ? t.accent : t.ink;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        kind === 'secondary' && { borderWidth: StyleSheet.hairlineWidth, borderColor: t.line },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[type.body, { color: fg, fontWeight: '600' }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, secret, mono, right, ...props }: TextInputProps & {
  label: string; secret?: boolean; mono?: boolean; right?: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Small>{label}</Small>
      <View style={[styles.input, { backgroundColor: t.surface, borderColor: t.line }]}>
        <TextInput
          placeholderTextColor={t.muted}
          secureTextEntry={secret}
          autoCorrect={false}
          autoCapitalize="none"
          importantForAutofill={secret ? 'no' : 'auto'}
          style={[mono ? type.mono : type.body, { color: t.ink, flex: 1, paddingVertical: space.md }]}
          {...props}
        />
        {right}
      </View>
    </View>
  );
}

export function Banner({ tone = 'warn', children, action }: {
  tone?: 'warn' | 'danger' | 'info'; children: React.ReactNode; action?: React.ReactNode;
}) {
  const t = useTheme();
  const color = tone === 'danger' ? t.danger : tone === 'info' ? t.accent : t.warn;
  return (
    <View style={[styles.banner, { backgroundColor: tone === 'warn' ? t.warnBg : t.surface, borderLeftColor: color }]}>
      <Text style={[type.small, { color: t.ink, flex: 1 }]}>{children}</Text>
      {action}
    </View>
  );
}

export function KeyTag({ seed, label, size = 40 }: { seed: string; label: string; size?: number }) {
  const scheme = useColorScheme();
  const letter = (label.trim()[0] ?? '•').toUpperCase();
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size * 0.28, borderTopRightRadius: size * 0.5,
        backgroundColor: tagColor(seed || label, scheme), alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#FFFFFF', fontSize: size * 0.42, fontWeight: '700' }}>{letter}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.surface, borderRadius: 14, padding: space.lg, gap: space.md }, style]}>{children}</View>;
}

export function Choice<T extends string | number>({ options, value, onChange }: {
  options: { label: string; value: T }[]; value: T; onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={{
              paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: 999,
              backgroundColor: on ? t.accent : t.sunken,
            }}
          >
            <Text style={[type.small, { color: on ? t.accentInk : t.ink, fontWeight: on ? '600' : '400' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  input: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: 10, borderLeftWidth: 4 },
});

export function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export function hostOf(url: string) {
  const m = /^(?:[a-z]+:\/\/)?([^/?#:]+)/i.exec(url.trim());
  return m ? m[1].replace(/^www\./, '') : '';
}

export function HeaderLink({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button">
      <Text style={[type.body, { color: t.accent, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}
