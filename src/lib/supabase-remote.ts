/** `public.vaults` adapter. Same table, same RLS, same version contract as the web app. */
import { Buffer } from 'react-native-quick-crypto';
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { MAX_BASE64_BYTES } from './config';
import { OfflineError, type VaultRemote } from '../core/sync';

function check(error: PostgrestError | null) {
  if (!error) return;
  if (!error.code && /network|fetch|timed? ?out|abort/i.test(error.message + (error.details ?? ''))) throw new OfflineError();
  throw new Error(error.message);
}
async function guard<T>(fn: () => PromiseLike<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof OfflineError) throw e;
    if (e instanceof TypeError && /network|fetch/i.test(e.message)) throw new OfflineError();
    throw e;
  }
}
function encode(data: Uint8Array) {
  const b64 = Buffer.from(data).toString('base64');
  if (b64.length > MAX_BASE64_BYTES) throw new Error('The vault is larger than the 8 MB limit. Remove large attachments.');
  return b64;
}

export function supabaseRemote(ownerId: string): VaultRemote {
  return {
    fetch: () => guard(async () => {
      const { data, error } = await supabase.from('vaults').select('data, version, name').eq('owner_id', ownerId).maybeSingle();
      check(error);
      if (!data) return null;
      return { data: new Uint8Array(Buffer.from(data.data, 'base64')), revision: String(data.version), name: data.name };
    }),
    revision: () => guard(async () => {
      const { data, error } = await supabase.from('vaults').select('version').eq('owner_id', ownerId).maybeSingle();
      check(error);
      return data ? String(data.version) : null;
    }),
    insert: (bytes, name) => guard(async () => {
      const { data, error } = await supabase.from('vaults')
        .insert({ owner_id: ownerId, name, data: encode(bytes), byte_size: bytes.byteLength, version: 1 })
        .select('version').single();
      check(error);
      return String(data!.version);
    }),
    update: (bytes, expectedRevision) => guard(async () => {
      const expected = Number(expectedRevision);
      const { data, error } = await supabase.from('vaults')
        .update({ data: encode(bytes), byte_size: bytes.byteLength, version: expected + 1, updated_at: new Date().toISOString() })
        .eq('owner_id', ownerId).eq('version', expected)
        .select('version');
      check(error);
      return data && data.length ? String(data[0].version) : null;
    }),
    remove: () => guard(async () => {
      const { error } = await supabase.from('vaults').delete().eq('owner_id', ownerId);
      check(error);
    }),
  };
}
