import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { Database } from '../src/db/database.js';
import { EventBus } from '../src/core/event-bus.js';
import { MemoryService } from '../src/memory/memory.js';
import { registerMemoryRoutes } from '../src/server/routes/memory.js';

describe('memory route scopes', () => {
  let db: Database | undefined;
  let app: ReturnType<typeof Fastify> | undefined;

  afterEach(async () => {
    await app?.close();
    db?.close();
    app = undefined;
    db = undefined;
  });

  it('creates, lists, and searches memories within project and agent scopes', async () => {
    db = new Database(':memory:'); db.migrate();
    const bus = new EventBus(db);
    const memory = new MemoryService(db, bus, null);
    app = Fastify();
    registerMemoryRoutes(app, { memory });

    const scoped = await app.inject({
      method: 'POST', url: '/api/v1/memory/items',
      payload: { type: 'project', content: 'scope marker alpha', project_id: 'project-alpha', agent_id: 'agent-alpha' },
    });
    const otherProject = await app.inject({
      method: 'POST', url: '/api/v1/memory/items',
      payload: { type: 'project', content: 'scope marker beta', project_id: 'project-beta', agent_id: 'agent-alpha' },
    });
    expect(scoped.statusCode).toBe(200);
    expect(otherProject.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/v1/memory/items?project_id=project-alpha&agent_id=agent-alpha' });
    expect(list.json().items.map((item: { content: string }) => item.content)).toEqual(['scope marker alpha']);
    const search = await app.inject({ method: 'GET', url: '/api/v1/memory/search?q=scope%20marker&project_id=project-alpha&agent_id=agent-alpha' });
    expect(search.json().results.map((item: { memory: { content: string } }) => item.memory.content)).toEqual(['scope marker alpha']);
    const invalidRepeatedScope = await app.inject({ method: 'GET', url: '/api/v1/memory/items?project_id=a&project_id=b' });
    expect(invalidRepeatedScope.statusCode).toBe(400);
  });
});
