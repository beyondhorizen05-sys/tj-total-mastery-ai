import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import type { Database } from '../db/database.js';
import type { Vault } from '../security/vault.js';

export type RequestMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface SavedRequest {
  id: string; name: string; method: RequestMethod; url: string;
  headers: Record<string, string>; body: string; bearer_secret_ref: string | null;
  timeout_ms: number; created_at: string; updated_at: string;
}
export interface WorkbenchResponse {
  ok: boolean; status: number; content_type: string; body: string;
  truncated: boolean; duration_ms: number; executed_at: string;
}
export interface RequestHistory {
  id: string; request_id: string; method: string; host: string;
  status: number | null; ok: boolean; error: string | null;
  duration_ms: number; executed_at: string;
}
export interface TransportRequest {
  url: URL; address: string; family: 4 | 6; method: RequestMethod;
  headers: Record<string, string>; body: string; timeoutMs: number;
}
export type Transport = (request: TransportRequest) => Promise<{ status: number; contentType: string; body: string; truncated: boolean }>;
export type Resolver = (host: string) => Promise<Array<{ address: string; family: 4 | 6 }>>;

const maxRequestBody = 64 * 1024;
const maxResponseBody = 1024 * 1024;
const allowedMethods = new Set<RequestMethod>(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const blockedHeaders = new Set(['authorization', 'cookie', 'host', 'proxy-authorization', 'connection', 'transfer-encoding', 'content-length']);
const secretQuery = /^(?:api[_-]?key|access[_-]?token|token|secret|password)$/i;

function publicIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || b === 0 || b === 2)) return false;
  // Deprecated 6to4 relay anycast is special-purpose and not globally reachable.
  if (a === 192 && b === 88 && parts[2] === 99) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0 && parts[2] === 113) return false;
  return true;
}

export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return publicIpv4(address);
  if (family !== 6) return false;
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) return publicIpv4(lower.slice(7));
  const value = ipv6Value(lower);
  if (value === null || (value >> 125n) !== 1n) return false; // Only global-unicast 2000::/3.
  const inRange = (network: bigint, bits: bigint) => (value >> (128n - bits)) === (network >> (128n - bits));
  const prefix = (parts: number[]) => parts.reduce((result, part) => (result << 16n) | BigInt(part), 0n) << BigInt(128 - parts.length * 16);
  const special: Array<[bigint, bigint]> = [
    [prefix([0x2001, 0x0000]), 32n], // Teredo / IETF protocol assignment block
    [prefix([0x2001, 0x0002, 0x0000]), 48n], // Benchmarking
    [prefix([0x2001, 0x0010]), 28n], // Deprecated ORCHID
    [prefix([0x2001, 0x0db8]), 32n], // Documentation
    [prefix([0x2002]), 16n], // 6to4
    [prefix([0x3fff]), 20n], // Documentation
    [prefix([0x5f00]), 16n], // SRv6 SIDs
  ];
  return !special.some(([network, bits]) => inRange(network, bits));
}

function ipv6Value(address: string): bigint | null {
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function validateUrl(value: string): URL {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('URL is required and must be at most 2048 characters');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid URL'); }
  if (url.protocol !== 'https:') throw new Error('Only public HTTPS endpoints are supported');
  if (url.username || url.password) throw new Error('URL credentials are forbidden; use a Workbench bearer secret');
  if (url.hash) throw new Error('URL fragments are not supported');
  const host = url.hostname.toLowerCase();
  if (net.isIP(host) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test') || !host.includes('.')) {
    throw new Error('Use a public DNS hostname, not a private or local address');
  }
  for (const key of url.searchParams.keys()) if (secretQuery.test(key)) throw new Error('Do not put credentials in the URL; use a Workbench bearer secret');
  return url;
}

function validateHeaders(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Headers must be an object');
  const entries = Object.entries(input);
  if (entries.length > 20) throw new Error('At most 20 headers are allowed');
  const headers: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)) throw new Error(`Invalid header name: ${key}`);
    if (blockedHeaders.has(key.toLowerCase())) throw new Error(`${key} header is managed by TJ or forbidden`);
    if (typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value)) throw new Error(`Invalid header value: ${key}`);
    headers[key] = value;
  }
  return headers;
}

const defaultResolver: Resolver = async (host) => dns.lookup(host, { all: true, verbatim: true }) as Promise<Array<{ address: string; family: 4 | 6 }>>;

/** HTTPS transport pins the validated DNS address, preventing a second resolver lookup. Redirects are never followed. */
export const httpsTransport: Transport = (request) => new Promise((resolve, reject) => {
  const req = https.request(request.url, {
    method: request.method,
    headers: request.headers,
    lookup: (_hostname, _options, callback) => callback(null, request.address, request.family),
  }, (res) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    res.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total <= maxResponseBody) chunks.push(chunk);
      else {
        truncated = true;
        res.destroy();
      }
    });
    res.on('close', () => {
      if (!res.complete && !truncated) { reject(new Error('Response stream ended before completion')); return; }
      resolve({ status: res.statusCode ?? 0, contentType: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks).toString('utf8'), truncated });
    });
    res.on('error', reject);
  });
  req.setTimeout(request.timeoutMs, () => req.destroy(new Error('Request timed out')));
  req.on('error', reject);
  req.end(request.body || undefined);
});

export class ApiWorkbench {
  constructor(private db: Database, private vault: Vault, private resolve: Resolver = defaultResolver, private transport: Transport = httpsTransport) {
    db.exec(`CREATE TABLE IF NOT EXISTS workbench_requests (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, method TEXT NOT NULL, url TEXT NOT NULL,
      headers TEXT NOT NULL, body TEXT NOT NULL, bearer_secret_ref TEXT,
      timeout_ms INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workbench_credentials (
      ref TEXT PRIMARY KEY, host TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workbench_history (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL, method TEXT NOT NULL, host TEXT NOT NULL,
      status INTEGER, ok INTEGER NOT NULL, error TEXT, duration_ms INTEGER NOT NULL, executed_at TEXT NOT NULL);`);
  }

  addBearerSecret(input: { host: string; label: string; token: string }): { ref: string; host: string; label: string } {
    const url = validateUrl(`https://${input.host}/`);
    if (typeof input.token !== 'string' || !input.token.trim() || input.token.length > 4096) throw new Error('Bearer token is required and must be at most 4096 characters');
    const label = String(input.label ?? '').trim().slice(0, 100);
    if (!label) throw new Error('Credential label is required');
    const ref = this.vault.put({ label: `Workbench ${label}`, scope: 'workbench', value: input.token });
    this.db.run('INSERT INTO workbench_credentials (ref, host, label, created_at) VALUES (?,?,?,?)', [ref, url.hostname, label, new Date().toISOString()]);
    return { ref, host: url.hostname, label };
  }

  credentials(): Array<{ ref: string; host: string; label: string }> {
    return this.db.all('SELECT ref, host, label FROM workbench_credentials ORDER BY created_at DESC');
  }

  save(input: Partial<SavedRequest> & Pick<SavedRequest, 'name' | 'method' | 'url'>): SavedRequest {
    const url = validateUrl(input.url);
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new Error('Request name is required (max 100 characters)');
    if (!allowedMethods.has(input.method)) throw new Error('Unsupported HTTP method');
    const headers = validateHeaders(input.headers ?? {});
    const body = input.body ?? '';
    if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > maxRequestBody) throw new Error('Request body exceeds 64 KB');
    if ((input.method === 'GET' || input.method === 'HEAD') && body) throw new Error(`${input.method} requests cannot have a body`);
    const timeout = Number(input.timeout_ms ?? 10_000);
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 15_000) throw new Error('Timeout must be 1000–15000 ms');
    const secretRef = input.bearer_secret_ref || null;
    if (secretRef) {
      const credential = this.db.get<{ host: string }>('SELECT host FROM workbench_credentials WHERE ref=?', [secretRef]);
      if (!credential || credential.host !== url.hostname || !this.vault.has(secretRef)) throw new Error('Bearer secret must be a Workbench credential bound to this host');
    }
    const existing = input.id ? this.get(input.id) : null;
    if (input.id && !existing) throw new Error('Saved request not found');
    const id = existing?.id ?? crypto.randomUUID();
    const timestamp = new Date().toISOString();
    this.db.run(`INSERT INTO workbench_requests (id,name,method,url,headers,body,bearer_secret_ref,timeout_ms,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,method=excluded.method,url=excluded.url,
      headers=excluded.headers,body=excluded.body,bearer_secret_ref=excluded.bearer_secret_ref,timeout_ms=excluded.timeout_ms,updated_at=excluded.updated_at`,
    [id, input.name.trim(), input.method, url.href, JSON.stringify(headers), body, secretRef, timeout, existing?.created_at ?? timestamp, timestamp]);
    return this.get(id)!;
  }

  get(id: string): SavedRequest | null {
    const row = this.db.get<any>('SELECT * FROM workbench_requests WHERE id=?', [id]);
    return row ? { ...row, headers: JSON.parse(row.headers) } : null;
  }
  list(): SavedRequest[] { return this.db.all<any>('SELECT * FROM workbench_requests ORDER BY updated_at DESC').map((row) => ({ ...row, headers: JSON.parse(row.headers) })); }
  delete(id: string): boolean { return this.db.run('DELETE FROM workbench_requests WHERE id=?', [id]).changes > 0; }
  history(requestId?: string): RequestHistory[] {
    const rows = requestId
      ? this.db.all<any>('SELECT * FROM workbench_history WHERE request_id=? ORDER BY executed_at DESC LIMIT 100', [requestId])
      : this.db.all<any>('SELECT * FROM workbench_history ORDER BY executed_at DESC LIMIT 100');
    return rows.map((row) => ({ ...row, ok: Boolean(row.ok) }));
  }

  async run(id: string, approvedRequest?: SavedRequest): Promise<WorkbenchResponse> {
    const saved = this.get(id);
    if (!saved) throw new Error('Saved request not found');
    if (approvedRequest && JSON.stringify(saved) !== JSON.stringify(approvedRequest)) {
      throw new Error('Saved request changed after approval; review and send it again');
    }
    const url = validateUrl(saved.url);
    const started = performance.now();
    const executedAt = new Date().toISOString();
    let status: number | null = null;
    let error: string | null = null;
    try {
      const addresses = await this.resolve(url.hostname);
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('DNS resolved to a private, local or unsupported address');
      const headers: Record<string, string> = { ...saved.headers, 'user-agent': 'TJ-Workbench/1.0' };
      if (saved.bearer_secret_ref) {
        const binding = this.db.get<{ host: string }>('SELECT host FROM workbench_credentials WHERE ref=?', [saved.bearer_secret_ref]);
        if (!binding || binding.host !== url.hostname) throw new Error('Bearer secret is not bound to this host');
        const token = this.vault.get(saved.bearer_secret_ref, 'api_workbench', `request:${id}`);
        if (!token) throw new Error('Bearer secret is no longer available');
        headers.authorization = `Bearer ${token}`;
      }
      const response = await this.transport({ url, address: addresses[0].address, family: addresses[0].family,
        method: saved.method, headers, body: saved.body, timeoutMs: saved.timeout_ms });
      status = response.status;
      const duration = Math.round(performance.now() - started);
      const result = { ok: status >= 200 && status < 300, status, content_type: response.contentType,
        body: response.body, truncated: response.truncated, duration_ms: duration, executed_at: executedAt };
      this.record(saved, status, result.ok, null, duration, executedAt);
      return result;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Request failed';
      this.record(saved, status, false, error, Math.round(performance.now() - started), executedAt);
      throw new Error(error);
    }
  }

  private record(saved: SavedRequest, status: number | null, ok: boolean, error: string | null, duration: number, timestamp: string) {
    this.db.run('INSERT INTO workbench_history (id,request_id,method,host,status,ok,error,duration_ms,executed_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [crypto.randomUUID(), saved.id, saved.method, new URL(saved.url).hostname, status, ok ? 1 : 0, error, duration, timestamp]);
  }
}
