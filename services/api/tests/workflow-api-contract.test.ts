import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';

describe('workflow HTTP error contract', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-workflow-contract-'));
  const config = loadConfig({
    dataDir,
    dbPath: path.join(dataDir, 'tj.sqlite'),
    vaultPath: path.join(dataDir, 'vault'),
    artifactsDir: path.join(dataDir, 'artifacts'),
    projectsDir: path.join(dataDir, 'projects'),
    backupsDir: path.join(dataDir, 'backups'),
    logsDir: path.join(dataDir, 'logs'),
    enableTestProvider: true,
    enableChatGPTPlanSignIn: false,
  });
  let server: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    server = await createServer(config);
    const added = await server.app.inject({ method: 'POST', url: '/api/v1/models/providers', payload: { name: 'Deterministic workflow test', kind: 'test' } });
    const providerId = added.json().id as string;
    await server.app.inject({ method: 'POST', url: `/api/v1/models/providers/${providerId}/test` });
    await server.app.inject({ method: 'POST', url: `/api/v1/models/providers/${providerId}/refresh` });
  });
  afterAll(async () => {
    if (server) { await server.app.close(); server.db.close(); }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('rejects invalid create and update requests without replacing a saved definition', async () => {
    const invalidCreate = await server.app.inject({ method: 'POST', url: '/api/v1/workflows', payload: { name: 'Bad', steps: [{ id: 'x', kind: 'imaginary' }] } });
    expect(invalidCreate.statusCode).toBe(400);
    expect(invalidCreate.json().error).toBeTruthy();

    const created = await server.app.inject({ method: 'POST', url: '/api/v1/workflows', payload: {
      name: 'Stable definition', steps: [{ id: 'first', name: 'First', kind: 'transform', config: { value: 'kept' } }],
    } });
    expect(created.statusCode).toBe(200);
    const saved = created.json() as { id: string; version: number; steps: unknown[] };

    const invalidUpdate = await server.app.inject({ method: 'POST', url: '/api/v1/workflows', payload: {
      id: saved.id, name: 'Bad update', steps: [{ id: 'cycle', name: 'Cycle', kind: 'transform', depends_on: ['cycle'] }],
    } });
    expect(invalidUpdate.statusCode).toBe(400);
    expect(invalidUpdate.json().error).toContain('Cycle');
    const after = await server.app.inject({ method: 'GET', url: `/api/v1/workflows/${saved.id}` });
    expect(after.json()).toMatchObject({ name: 'Stable definition', version: saved.version, steps: saved.steps });

    const badInputs = await server.app.inject({ method: 'POST', url: `/api/v1/workflows/${saved.id}/run`, payload: { inputs: 'not an object' } });
    expect(badInputs.statusCode).toBe(400);
    const runs = await server.app.inject({ method: 'GET', url: `/api/v1/workflow-runs?workflow_id=${saved.id}` });
    expect(runs.json().runs).toEqual([]);
  });

  it('returns 404 for nonexistent workflow and run actions', async () => {
    const start = await server.app.inject({ method: 'POST', url: '/api/v1/workflows/absent/run', payload: {} });
    expect(start.statusCode).toBe(404);
    for (const action of ['pause', 'resume', 'cancel']) {
      const response = await server.app.inject({ method: 'POST', url: `/api/v1/workflow-runs/absent/${action}`, payload: {} });
      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('Run not found');
    }
  });

  it('builds a daily agent workflow from one prompt and reuses deployed specialists', async () => {
    const payload = { prompt: 'Research, implement, and test a small local feature', time: '08:15', timezone: 'Asia/Dubai' };
    const first = await server.app.inject({ method: 'POST', url: '/api/v1/workflows/from-prompt', payload });
    expect(first.statusCode, JSON.stringify(first.json())).toBe(201);
    const created = first.json() as { workflow: { id: string; steps: Array<{ kind: string; config: { agent_id: string } }> }; automation: { enabled: boolean; trigger: { config: Record<string, unknown> } }; planner_source: string };
    expect(created.workflow.steps.length).toBeGreaterThan(0);
    expect(created.workflow.steps.every((step) => step.kind === 'agent' && step.config.agent_id)).toBe(true);
    expect(created.automation.enabled).toBe(true);
    expect(created.automation.trigger.config).toMatchObject({ cron: '15 8 * * *', timezone: 'Asia/Dubai' });
    expect(['model', 'fallback']).toContain(created.planner_source);

    const second = await server.app.inject({ method: 'POST', url: '/api/v1/workflows/from-prompt', payload });
    expect(second.statusCode).toBe(201);
    const secondIds = (second.json() as typeof created).workflow.steps.map((step) => step.config.agent_id).sort();
    expect(secondIds).toEqual(created.workflow.steps.map((step) => step.config.agent_id).sort());
    const allAgents = server.agentService.list();
    expect(new Set(created.workflow.steps.map((step) => step.config.agent_id)).size).toBe(created.workflow.steps.length);
    expect(allAgents.length).toBe(created.workflow.steps.length);
  });

  it('validates timezone and exposes guarded manual agent deletion', async () => {
    const invalidTimezone = await server.app.inject({ method: 'POST', url: '/api/v1/workflows/from-prompt', payload: { prompt: 'Create a daily local check', time: '08:00', timezone: 'Mars/Olympus' } });
    expect(invalidTimezone.statusCode).toBe(400);

    const agent = server.agentService.create({ workspace_id: 'default', name: 'Duplicate Analyst', role: 'Analyst' });
    server.agentService.setStatus(agent.id, 'working', 'active-task');
    const blocked = await server.app.inject({ method: 'DELETE', url: `/api/v1/agents/${agent.id}` });
    expect(blocked.statusCode).toBe(409);
    server.agentService.setStatus(agent.id, 'idle', null);
    const deleted = await server.app.inject({ method: 'DELETE', url: `/api/v1/agents/${agent.id}` });
    expect(deleted.statusCode).toBe(200);
    const missing = await server.app.inject({ method: 'DELETE', url: `/api/v1/agents/${agent.id}` });
    expect(missing.statusCode).toBe(404);
  });

  it('deploys one fully equipped Orchestrator with computer and self-improvement tools', async () => {
    const first = await server.app.inject({ method: 'POST', url: '/api/v1/agents', payload: { template_id: 'orchestrator' } });
    const second = await server.app.inject({ method: 'POST', url: '/api/v1/agents', payload: { template_id: 'orchestrator' } });
    expect(first.statusCode, JSON.stringify(first.json())).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    const orchestrator = first.json() as { tools: string[]; permissions: string[]; system_instructions: string };
    expect(orchestrator.tools).toEqual(expect.arrayContaining(['computer_observe', 'computer_read_screen', 'tj_self_improve']));
    expect(orchestrator.tools).toContain('github_inspect_repository');
    expect(orchestrator.system_instructions).toMatch(/SKILL\.md/i);
    expect(orchestrator.system_instructions).toMatch(/license compatibility/i);
    expect(orchestrator.system_instructions).toMatch(/original TJ-native implementation/i);
    expect(orchestrator.system_instructions).toMatch(/never execute downloaded scripts/i);
    expect(orchestrator.permissions).toContain('computer.control');
    expect(server.tools.get('tj_self_improve')?.risk).toBe('high');
    expect(server.tools.get('tj_self_improve')?.permission).toBe('code.execute');
  });

  it('reuses an existing role across projects instead of deploying a duplicate', () => {
    const first = server.orchestrator.ensureAgentForRole('Shared Specialist', 'project-one');
    const second = server.orchestrator.ensureAgentForRole('Shared Specialist', 'project-two');
    expect(second.id).toBe(first.id);
    expect(server.agentService.list().filter((agent) => agent.role === 'Shared Specialist')).toHaveLength(1);
  });
});
