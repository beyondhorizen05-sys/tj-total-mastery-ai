import type { FastifyInstance } from 'fastify';
import { CreateAgentRequest } from '@tj/schemas';
import type { AgentService } from '../../agents/service.js';

export function registerAgentRoutes(
  app: FastifyInstance,
  deps: {
    agents: AgentService;
  }
) {
  // GET /api/v1/agents/templates
  app.get('/api/v1/agents/templates', async () => {
    return { templates: deps.agents.templates() };
  });

  // GET /api/v1/agents
  app.get('/api/v1/agents', async (req) => {
    const q = req.query as { project_id?: string; status?: string };
    return { agents: deps.agents.list({ project_id: q.project_id ?? null, status: q.status }) };
  });

  // GET /api/v1/agents/:id
  app.get('/api/v1/agents/:id', async (req, reply) => {
    const p = req.params as { id: string };
    const agent = deps.agents.get(p.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return agent;
  });

  // POST /api/v1/agents
  app.post('/api/v1/agents', async (req) => {
    const body = CreateAgentRequest.parse(req.body);
    const agent = deps.agents.create({
      workspace_id: 'default',
      ...body,
    });
    return agent;
  });

  // PATCH /api/v1/agents/:id
  app.patch('/api/v1/agents/:id', async (req) => {
    const p = req.params as { id: string };
    const body = (req.body as any) ?? {};
    return deps.agents.update(p.id, body);
  });

  // DELETE /api/v1/agents/:id
  app.delete('/api/v1/agents/:id', async (req) => {
    const p = req.params as { id: string };
    deps.agents.delete(p.id);
    return { ok: true };
  });

  // GET /api/v1/agents/:id/messages
  app.get('/api/v1/agents/:id/messages', async (req) => {
    const p = req.params as { id: string };
    const q = req.query as { project_id?: string; limit?: string };
    return { messages: deps.agents.messages({ project_id: q.project_id, limit: Number(q.limit ?? 100) }) };
  });
}
