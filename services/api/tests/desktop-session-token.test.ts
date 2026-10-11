import { describe, it, expect } from 'vitest';
import { createServer } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Packaged desktop API local authentication', () => {
  it('requires the desktop session token only when enabled', async () => {
    const old = process.env.TJ_DESKTOP_TOKEN;
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-packaged-api-'));
    process.env.TJ_DESKTOP_TOKEN = 'a'.repeat(64);
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      server = await createServer(loadConfig({
        dataDir: folder, dbPath: path.join(folder, 'tj.sqlite'), vaultPath: path.join(folder, 'vault'),
        projectsDir: path.join(folder, 'projects'), artifactsDir: path.join(folder, 'artifacts'),
        backupsDir: path.join(folder, 'backups'), logsDir: path.join(folder, 'logs'),
        enableTestProvider: false,
      }));
      const missing = await server.app.inject({ method: 'GET', url: '/api/v1/system/status' });
      expect(missing.statusCode).toBe(401);
      const wrong = await server.app.inject({ method: 'GET', url: '/api/v1/system/status',
        headers: { 'x-tj-desktop-token': 'b'.repeat(64) } });
      expect(wrong.statusCode).toBe(401);
      const correct = await server.app.inject({ method: 'GET', url: '/api/v1/system/status',
        headers: { 'x-tj-desktop-token': 'a'.repeat(64) } });
      expect(correct.statusCode).toBe(200);
    } finally {
      if (server) { await server.app.close(); server.db.close(); }
      if (old === undefined) delete process.env.TJ_DESKTOP_TOKEN;
      else process.env.TJ_DESKTOP_TOKEN = old;
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
