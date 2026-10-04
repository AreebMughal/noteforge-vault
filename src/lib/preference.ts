/** Reads/writes the shared vault choice (see core/preference.ts) on the Supabase user. */
import { supabase } from './supabase';
import { PREFERENCE_KEY, parsePreference, type VaultPreference } from '../core/preference';

/**
 * Asks the server (not the cached JWT), so a choice made on the web a minute
 * ago is seen here. Throws when offline so the caller can fall back.
 */
export async function readPreference(): Promise<VaultPreference | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return parsePreference(data.user?.user_metadata?.[PREFERENCE_KEY]);
}

/** Best effort: the vault is fine without it; other devices just ask again. */
export async function writePreference(pref: VaultPreference | null): Promise<void> {
  try {
    // `data` is merged into user_metadata key by key; other keys are untouched.
    await supabase.auth.updateUser({ data: { [PREFERENCE_KEY]: pref } });
  } catch {
    // ignore
  }
}
