import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { secureSessionStorage } from './secure-session-storage';

export const supabase = createClient(SUPABASE_URL || 'https://unconfigured.invalid', SUPABASE_ANON_KEY || 'unconfigured', {
  auth: {
    storage: secureSessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh tokens only while in the foreground (Supabase's React Native guidance).
AppState.addEventListener('change', (s) => {
  if (s === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
