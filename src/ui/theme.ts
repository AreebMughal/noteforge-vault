import { useColorScheme } from 'react-native';

/**
 * "Tempered steel": cool blue-greys with one heat-blued accent, the colour
 * steel turns when it is forged. Key tags (per-entry monograms) carry the
 * only other colour in the app.
 */
const light = {
  bg: '#E9EDF1', surface: '#FFFFFF', sunken: '#DCE2E8', ink: '#15202B', muted: '#5A6876',
  line: '#C9D2DB', accent: '#2B5C8F', accentInk: '#FFFFFF', danger: '#A8322A', warn: '#8A5A00', warnBg: '#F6EAD2',
};
const dark: typeof light = {
  bg: '#0E141A', surface: '#172029', sunken: '#0A0F14', ink: '#E4EAF0', muted: '#8E9CAA',
  line: '#27333F', accent: '#86AEDB', accentInk: '#0E141A', danger: '#F08C82', warn: '#E9C27A', warnBg: '#2B2415',
};
export type Palette = typeof light;
export const useTheme = (): Palette => (useColorScheme() === 'dark' ? dark : light);

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 36 };
export const type = {
  title: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.4 },
  heading: { fontSize: 19, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 23 },
  small: { fontSize: 13, lineHeight: 18 },
  mono: { fontFamily: 'monospace', fontSize: 16, letterSpacing: 0.3 },
};

/** Stable hue per site/title so the same login gets the same tag everywhere. */
export function tagColor(seed: string, scheme: string | null | undefined) {
  let h = 0;
  for (const ch of seed.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return scheme === 'dark' ? `hsl(${hue}, 38%, 34%)` : `hsl(${hue}, 42%, 42%)`;
}
