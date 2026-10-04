export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
/** The web app's Google OAuth *Web* client ID. Empty = the Google button is hidden. */
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
export const googleEnabled = Boolean(GOOGLE_WEB_CLIENT_ID);
export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
/**
 * The web app's Azure app registration (NEXT_PUBLIC_AZURE_CLIENT_ID / _TENANT).
 * Public client id, no secret. Empty = the OneDrive option is hidden.
 */
export const AZURE_CLIENT_ID = process.env.EXPO_PUBLIC_AZURE_CLIENT_ID ?? '';
export const AZURE_TENANT = process.env.EXPO_PUBLIC_AZURE_TENANT || 'common';
export const oneDriveEnabled = Boolean(AZURE_CLIENT_ID);

/** Supabase column check: octet_length(data) <= 8 MiB (base64 text). */
export const MAX_BASE64_BYTES = 8 * 1024 * 1024;
export const CLIPBOARD_CLEAR_MS = 15_000;
