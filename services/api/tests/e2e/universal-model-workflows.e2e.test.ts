import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server/app.js';
import { loadConfig } from '../../src/config.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Provider-agnostic workflow API — deterministic fixtures, NOT live provider acceptance', () => {
  let service: Awaited<ReturnType<typeof createServer>>;
  let dir = '';
  let modelPrefix = '';
  const step = (id: string, kind: 'wait' | 'model' | 'transform', deps: string[], config: Record<string, unknown>) => ({
    id, name: id, kind, depends_on: deps, config, permissions: [], risk: 'low',
    continue_on_error: false, retry: { max_attempts: 1, backoff_ms: 50, max_backoff_ms: 50 }, timeout_ms: 5000,
  });
  const makeWorkflow = async (name: string, steps: ReturnType<typeof step>[]) => {
    const saved = await service.app.inject({ method: 'POST', url: '/api/v1/workflows',
      payload: { name, steps } });
    expect(saved.statusCode).toBe(200);
    return saved.json().id as string;
  };
  const start = async (id: string) => {
    const r = await service.app.inject({ method: 'POST', url: '/api/v1/workflows/' + id + '/run', payload: {} });
    expect(r.statusCode).toBe(200);
    return r.json().id as string;
  };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-e2e-model-'));
    service = await createServer(loadConfig({
      dataDir: dir, dbPath: path.join(dir, 'tj.sqlite'), vaultPath: path.join(dir, 'vault'),
      projectsDir: path.join(dir, 'projects'), artifactsDir: path.join(dir, 'artifacts'),
      backupsDir: path.join(dir, 'backups'), logsDir: path.join(dir, 'logs'),
      enableTestProvider: true, enableChatGPTPlanSignIn: false,
    }));
    const created = await service.app.inject({ method: 'POST', url: '/api/v1/models/providers',
      payload: { name: 'Fixture provider (not an AI)', kind: 'test' } });
    expect(created.statusCode).toBe(200);
    expect(created.json().discovery.status).toBe('discovered');
    modelPrefix = created.json().id;
  });
  afterAll(async () => {
    try { if (service) { await service.app.close(); service.db.close(); } }
    finally { if (dir) fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('creates, runs and persists parallel model steps and dependent delivery through HTTP routes', async () => {
    const id = await makeWorkflow('Actual API workflow using test fixtures', [
      step('research', 'model', [], { model_id: modelPrefix + '/tj-test-echo', prompt: 'Research evidence is available' }),
      step('verify', 'model', [], { model_id: modelPrefix + '/tj-test-planner', prompt: 'Testing evidence is available' }),
      step('delivery', 'transform', ['research', 'verify'], { value: 'Local test deliverable' }),
    ]);
    const runId = await start(id);
    const done = await service.workflowEngine.wait(runId);
    expect(done.status).toBe('completed');
    expect(String(done.step_state.research.output)).toContain('Research evidence');
    expect(String(done.step_state.verify.output)).toContain('Testing evidence');
    expect(done.step_state.delivery.output).toBe('Local test deliverable');
    expect(done.step_state.delivery.attempts).toBe(1);
    const persisted = await service.app.inject({ method: 'GET', url: '/api/v1/workflow-runs/' + runId });
    expect(persisted.json().status).toBe('completed');
  });

  it('changes only future model steps in an active workflow', async () => {
    const id = await makeWorkflow('Model switch without workflow restart', [
      step('pause', 'wait', [], { ms: 500 }),
      step('reply', 'model', ['pause'], { prompt: 'Selected model changed during run' }),
    ]);
    const runId = await start(id);
    const response = await service.app.inject({ method: 'POST',
      url: '/api/v1/workflow-runs/' + runId + '/switch-model',
      payload: { model_id: modelPrefix + '/tj-test-planner' } });
    expect(response.statusCode).toBe(200);
    const result = await service.workflowEngine.wait(runId);
    expect(result.status).toBe('completed');
    expect(result.checkpoint.model_override_id).toBe(modelPrefix + '/tj-test-planner');
    expect(result.step_state.pause.attempts).toBe(1);
    expect(result.step_state.reply.attempts).toBe(1);
  });

  it('cancels a running wait without waiting for its full timeout', async () => {
    const id = await makeWorkflow('Cancellable waiting step', [
      step('sleep', 'wait', [], { ms: 10000 }),
      step('must_not_execute', 'transform', ['sleep'], { value: 'incorrect' }),
    ]);
    const runId = await start(id);
    const before = Date.now();
    const cancelled = await service.app.inject({ method: 'POST', url: '/api/v1/workflow-runs/' + runId + '/cancel', payload: {} });
    expect(cancelled.statusCode).toBe(200);
    const finished = await service.workflowEngine.wait(runId);
    expect(Date.now() - before).toBeLessThan(4000);
    expect(finished.status).toBe('cancelled');
    expect(finished.step_state.must_not_execute.status).not.toBe('completed');
  });

  it('records failure rather than sending data to a provider blocked by privacy policy', async () => {
    const setting = await service.app.inject({ method: 'PATCH', url: '/api/v1/settings',
      payload: { privacy_mode: 'local-only' } });
    expect(setting.statusCode).toBe(200);
    try {
      const id = await makeWorkflow('Privacy must be enforced', [
        step('blocked', 'model', [], { model_id: modelPrefix + '/tj-test-echo', prompt: 'Not transmitted' }),
      ]);
      const done = await service.workflowEngine.wait(await start(id));
      expect(done.status).toBe('failed');
      expect(done.step_state.blocked.error).toMatch(/unavailable|privacy|provider/i);
    } finally {
      await service.app.inject({ method: 'PATCH', url: '/api/v1/settings',
        payload: { privacy_mode: 'balanced' } });
    }
  });
});
