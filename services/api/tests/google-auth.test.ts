import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../src/db/database.js';
import { SettingsRepo } from '../src/db/repo.js';
import { EventBus } from '../src/core/event-bus.js';
import { WorkspaceService } from '../src/core/workspace.js';
import { GoogleAuthService } from '../src/core/google-auth.js';
import fs from 'node:fs';
import path from 'node:path';

describe('GoogleAuthService (User Identity Authentication)', () => {
  let db: Database;
  let bus: EventBus;
  let settings: SettingsRepo;
  let ws: WorkspaceService;
  let authService: GoogleAuthService;
  const testDir = path.resolve('tests/tmp-google-auth');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    db = new Database(path.join(testDir, 'test.sqlite'));
    db.migrate();
    bus = new EventBus(db);
    settings = new SettingsRepo(db);
    ws = new WorkspaceService(db, bus, path.join(testDir, 'projects'), testDir);
    ws.init();
    authService = new GoogleAuthService(ws, settings, {
      clientId: 'mock-google-client-id.apps.googleusercontent.com',
      clientSecret: 'mock-google-secret',
      redirectUri: 'http://127.0.0.1:4780/api/v1/auth/google/callback',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      db.close();
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('generates a valid PKCE authorization URL with openid email profile scopes', () => {
    const { authUrl, state } = authService.startAuth();
    expect(authUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(authUrl).toContain('client_id=mock-google-client-id.apps.googleusercontent.com');
    expect(authUrl).toContain('scope=openid+email+profile');
    expect(authUrl).toContain('code_challenge_method=S256');
    expect(authUrl).toContain(`state=${state}`);
  });

  it('exchanges code for user identity, updates local workspace user, and saves in settings', async () => {
    const { state } = authService.startAuth();

    vi.stubGlobal('fetch', async (url: string) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({
          access_token: 'mock-google-access-token',
          id_token: 'mock-google-id-token',
        }), { status: 200 });
      }
      if (url === 'https://www.googleapis.com/oauth2/v3/userinfo') {
        return new Response(JSON.stringify({
          sub: 'google-sub-12345',
          email: 'developer@example.com',
          name: 'Developer Jazib',
          picture: 'https://example.com/avatar.png',
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const user = await authService.handleCallback('mock-auth-code', state);
    expect(user.email).toBe('developer@example.com');
    expect(user.name).toBe('Developer Jazib');
    expect(user.sub).toBe('google-sub-12345');

    // Confirm local workspace user was updated
    expect(ws.user().display_name).toBe('Developer Jazib');
    expect(settings.get('google_user_email', null)).toBe('developer@example.com');
  });

  it('rejects an invalid or expired OAuth state', async () => {
    await expect(authService.handleCallback('mock-code', 'invalid-state')).rejects.toThrow(/invalid or expired Google OAuth state/i);
  });
});
