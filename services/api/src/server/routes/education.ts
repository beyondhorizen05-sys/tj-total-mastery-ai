import type { FastifyInstance, FastifyReply } from 'fastify';
import { EducationError, type EducationService } from '../../education/service.js';

function respondError(reply: FastifyReply, error: unknown) {
  if (error instanceof EducationError) return reply.code(error.status).send({ error: error.message });
  throw error;
}

export function registerEducationRoutes(app: FastifyInstance, deps: { education: EducationService }) {
  app.get('/api/v1/education/plans', async () => ({ plans: deps.education.listPlans() }));
  app.post('/api/v1/education/plans', async (req, reply) => {
    try { return reply.code(201).send({ plan: deps.education.createPlan((req.body ?? {}) as any) }); }
    catch (error) { return respondError(reply, error); }
  });
  app.get('/api/v1/education/plans/:id', async (req, reply) => {
    try { return deps.education.getPlan((req.params as { id: string }).id); }
    catch (error) { return respondError(reply, error); }
  });
  app.delete('/api/v1/education/plans/:id', async (req, reply) => {
    try { deps.education.deletePlan((req.params as { id: string }).id); return reply.code(204).send(); }
    catch (error) { return respondError(reply, error); }
  });
  app.post('/api/v1/education/plans/:id/lessons', async (req, reply) => {
    try { return reply.code(201).send({ lesson: deps.education.createLesson((req.params as { id: string }).id, (req.body ?? {}) as any) }); }
    catch (error) { return respondError(reply, error); }
  });
  app.patch('/api/v1/education/lessons/:id/progress', async (req, reply) => {
    try { return { lesson: deps.education.updateProgress((req.params as { id: string }).id, (req.body as any)?.status) }; }
    catch (error) { return respondError(reply, error); }
  });
  app.get('/api/v1/education/lessons/:id/quiz', async (req, reply) => {
    try { return { questions: deps.education.quiz((req.params as { id: string }).id) }; }
    catch (error) { return respondError(reply, error); }
  });
  app.post('/api/v1/education/lessons/:id/questions', async (req, reply) => {
    try { return reply.code(201).send({ question: deps.education.addQuestion((req.params as { id: string }).id, (req.body ?? {}) as any) }); }
    catch (error) { return respondError(reply, error); }
  });
  app.get('/api/v1/education/lessons/:id/attempts', async (req, reply) => {
    try { return { attempts: deps.education.attempts((req.params as { id: string }).id) }; }
    catch (error) { return respondError(reply, error); }
  });
  app.post('/api/v1/education/lessons/:id/attempts', async (req, reply) => {
    try { return reply.code(201).send({ attempt: deps.education.submitAttempt((req.params as { id: string }).id, (req.body ?? {}) as any) }); }
    catch (error) { return respondError(reply, error); }
  });
}
