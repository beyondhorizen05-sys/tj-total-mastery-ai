import { describe, it, expect, vi, afterEach } from 'vitest';
import { Database } from '../src/db/database.js';
import { webTools } from '../src/tools/builtin/web.js';
afterEach(() => vi.unstubAllGlobals());
describe('Free search in agent-facing web_search', () => {
  it('uses local SearXNG first and records real source evidence, without paid API calls', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const requests: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
        requests.push(String(url));
        return new Response(JSON.stringify({ results: [
          { title: 'Current resource', url: 'https://example.org/article', content: 'Verified source excerpt' },
        ] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }));
      const secrets = (provider: string, name: string) => ({
        'searxng:url': 'http://127.0.0.1:8080',
        'tavily:api_key': 'paid-key-must-not-be-sent',
        'brave_search:api_key': 'paid-key-must-not-be-sent',
      } as Record<string, string>)[provider + ':' + name] ?? null;
      const tool = webTools({} as any, db, secrets).find(x => x.id === 'web_search')!;
      const result = await tool.execute({ query: 'reliable research', max_results: 1 }, {} as any);
      expect(result.ok).toBe(true);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toContain('127.0.0.1:8080/search');
      expect(requests[0]).not.toContain('paid-key');
      expect(result.data?.results).toHaveLength(1);
      expect(db.get<{source_url:string}>('SELECT source_url FROM research_notes')?.source_url).toBe('https://example.org/article');
    } finally { db.close(); }
  });
  it('does not silently pay for search after the configured local service fails', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const requests: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
        requests.push(String(url));
        return new Response('not configured', { status: 503 });
      }));
      const tool = webTools({} as any, db, (provider, name) =>
        provider === 'searxng' && name === 'url' ? 'http://127.0.0.1:8080'
          : provider === 'tavily' && name === 'api_key' ? 'paid-key' : null
      ).find(x => x.id === 'web_search')!;
      const result = await tool.execute({ query: 'no charges' }, {} as any);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('paid search fallback not attempted');
      expect(requests).toHaveLength(1);
      expect(requests[0]).toContain('127.0.0.1');
    } finally { db.close(); }
  });
  it('blocks automatic redirect handling on a public web fetch', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const fn = vi.fn(async (_url: unknown, init: RequestInit) => {
        expect(init.redirect).toBe('error');
        return new Response('redirect blocked', { status: 302 });
      });
      vi.stubGlobal('fetch', fn);
      const tool = webTools({} as any, db, () => null).find(x => x.id === 'web_fetch')!;
      const result = await tool.execute({ url: 'https://example.org/' }, {} as any);
      expect(result.ok).toBe(false);
      expect(fn).toHaveBeenCalledOnce();
    } finally { db.close(); }
  });
});
