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

  it('does not persist a stale embedding after an edit or secret classification', async () => {
    const pending: Array<(value: { vectors: number[][]; model_id: string }) => void> = [];
    const router = {
      embed: () => new Promise<{ vectors: number[][]; model_id: string }>((resolve) => pending.push(resolve)),
    };
    memory.setRouter(router as any);
    const item = await memory.create({ workspace_id: 'default', type: 'working', content: 'First version' });
    expect(pending).toHaveLength(1);

    memory.update(item.id, { content: 'Second version' });
    expect(pending).toHaveLength(2);
    pending[0]({ vectors: [[1, 0]], model_id: 'test' });
    await Promise.resolve();
    expect(memory.get(item.id)?.has_embedding).toBe(false);

    pending[1]({ vectors: [[0, 1]], model_id: 'test' });
    await Promise.resolve();
    expect(memory.get(item.id)?.has_embedding).toBe(true);

    memory.update(item.id, { sensitivity: 'secret' });
    expect(memory.get(item.id)?.has_embedding).toBe(false);
    expect(db.get<{ embedding: Uint8Array | null }>('SELECT embedding FROM memories WHERE id=?', [item.id])?.embedding).toBeNull();

    memory.update(item.id, { content: 'Secret replacement' });
    expect(pending).toHaveLength(2);

    const later = await memory.create({ workspace_id: 'default', type: 'working', content: 'Pending classification' });
    memory.update(later.id, { sensitivity: 'secret' });
    pending[2]({ vectors: [[1, 1]], model_id: 'test' });
    await Promise.resolve();
    expect(memory.get(later.id)?.has_embedding).toBe(false);
  });
});
