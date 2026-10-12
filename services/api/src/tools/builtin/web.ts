import type { Tool } from '../types.js';
import { ok, fail } from '../types.js';
import type { Vault } from '../../security/vault.js';
import type { Database } from '../../db/database.js';
import { uuid, now } from '../../core/ids.js';
import fs from 'node:fs';
import path from 'node:path';
import yauzl from 'yauzl';

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

async function fetchPublic(input: URL, init: RequestInit): Promise<Response> {
  let current = input;
  for (let hop = 0; hop <= 5; hop++) {
    if (!/^https?:$/.test(current.protocol) || isPrivateHost(current.hostname) || current.username || current.password) throw new Error('Public web access blocks private hosts, credentials, and non-HTTP(S) URLs.');
    const response = await fetch(current, { ...init, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location || hop === 5) throw new Error('Redirect limit exceeded or redirect target missing.');
    current = new URL(location, current);
  }
  throw new Error('Redirect limit exceeded.');
}

export function parseSearchResults(html: string, limit: number): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  for (const match of html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>)?/gi)) {
    let url = match[1].replace(/&amp;/g, '&');
    if (url.startsWith('//')) url = `https:${url}`;
    try { const parsed = new URL(url); const redirected = parsed.searchParams.get('uddg'); url = redirected || url; } catch {}
    if (!/^https?:\/\//i.test(url)) continue;
    results.push({ title: htmlToText(match[2]), url, snippet: htmlToText(match[3] ?? '') });
    if (results.length >= limit) break;
  }
  return results;
}

export function extractZip(zipPath: string, destination: string): Promise<{ files: number; bytes: number }> {
  const maxFiles = 500, maxExpandedBytes = 50_000_000;
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error('Could not open ZIP archive'));
      let files = 0, bytes = 0, done = false;
      const finish = (err?: Error) => {
        if (done) return;
        done = true;
        zip.close();
        if (err) reject(err);
        else resolve({ files, bytes });
      };
      zip.on('error', (err) => finish(err));
      zip.on('end', () => finish());
      zip.on('entry', (entry) => {
        try {
          const name = entry.fileName.replace(/\\/g, '/');
          if (name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').some((part: string) => part === '..')) throw new Error('ZIP contains a path traversal entry');
          const target = path.resolve(destination, name);
          const rel = path.relative(destination, target);
          if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('ZIP entry escapes extraction folder');
          const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
          if ((unixMode & 0o170000) === 0o120000) throw new Error('ZIP symlinks are not allowed');
          if (entry.uncompressedSize > maxExpandedBytes || bytes + entry.uncompressedSize > maxExpandedBytes) throw new Error('ZIP exceeds the 50 MB expanded-size limit');
          if (name.endsWith('/')) { fs.mkdirSync(target, { recursive: true }); zip.readEntry(); return; }
          files++;
          if (files > maxFiles) throw new Error('ZIP exceeds the 500-file limit');
          fs.mkdirSync(path.dirname(target), { recursive: true });
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) return finish(streamError ?? new Error('Could not read ZIP entry'));
            const output = fs.createWriteStream(target, { flags: 'wx' });
            let entryBytes = 0;
            stream.on('data', (chunk: Buffer) => { entryBytes += chunk.length; bytes += chunk.length; if (entryBytes > entry.uncompressedSize || bytes > maxExpandedBytes) stream.destroy(new Error('ZIP expanded-size limit exceeded')); });
            stream.on('error', (err) => finish(err)); output.on('error', (err) => finish(err));
            output.on('finish', () => zip.readEntry()); stream.pipe(output);
          });
        } catch (err) { finish(err instanceof Error ? err : new Error(String(err))); }
      });
      zip.readEntry();
    });
  });
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
          const res = await fetchPublic(u, { headers: { 'user-agent': 'TJ-TotalMasteryAI/2.0 (+local)' }, signal: AbortSignal.timeout(20000) });
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
      id: 'web_search', name: 'Web search', description: 'Search public web results. Uses configured Tavily or Brave when available, with a public DuckDuckGo HTML fallback when no search key is configured.', domain: 'research',
      input_schema: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'number' } }, required: ['query'] },
      permission: 'network.http', risk: 'low', reversible: true, resource: () => 'search',
      requiresApproval: () => Boolean(getConnectorSecret('tavily', 'api_key') || getConnectorSecret('brave_search', 'api_key')),
      describe: () => ({ action: 'Search with configured paid search service', target: 'Tavily or Brave Search', why: 'The configured provider may consume paid API credits.', risks: ['Search-provider pricing or credit consumption may apply'] }),
      async execute(a, ctx) {
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
            const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; TJResearch/2.0)', accept: 'text/html' }, signal: ctx.signal ?? AbortSignal.timeout(20000) });
            if (!res.ok) return fail(`Public search fallback returned HTTP ${res.status}; configure Tavily or Brave Search in Connectors and retry.`);
            results = parseSearchResults((await res.text()).slice(0, 2_000_000), n);
            if (!results.length) return fail('Public search returned no parseable results. Configure Tavily or Brave Search in Connectors, or provide a source URL for web_fetch.');
          }
          for (const r of results) db.run('INSERT INTO research_notes (id, project_id, task_id, query, source_title, source_url, retrieved_at, excerpt, kind, confidence, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [uuid(), ctx.project_id, ctx.task_id, q, r.title ?? '', r.url, retrieved_at, (r.snippet ?? '').slice(0, 1000), 'source_evidence', 0.6, now()]);
          return ok(results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${(r.snippet ?? '').slice(0, 300)}`).join('\n') + `\n\n(retrieved ${retrieved_at})`, { data: { results, retrieved_at } });
        } catch (e: any) {
          return fail(`Search failed: ${e.message}`);
        }
      },
    },
    {
      id: 'web_download', name: 'Download public file', description: 'Download a public HTTP/HTTPS file without credentials into the current project’s downloads folder. Limited to 25 MB; never purchases or authenticates.', domain: 'browser',
      input_schema: { type: 'object', properties: { url: { type: 'string' }, filename: { type: 'string' } }, required: ['url'] },
      permission: 'network.http', risk: 'medium', reversible: true, resource: (a, ctx) => `${ctx.project_root ?? '(no project)'}/downloads/${String(a.filename ?? 'download')}`,
      requiresApproval: (a) => Boolean(a.paid === true || a.purchase === true),
      describe: (a) => ({ action: 'Download public file', target: String(a.url), why: 'Retrieve a public file for the current task', risks: ['Writes downloaded content into the project downloads folder; size limited to 25 MB'] }),
      async execute(a, ctx) {
        if (!ctx.project_root) return fail('A project folder is required to save downloads.');
        let url: URL;
        try { url = new URL(String(a.url)); } catch { return fail('Invalid download URL'); }
        if (url.protocol !== 'https:' || isPrivateHost(url.hostname) || url.username || url.password) return fail('Downloads require a public HTTPS URL without embedded credentials.');
        const filename = path.basename(String(a.filename || path.basename(url.pathname) || 'download')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'download';
        const dir = path.join(ctx.project_root, 'downloads'); const target = path.join(dir, filename);
        try {
          const response = await fetchPublic(url, { headers: { 'user-agent': 'TJ-TotalMasteryAI/2.0' }, signal: ctx.signal ?? AbortSignal.timeout(30000) });
          if (!response.ok) return fail(`Download returned HTTP ${response.status}`);
          const declared = Number(response.headers.get('content-length') ?? 0);
          if (declared > 25_000_000) return fail('Download exceeds 25 MB limit.');
          if (!response.body) return fail('Download response had no body.');
          const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
          while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > 25_000_000) { await reader.cancel(); return fail('Download exceeds 25 MB limit.'); } chunks.push(part.value); }
          const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), length);
          fs.mkdirSync(dir, { recursive: true });
          if (fs.existsSync(target)) return fail(`File already exists: ${target}. Choose another filename; downloads never overwrite.`);
          fs.writeFileSync(target, bytes, { flag: 'wx' });
          return ok(`Downloaded ${bytes.length} bytes to ${target}`, { data: { path: target, bytes: bytes.length, content_type: response.headers.get('content-type') } , artifacts: [{ kind: 'file', name: filename, path: target, summary: 'Downloaded from a public HTTPS URL; not executed.' }] });
        } catch (e: any) { return fail(`Download failed: ${e.message}`); }
      },
    },
    {
      id: 'archive_extract', name: 'Safely extract ZIP archive', description: 'Extract a ZIP file inside the current project. Blocks traversal paths, symlinks, overwrite, more than 500 files, or more than 50 MB expanded size. Extracted content is untrusted and never executed.', domain: 'files',
      input_schema: { type: 'object', properties: { path: { type: 'string' }, destination: { type: 'string' } }, required: ['path'] },
      permission: 'filesystem.write', risk: 'medium', reversible: true, resource: (a, ctx) => path.resolve(ctx.project_root ?? '', String(a.destination ?? 'downloads/extracted')),
      requiresApproval: (a) => Boolean(a.system_change === true || a.overwrite === true),
      describe: (a) => ({ action: 'Extract ZIP archive', target: String(a.destination ?? 'downloads/extracted'), why: 'Unpack downloaded or supplied archive contents for inspection', risks: ['Writes multiple untrusted files into the project; strict size and path limits apply'] }),
      async execute(a, ctx) {
        if (!ctx.project_root) return fail('A project folder is required for safe extraction.');
        const source = path.resolve(ctx.project_root, String(a.path ?? ''));
        const destination = path.resolve(ctx.project_root, String(a.destination ?? 'downloads/extracted'));
        const inside = (target: string) => { const rel = path.relative(path.resolve(ctx.project_root!), target); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
        if (!inside(source) || !inside(destination)) return fail('Archive and extraction destination must stay inside the current project.');
        if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return fail('ZIP source file was not found.');
        if (fs.existsSync(destination)) return fail('Extraction destination must be a new folder; existing files and folders are never overwritten.');
        fs.mkdirSync(destination, { recursive: true });
        try { const result = await extractZip(source, destination); return ok(`Extracted ${result.files} file(s), ${result.bytes} bytes, to ${destination}. Contents were not executed.`, { data: { path: destination, ...result }, artifacts: [{ kind: 'directory', name: path.basename(destination), path: destination, summary: 'Safely extracted untrusted ZIP contents' }] }); }
        catch (e: any) { fs.rmSync(destination, { recursive: true, force: true }); return fail(`ZIP extraction failed and partial output was removed: ${e.message}`); }
      },
    },
  ];
}
