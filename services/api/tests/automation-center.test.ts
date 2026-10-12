import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { Database } from '../src/db/database.js';
import { EventBus } from '../src/core/event-bus.js';
import { WorkflowEngine } from '../src/workflows/engine.js';
import { AutomationScheduler } from '../src/workflows/automation-scheduler.js';
import { registerWorkflowRoutes } from '../src/server/routes/workflows.js';

describe('Automation Center lifecycle', () => {
  it('creates, updates, disables, deletes and persists dispatched runs', async () => {
    const db = new Database(':memory:'); db.migrate();
    const bus = new EventBus(db);
    const engine = new WorkflowEngine(db, bus, () => 'default');
    engine.registerExecutor('model', async () => ({ text: 'Local acceptance output' }));
    const scheduler = new AutomationScheduler({ db, engine, bus });
    const app = Fastify(); registerWorkflowRoutes(app, { engine, scheduler });
    try {
      const workflow = engine.save({ name: 'Local workflow', steps: [{ id: 'produce', name: 'Produce', kind: 'model', depends_on: [], config: {},
        retry: { max_attempts: 1, backoff_ms: 1000, max_backoff_ms: 1000 }, timeout_ms: 120000,
        permissions: [], risk: 'low', continue_on_error: false }] });
      const create = await app.inject({ method: 'POST', url: '/api/v1/automations', payload: {
        name: 'Original', workflow_id: workflow.id, enabled: true,
        trigger: { kind: 'schedule', config: { cron: '0 8 * * 1-5', timezone: 'Asia/Dubai' } },
      } });
      expect(create.statusCode).toBe(200);
      const created = create.json();
      expect(created.next_run_at).toBeTruthy();
      expect((await app.inject({ method: 'GET', url: '/api/v1/automations' })).json().automations).toHaveLength(1);

      const dispatched = await app.inject({ method: 'POST', url: `/api/v1/automations/${created.id}/trigger` });
      expect(dispatched.statusCode).toBe(200);
      const run = engine.listRuns({ workflow_id: workflow.id })[0];
      expect(run).toBeDefined();
      expect(dispatched.json().run_id).toBe(run.id);
      expect((await engine.wait(run.id)).status).toBe('completed');
      expect(scheduler.get(created.id)?.run_count).toBe(1);
      expect(scheduler.get(created.id)?.last_run_at).toBeTruthy();

      const update = await app.inject({ method: 'POST', url: '/api/v1/automations', payload: {
        id: created.id, name: 'Renamed and disabled', workflow_id: workflow.id, enabled: false,
        trigger: { kind: 'schedule', config: { cron: '0 8 * * 1-5', timezone: 'Asia/Dubai' } },
      } });
      expect(update.statusCode).toBe(200);
      expect(update.json()).toMatchObject({ id: created.id, name: 'Renamed and disabled', enabled: false, next_run_at: null, run_count: 1 });
      expect(engine.listRuns({ workflow_id: workflow.id })).toHaveLength(1);

      const remove = await app.inject({ method: 'DELETE', url: `/api/v1/automations/${created.id}` });
      expect(remove.statusCode).toBe(200);
      expect(scheduler.get(created.id)).toBeNull();
      expect(engine.listRuns({ workflow_id: workflow.id })).toHaveLength(1);
    } finally {
      scheduler.stop(); await app.close(); db.close();
    }
  });
});
