import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../src/db/database.js';
import { Vault } from '../src/security/vault.js';
import { ConnectorService } from '../src/connectors/service.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Connectors Integration with Mocked Fetch', () => {
  let db: Database;
  let vault: Vault;
  let connectors: ConnectorService;
  const testDir = path.resolve('tests/tmp-connectors');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    db = new Database(path.join(testDir, 'test.sqlite'));
    db.migrate();
    vault = new Vault(db, path.join(testDir, 'vault'));
    connectors = new ConnectorService({ db, vault });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    try {
      db.close();
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('reports missing API key when unconfigured and updates after setConfig', async () => {
    const tavily = await connectors.get('tavily');
    expect(tavily).toBeDefined();
    expect(tavily?.status).toBe('NEEDS_API_KEY');

    await connectors.setConfig('tavily', { api_key: 'tvly-test-12345678' });
    const updated = await connectors.get('tavily');
    expect(updated?.configured_keys).toContain('api_key');
    expect(updated?.status).toBe('NEEDS_SETUP');
  });

  it('executes actions and performs health test with mocked network', async () => {
    await connectors.setConfig('tavily', { api_key: 'tvly-test-12345678' });

    // Mock global fetch
    const fetchMock = vi.fn().mockImplementation(async (url: string, _opts: any) => {
      if (url.includes('tavily.com/search')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            results: [{ title: 'TJ Total Mastery', url: 'https://tj.ai', content: 'AI OS' }],
          }),
        };
      }
      return { ok: false, status: 404, text: async () => 'Not found' };
    });
    vi.stubGlobal('fetch', fetchMock);

    // Test health check
    const testRes = await connectors.test('tavily');
    expect(testRes.ok).toBe(true);
    expect((await connectors.get('tavily'))?.status).toBe('CONNECTED');
    await connectors.setConfig('tavily', { api_key: 'tvly-changed-key' });
    expect((await connectors.get('tavily'))?.status).toBe('NEEDS_SETUP');
    await expect(connectors.setConfig('tavily', { bogus: 'value' })).rejects.toThrow(/Unknown config field/);

    // Test search action
    const searchRes = (await connectors.execute('tavily', 'search', { query: 'test search' })) as any;
    expect(searchRes.results).toBeDefined();
    expect(searchRes.results[0].title).toBe('TJ Total Mastery');
  });

  it('connects Microsoft 365 with bounded read-only calendar and email actions', async () => {
    await connectors.setConfig('microsoft365', { tenant_id: 'tenant.example', client_id: 'app-id', client_secret: 'secret', user_id: 'user@example.com' });
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      const target = String(url); calls.push(target);
      if (target.includes('/oauth2/v2.0/token')) return new Response(JSON.stringify({ access_token: 'graph-token' }));
      expect((init.headers as any)?.authorization).toBe('Bearer graph-token');
      return new Response(JSON.stringify({ displayName: 'Test User', value: [] }));
    }));
    expect((await connectors.test('microsoft365')).ok).toBe(true);
    await connectors.execute('microsoft365', 'list_events', { start_datetime: '2026-10-10T00:00:00Z', end_datetime: '2026-10-11T00:00:00Z' });
    await connectors.execute('microsoft365', 'list_messages', { top: 5 });
    expect(calls.some((url) => url.includes('/users/user%40example.com/calendarView'))).toBe(true);
    expect(calls.some((url) => url.includes('/users/user%40example.com/messages?'))).toBe(true);
    await expect(connectors.execute('microsoft365', 'list_events', { start_datetime: '2026-10-10T00:00:00Z', end_datetime: '2026-12-01T00:00:00Z' })).rejects.toThrow(/31 days/);
  });

  it('connects Shopify only through a validated myshopify domain and reads GraphQL data', async () => {
    await connectors.setConfig('shopify', { shop_domain: 'tj-store.myshopify.com', access_token: 'shop-secret' });
    const fetchMock = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      expect(String(url)).toBe('https://tj-store.myshopify.com/admin/api/2026-10/graphql.json');
      expect((init.headers as any)['x-shopify-access-token']).toBe('shop-secret');
      return new Response(JSON.stringify({ data: { shop: { name: 'TJ Store', myshopifyDomain: 'tj-store.myshopify.com' }, products: { edges: [] } } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    expect((await connectors.test('shopify')).ok).toBe(true);
    expect(await connectors.execute('shopify', 'shop_info', {})).toMatchObject({ shop: { name: 'TJ Store' } });
    await expect(connectors.execute('shopify', 'list_products', { first: 100 })).rejects.toThrow(/from 1 to 50/);
    await connectors.setConfig('shopify', { shop_domain: 'example.com' });
    expect((await connectors.test('shopify')).ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps Alpaca hard-bound to paper trading and exposes no order-submit operation', async () => {
    await connectors.setConfig('alpaca', { key_id: 'paper-key', secret_key: 'paper-secret' });
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ status: 'ACTIVE', orders: [] }));
    }));
    expect((await connectors.test('alpaca')).ok).toBe(true);
    expect(await connectors.execute('alpaca', 'orders', { limit: 5 })).toMatchObject({ orders: [] });
    expect(connectors.getRuntime('alpaca')?.actions.submit_order).toBeUndefined();
    expect(calls.every((url) => url.startsWith('https://paper-api.alpaca.markets/'))).toBe(true);
    await expect(connectors.execute('alpaca', 'orders', { limit: 500 })).rejects.toThrow(/from 1 to 50/);
  });
});
