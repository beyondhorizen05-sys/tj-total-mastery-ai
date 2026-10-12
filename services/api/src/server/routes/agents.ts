import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentService } from '../../agents/service.js';
import type { Orchestrator } from '../../orchestrator/orchestrator.js';
import { buildTownState } from '../../agents/town.js';

export function registerAgentRoutes(
  app: FastifyInstance,
  deps: {
    agents: AgentService;
    orchestrator?: Orchestrator;
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

  app.get('/api/v1/town/state', async () => ({
    agents: buildTownState(deps.agents.list({ project_id: null })),
    messages: deps.agents.messages({ limit: 100 }).filter((message) => message.from_agent_id && message.to_agent_id),
  }));

  // GET /api/v1/agents/:id
  app.get('/api/v1/agents/:id', async (req, reply) => {
    const p = req.params as { id: string };
    const agent = deps.agents.get(p.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return agent;
  });

  // POST /api/v1/agents
  app.post('/api/v1/agents', async (req) => {
    const body = z.object({
      template_id: z.string().optional(), name: z.string().min(1).optional(), role: z.string().min(1).optional(),
      description: z.string().default(''), personality: z.string().default(''), system_instructions: z.string().default(''),
      project_id: z.string().optional().nullable(), model_id: z.string().optional().nullable(), tools: z.array(z.string()).optional(),
      permissions: z.array(z.string()).optional(), budget_usd: z.number().optional().nullable(), avatar: z.string().optional(),
    }).refine((value) => Boolean(value.template_id || (value.name && value.role)), 'Provide a template_id or both name and role').parse(req.body);
    const template = body.template_id ? deps.agents.templates().find((item) => item.id === body.template_id) : undefined;
    if (template?.role.toLowerCase() === 'orchestrator' && deps.orchestrator) {
      return deps.orchestrator.ensureAgentForRole('Orchestrator', body.project_id ?? null);
    }
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
  app.delete('/api/v1/agents/:id', async (req, reply) => {
    const p = req.params as { id: string };
    try {
      const deleted = deps.agents.delete(p.id);
      if (!deleted) return reply.status(404).send({ error: 'Agent not found' });
      return { ok: true };
    } catch (error) {
      return reply.status(409).send({ error: error instanceof Error ? error.message : 'Agent cannot be deleted' });
    }
  });

  // GET /api/v1/agents/:id/messages
  app.get('/api/v1/agents/:id/messages', async (req) => {
    const p = req.params as { id: string };
    const q = req.query as { project_id?: string; limit?: string };
    return { messages: deps.agents.messages({ agent_id: p.id, project_id: q.project_id, limit: Number(q.limit ?? 100) }) };
  });
}
