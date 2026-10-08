import type { FastifyInstance } from 'fastify';
import { SkillError, type SkillService, validateSkillManifest } from '../../skills/service.js';

function fail(reply: any, error: unknown) {
  const status = error instanceof SkillError ? error.status : 500;
  return reply.status(status).send({ error: (error as Error).message });
}

export function registerSkillRoutes(app: FastifyInstance, deps: { skills: SkillService }) {
  app.get('/api/v1/skills', async () => ({ skills: deps.skills.list() }));
  app.get('/api/v1/skills/runs', async () => ({ runs: deps.skills.runs() }));
  app.get('/api/v1/skills/catalog', async () => ({ catalog: deps.skills.discover(), catalog_path: deps.skills.catalogPath() }));

  app.post('/api/v1/skills/validate', async (req, reply) => {
    try { return { valid: true, manifest: validateSkillManifest(req.body) }; }
    catch (error) { return fail(reply, error); }
  });

  app.post('/api/v1/skills', async (req, reply) => {
    try { return reply.status(201).send({ skill: deps.skills.install(req.body) }); }
    catch (error) { return fail(reply, error); }
  });

  app.post('/api/v1/skills/install-from-catalog', async (req, reply) => {
    try {
      const filename = (req.body as { filename?: unknown })?.filename;
      if (typeof filename !== 'string') throw new SkillError('Catalog filename required');
      return reply.status(201).send({ skill: deps.skills.installFromCatalog(filename) });
    } catch (error) { return fail(reply, error); }
  });

  app.get('/api/v1/skills/:id', async (req, reply) => {
    const skill = deps.skills.get((req.params as { id: string }).id);
    return skill ? { skill } : reply.status(404).send({ error: 'Skill not found' });
  });

  app.get('/api/v1/skills/:id/runs', async (req) => ({ runs: deps.skills.runs((req.params as { id: string }).id) }));

  app.post('/api/v1/skills/:id/enable', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as { reviewed?: boolean };
      return { skill: deps.skills.setEnabled((req.params as { id: string }).id, true, body.reviewed === true) };
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/v1/skills/:id/disable', async (req, reply) => {
    try { return { skill: deps.skills.setEnabled((req.params as { id: string }).id, false, false) }; }
    catch (error) { return fail(reply, error); }
  });

  app.post('/api/v1/skills/:id/run', async (req, reply) => {
    try { return deps.skills.run((req.params as { id: string }).id, (req.body as { input?: unknown })?.input); }
    catch (error) { return fail(reply, error); }
  });
}
