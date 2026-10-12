import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { Sandbox } from '../src/tools/sandbox.js';
import { registerFileSearchRoutes } from '../src/server/routes/file-search.js';

describe('read-only palette file search', () => {
  it('searches only explicitly allowed roots and validates query bounds', async () => {
    const allowed = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-search-allowed-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-search-outside-'));
    const app = Fastify();
    try {
      fs.writeFileSync(path.join(allowed, 'agenda.txt'), 'team deadline tomorrow');
      fs.writeFileSync(path.join(outside, 'private.txt'), 'team deadline tomorrow');
      const roots = [allowed];
      registerFileSearchRoutes(app, { sandbox: new Sandbox(() => roots), allowedRoots: () => roots });
      const result = await app.inject({ method: 'GET', url: '/api/v1/files/search?query=deadline' });
      expect(result.statusCode).toBe(200);
      expect(result.json().results).toEqual([expect.stringContaining('agenda.txt:1: team deadline tomorrow')]);
      expect(JSON.stringify(result.json())).not.toContain('private.txt');
      expect((await app.inject({ method: 'GET', url: '/api/v1/files/search?query=x' })).statusCode).toBe(400);
      roots.length = 0;
      expect((await app.inject({ method: 'GET', url: '/api/v1/files/search?query=deadline' })).json().results).toEqual([]);
    } finally {
      await app.close(); fs.rmSync(allowed, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
