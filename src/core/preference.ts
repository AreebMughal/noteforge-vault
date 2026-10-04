/**
 * Which vault this user uses, shared with the web app through the Supabase
 * Auth user's `user_metadata.noteforge_vault`. Pick "KeePassXC on OneDrive"
 * on the web and this app opens the same file without asking, and the other
 * way round. No table, no schema change.
 *
 * It says where the vault is, never anything that opens it: a OneDrive path
 * and item id aren't secrets, and Microsoft tokens stay on each device.
 *
 * Mirror of the web app's `lib/vault/preference.ts`. Change both together.
 */
export const PREFERENCE_KEY = 'noteforge_vault';

export interface OneDriveRef {
  fileId: string;
  /** Relative to the drive root, e.g. `Documents/Passwords.kdbx`. */
  path: string;
  /** The Microsoft account that holds it, used as a sign-in hint. */
  account?: string;
}

export type VaultPreference =
  | { v: 1; source: 'account'; updatedAt: string }
  | { v: 1; source: 'onedrive'; onedrive: OneDriveRef; updatedAt: string };

/** Tolerant reader: anything malformed reads as "no preference yet". */
export function parsePreference(raw: unknown): VaultPreference | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const updatedAt = typeof p.updatedAt === 'string' ? p.updatedAt : '';
  if (p.source === 'account') return { v: 1, source: 'account', updatedAt };
  if (p.source === 'onedrive' && p.onedrive && typeof p.onedrive === 'object') {
    const o = p.onedrive as Record<string, unknown>;
    if (typeof o.fileId !== 'string' || typeof o.path !== 'string') return null;
    return {
      v: 1,
      source: 'onedrive',
      onedrive: { fileId: o.fileId, path: o.path, ...(typeof o.account === 'string' ? { account: o.account } : {}) },
      updatedAt,
    };
  }
  return null;
}

export function accountPreference(now = new Date()): VaultPreference {
  return { v: 1, source: 'account', updatedAt: now.toISOString() };
}

export function oneDrivePreference(ref: OneDriveRef, now = new Date()): VaultPreference {
  return {
    v: 1,
    source: 'onedrive',
    onedrive: { fileId: ref.fileId, path: ref.path, ...(ref.account ? { account: ref.account } : {}) },
    updatedAt: now.toISOString(),
  };
}
