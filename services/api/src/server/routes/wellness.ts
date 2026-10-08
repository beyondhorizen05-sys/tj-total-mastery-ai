import type { FastifyInstance } from 'fastify';
import type { WellnessEntry, WellnessKind, WellnessService } from '../../wellness/service.js';

export function registerWellnessRoutes(app: FastifyInstance, deps: { wellness: WellnessService }) {
  const noStore = (reply: any) => reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
  app.get('/api/v1/wellness/entries', async (req, reply) => {
    noStore(reply);
    try { return { entries: deps.wellness.list(req.query as { from?: string; to?: string; kind?: WellnessKind; limit?: number }) }; }
    catch (error) { return reply.status(400).send({ error: (error as Error).message }); }
  });
  app.post('/api/v1/wellness/entries', async (req, reply) => {
    noStore(reply);
    try { return reply.status(201).send(deps.wellness.add(req.body as Partial<WellnessEntry>)); }
    catch (error) { return reply.status(400).send({ error: (error as Error).message }); }
  });
  app.delete('/api/v1/wellness/entries/:id', async (req, reply) => {
    noStore(reply);
    return deps.wellness.delete((req.params as { id: string }).id) ? { ok: true } : reply.status(404).send({ error: 'Wellness entry not found' });
  });
  app.post('/api/v1/wellness/import', async (req, reply) => {
    noStore(reply);
    const body = req.body as { csv: string; source_label: string };
    try { return reply.status(201).send(deps.wellness.importCsv(body?.csv, body?.source_label)); }
    catch (error) { return reply.status(400).send({ error: (error as Error).message }); }
  });
  app.get('/api/v1/wellness/trends', async (req, reply) => {
    noStore(reply);
    const query = req.query as { kind: WellnessKind; from: string; to: string };
    try { return deps.wellness.trend(query.kind, query.from, query.to); }
    catch (error) { return reply.status(400).send({ error: (error as Error).message }); }
  });
  app.get('/api/v1/wellness/clinician-questions', async (req, reply) => {
    noStore(reply);
    const query = req.query as { kind: WellnessKind; from: string; to: string };
    try { return deps.wellness.clinicianQuestions(query.kind, query.from, query.to); }
    catch (error) { return reply.status(400).send({ error: (error as Error).message }); }
  });
}
