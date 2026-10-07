import type { FastifyInstance } from 'fastify';
import { MemoryCreateRequest } from '@tj/schemas';
import type { MemoryService } from '../../memory/memory.js';

export function registerMemoryRoutes(
  app: FastifyInstance,
  deps: {
    memory: MemoryService;
  }
) {
  // GET /api/v1/memory/search
  app.get('/api/v1/memory/search', async (req) => {
    const q = req.query as { q?: string; limit?: string; type?: string };
    const query = q.q ?? '';
    const results = await deps.memory.search(query, {
      limit: Number(q.limit ?? 20),
      type: q.type,
    });
    return { results };
  });

  // GET /api/v1/memory/items
  app.get('/api/v1/memory/items', async (req) => {
    const q = req.query as { limit?: string; type?: string };
    return { items: deps.memory.list({ limit: Number(q.limit ?? 100), type: q.type }) };
  });

  // POST /api/v1/memory/items
  app.post('/api/v1/memory/items', async (req) => {
    const body = MemoryCreateRequest.parse(req.body);
    const item = await deps.memory.create({
      workspace_id: 'default',
      ...body,
    });
    return item;
  });

  // DELETE /api/v1/memory/items/:id
  app.delete('/api/v1/memory/items/:id', async (req) => {
    const p = req.params as { id: string };
    deps.memory.delete(p.id);
    return { ok: true };
  });
}

