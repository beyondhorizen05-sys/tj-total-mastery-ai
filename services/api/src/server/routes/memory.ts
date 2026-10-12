import type { FastifyInstance } from 'fastify';
import { MemoryCreateRequest } from '@tj/schemas';
import type { MemoryService } from '../../memory/memory.js';
import type { KnowledgeIndexer } from '../../memory/knowledge-indexer.js';

export function registerMemoryRoutes(
  app: FastifyInstance,
  deps: {
    memory: MemoryService;
    indexer?: KnowledgeIndexer;
  }
) {
  const pageNumber = (raw: string | undefined, fallback: number, min: number, max: number): number | null => {
    if (raw == null) return fallback;
    if (!/^\d+$/.test(raw)) return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
  };
  const validScope = (value: unknown) => value === undefined || (typeof value === 'string' && value.trim().length > 0 && value.length <= 200);

  // GET /api/v1/memory/search
  app.get('/api/v1/memory/search', async (req, reply) => {
    const q = req.query as { q?: string; limit?: string; type?: string; project_id?: string; agent_id?: string };
    const limit = pageNumber(q.limit, 20, 1, 100);
    if (limit == null) return reply.status(400).send({ error: 'Search limit must be an integer from 1 to 100.' });
    if (!validScope(q.project_id) || !validScope(q.agent_id)) {
      return reply.status(400).send({ error: 'Project and agent scope IDs must be non-empty and at most 200 characters.' });
    }
    const query = q.q ?? '';
    const results = await deps.memory.search(query, {
      limit,
      type: q.type,
      project_id: q.project_id,
      agent_id: q.agent_id,
    });
    return { results };
  });

  // GET /api/v1/memory/items
  app.get('/api/v1/memory/items', async (req, reply) => {
    const q = req.query as { limit?: string; type?: string; project_id?: string; agent_id?: string };
    const limit = pageNumber(q.limit, 100, 1, 500);
    if (limit == null) return reply.status(400).send({ error: 'Memory page size must be an integer from 1 to 500.' });
    if (!validScope(q.project_id) || !validScope(q.agent_id)) {
      return reply.status(400).send({ error: 'Project and agent scope IDs must be non-empty and at most 200 characters.' });
    }
    return { items: deps.memory.list({ limit, type: q.type, project_id: q.project_id, agent_id: q.agent_id }) };
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
  app.delete('/api/v1/memory/items/:id', async (req, reply) => {
    const p = req.params as { id: string };
    if (!deps.memory.delete(p.id)) return reply.status(404).send({ error: 'Memory not found.' });
    return { ok: true };
  });

  // POST /api/v1/memory/ingest
  app.post('/api/v1/memory/ingest', async (req, reply) => {
    const b = req.body as {
      file_path?: string;
      content?: string;
      format?: string;
      category?: string;
      project_id?: string;
      agent_id?: string;
    };
    if (!b || typeof b.file_path !== 'string' || !b.file_path.trim()) {
      return reply.status(400).send({ error: 'file_path is required.' });
    }
    if (typeof b.content !== 'string' || !b.content.trim()) {
      return reply.status(400).send({ error: 'content is required.' });
    }
    if (!deps.indexer) {
      return reply.status(501).send({ error: 'KnowledgeIndexer not initialized on this server.' });
    }
    const result = await deps.indexer.ingestDocument({
      file_path: b.file_path.trim(),
      content: b.content,
      format: b.format as any,
      category: b.category,
      project_id: b.project_id,
      agent_id: b.agent_id,
    });
    return { ok: true, result };
  });

  // GET /api/v1/memory/status
  app.get('/api/v1/memory/status', async () => {
    const status = await deps.memory.semanticStatus();
    return {
      status,
      indexer_available: !!deps.indexer,
    };
  });
}
