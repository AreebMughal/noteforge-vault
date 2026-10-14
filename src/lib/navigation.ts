import { useCallback, useRef } from 'react';
import { useRouter, type Href } from 'expo-router';

/** A second tap inside this window is the same intent, not a second screen. */
const REPEAT_TAP_MS = 1000;

/**
 * `router.push` that swallows repeat taps. Expo Router's push always adds a
 * screen, so tapping a button several times before the transition finishes
 * stacked the same page several times (and Back then walked through them).
 */
export function useSafePush() {
  const router = useRouter();
  const last = useRef(0);
  return useCallback(
    (href: Href) => {
      const now = Date.now();
      if (now - last.current < REPEAT_TAP_MS) return;
      last.current = now;
      router.push(href);
    },
    [router],
  );
}
