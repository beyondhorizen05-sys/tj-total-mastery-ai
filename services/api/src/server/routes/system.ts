import type { FastifyInstance } from 'fastify';
import type { Database } from '../../db/database.js';
import type { EventBus } from '../../core/event-bus.js';
import type { HealthMonitor } from '../../core/health.js';
import type { CapabilityRegistry } from '../../core/capabilities.js';
import type { SettingsRepo } from '../../db/repo.js';
import type { Orchestrator } from '../../orchestrator/orchestrator.js';
import type { ApprovalService } from '../../security/approvals.js';
import type { AgentService } from '../../agents/service.js';
import type { WorkspaceService } from '../../core/workspace.js';
import type { SelfImprovementService } from '../../self-improvement/service.js';
import { TJPersona } from '@tj/schemas';
import { getPersona } from '../../core/persona.js';
import { listLocalVoices } from '../../core/voice-listener.js';
import { z } from 'zod';
import path from 'node:path';

export function registerSystemRoutes(
  app: FastifyInstance,
  deps: {
    db: Database;
    bus: EventBus;
    health: HealthMonitor;
    capabilities: CapabilityRegistry;
    settings: SettingsRepo;
    orchestrator: Orchestrator;
    improvements: SelfImprovementService;
    approvals: ApprovalService;
    agents: AgentService;
    workspace: WorkspaceService;
    coreDataDir: string;
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
    deps.improvements.stopAll();
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

  app.get('/api/v1/system/setup', async () => ({
    profile: deps.workspace.user(),
    storage: { core_data_dir: deps.coreDataDir, project_files_dir: deps.workspace.projectStorageDir() },
    settings: deps.settings.all(),
  }));

  app.put('/api/v1/system/profile', async (req, reply) => {
    const parsed = z.object({
      display_name: z.string().trim().min(1).max(80),
      locale: z.string().trim().min(2).max(35),
      time_zone: z.string().trim().min(1).max(80),
    }).strict().safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid local profile', details: parsed.error.issues });
    try { new Intl.DateTimeFormat(parsed.data.locale, { timeZone: parsed.data.time_zone }); }
    catch { return reply.status(400).send({ error: 'Invalid locale or time zone' }); }
    deps.workspace.setUser(parsed.data);
    deps.settings.set('profile_name', parsed.data.display_name);
    return { ok: true, profile: deps.workspace.user() };
  });

  app.put('/api/v1/system/project-storage', async (req, reply) => {
    const parsed = z.object({ directory: z.string().trim().min(1).max(1024) }).strict().safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid project storage directory' });
    const directory = path.resolve(parsed.data.directory);
    const root = path.parse(directory).root;
    if (!path.isAbsolute(parsed.data.directory) || directory === root || /\0/.test(directory)) return reply.status(400).send({ error: 'Choose an absolute folder below a drive or filesystem root' });
    const normalized = directory.replaceAll('\\', '/').toLowerCase();
    if (process.platform === 'win32' && /^([a-z]:\/windows|[a-z]:\/program files(?: \(x86\))?|[a-z]:\/programdata)(\/|$)/.test(normalized)) return reply.status(400).send({ error: 'Choose a folder outside protected Windows system directories' });
    try {
      const saved = deps.workspace.setProjectStorageDir(directory);
      deps.settings.set('project_storage_dir', saved);
      return { ok: true, project_files_dir: saved, core_data_dir: deps.coreDataDir };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? `Folder is not writable: ${error.message}` : 'Folder is not writable' });
    }
  });

  // PATCH /api/v1/settings
  app.patch('/api/v1/settings', async (req, reply) => {
    const body = (req.body as Record<string, unknown>) ?? {};
    if ('tj_persona' in body || 'first_run_completed' in body) return reply.status(400).send({ error: 'Use the identity or first-run endpoint for this setting' });
    const validation = z.object({
      autonomy_level: z.number().int().min(1).max(4).optional(),
      privacy_mode: z.enum(['balanced', 'local-only']).optional(),
      default_model_id: z.string().nullable().optional(),
      routing_mode: z.enum(['auto', 'manual']).optional(),
      router_priority: z.enum(['balanced', 'cheapest', 'fastest', 'quality', 'local-only', 'private-only']).optional(),
      budget_daily_usd: z.number().min(0).nullable().optional(),
      budget_monthly_usd: z.number().min(0).nullable().optional(),
      max_request_cost_usd: z.number().min(0).nullable().optional(),
      notifications_enabled: z.boolean().optional(),
      computer_control_enabled: z.boolean().optional(),
      voice_autostart: z.boolean().optional(),
      voice_handsfree_mode: z.boolean().optional(),
      voice_asr_provider: z.enum(['local', 'fish']).optional(),
      voice_recognition_mode: z.enum(['fast', 'accurate']).optional(),
      voice_use_default_model: z.boolean().optional(),
    }).strict().safeParse(body);
    if (!validation.success) return reply.status(400).send({ error: 'Invalid settings value', details: validation.error.issues });
    for (const [k, v] of Object.entries(body)) {
      deps.settings.set(k, v);
    }
    deps.bus.emit({ name: 'system.settings_changed', summary: 'TJ settings updated', data: { keys: Object.keys(body) } });
    return { ok: true, settings: deps.settings.all() };
  });

  app.get('/api/v1/persona', async () => ({ persona: getPersona(deps.settings) }));
  app.put('/api/v1/persona', async (req, reply) => {
    const parsed = TJPersona.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid TJ identity settings', details: parsed.error.issues });
    const persona = parsed.data;
    if (persona.voice_id) {
      if (persona.voice_id.startsWith('windows:')) {
        const name = persona.voice_id.slice(8);
        if (!['default', 'female'].includes(name)) {
          const installed = await listLocalVoices().catch(() => []);
          if (!installed.some((voice) => voice.name === name)) return reply.status(400).send({ error: 'Selected Windows voice is not installed.' });
        }
      } else if (!/^fish:[a-f\d]{32}$/i.test(persona.voice_id)) {
        return reply.status(400).send({ error: 'Select a Fish Audio or installed Windows voice.' });
      }
    }
    deps.settings.set('tj_persona', persona);
    deps.bus.emit({ name: 'system.persona_changed', summary: `TJ presentation updated to ${persona.name}` });
    return { ok: true, persona };
  });

  // GET /api/v1/system/first-run
  app.get('/api/v1/system/first-run', async () => {
    const completed = deps.settings.get<boolean>('first_run_completed', false);
    return { first_run_completed: completed };
  });

  const completeFirstRun = async (req: { body: unknown }, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) => {
    const parsed = z.object({ completed: z.literal(true) }).strict().safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Finish setup with completed: true' });
    deps.settings.set('first_run_completed', true);
    deps.bus.emit({ name: 'system.health_changed', summary: 'First-run setup completed' });
    return { ok: true, first_run_completed: true };
  };
  app.post('/api/v1/system/first-run', completeFirstRun);
  app.post('/api/v1/system/first-run/complete', completeFirstRun);
}
