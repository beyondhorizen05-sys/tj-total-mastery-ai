import crypto from 'node:crypto';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Database } from '../db/database.js';
import { SettingsRepo } from '../db/repo.js';
import type { Vault } from '../security/vault.js';
import { ProviderError } from './types.js';

const AUTH_ORIGIN = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const CALLBACK_PATH = '/auth/callback';
const TOKEN_URL = `${AUTH_ORIGIN}/api/accounts/oauth/token`;

export interface ChatGPTPlanAccount {
  id: string;
  client_id: string;
  subject: string;
  email: string | null;
  name: string | null;
  credential_ref: string | null;
  connected_at: string;
}

interface TokenRecord {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_at: number;
  scopes: string[];
}

interface PendingAttempt {
  server: http.Server;
  timer: ReturnType<typeof setTimeout>;
  state: string;
  nonce: string;
  verifier: string;
  redirect_uri: string;
  selected_account: ChatGPTPlanAccount | null;
}

class TokenExchangeError extends Error {
  constructor(readonly status: number, readonly code: string | null) { super(`OpenAI token exchange failed (${status})`); }
}

export interface ChatGPTPlanStatus {
  enabled: boolean;
  pending: boolean;
  accounts: Array<{ id: string; email: string | null; name: string | null; connected: boolean }>;
  active_account_id: string | null;
  last_error: string | null;
}

/** Public-client OAuth for the documented open-source ChatGPT plan flow. Tokens remain in Vault. */
export class ChatGPTPlanService {
  private settings: SettingsRepo;
  private pending: PendingAttempt | null = null;
  private refreshes = new Map<string, Promise<TokenRecord>>();
  private lastError: string | null = null;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(
    db: Database,
    private vault: Vault,
    readonly enabled: boolean,
    private onConnected?: (account: ChatGPTPlanAccount) => Promise<void>,
    private onDisconnected?: (account: ChatGPTPlanAccount) => void,
    private browserOpen: (url: string) => Promise<void> = openSystemBrowser,
  ) {
    this.settings = new SettingsRepo(db);
  }

  accounts(): ChatGPTPlanAccount[] {
    return this.settings.get<ChatGPTPlanAccount[]>('chatgpt_plan_accounts', []);
  }

  status(): ChatGPTPlanStatus {
    const accounts = this.accounts();
    return {
      enabled: this.enabled,
      pending: !!this.pending,
      accounts: accounts.map((a) => ({ id: a.id, email: a.email, name: a.name, connected: !!a.credential_ref && this.vault.has(a.credential_ref) })),
      active_account_id: this.settings.get<string | null>('chatgpt_plan_active_account_id', null),
      last_error: this.lastError,
    };
  }

  hostId(): string {
    let id = this.settings.get<string | null>('chatgpt_plan_host_id', null);
    if (!id) {
      id = `urn:uuid:${crypto.randomUUID()}`;
      this.settings.set('chatgpt_plan_host_id', id);
    }
    return id;
  }

  async begin(accountId?: string): Promise<void> {
    if (!this.enabled) throw new Error('ChatGPT plan sign-in is disabled for this build. Enable it only for an eligible open-source or approved private client.');
    if (this.pending) throw new Error('A ChatGPT sign-in is already in progress');
    const selected = accountId ? this.accounts().find((a) => a.id === accountId) : null;
    if (accountId && !selected) throw new Error('ChatGPT account not found');
    const state = randomUrlSafe(32);
    const nonce = randomUrlSafe(32);
    const verifier = randomUrlSafe(48);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const server = http.createServer((request, response) => {
      void this.handleCallback(request, response);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Could not allocate loopback callback port');
      const redirect_uri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
      const timer = setTimeout(() => this.finishPending('Sign-in timed out. Please try again.'), 5 * 60_000);
      this.pending = { server, timer, state, nonce, verifier, redirect_uri, selected_account: selected ?? null };
      this.lastError = null;
      const url = new URL(`${AUTH_ORIGIN}/api/accounts/authorize`);
      url.searchParams.set('client_id', selected?.client_id ?? 'dynamic_agent_client');
      if (!selected) url.searchParams.set('agent_name_hint', 'TJ Total Mastery AI');
      url.searchParams.set('ext_agent_host_id', this.hostId());
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('redirect_uri', redirect_uri);
      url.searchParams.set('scope', SCOPES);
      url.searchParams.set('resource', RESOURCE);
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('code_challenge', challenge);
      await this.browserOpen(url.toString());
    } catch (error) {
      this.finishPending('Could not open ChatGPT sign-in.');
      if (server.listening) server.close();
      throw error;
    }
  }

  private async handleCallback(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const pending = this.pending;
    if (!pending) { this.sendCallbackPage(response, 410, 'Sign-in attempt expired.'); return; }
    const expectedHost = new URL(pending.redirect_uri).host;
    if (request.headers.host !== expectedHost) { this.sendCallbackPage(response, 400, 'Invalid callback host.'); return; }
    const url = new URL(request.url ?? '/', pending.redirect_uri);
    if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH) { this.sendCallbackPage(response, 404, 'Not found.'); return; }
    const receivedState = url.searchParams.get('state') ?? '';
    if (!safeEqual(receivedState, pending.state)) { this.sendCallbackPage(response, 400, 'Invalid sign-in state.'); return; }
    // Consume the attempt before any network work so the same authorization code cannot be replayed.
    this.pending = null;
    clearTimeout(pending.timer);
    pending.server.close();
    if (url.searchParams.has('error')) {
      this.lastError = url.searchParams.get('error') === 'access_denied' ? 'ChatGPT authorization was declined.' : 'ChatGPT authorization failed.';
      this.sendCallbackPage(response, 400, this.lastError);
      return;
    }
    const code = url.searchParams.get('code');
    const callbackClient = url.searchParams.get('client_id');
    const clientId = pending.selected_account?.client_id ?? callbackClient;
    if (!code || !clientId || clientId === 'dynamic_agent_client' || (pending.selected_account && callbackClient && callbackClient !== clientId)) {
      this.lastError = 'ChatGPT registration callback was incomplete.';
      this.sendCallbackPage(response, 400, this.lastError);
      return;
    }
    try {
      const tokenResponse = await this.exchange(new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: pending.verifier, redirect_uri: pending.redirect_uri, resource: RESOURCE }));
      const identity = await this.validateIdToken(tokenResponse.id_token, clientId, pending.nonce);
      if (pending.selected_account && identity.subject !== pending.selected_account.subject) throw new Error('The selected ChatGPT account did not match the signed-in account.');
      const scopes = String(tokenResponse.scope ?? '').split(/\s+/).filter(Boolean);
      if (!scopes.includes('chatgpt.tokens.use.direct') || !scopes.includes('resource.invoke')) throw new Error('ChatGPT plan inference permission was not granted.');
      if (!tokenResponse.access_token || !tokenResponse.refresh_token) throw new Error('ChatGPT token response was incomplete.');
      const id = `chatgpt_${crypto.createHash('sha256').update(`${clientId}:${identity.subject}`).digest('hex').slice(0, 16)}`;
      const prior = this.accounts().find((a) => a.id === id);
      const tokens: TokenRecord = { access_token: tokenResponse.access_token, refresh_token: tokenResponse.refresh_token, id_token: tokenResponse.id_token, expires_at: Date.now() + Number(tokenResponse.expires_in ?? 3600) * 1000, scopes };
      const ref = this.vault.put({ label: `ChatGPT plan ${id}`, scope: `chatgpt-plan:${id}`, value: JSON.stringify(tokens), ref: prior?.credential_ref ?? undefined });
      const account: ChatGPTPlanAccount = { id, client_id: clientId, subject: identity.subject, email: identity.email, name: identity.name, credential_ref: ref, connected_at: new Date().toISOString() };
      this.settings.set('chatgpt_plan_accounts', [...this.accounts().filter((a) => a.id !== id), account]);
      this.settings.set('chatgpt_plan_active_account_id', id);
      this.lastError = null;
      if (this.onConnected) await this.onConnected(account);
      this.sendCallbackPage(response, 200, 'ChatGPT account connected. You can return to TJ.');
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'ChatGPT sign-in failed.';
      this.sendCallbackPage(response, 400, this.lastError);
    }
  }

  private sendCallbackPage(response: http.ServerResponse, status: number, message: string): void {
    response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff' });
    response.end(`<html><body style="font-family:system-ui;background:#09111e;color:#fff;padding:3rem"><h1>TJ Total Mastery AI</h1><p>${escapeHtml(message)}</p></body></html>`);
  }

  private finishPending(error: string): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.server.close();
    this.lastError = error;
  }

  private async discovery(): Promise<{ jwks_uri: string; revocation_endpoint?: string }> {
    const response = await fetch(`${AUTH_ORIGIN}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Could not verify OpenAI identity configuration.');
    const data = await response.json() as { issuer?: string; jwks_uri?: string; revocation_endpoint?: string };
    if (data.issuer !== AUTH_ORIGIN || !data.jwks_uri || new URL(data.jwks_uri).origin !== AUTH_ORIGIN) throw new Error('Unexpected OpenAI identity configuration.');
    return { jwks_uri: data.jwks_uri, revocation_endpoint: data.revocation_endpoint };
  }

  private async validateIdToken(idToken: string, clientId: string, nonce?: string): Promise<{ subject: string; email: string | null; name: string | null }> {
    if (!idToken) throw new Error('OpenAI ID token was missing.');
    if (!this.jwks) this.jwks = createRemoteJWKSet(new URL((await this.discovery()).jwks_uri));
    const { payload } = await jwtVerify(idToken, this.jwks, { issuer: AUTH_ORIGIN, audience: clientId });
    if (!payload.sub || (nonce && payload.nonce !== nonce)) throw new Error('OpenAI ID token validation failed.');
    return { subject: payload.sub, email: typeof payload.email === 'string' ? payload.email : null, name: typeof payload.name === 'string' ? payload.name : null };
  }

  private async exchange(params: URLSearchParams): Promise<any> {
    const response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      let code: string | null = null;
      try { const payload = await response.json() as { error?: string }; code = typeof payload.error === 'string' ? payload.error : null; } catch { /* no structured error */ }
      throw new TokenExchangeError(response.status, code);
    }
    return response.json();
  }

  private account(id: string): ChatGPTPlanAccount {
    if (!this.enabled) throw new ProviderError('ChatGPT plan sign-in is disabled', 'auth', undefined, false);
    const account = this.accounts().find((a) => a.id === id);
    if (!account || !account.credential_ref) throw new ProviderError('ChatGPT account is not connected', 'auth', undefined, false);
    return account;
  }

  private tokenRecord(account: ChatGPTPlanAccount): TokenRecord {
    const value = this.vault.get(account.credential_ref!, `chatgpt-plan:${account.id}`, 'model inference');
    if (!value) throw new ProviderError('ChatGPT credentials are unavailable', 'auth', undefined, false);
    return JSON.parse(value) as TokenRecord;
  }

  async accessToken(accountId: string): Promise<string> {
    const account = this.account(accountId);
    const tokens = this.tokenRecord(account);
    if (tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
    let refresh = this.refreshes.get(accountId);
    if (!refresh) {
      refresh = this.refresh(account, tokens).finally(() => this.refreshes.delete(accountId));
      this.refreshes.set(accountId, refresh);
    }
    return (await refresh).access_token;
  }

  private async refresh(account: ChatGPTPlanAccount, old: TokenRecord): Promise<TokenRecord> {
    try {
      const response = await this.exchange(new URLSearchParams({ grant_type: 'refresh_token', client_id: account.client_id, refresh_token: old.refresh_token, resource: RESOURCE }));
      if (!response.access_token || !response.refresh_token) throw new Error('ChatGPT refresh response was incomplete.');
      if (response.id_token) {
        const identity = await this.validateIdToken(response.id_token, account.client_id);
        if (identity.subject !== account.subject) throw new Error('ChatGPT refresh identity changed.');
      }
      const scopes = String(response.scope ?? old.scopes.join(' ')).split(/\s+/).filter(Boolean);
      if (!scopes.includes('chatgpt.tokens.use.direct')) throw new Error('ChatGPT plan permission is no longer available.');
      const next: TokenRecord = { access_token: response.access_token, refresh_token: response.refresh_token, id_token: response.id_token ?? old.id_token, expires_at: Date.now() + Number(response.expires_in ?? 3600) * 1000, scopes };
      this.vault.put({ label: `ChatGPT plan ${account.id}`, scope: `chatgpt-plan:${account.id}`, value: JSON.stringify(next), ref: account.credential_ref! });
      return next;
    } catch (error) {
      const code = error instanceof TokenExchangeError ? error.code : null;
      if (code && ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'].includes(code)) {
        this.vault.delete(account.credential_ref!);
        this.settings.set('chatgpt_plan_accounts', this.accounts().map((item) => item.id === account.id ? { ...item, credential_ref: null } : item));
        this.onDisconnected?.(account);
        throw new ProviderError('ChatGPT session expired. Reconnect the account.', 'auth', undefined, false);
      }
      throw new ProviderError('ChatGPT session refresh is temporarily unavailable.', 'unavailable', undefined, false);
    }
  }

  async listModels(accountId: string): Promise<Array<{ id: string; display_name: string }>> {
    const token = await this.accessToken(accountId);
    const response = await fetch(`${RESOURCE}/models`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new ProviderError(`ChatGPT model discovery failed (${response.status})`, response.status === 401 ? 'auth' : 'unavailable', response.status, false);
    const payload = await response.json() as { models?: Array<{ slug?: string; display_name?: string; visibility?: string }> };
    return (payload.models ?? []).filter((m) => m.visibility === 'list' && !!m.slug).map((m) => ({ id: m.slug!, display_name: m.display_name || m.slug! }));
  }

  async disconnect(id: string): Promise<{ remote_revocation_confirmed: boolean }> {
    const account = this.accounts().find((a) => a.id === id);
    if (!account) throw new Error('ChatGPT account not found');
    let confirmed = false;
    if (account.credential_ref) {
      try {
        const tokens = this.tokenRecord(account);
        const endpoint = (await this.discovery()).revocation_endpoint;
        if (endpoint && new URL(endpoint).origin === AUTH_ORIGIN) {
          const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokens.refresh_token, token_type_hint: 'refresh_token', client_id: account.client_id }), signal: AbortSignal.timeout(10_000) });
          confirmed = response.ok;
        }
      } catch { /* local disconnect still clears credentials */ }
      this.vault.delete(account.credential_ref);
    }
    this.settings.set('chatgpt_plan_accounts', this.accounts().filter((a) => a.id !== id));
    if (this.settings.get<string | null>('chatgpt_plan_active_account_id', null) === id) this.settings.set('chatgpt_plan_active_account_id', null);
    this.onDisconnected?.(account);
    return { remote_revocation_confirmed: confirmed };
  }

  close(): void { this.finishPending('Sign-in interrupted because TJ stopped.'); }
}

function randomUrlSafe(bytes: number): string { return crypto.randomBytes(bytes).toString('base64url'); }
function safeEqual(a: string, b: string): boolean { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function escapeHtml(input: string): string { return input.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
function openSystemBrowser(url: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('System-browser sign-in currently supports Windows only.');
  return new Promise((resolve, reject) => execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true }, (error) => error ? reject(error) : resolve()));
}
