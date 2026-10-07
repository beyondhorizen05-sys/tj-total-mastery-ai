import type { FastifyInstance } from 'fastify';
import type { Database } from '../../db/database.js';
import type { EventBus } from '../../core/event-bus.js';
import type { HealthMonitor } from '../../core/health.js';
import type { CapabilityRegistry } from '../../core/capabilities.js';
import type { SettingsRepo } from '../../db/repo.js';
import type { Orchestrator } from '../../orchestrator/orchestrator.js';
import type { ApprovalService } from '../../security/approvals.js';
import type { AgentService } from '../../agents/service.js';

export function registerSystemRoutes(
  app: FastifyInstance,
  deps: {
    db: Database;
    bus: EventBus;
    health: HealthMonitor;
    capabilities: CapabilityRegistry;
    settings: SettingsRepo;
    orchestrator: Orchestrator;
    approvals: ApprovalService;
    agents: AgentService;
  }
) {
  // GET /api/v1/system/status
  app.get('/api/v1/system/status', async () => {
    return await deps.health.getStatus();
  });

  // GET /api/v1/system/capabilities
  app.get('/api/v1/system/capabilities', async () => {
    const list = await deps.capabilities.list();
    return { capabilities: list };
  });

  // GET /api/v1/system/events (SSE)
  app.get('/api/v1/system/events', async (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders?.();

    // Send initial ping
    reply.raw.write(`event: ping\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);

    const unsubscribe = deps.bus.on('*', (event) => {
      reply.raw.write(`event: ${event.name}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    req.raw.on('close', () => {
      unsubscribe();
    });
  });

  // GET /api/v1/system/activity
  app.get('/api/v1/system/activity', async (req) => {
    const query = req.query as { limit?: string; severity?: string };
    const limit = Math.min(Number(query.limit ?? 100), 500);
    const rows = deps.db.all<any>(
      'SELECT * FROM events ORDER BY ts DESC LIMIT ?',
      [limit]
    );
    return { events: rows.map((r) => ({ ...r, data: JSON.parse(r.data || '{}') })) };
  });

  // POST /api/v1/system/stop-all
  app.post('/api/v1/system/stop-all', async () => {
    deps.health.setStopAll(true);
    deps.orchestrator.stopAll();
    deps.approvals.denyAllPending('stop_all');
    deps.agents.resetActive('idle');
    deps.bus.emit({
      name: 'system.health_changed',
      severity: 'warning',
      summary: 'STOP ALL engaged by user: all runs aborted, pending approvals denied, agents reset to idle',
    });
    return { ok: true, stopped: true, status: await deps.health.getStatus() };
  });

  // POST /api/v1/system/resume
  app.post('/api/v1/system/resume', async () => {
    deps.health.setStopAll(false);
    deps.health.setState('idle');
    deps.bus.emit({
      name: 'system.health_changed',
      severity: 'info',
      summary: 'STOP ALL released by user: normal operation resumed',
    });
    return { ok: true, stopped: false, status: await deps.health.getStatus() };
  });

  // GET /api/v1/settings
  app.get('/api/v1/settings', async () => {
    return { settings: deps.settings.all() };
  });

  // PATCH /api/v1/settings
  app.patch('/api/v1/settings', async (req) => {
    const body = (req.body as Record<string, unknown>) ?? {};
    for (const [k, v] of Object.entries(body)) {
      deps.settings.set(k, v);
    }
    return { ok: true, settings: deps.settings.all() };
  });

  // GET /api/v1/system/first-run
  app.get('/api/v1/system/first-run', async () => {
    const completed = deps.settings.get<boolean>('first_run_completed', false);
    return { first_run_completed: completed };
  });

  // POST /api/v1/system/first-run (alias for complete)
  app.post('/api/v1/system/first-run', async (req) => {
    const body = (req.body as Record<string, unknown>) ?? {};
    deps.settings.set('first_run_completed', true);
    if (body.user_name) deps.settings.set('user_name', String(body.user_name));
    if (body.autonomy_level) deps.settings.set('autonomy_level', Number(body.autonomy_level));
    if (body.privacy_mode) deps.settings.set('privacy_mode', String(body.privacy_mode));
    return { ok: true, first_run_completed: true };
  });

  // POST /api/v1/system/first-run/complete
  app.post('/api/v1/system/first-run/complete', async (req) => {
    const body = (req.body as Record<string, unknown>) ?? {};
    deps.settings.set('first_run_completed', true);
    if (body.user_name) deps.settings.set('user_name', String(body.user_name));
    if (body.autonomy_level) deps.settings.set('autonomy_level', Number(body.autonomy_level));
    if (body.privacy_mode) deps.settings.set('privacy_mode', String(body.privacy_mode));
    return { ok: true, first_run_completed: true };
  });
}
