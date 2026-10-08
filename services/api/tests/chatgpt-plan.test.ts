import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Database } from '../src/db/database.js';
import { Vault } from '../src/security/vault.js';
import { ChatGPTPlanService } from '../src/models/chatgpt-plan.js';
import { ChatGPTPlanAdapter } from '../src/models/adapters/chatgpt-plan.js';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const testDir = path.resolve('tests/tmp-chatgpt-plan');

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('ChatGPT plan integration', () => {
  it('keeps sign-in disabled until the release flag is enabled', async () => {
    fs.mkdirSync(testDir, { recursive: true });
    const db = new Database(path.join(testDir, 'test.sqlite')); db.migrate();
    const service = new ChatGPTPlanService(db, new Vault(db, path.join(testDir, 'vault')), false, undefined, undefined, async () => {});
    await expect(service.begin()).rejects.toThrow(/disabled/);
    expect(service.status()).toMatchObject({ enabled: false, pending: false, accounts: [] });
    db.close();
  });

  it('generates stable host identity and rejects a callback with the wrong state', async () => {
    fs.mkdirSync(testDir, { recursive: true });
    const db = new Database(path.join(testDir, 'test.sqlite')); db.migrate();
    let authorizeUrl = '';
    const vault = new Vault(db, path.join(testDir, 'vault'));
    const service = new ChatGPTPlanService(db, vault, true, undefined, undefined, async (url) => { authorizeUrl = url; });
    const hostId = service.hostId();
    expect(hostId).toMatch(/^urn:uuid:/);
    await service.begin();
    expect(service.status().pending).toBe(true);
    const url = new URL(authorizeUrl);
    expect(url.origin).toBe('https://auth.openai.com');
    expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(url.searchParams.get('ext_agent_host_id')).toBe(hostId);
    expect(url.searchParams.get('scope')).toContain('chatgpt.tokens.use.direct');
    const redirect = new URL(url.searchParams.get('redirect_uri')!);
    expect(redirect.hostname).toBe('127.0.0.1');
    const rejected = await fetch(`${redirect.toString()}?state=wrong&code=fake`);
    expect(rejected.status).toBe(400);
    expect(service.status().pending).toBe(true);
    const denied = await fetch(`${redirect.toString()}?state=${encodeURIComponent(url.searchParams.get('state')!)}&error=access_denied`);
    expect(denied.status).toBe(400);
    expect(service.status()).toMatchObject({ pending: false, accounts: [], last_error: 'ChatGPT authorization was declined.' });
    expect(new ChatGPTPlanService(db, vault, true).hostId()).toBe(hostId);
    db.close();
  });

  it('validates a signed ID token and stores credentials only in the vault', async () => {
    fs.mkdirSync(testDir, { recursive: true });
    const db = new Database(path.join(testDir, 'test.sqlite')); db.migrate();
    const vault = new Vault(db, path.join(testDir, 'vault'));
    let authorizeUrl = '';
    const service = new ChatGPTPlanService(db, vault, true, undefined, undefined, async (url) => { authorizeUrl = url; });
    await service.begin();
    const authorize = new URL(authorizeUrl);
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', use: 'sig', alg: 'RS256' };
    const idToken = await new SignJWT({ nonce: authorize.searchParams.get('nonce'), email: 'test@example.com', name: 'Test User' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer('https://auth.openai.com')
      .setAudience('oaiapp_test').setSubject('subject-1').setIssuedAt().setExpirationTime('1h').sign(privateKey);
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('http://127.0.0.1:')) return realFetch(input);
      if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/test-jwks' });
      if (url.endsWith('/test-jwks')) return Response.json({ keys: [jwk] });
      if (url.endsWith('/api/accounts/oauth/token')) return Response.json({ access_token: 'mock-access-token', refresh_token: 'mock-refresh-token', id_token: idToken, expires_in: 3600, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' });
      throw new Error(`Unexpected URL: ${url}`);
    }));
    const redirect = new URL(authorize.searchParams.get('redirect_uri')!);
    redirect.searchParams.set('state', authorize.searchParams.get('state')!);
    redirect.searchParams.set('code', 'test-code');
    redirect.searchParams.set('client_id', 'oaiapp_test');
    const response = await fetch(redirect);
    expect(response.status).toBe(200);
    const account = service.accounts()[0];
    expect(account).toMatchObject({ client_id: 'oaiapp_test', subject: 'subject-1', email: 'test@example.com' });
    expect(service.status().accounts[0].connected).toBe(true);
    expect(await service.accessToken(account.id)).toBe('mock-access-token');
    const rows = db.all<{ value: string }>('SELECT value FROM settings');
    expect(JSON.stringify(rows)).not.toContain('mock-access-token');
    db.close();
  });

  it('streams only documented Responses fields and requires response.completed', async () => {
    const service = { accessToken: vi.fn(async () => 'test-token'), listModels: vi.fn(async () => [{ id: 'model-a', display_name: 'Model A' }]) } as unknown as ChatGPTPlanService;
    const adapter = new ChatGPTPlanAdapter(service, 'account-a');
    expect(await adapter.listModels()).toMatchObject([{ id: 'model-a', supports_tools: false }]);
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response('data: {"type":"response.output_text.delta","delta":"Hello"}\n\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":1}}}\n\n', { headers: { 'content-type': 'text/event-stream' } });
    }));
    const deltas: string[] = [];
    const result = await adapter.chat({ model: 'model-a', messages: [{ role: 'system', content: 'Be brief' }, { role: 'user', content: 'Hi' }], temperature: 0.9, max_tokens: 123, onDelta: (delta) => deltas.push(delta) });
    expect(result.text).toBe('Hello');
    expect(result.usage).toEqual({ tokens_in: 3, tokens_out: 1 });
    expect(deltas).toEqual(['Hello']);
    expect(bodies[0]).toEqual({ model: 'model-a', input: [{ role: 'user', content: 'Hi' }], instructions: 'Be brief', store: false, stream: true });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n', { headers: { 'content-type': 'text/event-stream' } })));
    await expect(adapter.chat({ model: 'model-a', messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(/without response.completed/);
  });
});
