import type { FastifyInstance } from 'fastify';
import { LearningError, type LearningService } from '../../learning/service.js';

function fail(reply: any, error: unknown) {
  return reply.status(error instanceof LearningError ? error.status : 500).send({ error: (error as Error).message });
}

export function registerLearningRoutes(app: FastifyInstance, deps: { learning: LearningService }) {
  app.get('/api/v1/learning/feedback', async (req) => ({ feedback: deps.learning.listFeedback(Number((req.query as { limit?: string }).limit ?? 100)) }));
  app.post('/api/v1/learning/feedback', async (req, reply) => {
    try { return reply.status(201).send({ feedback: deps.learning.feedback((req.body ?? {}) as any) }); }
    catch (error) { return fail(reply, error); }
  });
  app.get('/api/v1/learning/proposals', async () => ({ proposals: deps.learning.listProposals() }));
  app.get('/api/v1/learning/proposals/:id', async (req, reply) => {
    const proposal = deps.learning.getProposal((req.params as { id: string }).id);
    return proposal ? { proposal } : reply.status(404).send({ error: 'Proposal not found' });
  });
  app.get('/api/v1/learning/evidence/:type/:id', async (req, reply) => {
    try {
      const p = req.params as { type: string; id: string };
      return { evidence: deps.learning.inspectEvidence(p.type, p.id) };
    } catch (error) { return fail(reply, error); }
  });
  app.post('/api/v1/learning/analyze', async () => deps.learning.analyze());
  app.post('/api/v1/learning/proposals/:id/review', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as { decision?: 'accept' | 'reject'; note?: string };
      return { proposal: deps.learning.decide((req.params as { id: string }).id, body.decision as any, body.note) };
    } catch (error) { return fail(reply, error); }
  });
}
