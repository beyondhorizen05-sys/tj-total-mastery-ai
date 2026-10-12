import type { FastifyInstance } from 'fastify';
import type { WorkflowEngine } from '../../workflows/engine.js';
import type { AutomationScheduler } from '../../workflows/automation-scheduler.js';
import type { HealthMonitor } from '../../core/health.js';
import type { CognitiveEngine } from '../../cognitive/engine.js';
import type { Orchestrator } from '../../orchestrator/orchestrator.js';
import type { WorkspaceService } from '../../core/workspace.js';
import { WorkflowStep } from '@tj/schemas';
import { weekdaySummaryDefinition } from '../../workflows/template.js';
import { z } from 'zod';

export function registerWorkflowRoutes(
  app: FastifyInstance,
  deps: {
    engine: WorkflowEngine;
    scheduler: AutomationScheduler;
    health?: Pick<HealthMonitor, 'isStopped'>;
    cognitive?: CognitiveEngine;
    orchestrator?: Orchestrator;
    workspace?: WorkspaceService;
  }
) {
  // GET /api/v1/workflows
  app.get('/api/v1/workflows', async () => {
    return { workflows: deps.engine.list() };
  });

  // GET /api/v1/workflows/:id
  app.get('/api/v1/workflows/:id', async (req, reply) => {
    const p = req.params as { id: string };
    const w = deps.engine.get(p.id);
    if (!w) return reply.status(404).send({ error: 'Workflow not found' });
    return w;
  });

  // POST /api/v1/workflows
  app.post('/api/v1/workflows', async (req, reply) => {
    const parsed = z.object({
      id: z.string().optional(),
      name: z.string().trim().min(1),
      description: z.string().optional(),
      project_id: z.string().nullable().optional(),
      steps: WorkflowStep.array(),
    }).passthrough().safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid workflow definition', issues: parsed.error.issues });
    try { deps.engine.validate(parsed.data.steps); }
    catch (error) { return reply.status(400).send({ error: (error as Error).message }); }
    return deps.engine.save(parsed.data);
  });

  // Plan a prompt into reusable agent steps, persist the workflow, and opt it into a daily schedule.
  app.post('/api/v1/workflows/from-prompt', async (req, reply) => {
    if (!deps.cognitive || !deps.orchestrator || !deps.workspace) return reply.status(501).send({ error: 'Prompt workflow planning is unavailable in this server instance.' });
    const cognitive = deps.cognitive;
    const orchestrator = deps.orchestrator;
    const workspace = deps.workspace;
    if (deps.health?.isStopped()) return reply.status(403).send({ error: 'System is stopped. Resume TJ before creating a scheduled workflow.' });
    const parsed = z.object({
      prompt: z.string().trim().min(8).max(4000),
      name: z.string().trim().min(1).max(100).optional(),
      time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
      timezone: z.string().trim().min(1).max(100),
      project_id: z.string().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Provide a task prompt, daily time (HH:mm), and valid timezone.', issues: parsed.error.issues });
    try { new Intl.DateTimeFormat('en', { timeZone: parsed.data.timezone }); }
    catch { return reply.status(400).send({ error: `Invalid timezone: ${parsed.data.timezone}` }); }
    if (parsed.data.project_id && !workspace.getProject(parsed.data.project_id)) return reply.status(404).send({ error: 'Project not found' });

    try {
      const planned = await cognitive.plan(parsed.data.prompt, { project_id: parsed.data.project_id ?? null });
      const idByPlanId = new Map(planned.plan.tasks.map((task, index) => [task.id, `agent-step-${index + 1}`]));
      const steps = planned.plan.tasks.map((task) => {
        const agent = orchestrator.ensureAgentForRole(task.role, parsed.data.project_id ?? null, task.tools);
        return WorkflowStep.parse({
          id: idByPlanId.get(task.id)!, name: task.title, kind: 'agent',
          depends_on: task.depends_on.map((dependency) => idByPlanId.get(dependency)).filter((dependency): dependency is string => Boolean(dependency)),
          config: { agent_id: agent.id, instruction: `${task.description || task.title}\n\nComplete this scheduled task with evidence. Follow TJ permissions and approval requests. Do not claim completion without verification.` },
          retry: { max_attempts: 1, backoff_ms: 1000, max_backoff_ms: 1000 },
          timeout_ms: /code|implement|build|develop|debug|fix|test/i.test(`${task.title} ${task.role}`) ? 300000 : 180000,
          permissions: agent.permissions, risk: task.risk ?? 'low', continue_on_error: false,
        });
      });
      const name = parsed.data.name || planned.plan.objective.trim().slice(0, 100) || parsed.data.prompt.slice(0, 100);
      const description = `Created from a user prompt. Daily schedule ${parsed.data.time} (${parsed.data.timezone}). ${planned.source === 'fallback' ? 'The planner used its labelled fallback plan; inspect the saved steps before relying on it.' : ''}`.trim();
      const workflow = deps.engine.save({ name, description, project_id: parsed.data.project_id ?? null, steps });
      const [hour, minute] = parsed.data.time.split(':').map(Number);
      const automation = deps.scheduler.save({
        name: `${name} · Daily`, description: workflow.description, enabled: true, workflow_id: workflow.id,
        trigger: { kind: 'schedule', config: { cron: `${minute} ${hour} * * *`, timezone: parsed.data.timezone } },
      });
      return reply.status(201).send({ workflow, automation, planner_source: planned.source, model_id: planned.model_id, agent_count: [...new Set(steps.map((step) => String(step.config.agent_id)))].length });
    } catch (error) {
      return reply.status(503).send({ error: error instanceof Error ? error.message : 'Could not build and schedule this workflow' });
    }
  });

  // POST /api/v1/workflows/:id/run
  app.post('/api/v1/workflows/:id/run', async (req, reply) => {
    if (deps.health?.isStopped()) return reply.status(403).send({ error: 'System is stopped. Resume to start workflows.' });
    const p = req.params as { id: string };
    if (!deps.engine.get(p.id)) return reply.status(404).send({ error: 'Workflow not found' });
    const parsed = z.object({ inputs: z.record(z.string(), z.unknown()).optional() }).passthrough().safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid workflow inputs', issues: parsed.error.issues });
    const run = await deps.engine.start(p.id, parsed.data.inputs ?? {}, 'user_api');
    return run;
  });

  // GET /api/v1/workflow-runs
  app.get('/api/v1/workflow-runs', async (req) => {
    const q = req.query as { workflow_id?: string; limit?: string };
    return { runs: deps.engine.listRuns({ workflow_id: q.workflow_id, limit: Number(q.limit ?? 50) }) };
  });

  // GET /api/v1/workflow-runs/:id
  app.get('/api/v1/workflow-runs/:id', async (req, reply) => {
    const p = req.params as { id: string };
    const run = deps.engine.getRun(p.id);
    if (!run) return reply.status(404).send({ error: 'Run not found' });
    return run;
  });

  // POST /api/v1/workflow-runs/:id/pause
  app.post('/api/v1/workflow-runs/:id/pause', async (req, reply) => {
    const p = req.params as { id: string };
    if (!deps.engine.getRun(p.id)) return reply.status(404).send({ error: 'Run not found' });
    deps.engine.pause(p.id);
    return { ok: true };
  });

  // POST /api/v1/workflow-runs/:id/resume
  app.post('/api/v1/workflow-runs/:id/resume', async (req, reply) => {
    if (deps.health?.isStopped()) return reply.status(403).send({ error: 'System is stopped. Resume before resuming workflows.' });
    const p = req.params as { id: string };
    if (!deps.engine.getRun(p.id)) return reply.status(404).send({ error: 'Run not found' });
    await deps.engine.resume(p.id);
    return { ok: true };
  });

  // POST /api/v1/workflow-runs/:id/cancel
  app.post('/api/v1/workflow-runs/:id/cancel', async (req, reply) => {
    const p = req.params as { id: string };
    if (!deps.engine.getRun(p.id)) return reply.status(404).send({ error: 'Run not found' });
    deps.engine.cancel(p.id);
    return { ok: true };
  });

  // GET /api/v1/automations
  app.get('/api/v1/automations', async () => {
    return { automations: deps.scheduler.list() };
  });

  // Explicit creation only. The caller must choose a timezone and opt in to enabling it.
  app.post('/api/v1/automations/weekday-summary', async (req, reply) => {
    const body = (req.body as { timezone?: string; enabled?: boolean; name?: string }) ?? {};
    if (!body.timezone || typeof body.timezone !== 'string') return reply.status(400).send({ error: 'Choose an IANA timezone, e.g. Asia/Dubai' });
    try { new Intl.DateTimeFormat('en', { timeZone: body.timezone }); }
    catch { return reply.status(400).send({ error: `Invalid timezone: ${body.timezone}` }); }
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return reply.status(400).send({ error: 'enabled must be a boolean' });
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : weekdaySummaryDefinition.name;
    const workflow = deps.engine.save({ ...weekdaySummaryDefinition, name });
    const automation = deps.scheduler.save({
      name, description: weekdaySummaryDefinition.description, enabled: body.enabled === true,
      workflow_id: workflow.id,
      trigger: { kind: 'schedule', config: { cron: '0 8 * * 1-5', timezone: body.timezone } },
    });
    return reply.status(201).send({ workflow_id: workflow.id, automation_id: automation.id, enabled: automation.enabled,
      timezone: body.timezone, next_run_at: automation.next_run_at, action: 'tj_productivity:weekday_summary' });
  });

  // POST /api/v1/automations
  app.post('/api/v1/automations', async (req) => {
    const body = (req.body as any) ?? {};
    return deps.scheduler.save(body);
  });

  // POST /api/v1/automations/:id/trigger
  app.post('/api/v1/automations/:id/trigger', async (req, reply) => {
    if (deps.health?.isStopped() || deps.scheduler.isPaused()) return reply.status(403).send({ error: 'System is stopped. Resume before triggering automations.' });
    const p = req.params as { id: string };
    const runId = await deps.scheduler.trigger(p.id, 'manual_api');
    if (!runId) return reply.status(403).send({ error: 'Automation scheduler is paused.' });
    return { ok: true, run_id: runId };
  });

  // DELETE /api/v1/automations/:id
  app.delete('/api/v1/automations/:id', async (req) => {
    const p = req.params as { id: string };
    deps.scheduler.delete(p.id);
    return { ok: true };
  });
}
