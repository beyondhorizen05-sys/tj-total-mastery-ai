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
    expect(updated?.status).toBe('CONNECTED');
  });

  it('executes actions and performs health test with mocked network', async () => {
    await connectors.setConfig('tavily', { api_key: 'tvly-test-12345678' });

    // Mock global fetch
    const fetchMock = vi.fn().mockImplementation(async (url: string, opts: any) => {
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

    // Test search action
    const searchRes = (await connectors.execute('tavily', 'search', { query: 'test search' })) as any;
    expect(searchRes.results).toBeDefined();
    expect(searchRes.results[0].title).toBe('TJ Total Mastery');
  });
});
