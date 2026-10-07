import type { Tool } from '../types.js';
import { ok, fail } from '../types.js';
import type { Vault } from '../../security/vault.js';
import type { Database } from '../../db/database.js';
import { uuid, now } from '../../core/ids.js';

/** Block requests to private/loopback/link-local addresses unless explicitly allowed (SSRF guard). */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

export function webTools(vault: Vault, db: Database, getConnectorSecret: (connector: string, key: string) => string | null): Tool[] {
  return [
    {
      id: 'web_fetch', name: 'Fetch web page', description: 'Fetch a public URL and return readable text. Records source URL and retrieval time.', domain: 'browser',
      input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      permission: 'network.http', risk: 'low', reversible: true,
      resource: (a) => { try { return new URL(String(a.url)).host; } catch { return null; } },
      async execute(a) {
        let u: URL;
        try { u = new URL(String(a.url)); } catch { return fail('Invalid URL'); }
        if (!/^https?:$/.test(u.protocol)) return fail('Only http/https URLs are supported');
        if (isPrivateHost(u.hostname)) return fail('Requests to private/loopback hosts are blocked by the SSRF guard');
        const retrieved_at = now();
        try {
          const res = await fetch(u, { headers: { 'user-agent': 'TJ-TotalMasteryAI/2.0 (+local)' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
          if (!res.ok) return fail(`HTTP ${res.status} from ${u.host}`);
          const ct = res.headers.get('content-type') ?? '';
          const raw = (await res.text()).slice(0, 2_000_000);
          const text = ct.includes('html') ? htmlToText(raw) : raw;
          const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? u.host;
          return ok(`Source: ${u.href}\nRetrieved: ${retrieved_at}\n\n${text.slice(0, 20000)}`, { data: { url: u.href, title, retrieved_at, chars: text.length } });
        } catch (e: any) {
          return fail(`Fetch failed: ${e.message}`);
        }
      },
    },
    {
      id: 'web_search', name: 'Web search', description: 'Search the web (requires a Tavily or Brave Search API key in Connectors). Returns titles, URLs, snippets with retrieval time.', domain: 'research',
      input_schema: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'number' } }, required: ['query'] },
      permission: 'network.http', risk: 'low', reversible: true, resource: () => 'search',
      async execute(a) {
        const q = String(a.query ?? '').trim();
        if (!q) return fail('query is required');
        const n = Math.min(Number(a.max_results ?? 5), 10);
        const retrieved_at = now();
        const tavily = getConnectorSecret('tavily', 'api_key');
        const brave = getConnectorSecret('brave_search', 'api_key');
        try {
          let results: Array<{ title: string; url: string; snippet: string }> = [];
          if (tavily) {
            const res = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tavily}` }, body: JSON.stringify({ query: q, max_results: n }), signal: AbortSignal.timeout(25000) });
            if (!res.ok) return fail(`Tavily error ${res.status}`);
            const j: any = await res.json();
            results = (j.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content }));
          } else if (brave) {
            const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${n}`, { headers: { 'x-subscription-token': brave, accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
            if (!res.ok) return fail(`Brave Search error ${res.status}`);
            const j: any = await res.json();
            results = (j.web?.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.description }));
          } else {
            return fail('NEEDS_API_KEY: no search provider configured. Add a Tavily or Brave Search key under Connectors. TJ will not invent search results.');
          }
          for (const r of results) db.run('INSERT INTO research_notes (id, query, source_title, source_url, retrieved_at, excerpt, kind, confidence, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [uuid(), q, r.title ?? '', r.url, retrieved_at, (r.snippet ?? '').slice(0, 1000), 'source_evidence', 0.6, now()]);
          return ok(results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${(r.snippet ?? '').slice(0, 300)}`).join('\n') + `\n\n(retrieved ${retrieved_at})`, { data: { results, retrieved_at } });
        } catch (e: any) {
          return fail(`Search failed: ${e.message}`);
        }
      },
    },
  ];
}
