import type { FastifyInstance } from 'fastify';
import { AddProviderRequest } from '@tj/schemas';
import type { ModelRegistry } from '../../models/registry.js';
import type { ModelRouter } from '../../models/router.js';
import { z } from 'zod';
import type { ChatGPTPlanService } from '../../models/chatgpt-plan.js';

export function registerModelRoutes(
  app: FastifyInstance,
  deps: {
    registry: ModelRegistry;
    router: ModelRouter;
    chatgptPlan: ChatGPTPlanService;
  }
) {
  // GET /api/v1/models/presets
  app.get('/api/v1/models/presets', async () => {
    return { presets: deps.registry.presets() };
  });

  // GET /api/v1/models/providers
  app.get('/api/v1/models/providers', async () => {
    return { providers: deps.registry.listProviders() };
  });

  // POST /api/v1/models/providers
  app.post('/api/v1/models/providers', async (req, reply) => {
    const body = AddProviderRequest.parse(req.body);
    if (body.kind === 'chatgpt-plan') return reply.code(400).send({ error: 'Use Continue with ChatGPT to add this provider.' });
    const p = deps.registry.addProvider({
      name: body.name,
      kind: body.kind,
      preset: body.preset,
      base_url: body.base_url ?? null,
      api_key: body.api_key ?? null,
      organization: body.organization ?? null,
    });
    return p;
  });

  app.get('/api/v1/models/chatgpt-plan/status', async () => deps.chatgptPlan.status());

  app.post('/api/v1/models/chatgpt-plan/sign-in', async (req, reply) => {
    if (!deps.chatgptPlan.enabled) return reply.code(403).send({ error: 'ChatGPT plan sign-in requires an eligible open-source or approved private client and is disabled in this build.' });
    const body = z.object({ account_id: z.string().optional() }).strict().parse(req.body ?? {});
    await deps.chatgptPlan.begin(body.account_id);
    return { pending: true };
  });

  app.post('/api/v1/models/chatgpt-plan/disconnect', async (req) => {
    const body = z.object({ account_id: z.string() }).strict().parse(req.body);
    return deps.chatgptPlan.disconnect(body.account_id);
  });

  app.patch('/api/v1/models/providers/:id', async (req) => {
    const p = req.params as { id: string };
    const body = z.object({ name: z.string().min(1).optional(), base_url: z.string().url().nullable().optional(), api_key: z.string().min(1).optional(), organization: z.string().nullable().optional(), enabled: z.boolean().optional() }).strict().parse(req.body);
    return deps.registry.updateProvider(p.id, body);
  });

  // POST /api/v1/models/providers/:id/test
  app.post('/api/v1/models/providers/:id/test', async (req) => {
    const p = req.params as { id: string };
    const res = await deps.registry.testConnection(p.id);
    return res;
  });

  // POST /api/v1/models/providers/:id/refresh
  app.post('/api/v1/models/providers/:id/refresh', async (req) => {
    const p = req.params as { id: string };
    const models = await deps.registry.fetchModels(p.id);
    return { models };
  });

  // DELETE /api/v1/models/providers/:id
  app.delete('/api/v1/models/providers/:id', async (req) => {
    const p = req.params as { id: string };
    deps.registry.removeProvider(p.id);
    return { ok: true };
  });

  // GET /api/v1/models
  app.get('/api/v1/models', async (req) => {
    const q = req.query as { provider_id?: string; active_only?: string };
    const activeOnly = q.active_only === 'true';
    return { models: deps.registry.listModels(q.provider_id, activeOnly) };
  });

  // GET /api/v1/models/candidates
  app.get('/api/v1/models/candidates', async (req) => {
    const q = req.query as { task_type?: any; prefer?: any };
    const candidates = deps.router.candidates({
      task_type: q.task_type ?? 'chat',
      prefer: q.prefer,
    });
    return { candidates };
  });
}
