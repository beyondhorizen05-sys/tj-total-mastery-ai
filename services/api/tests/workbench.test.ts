import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { Database } from '../src/db/database.js';
import { Vault } from '../src/security/vault.js';
import { ApiWorkbench, type Resolver, type Transport } from '../src/workbench/service.js';
import { registerWorkbenchRoutes } from '../src/server/routes/workbench.js';

describe('API Workbench', () => {
  let db: Database;
  let vaultDir: string;
  let service: ApiWorkbench;
  let transport: ReturnType<typeof vi.fn<Transport>>;
  let resolver: Resolver;
  beforeEach(() => {
    db = new Database(':memory:'); db.migrate();
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-workbench-test-'));
    resolver = async () => [{ address: '8.8.8.8', family: 4 }];
    transport = vi.fn<Transport>(async () => ({ status: 200, contentType: 'application/json', body: '{"ok":true}', truncated: false }));
    service = new ApiWorkbench(db, new Vault(db, vaultDir), resolver, transport);
  });
  afterEach(() => { db.close(); fs.rmSync(vaultDir, { recursive: true, force: true }); });

  it('blocks local targets, URL credentials, secret query strings and unsafe headers', () => {
    const base = { name: 'test', method: 'GET' as const };
    for (const url of ['http://api.example.com', 'https://localhost/', 'https://127.0.0.1/', 'https://[::1]/', 'https://user:pass@api.example.com/', 'https://api.example.com/?api_key=secret']) {
      expect(() => service.save({ ...base, url })).toThrow();
    }
    expect(() => service.save({ ...base, url: 'https://api.example.com/', headers: { Authorization: 'Bearer hidden' } })).toThrow(/managed/);
    expect(() => service.save({ ...base, url: 'https://api.example.com/', headers: { 'X-Test': 'bad\r\nvalue' } })).toThrow(/Invalid header value/);
    expect(() => service.save({ ...base, url: 'https://api.example.com/', body: 'not allowed' })).toThrow(/cannot have a body/);
    expect(service.list()).toHaveLength(0);
  });

  it('rejects a hostname resolving to a private address before transport and records failure', async () => {
    service = new ApiWorkbench(db, new Vault(db, vaultDir), async () => [{ address: '169.254.169.254', family: 4 }], transport);
    const saved = service.save({ name: 'metadata', method: 'GET', url: 'https://api.example.com/latest/meta-data' });
    await expect(service.run(saved.id)).rejects.toThrow(/private, local or unsupported/);
    expect(transport).not.toHaveBeenCalled();
    expect(service.history(saved.id)[0]).toMatchObject({ ok: false, status: null });
  });

  it('pins a public resolved address, binds vault credential to host and records only response metadata', async () => {
    const secret = service.addBearerSecret({ host: 'api.example.com', label: 'Demo', token: 'secret-token-value' });
    expect(service.credentials()).toEqual([{ ref: secret.ref, host: 'api.example.com', label: 'Demo' }]);
    expect(() => service.save({ name: 'wrong host', method: 'GET', url: 'https://other.example.com/', bearer_secret_ref: secret.ref })).toThrow(/bound to this host/);
    const saved = service.save({ name: 'Read', method: 'GET', url: 'https://api.example.com/items', bearer_secret_ref: secret.ref });
    const result = await service.run(saved.id);
    expect(result).toMatchObject({ ok: true, status: 200, body: '{"ok":true}' });
    expect(transport).toHaveBeenCalledOnce();
    const outgoing = transport.mock.calls[0][0];
    expect(outgoing.address).toBe('8.8.8.8');
    expect(outgoing.headers.authorization).toBe('Bearer secret-token-value');
    const history = service.history(saved.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ method: 'GET', host: 'api.example.com', status: 200, ok: true });
    expect(JSON.stringify(history)).not.toContain('secret-token-value');
    expect(JSON.stringify(history)).not.toContain('{"ok":true}');
    expect(service.list()[0].bearer_secret_ref).toBe(secret.ref);
  });

  it('enforces privacy denial and approval before remote writes through the route', async () => {
    const saved = service.save({ name: 'Update', method: 'POST', url: 'https://api.example.com/items', body: '{"x":1}' });
    const app = Fastify();
    let decision: 'deny' | 'allow' = 'deny';
    let approvalStatus: 'denied' | 'approved' = 'denied';
    const permissions = { evaluate: vi.fn(() => ({ decision, reason: decision === 'deny' ? 'Local-only privacy mode blocks outbound network and connector actions' : 'allowed' })) };
    const approvals = { request: vi.fn(() => ({ id: 'approval-1' })), waitFor: vi.fn(async () => ({ status: approvalStatus })) };
    const audit = { log: vi.fn() };
    registerWorkbenchRoutes(app, { workbench: service, permissions: permissions as any, approvals: approvals as any, audit: audit as any });
    const url = `/api/v1/workbench/requests/${saved.id}/run`;
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(403);
    expect(transport).not.toHaveBeenCalled();
    decision = 'allow';
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(403);
    expect(approvals.request).toHaveBeenCalledOnce();
    expect(transport).not.toHaveBeenCalled();
    approvalStatus = 'approved';
    const sent = await app.inject({ method: 'POST', url });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ status: 200, ok: true });
    expect(transport).toHaveBeenCalledOnce();
    await app.close();
  });

  it('rejects a request edited while its approval is pending', async () => {
    const saved = service.save({ name: 'Update', method: 'POST', url: 'https://api.example.com/items', body: '{"x":1}' });
    const app = Fastify();
    const permissions = { evaluate: vi.fn(() => ({ decision: 'allow', reason: 'allowed' })) };
    const approvals = {
      request: vi.fn(() => ({ id: 'approval-1' })),
      waitFor: vi.fn(async () => {
        service.save({ ...saved, method: 'DELETE', url: 'https://other.example.com/items', body: '' });
        return { status: 'approved' };
      }),
    };
    const audit = { log: vi.fn() };
    registerWorkbenchRoutes(app, { workbench: service, permissions: permissions as any, approvals: approvals as any, audit: audit as any });
    const response = await app.inject({ method: 'POST', url: `/api/v1/workbench/requests/${saved.id}/run` });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatch(/changed after approval/);
    expect(transport).not.toHaveBeenCalled();
    await app.close();
  });
});
