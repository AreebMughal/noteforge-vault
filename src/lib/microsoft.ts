/**
 * Microsoft sign-in for OneDrive, on this phone. OAuth 2.0 authorization code
 * + PKCE in a Custom Tab (expo-auth-session) — a public client with no
 * secret, the mobile counterpart of the web app's MSAL popup, using the same
 * Azure app registration with a "Mobile and desktop" redirect URI added.
 *
 * Tokens never leave the phone and are never shared with the web app: each
 * device signs in to Microsoft once. The refresh token is kept per NoteForge
 * user, encrypted (same storage as the Supabase session), and dropped on
 * sign-out or "Disconnect OneDrive".
 */
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { secureSessionStorage } from './secure-session-storage';
import { AZURE_CLIENT_ID, AZURE_TENANT } from './config';
import { GRAPH_SCOPES, GraphClient, MicrosoftSignInRequired } from '../core/onedrive';
import { OfflineError } from '../core/sync';

WebBrowser.maybeCompleteAuthSession();

/**
 * The redirect Azure suggests for "Mobile and desktop applications"
 * (msal<client id>://auth) — tick it there. app.config.ts registers the scheme.
 */
export const MICROSOFT_REDIRECT_URI = `msal${AZURE_CLIENT_ID}://auth`;

const discovery = {
  authorizationEndpoint: `https://login.microsoftonline.com/${AZURE_TENANT}/oauth2/v2.0/authorize`,
  tokenEndpoint: `https://login.microsoftonline.com/${AZURE_TENANT}/oauth2/v2.0/token`,
};

interface Stored { refreshToken: string; account: string }
const storeKey = (ownerId: string) => `ms-auth-${ownerId}`;

async function readStored(ownerId: string): Promise<Stored | null> {
  const raw = await secureSessionStorage.getItem(storeKey(ownerId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Stored;
  } catch {
    return null;
  }
}

/** One Microsoft connection for one NoteForge user on this phone. */
export class MicrosoftConnection {
  private access: { token: string; expiresAt: number } | null = null;
  private refreshing: Promise<string> | null = null;
  readonly graph = new GraphClient((force) => this.token(force));

  constructor(private ownerId: string) {}

  /** The connected Microsoft account, or null if this phone hasn't connected yet. */
  async account(): Promise<string | null> {
    return (await readStored(this.ownerId))?.account ?? null;
  }

  /** Opens Microsoft's sign-in page. Returns the account, or null if the user backed out. */
  async connect(loginHint?: string): Promise<string | null> {
    const request = new AuthSession.AuthRequest({
      clientId: AZURE_CLIENT_ID,
      redirectUri: MICROSOFT_REDIRECT_URI,
      scopes: GRAPH_SCOPES,
      usePKCE: true,
      prompt: AuthSession.Prompt.SelectAccount,
      extraParams: loginHint ? { login_hint: loginHint } : {},
    });
    const result = await request.promptAsync(discovery);
    if (result.type === 'cancel' || result.type === 'dismiss') return null;
    if (result.type !== 'success') {
      const msg = result.type === 'error' ? result.error?.description || result.error?.message : null;
      throw new Error(msg || 'Microsoft sign-in didn’t complete.');
    }
    const tokens = await AuthSession.exchangeCodeAsync(
      {
        clientId: AZURE_CLIENT_ID,
        code: result.params.code,
        redirectUri: MICROSOFT_REDIRECT_URI,
        extraParams: { code_verifier: request.codeVerifier ?? '' },
      },
      discovery,
    );
    if (!tokens.refreshToken) throw new Error('Microsoft didn’t return a refresh token (offline_access).');
    this.remember(tokens);
    // Store the refresh token first: me() below already goes through token().
    await secureSessionStorage.setItem(storeKey(this.ownerId), JSON.stringify({ refreshToken: tokens.refreshToken, account: '' }));
    const account = await this.graph.me();
    await secureSessionStorage.setItem(storeKey(this.ownerId), JSON.stringify({ refreshToken: tokens.refreshToken, account }));
    return account;
  }

  async disconnect() {
    this.access = null;
    await secureSessionStorage.removeItem(storeKey(this.ownerId));
  }

  private remember(t: AuthSession.TokenResponse) {
    this.access = { token: t.accessToken, expiresAt: Date.now() + Math.max(60, (t.expiresIn ?? 3600) - 120) * 1000 };
  }

  private token(force = false): Promise<string> {
    if (!force && this.access && Date.now() < this.access.expiresAt) return Promise.resolve(this.access.token);
    // One refresh at a time: refresh tokens rotate, so two parallel refreshes would race.
    this.refreshing ??= this.refresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async refresh(): Promise<string> {
    const stored = await readStored(this.ownerId);
    if (!stored) throw new MicrosoftSignInRequired();
    let t: AuthSession.TokenResponse;
    try {
      t = await AuthSession.refreshAsync(
        { clientId: AZURE_CLIENT_ID, refreshToken: stored.refreshToken, scopes: GRAPH_SCOPES },
        discovery,
      );
    } catch (e) {
      // Microsoft said no: expired (90 days unused), revoked, password changed, or consent withdrawn.
      if (e instanceof AuthSession.TokenError && /invalid_grant|interaction_required|consent_required|login_required/.test(e.code)) {
        await this.disconnect();
        throw new MicrosoftSignInRequired();
      }
      // Anything else (no network, a Microsoft outage) is temporary: keep the sign-in.
      if (e instanceof AuthSession.TokenError) throw new Error(e.description || e.message);
      throw new OfflineError();
    }
    this.remember(t);
    if (t.refreshToken && t.refreshToken !== stored.refreshToken) {
      await secureSessionStorage.setItem(storeKey(this.ownerId), JSON.stringify({ ...stored, refreshToken: t.refreshToken }));
    }
    return t.accessToken;
  }
}

export async function forgetMicrosoft(ownerId: string) {
  await secureSessionStorage.removeItem(storeKey(ownerId));
}
