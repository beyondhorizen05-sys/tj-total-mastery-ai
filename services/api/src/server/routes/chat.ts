import type { FastifyInstance } from 'fastify';
import { ChatRequest } from '@tj/schemas';
import type { WorkspaceService } from '../../core/workspace.js';
import type { ModelRouter } from '../../models/router.js';
import type { CognitiveEngine } from '../../cognitive/engine.js';
import type { Orchestrator } from '../../orchestrator/orchestrator.js';
import type { HealthMonitor } from '../../core/health.js';

export function registerChatRoutes(
  app: FastifyInstance,
  deps: {
    ws: WorkspaceService;
    router: ModelRouter;
    cognitive: CognitiveEngine;
    orchestrator: Orchestrator;
    health: HealthMonitor;
  }
) {
  // GET /api/v1/conversations
  app.get('/api/v1/conversations', async (req) => {
    const q = req.query as { limit?: string };
    const convs = deps.ws.listConversations(Number(q.limit ?? 100));
    return { conversations: convs };
  });

  // POST /api/v1/conversations
  app.post('/api/v1/conversations', async (req) => {
    const body = (req.body as { title?: string; project_id?: string | null }) ?? {};
    const conv = deps.ws.createConversation(body.title ?? 'New Conversation', body.project_id ?? null);
    return conv;
  });

  // GET /api/v1/conversations/:id/messages
  app.get('/api/v1/conversations/:id/messages', async (req) => {
    const params = req.params as { id: string };
    const messages = deps.ws.messages(params.id);
    return { messages };
  });

  // POST /api/v1/chat
  app.post('/api/v1/chat', async (req, reply) => {
    if (deps.health.isStopped()) {
      return reply.status(403).send({ error: 'System is stopped. Resume to continue.' });
    }

    const body = ChatRequest.parse(req.body);
    let convId = body.conversation_id;
    if (!convId) {
      const conv = deps.ws.createConversation(body.content.slice(0, 40), body.project_id ?? null);
      convId = conv.id;
    }

    // Record user message
    deps.ws.addMessage({
      conversation_id: convId,
      role: 'user',
      content: body.content,
      attachments: body.attachments as any,
    });

    deps.health.setState('thinking');

    // Auto/Build/Research modes -> dispatch orchestrator
    if (body.mode === 'auto' || body.mode === 'build' || body.mode === 'research') {
      try {
        const planRes = await deps.cognitive.plan(body.content, {
          project_id: body.project_id ?? null,
        });
        const prepared = deps.orchestrator.prepare(body.content, planRes.plan, {
          project_id: body.project_id ?? null,
          conversation_id: convId,
        });
        const goalRes = await deps.orchestrator.execute(
          prepared,
          body.content,
          planRes.plan,
          { plan_source: planRes.source }
        );
        deps.ws.addMessage({
          conversation_id: convId,
          role: 'assistant',
          content: goalRes.summary,
        });
        deps.health.setState('idle');
        return {
          conversation_id: convId,
          content: goalRes.summary,
          plan_id: goalRes.plan_id,
          status: goalRes.status,
        };
      } catch (e: any) {
        deps.health.setState('error');
        deps.ws.addMessage({
          conversation_id: convId,
          role: 'assistant',
          content: `Execution halted: ${e.message}`,
        });
        return {
          conversation_id: convId,
          content: `Execution halted: ${e.message}`,
          error: e.message,
        };
      }
    }

    // Direct chat completion
    try {
      const history = deps.ws.messages(convId).map((m) => ({
        role: m.role as any,
        content: m.content,
      }));

      const res = await deps.router.chat(
        {
          task_type: 'chat',
          model_id: body.model_id ?? null,
        },
        {
          messages: history,
        },
        {
          project_id: body.project_id ?? null,
        }
      );

      const msg = deps.ws.addMessage({
        conversation_id: convId,
        role: 'assistant',
        content: res.text,
        model_id: res.model_id,
        provider_id: res.provider_id,
      });

      deps.health.setState('idle');
      return {
        conversation_id: convId,
        message: msg,
        content: res.text,
        model_id: res.model_id,
        provider_id: res.provider_id,
        cost_usd: res.cost_usd,
      };
    } catch (e: any) {
      deps.health.setState('error');
      return reply.status(500).send({ error: e.message });
    }
  });
}
