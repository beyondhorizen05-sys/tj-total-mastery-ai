import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SelfImprovementService } from '../../self-improvement/service.js';
import type { HealthMonitor } from '../../core/health.js';

const StartRequest = z.object({ prompt: z.string().trim().min(8).max(4000), model_id: z.string().optional() });

export function registerSelfImprovementRoutes(app: FastifyInstance, improvements: SelfImprovementService, health: HealthMonitor) {
  app.get('/api/v1/self-improvement/runs', async () => ({ runs: improvements.list() }));
  app.get('/api/v1/self-improvement/runs/:id', async (request, reply) => {
    const run = improvements.get((request.params as { id: string }).id);
    return run ?? reply.code(404).send({ error: 'Improvement run not found' });
  });
  app.post('/api/v1/self-improvement/runs', async (request, reply) => {
    if (health.isStopped()) return reply.code(403).send({ error: 'System is stopped. Resume TJ before starting an improvement.' });
    const parsed = StartRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Provide a clear improvement request (8 to 4000 characters).' });
    try { return reply.code(202).send(await improvements.start(parsed.data.prompt, parsed.data.model_id)); }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.post('/api/v1/self-improvement/runs/:id/rollback', async (request, reply) => {
    try { return await improvements.rollback((request.params as { id: string }).id); }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
}
