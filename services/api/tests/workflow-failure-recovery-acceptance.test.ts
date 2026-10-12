import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';
import { fail, ok } from '../src/tools/types.js';

describe('workflow retry, terminal failure, and recovery lifecycle', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-workflow-recovery-'));
  const config = loadConfig({
    dataDir,
    dbPath: path.join(dataDir, 'tj.sqlite'),
    vaultPath: path.join(dataDir, 'vault'),
    artifactsDir: path.join(dataDir, 'artifacts'),
    projectsDir: path.join(dataDir, 'projects'),
    backupsDir: path.join(dataDir, 'backups'),
    logsDir: path.join(dataDir, 'logs'),
    enableTestProvider: false,
    enableChatGPTPlanSignIn: false,
  });
  let server: Awaited<ReturnType<typeof createServer>>;
  let outage = true;
  let calls = 0;

  const registerLocalTool = () => {
    server.tools.register({
      id: 'acceptance_local_probe',
      name: 'Acceptance local probe',
      description: 'Deterministic local failure and recovery probe',
      domain: 'test',
      input_schema: { type: 'object', properties: {} },
      permission: 'system.info',
      risk: 'low',
      reversible: true,
      execute: async () => {
        calls++;
        return outage ? fail('Local probe temporarily unavailable') : ok('Local probe recovered');
      },
    });
  };

  beforeAll(async () => {
    server = await createServer(config);
    registerLocalTool();
  });

  afterAll(async () => {
    if (server) {
      await server.app.close();
      server.db.close();
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('surfaces exhausted retries, retains the saved definition, and succeeds after local recovery', async () => {
    const create = await server.app.inject({
      method: 'POST', url: '/api/v1/workflows',
      payload: {
        name: 'Local probe recovery',
        description: 'Saved configuration must survive an execution failure',
        steps: [
          {
            id: 'probe', name: 'Check local probe', kind: 'tool',
            config: { tool: 'acceptance_local_probe', input: {} },
            permissions: ['system.info'],
            retry: { max_attempts: 3, backoff_ms: 1, max_backoff_ms: 2 },
          },
          {
            id: 'after_probe', name: 'Continue after probe', kind: 'transform',
            depends_on: ['probe'], config: { value: 'done' },
          },
        ],
      },
    });
    expect(create.statusCode).toBe(200);
    const definition = create.json() as { id: string; version: number; steps: unknown[] };

    const start = await server.app.inject({ method: 'POST', url: `/api/v1/workflows/${definition.id}/run` });
    expect(start.statusCode).toBe(200);
    const failedRunId = (start.json() as { id: string }).id;
    await server.workflowEngine.wait(failedRunId);

    const failedResponse = await server.app.inject({ method: 'GET', url: `/api/v1/workflow-runs/${failedRunId}` });
    expect(failedResponse.statusCode).toBe(200);
    const failed = failedResponse.json();
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('Local probe temporarily unavailable');
    expect(failed.step_state.probe).toMatchObject({
      status: 'failed', attempts: 3, error: 'Local probe temporarily unavailable', output: null,
    });
    expect(failed.step_state.after_probe).toMatchObject({ status: 'skipped', attempts: 0, output: null });
    expect(calls).toBe(3);

    const activity = await server.app.inject({ method: 'GET', url: '/api/v1/system/activity?limit=100' });
    const runEvents = (activity.json() as { events: Array<{ name: string; workflow_run_id: string }> }).events
      .filter((event) => event.workflow_run_id === failedRunId);
    expect(runEvents.filter((event) => event.name === 'workflow.retrying')).toHaveLength(2);
    expect(runEvents.some((event) => event.name === 'workflow.failed')).toBe(true);

    await server.app.close();
    server.db.close();
    server = await createServer(config);
    registerLocalTool();

    const persistedRun = await server.app.inject({ method: 'GET', url: `/api/v1/workflow-runs/${failedRunId}` });
    expect(persistedRun.json()).toMatchObject({ status: 'failed', error: failed.error });
    const saved = await server.app.inject({ method: 'GET', url: `/api/v1/workflows/${definition.id}` });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ version: definition.version, steps: definition.steps });

    outage = false;
    const recoveredStart = await server.app.inject({ method: 'POST', url: `/api/v1/workflows/${definition.id}/run` });
    expect(recoveredStart.statusCode).toBe(200);
    const recoveredId = (recoveredStart.json() as { id: string }).id;
    await server.workflowEngine.wait(recoveredId);
    const recoveredResponse = await server.app.inject({ method: 'GET', url: `/api/v1/workflow-runs/${recoveredId}` });
    expect(recoveredResponse.json()).toMatchObject({
      status: 'completed', workflow_version: definition.version, error: null,
      step_state: { probe: { status: 'completed', attempts: 1 }, after_probe: { status: 'completed', attempts: 1 } },
    });
    expect(calls).toBe(4);
  });
});
