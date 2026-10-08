import type { FastifyInstance } from 'fastify';
import type { WorkflowEngine } from '../../workflows/engine.js';
import type { AutomationScheduler } from '../../workflows/automation-scheduler.js';
import { WorkflowStep } from '@tj/schemas';
import { weekdaySummaryDefinition } from '../../workflows/template.js';

export function registerWorkflowRoutes(
  app: FastifyInstance,
  deps: {
    engine: WorkflowEngine;
    scheduler: AutomationScheduler;
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
  app.post('/api/v1/workflows', async (req) => {
    const body = (req.body as any) ?? {};
    return deps.engine.save({ ...body, steps: WorkflowStep.array().parse(body.steps) });
  });

  // POST /api/v1/workflows/:id/run
  app.post('/api/v1/workflows/:id/run', async (req) => {
    const p = req.params as { id: string };
    const body = (req.body as any) ?? {};
    const run = await deps.engine.start(p.id, body.inputs ?? {}, 'user_api');
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
  app.post('/api/v1/workflow-runs/:id/pause', async (req) => {
    const p = req.params as { id: string };
    deps.engine.pause(p.id);
    return { ok: true };
  });

  // POST /api/v1/workflow-runs/:id/resume
  app.post('/api/v1/workflow-runs/:id/resume', async (req) => {
    const p = req.params as { id: string };
    await deps.engine.resume(p.id);
    return { ok: true };
  });

  // POST /api/v1/workflow-runs/:id/cancel
  app.post('/api/v1/workflow-runs/:id/cancel', async (req) => {
    const p = req.params as { id: string };
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
  app.post('/api/v1/automations/:id/trigger', async (req) => {
    const p = req.params as { id: string };
    const runId = await deps.scheduler.trigger(p.id, 'manual_api');
    return { ok: true, run_id: runId };
  });

  // DELETE /api/v1/automations/:id
  app.delete('/api/v1/automations/:id', async (req) => {
    const p = req.params as { id: string };
    deps.scheduler.delete(p.id);
    return { ok: true };
  });
}
