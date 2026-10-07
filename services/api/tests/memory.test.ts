import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from '../src/db/database.js';
import { EventBus } from '../src/core/event-bus.js';
import { MemoryService } from '../src/memory/memory.js';

describe('Hybrid Memory Store', () => {
  let db: Database;
  let bus: EventBus;
  let memory: MemoryService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.migrate();
    bus = new EventBus(db);
    memory = new MemoryService(db, bus, null);
  });

  it('stores and retrieves memories with FTS5 search', async () => {
    await memory.create({
      workspace_id: 'default',
      type: 'semantic',
      content: 'The user prefers TypeScript over Python for server logic.',
      source: 'chat',
      owner: 'user',
      sensitivity: 'private',
    });

    await memory.create({
      workspace_id: 'default',
      type: 'project',
      content: 'Database uses node:sqlite WAL mode for high concurrency.',
      source: 'documentation',
      owner: 'system',
      sensitivity: 'internal',
    });

    const search1 = await memory.search('TypeScript');
    expect(search1.length).toBeGreaterThan(0);
    expect(search1[0].memory.content).toContain('TypeScript over Python');

    const search2 = await memory.search('sqlite');
    expect(search2.length).toBeGreaterThan(0);
    expect(search2[0].memory.content).toContain('node:sqlite WAL');
  });

  it('honors retention and expiration policies', async () => {
    const mem = await memory.create({
      workspace_id: 'default',
      type: 'episodic',
      content: 'Temporary session token memo',
      retention: 'session',
    });

    expect(mem.expires_at).toBeDefined();
    expect(new Date(mem.expires_at!).getTime()).toBeGreaterThan(Date.now());
  });

  it('updates memory versions on edit', async () => {
    const mem = await memory.create({
      workspace_id: 'default',
      type: 'working',
      content: 'Initial requirement: build MVP',
    });

    const updated = await memory.update(mem.id, {
      content: 'Updated requirement: build production-grade app with tests',
    });

    expect(updated?.version).toBe(2);
    expect(updated?.content).toContain('production-grade');

    const versions = memory.versions(mem.id);
    expect(versions.length).toBe(2);
  });
});
