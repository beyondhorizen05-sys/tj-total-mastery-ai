import crypto from 'node:crypto';
import type { WorkspaceService } from './workspace.js';
import type { SettingsRepo } from '../db/repo.js';

export interface GoogleUserIdentity {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

interface PendingGoogleAuth {
  state: string;
  verifier: string;
  expiresAt: number;
}

/**
 * Standard Google Sign-In (OAuth2 / OpenID Connect) for User Authentication.
 *
 * ARCHITECTURAL SEPARATION NOTICE:
 * This service manages USER IDENTITY LOGIN only (email, name, sub).
 * Google does NOT provide consumer subscription OAuth tokens for free LLM inference.
 * Therefore, tokens from this service are strictly decoupled from the LLM provider layer
 * and are never passed to the ModelRouter or GoogleAdapter.
 */
export class GoogleAuthService {
  private pending = new Map<string, PendingGoogleAuth>();

  constructor(
    private ws: WorkspaceService,
    private settings: SettingsRepo,
    private config?: Partial<GoogleOAuthConfig>
  ) {}

  getConfig(): GoogleOAuthConfig {
    return {
      clientId: this.config?.clientId || process.env.GOOGLE_OAUTH_CLIENT_ID || '',
      clientSecret: this.config?.clientSecret || process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri: this.config?.redirectUri || process.env.GOOGLE_OAUTH_REDIRECT_URI || 'http://127.0.0.1:4780/api/v1/auth/google/callback',
    };
  }

  isConfigured(): boolean {
    return Boolean(this.getConfig().clientId);
  }

  /** Step 1: Generate PKCE authorization URL for Google Sign-In. */
  startAuth(): { authUrl: string; state: string } {
    const cfg = this.getConfig();
    if (!cfg.clientId) {
      throw new Error('Google OAuth is not configured: GOOGLE_OAUTH_CLIENT_ID is missing.');
    }

    const state = crypto.randomBytes(16).toString('hex');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    this.pending.set(state, {
      state,
      verifier,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    });

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      access_type: 'offline',
      prompt: 'consent',
    });

    return {
      authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      state,
    };
  }

  /** Step 2: Handle OAuth callback, verify PKCE verifier, exchange code, and fetch user identity. */
  async handleCallback(code: string, state: string): Promise<GoogleUserIdentity> {
    const attempt = this.pending.get(state);
    if (!attempt || Date.now() > attempt.expiresAt) {
      throw new Error('Invalid or expired Google OAuth state. Please restart sign-in.');
    }
    this.pending.delete(state);

    const cfg = this.getConfig();
    const bodyParams = new URLSearchParams({
      client_id: cfg.clientId,
      code,
      code_verifier: attempt.verifier,
      grant_type: 'authorization_code',
      redirect_uri: cfg.redirectUri,
    });
    if (cfg.clientSecret) {
      bodyParams.append('client_secret', cfg.clientSecret);
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`Google token exchange failed (${tokenRes.status}): ${errText}`);
    }

    const tokens = (await tokenRes.json()) as { access_token: string; id_token?: string };

    // Fetch user info from Google's standard UserInfo endpoint
    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userinfoRes.ok) {
      throw new Error(`Failed to retrieve Google user profile (${userinfoRes.status})`);
    }

    const info = (await userinfoRes.json()) as { sub: string; email: string; name: string; picture?: string };

    // Associate identity with local TJ workspace profile
    const currentUser = this.ws.user();
    const loc = Intl.DateTimeFormat().resolvedOptions();
    this.ws.setUser({
      display_name: info.name || info.email.split('@')[0],
      locale: currentUser?.locale || loc.locale,
      time_zone: currentUser?.time_zone || loc.timeZone,
    });
    this.settings.set('profile_name', info.name || info.email);
    this.settings.set('google_user_email', info.email);
    this.settings.set('google_user_sub', info.sub);

    return {
      sub: info.sub,
      email: info.email,
      name: info.name,
      picture: info.picture,
    };
  }

  getCurrentGoogleUser(): { email: string | null; sub: string | null } {
    return {
      email: this.settings.get<string | null>('google_user_email', null),
      sub: this.settings.get<string | null>('google_user_sub', null),
    };
  }
}
