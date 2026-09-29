/**
 * Native Google sign-in → Google ID token → Supabase, the same
 * signInWithIdToken flow the web app uses with Google Identity Services, so
 * it lands on the same Supabase user (and the same vault row).
 */
import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';
import { supabase } from './supabase';
import { GOOGLE_WEB_CLIENT_ID, googleEnabled } from './config';

let configured = false;
function ensureConfigured() {
  if (configured || !googleEnabled) return;
  // webClientId (not the Android client ID) makes Google issue an ID token whose
  // audience Supabase's Google provider already trusts for the web app.
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
  configured = true;
}

/** Returns false when the person cancels the Google account picker. */
export async function signInWithGoogle(): Promise<boolean> {
  ensureConfigured();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) return false;
    const token = res.data.idToken;
    if (!token) throw new Error('Google didn’t return an ID token. Check the web client ID in the app config.');
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token });
    if (error) throw error;
    return true;
  } catch (e) {
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.IN_PROGRESS) return false;
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) throw new Error('Google sign-in needs Google Play services on this phone.');
      if (e.code === 'DEVELOPER_ERROR' || e.code === '10')
        throw new Error('Google sign-in isn’t set up for this build (Android OAuth client or SHA-1 mismatch).');
    }
    throw e;
  }
}

/** Forget the Google account choice so the picker shows next time. */
export async function signOutOfGoogle() {
  if (!googleEnabled) return;
  ensureConfigured();
  await GoogleSignin.signOut().catch(() => undefined);
}
