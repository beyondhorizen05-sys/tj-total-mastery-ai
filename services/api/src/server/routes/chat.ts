import type { FastifyInstance } from 'fastify';
import { ChatRequest } from '@tj/schemas';
import type { WorkspaceService } from '../../core/workspace.js';
import type { ModelRouter } from '../../models/router.js';
import type { CognitiveEngine } from '../../cognitive/engine.js';
import type { Orchestrator } from '../../orchestrator/orchestrator.js';
import type { HealthMonitor } from '../../core/health.js';
import type { SettingsRepo } from '../../db/repo.js';
import { getPersona, personaInstruction } from '../../core/persona.js';
import type { CapabilityWorkflowService } from '../../self-improvement/capability-workflow.js';
import { formatFullAutonomyProbe, isFullAutonomyProbeRequest, type FullAutonomyProbeResult } from '../../core/full-autonomy-runtime-check.js';

export function registerChatRoutes(
  app: FastifyInstance,
  deps: {
    ws: WorkspaceService;
    router: ModelRouter;
    cognitive: CognitiveEngine;
    orchestrator: Orchestrator;
    health: HealthMonitor;
    settings: SettingsRepo;
    capabilityWorkflow: CapabilityWorkflowService;
    runtimeProbe: () => Promise<FullAutonomyProbeResult>;
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

  app.delete('/api/v1/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.ws.getConversation(id)) return reply.code(404).send({ error: 'Conversation not found' });
    deps.ws.deleteConversation(id);
    return { ok: true, deleted_id: id };
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

    if (isFullAutonomyProbeRequest(body.content)) {
      // Skip unreliable LLM planning for this exact fixed-command diagnostic.
      // The same ToolRegistry and approval service are used by normal agents.
      const diagnostic = await deps.runtimeProbe();
      const content = formatFullAutonomyProbe(diagnostic);
      deps.ws.addMessage({ conversation_id: convId, role: 'assistant', content });
      return {
        conversation_id: convId, content,
        status: diagnostic.status === 'passed' ? 'completed' : 'failed',
        plan_source: 'fixed_runtime_diagnostic',
        diagnostic,
      };
    }

    deps.health.setState('thinking');

    // Auto mode uses the cognitive classifier to distinguish a normal
    // conversation from a multi-step goal. Explicit Build/Research modes stay
    // deterministic and always enter the orchestration path.
    const intent = body.mode === 'auto'
      ? await deps.cognitive.classify(body.content, { project_id: body.project_id ?? null })
      : null;
    const shouldOrchestrate = body.mode === 'build' || body.mode === 'research' || intent?.intent === 'goal';

    if (shouldOrchestrate && deps.settings.get<number>('autonomy_level', 2) === 0) {
      const content = 'Autonomy is set to Chat only, so TJ cannot start plans or tool runs. Switch to a higher autonomy level in Settings to run this goal.';
      deps.ws.addMessage({ conversation_id: convId, role: 'assistant', content });
      deps.health.setState('idle');
      return { conversation_id: convId, content, status: 'autonomy_blocked' };
    }

    if (shouldOrchestrate && (body.mode === 'auto' || body.mode === 'build')) {
      const gap = await deps.capabilityWorkflow.assess(body.content);
      if (gap) {
        const approval = deps.capabilityWorkflow.request({
          request: body.content, ...gap, conversation_id: convId,
          project_id: body.project_id ?? null, model_id: body.model_id ?? null,
        });
        const content = `TJ does not currently have ${gap.capability_name}. ${gap.reason} Approve adding this ability before I continue your task.`;
        deps.ws.addMessage({ conversation_id: convId, role: 'assistant', content });
        deps.health.setState('idle');
        return { conversation_id: convId, content, status: 'approval_required', approval_id: approval.id, capability_workflow_id: approval.id, capability_id: gap.capability_id };
      }
    }

    // Auto/Build/Research modes -> dispatch orchestrator
    if (shouldOrchestrate) {
      try {
        deps.health.setState('planning');
        const planRes = await deps.cognitive.plan(body.content, {
          project_id: body.project_id ?? null,
        });
        const prepared = deps.orchestrator.prepare(body.content, planRes.plan, {
          project_id: body.project_id ?? null,
          conversation_id: convId,
        });
        deps.health.setState('executing');
        const goalRes = await deps.orchestrator.execute(
          prepared,
          body.content,
          planRes.plan,
          { plan_source: planRes.source }
        );
        if (goalRes.status !== 'completed') {
          const failureEvidence = goalRes.task_results
            .filter((task) => task.status !== 'completed')
            .map((task) => `${task.title} [${task.status}]: ${task.error ?? task.output}`)
            .join('\n')
            .slice(0, 4000);
          const gap = await deps.capabilityWorkflow.assess(body.content, failureEvidence);
          if (gap) {
            const approval = deps.capabilityWorkflow.request({
              request: body.content, ...gap, conversation_id: convId,
              project_id: body.project_id ?? null, model_id: body.model_id ?? null,
            });
            const content = `The goal stopped because TJ is missing a software ability: ${gap.capability_name}. ${gap.reason} I have not marked the goal complete. Approve the isolated source change; after it passes checks and is activated, TJ will resume the original task.`;
            deps.ws.addMessage({ conversation_id: convId, role: 'assistant', content });
            deps.health.setState('idle');
            return { conversation_id: convId, content, status: 'approval_required', approval_id: approval.id, capability_workflow_id: approval.id, capability_id: gap.capability_id, prior_status: goalRes.status, plan_id: goalRes.plan_id };
          }
        }
        const evidence = goalRes.evidence;
        const resultText = [
          goalRes.summary,
          `Evidence: ${evidence.changed_files.length} changed file(s), ${evidence.source_calls} source retrieval(s), ${evidence.test_calls} successful test command(s).`,
          evidence.changed_files.length ? `Changed files: ${evidence.changed_files.slice(0, 20).join(', ')}` : '',
          goalRes.artifacts.length ? `Artifacts: ${goalRes.artifacts.map((a) => a.path ?? a.name).slice(0, 20).join(', ')}` : '',
          evidence.gaps.length ? `Unverified: ${evidence.gaps.join(' ')}` : '',
        ].filter(Boolean).join('\n');
        deps.ws.addMessage({
          conversation_id: convId,
          role: 'assistant',
          content: resultText,
        });
        deps.health.setState('idle');
        return {
          conversation_id: convId,
          content: resultText,
          plan_id: goalRes.plan_id,
          status: goalRes.status,
          evidence,
          artifacts: goalRes.artifacts,
          plan_source: goalRes.plan_source,
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
    const streaming = req.headers.accept?.includes('text/event-stream') === true;
    const controller = streaming ? new AbortController() : null;
    const onResponseClose = () => {
      if (controller && !reply.raw.writableEnded) controller.abort();
    };
    if (streaming) {
      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      reply.raw.flushHeaders?.();
      reply.raw.on('close', onResponseClose);
    }
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
          messages: [{ role: 'system', content: personaInstruction(getPersona(deps.settings)) }, ...history],
          signal: controller?.signal,
          onDelta: streaming ? (delta) => {
            if (!reply.raw.writableEnded) reply.raw.write(`event: delta\ndata: ${JSON.stringify({ delta })}\n\n`);
          } : undefined,
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
        trace: {
          tokens_in: res.usage?.tokens_in ?? 0,
          tokens_out: res.usage?.tokens_out ?? 0,
          cost_usd: res.cost_usd,
          latency_ms: res.latency_ms ?? 0,
          routed_model_id: res.routed_model_id,
          routed_via: res.routed_via,
        },
      });

      deps.health.setState('idle');
      if (streaming) {
        reply.raw.write(`event: done\ndata: ${JSON.stringify({
          conversation_id: convId,
          message: msg,
          content: res.text,
          model_id: res.model_id,
          provider_id: res.provider_id,
          routed_model_id: res.routed_model_id,
          routed_via: res.routed_via,
          cost_usd: res.cost_usd,
        })}\n\n`);
        reply.raw.end();
        return reply;
      }
      return {
        conversation_id: convId,
        message: msg,
        content: res.text,
        model_id: res.model_id,
        provider_id: res.provider_id,
        routed_model_id: res.routed_model_id,
        routed_via: res.routed_via,
        cost_usd: res.cost_usd,
      };
    } catch (e: any) {
      deps.health.setState('error');
      if (streaming) {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
          reply.raw.end();
        }
        return reply;
      }
      return reply.status(500).send({ error: e.message });
    } finally {
      if (streaming) reply.raw.off('close', onResponseClose);
    }
  });

  app.get('/api/v1/chat/capability-workflows/:id', async (req, reply) => {
    const status = await deps.capabilityWorkflow.progress((req.params as { id: string }).id);
    return status ?? reply.status(404).send({ error: 'Capability workflow not found' });
  });

  app.delete('/api/v1/chat/capability-workflows/:id', async (req) => {
    const { id } = req.params as { id: string };
    deps.capabilityWorkflow.delete(id);
    return { ok: true, deleted_id: id };
  });

  app.delete('/api/v1/chat/capability-workflows', async () => {
    deps.capabilityWorkflow.clear();
    return { ok: true, cleared: true };
  });
}
