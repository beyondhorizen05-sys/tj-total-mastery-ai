import type { FastifyInstance } from 'fastify';
import { BusinessError, type BusinessService } from '../../business/service.js';

function fail(reply: any, error: unknown) {
  return reply.status(error instanceof BusinessError ? error.status : 500).send({ error: (error as Error).message });
}

export function registerBusinessRoutes(app: FastifyInstance, deps: { business: BusinessService }) {
  app.get('/api/v1/business/summary', async () => deps.business.summary());
  app.get('/api/v1/business/:kind', async (req, reply) => {
    try {
      const p = req.params as { kind: string };
      const q = (req.query ?? {}) as { q?: string; status?: string; stage?: string; company_id?: string; limit?: string };
      return { items: deps.business.list(p.kind, { ...q, limit: q.limit ? Number(q.limit) : undefined }) };
    } catch (error) { return fail(reply, error); }
  });
  app.get('/api/v1/business/:kind/:id', async (req, reply) => {
    try {
      const p = req.params as { kind: string; id: string };
      const item = deps.business.get(p.kind, p.id);
      return item ? { item } : reply.status(404).send({ error: 'Business record not found' });
    } catch (error) { return fail(reply, error); }
  });
  app.post('/api/v1/business/:kind', async (req, reply) => {
    try { return reply.status(201).send({ item: deps.business.create((req.params as { kind: string }).kind, req.body) }); }
    catch (error) { return fail(reply, error); }
  });
  app.patch('/api/v1/business/:kind/:id', async (req, reply) => {
    try {
      const p = req.params as { kind: string; id: string };
      return { item: deps.business.update(p.kind, p.id, req.body) };
    } catch (error) { return fail(reply, error); }
  });
  app.delete('/api/v1/business/:kind/:id', async (req, reply) => {
    try {
      const p = req.params as { kind: string; id: string };
      return deps.business.delete(p.kind, p.id);
    } catch (error) { return fail(reply, error); }
  });
}
