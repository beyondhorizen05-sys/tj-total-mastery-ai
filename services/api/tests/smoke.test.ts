import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Fastify Server Injection Smoke Tests', () => {
  let serverInstance: Awaited<ReturnType<typeof createServer>>;
  const testDir = path.resolve('tests/tmp-smoke');

  beforeEach(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    const cfg = loadConfig({
      dataDir: testDir,
      dbPath: path.join(testDir, 'test.sqlite'),
      vaultPath: path.join(testDir, 'vault'),
      artifactsDir: path.join(testDir, 'artifacts'),
      projectsDir: path.join(testDir, 'projects'),
      backupsDir: path.join(testDir, 'backups'),
      logsDir: path.join(testDir, 'logs'),
      enableTestProvider: true,
    });
    serverInstance = await createServer(cfg);
  });

  afterEach(async () => {
    try {
      await serverInstance.app.close();
      serverInstance.db.close();
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('GET /api/v1/system/status returns healthy system info', async () => {
    const res = await serverInstance.app.inject({
      method: 'GET',
      url: '/api/v1/system/status',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tj_state).toBeDefined();
    expect(body.version).toBe('2.0.0');
    expect(body.components).toBeDefined();
    expect(body.components.length).toBeGreaterThan(0);
  });

  it('GET /api/v1/connectors returns connector list and planned entries', async () => {
    const res = await serverInstance.app.inject({
      method: 'GET',
      url: '/api/v1/connectors',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.connectors)).toBe(true);
    expect(Array.isArray(body.planned)).toBe(true);
  });

  it('POST /api/v1/system/stop-all triggers emergency killswitch', async () => {
    const res = await serverInstance.app.inject({
      method: 'POST',
      url: '/api/v1/system/stop-all',
      payload: { reason: 'Smoke test stop-all' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.stopped).toBe(true);

    // Verify system status reflects stop-all active
    const statusRes = await serverInstance.app.inject({
      method: 'GET',
      url: '/api/v1/system/status',
    });
    const statusBody = statusRes.json();
    expect(statusBody.stop_all_engaged).toBe(true);
    expect(statusBody.tj_state).toBe('stopped');
  });
});

