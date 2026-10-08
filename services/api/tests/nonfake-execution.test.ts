import { describe, it, expect } from 'vitest';
import { Database } from '../src/db/database.js';
import { EventBus } from '../src/core/event-bus.js';
import { SettingsRepo } from '../src/db/repo.js';
import { Audit } from '../src/security/audit.js';
import { PermissionEngine } from '../src/security/permissions.js';
import { ApprovalService } from '../src/security/approvals.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { fail, ok } from '../src/tools/types.js';
import { AgentRuntime } from '../src/agents/runtime.js';
import type { AgentService } from '../src/agents/service.js';
import type { Agent } from '@tj/schemas';
import { ModelRouter } from '../src/models/router.js';
import type { ModelRegistry } from '../src/models/registry.js';
import { WorkflowEngine } from '../src/workflows/engine.js';
import { registerBuiltinStepExecutors, type StepExecutorDeps } from '../src/workflows/executors.js';
import { step } from './helpers/steps.js';
import { writeVerificationGap } from '../src/tools/builtin/computer.js';

describe('No fake success and privacy boundaries', () => {
  it('does not claim a computer write succeeded from pre-existing text or a changed window', () => {
    const before = { foreground_handle: 17, elements: ['Edit: draft value=hello [1,2,3,4]'] };
    expect(writeVerificationGap(before, { foreground_handle: 17, elements: ['Edit: draft value=hello [1,2,3,4]'] }, 'hello')).toMatch(/already visible/);
    expect(writeVerificationGap({ foreground_handle: 17, elements: [] }, { foreground_handle: 18, elements: ['Edit: value=hello'] }, 'hello')).toMatch(/window changed/);
    expect(writeVerificationGap({ foreground_handle: 17, elements: [] }, { foreground_handle: 17, elements: ['Edit: value=hello'] }, 'hello')).toBeNull();
  });
  it('does not persist text typed through computer tools in Activity events', async () => {
    const db = new Database(':memory:'); db.migrate();
    const bus = new EventBus(db);
    const audit = new Audit(db);
    const settings = new SettingsRepo(db);
    const permissions = new PermissionEngine(db, audit, settings);
    const tools = new ToolRegistry(permissions, new ApprovalService(db, bus, audit, permissions), bus, audit);
    tools.register({ id: 'computer_write', name: 'Write in app', domain: 'computer', description: 'Test write', input_schema: {}, permission: 'system.info', risk: 'low', reversible: false, execute: async () => ok('done') });
    const secret = 'private text that must stay out of Activity';
    const result = await tools.execute('computer_write', { text: secret }, { workspace_id: 'default', project_id: null, project_root: null, agent_id: null, agent_permissions: null, task_id: null, workflow_run_id: null });
    expect(result.ok).toBe(true);
    const event = bus.query({ name: 'tool.called' })[0];
    expect(event.data.args).toMatchObject({ text: `[REDACTED: ${secret.length} characters]` });
    expect(JSON.stringify(event)).not.toContain(secret);
    db.close();
  });

  it('delivers voice transcripts live without storing dictated text in Activity', () => {
    const db = new Database(':memory:'); db.migrate();
    const bus = new EventBus(db);
    let delivered = '';
    bus.on('voice.transcript', (event) => { delivered = event.summary; });
    const spoken = 'private dictated sentence';
    bus.emit({ name: 'voice.transcript', summary: spoken });
    expect(delivered).toBe(spoken);
    expect(bus.query({ name: 'voice.transcript' })).toHaveLength(0);
    db.close();
  });

  it('does not complete an agent run after an unverified computer write', async () => {
    const db = new Database(':memory:'); db.migrate();
    const bus = new EventBus(db);
    const audit = new Audit(db);
    const settings = new SettingsRepo(db);
    const permissions = new PermissionEngine(db, audit, settings);
    const tools = new ToolRegistry(permissions, new ApprovalService(db, bus, audit, permissions), bus, audit);
    tools.register({ id: 'computer_write', name: 'Write in app', domain: 'computer', description: 'Test write', input_schema: {}, permission: 'system.info', risk: 'low', reversible: false, execute: async () => fail('Visible text could not be verified') });
    let calls = 0;
    const router = { chat: async () => {
      calls++;
      return { text: calls === 1 ? '' : 'The task is done.', tool_calls: calls === 1 ? [{ id: 'call-1', name: 'computer_write', arguments: { text: 'hello' } }] : [], usage: { tokens_in: 1, tokens_out: 1 }, cost_usd: 0, model_id: 'test/model' };
    } } as unknown as ModelRouter;
    const agents = { setStatus: () => {}, addMetrics: () => {}, get: () => null } as unknown as AgentService;
    const agent = { id: 'test-agent', name: 'Test', role: 'operator', description: '', personality: '', system_instructions: '', tools: ['computer_write'], permissions: ['system.info'], model_id: 'test/model' } as unknown as Agent;
    const result = await new AgentRuntime(router, tools, agents, bus, settings).run({ agent, instruction: 'write hello', workspace_id: 'default', project_id: null, project_root: null, task_id: null, max_steps: 3 });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/could not verify completion/i);
    expect(result.tool_calls).toEqual(expect.arrayContaining([expect.objectContaining({ tool: 'computer_write', ok: false })]));
    db.close();
  });

  it('marks a workflow failed when a tool reports ok=false', async () => {
    const db = new Database(':memory:'); db.migrate();
    const bus = new EventBus(db);
    const engine = new WorkflowEngine(db, bus, () => 'default');
    registerBuiltinStepExecutors(engine, { tools: { execute: async () => ({ ok: false, output: 'ERROR: denied', error: 'denied' }) } } as unknown as StepExecutorDeps);
    const workflow = engine.save({ name: 'blocked write', steps: [step('write', [], { config: { tool: 'fs_write' } })] });
    const result = await engine.wait(engine.start(workflow.id).id);
    expect(result.status).toBe('failed');
    expect(result.step_state.write.status).toBe('failed');
    expect(result.step_state.write.error).toContain('denied');
    db.close();
  });

  it('rejects unsupported workflow steps before saving', () => {
    const db = new Database(':memory:'); db.migrate();
    const engine = new WorkflowEngine(db, new EventBus(db), () => 'default');
    engine.registerExecutor('tool', async () => 'ok');
    expect(() => engine.save({ name: 'unsupported', steps: [step('future', [], { kind: 'subworkflow' })] })).toThrow(/not available/);
    db.close();
  });

  it('cannot force a cloud model through local-only privacy mode', () => {
    const db = new Database(':memory:'); db.migrate();
    const settings = new SettingsRepo(db);
    settings.set('privacy_mode', 'local-only'); settings.set('routing_mode', 'manual'); settings.set('default_model_id', 'cloud/model');
    const registry = {
      listProviders: () => [{ id: 'cloud', enabled: true, health: 'healthy', requires_api_key: false }],
      listModels: () => [{ id: 'cloud/model', provider_id: 'cloud', model: 'model', privacy_class: 'cloud' }],
    } as unknown as ModelRegistry;
    const router = new ModelRouter(registry, settings, new EventBus(db));
    expect(() => router.route({ task_type: 'chat' })).toThrow(/unavailable under the current/);
    db.close();
  });

  it('does not route batch-only model IDs to chat completions', () => {
    const db = new Database(':memory:'); db.migrate();
    const registry = {
      listProviders: () => [{ id: 'cloud', enabled: true, health: 'healthy', requires_api_key: false }],
      listModels: () => [
        { id: 'cloud/gemini:batch', provider_id: 'cloud', model: 'gemini:batch', privacy_class: 'cloud' },
        { id: 'cloud/gemini', provider_id: 'cloud', model: 'gemini', privacy_class: 'cloud' },
      ],
    } as unknown as ModelRegistry;
    const router = new ModelRouter(registry, new SettingsRepo(db), new EventBus(db));
    expect(router.candidates({ task_type: 'chat' }).map((model) => model.id)).toEqual(['cloud/gemini']);
    db.close();
  });

  it('never falls back from an explicitly selected free model to a paid model', () => {
    const db = new Database(':memory:'); db.migrate();
    const registry = {
      listProviders: () => [{ id: 'cloud', enabled: true, health: 'healthy', requires_api_key: false }],
      listModels: () => [
        { id: 'cloud/free:free', provider_id: 'cloud', model: 'free:free', privacy_class: 'cloud' },
        { id: 'cloud/paid', provider_id: 'cloud', model: 'paid', privacy_class: 'cloud' },
      ],
    } as unknown as ModelRegistry;
    const router = new ModelRouter(registry, new SettingsRepo(db), new EventBus(db));
    expect(router.route({ task_type: 'chat', model_id: 'cloud/free:free' }).chain.map((model) => model.id)).toEqual(['cloud/free:free']);
    db.close();
  });

  it('requires approval for high-risk actions even with an allow policy', () => {
    const db = new Database(':memory:'); db.migrate();
    const settings = new SettingsRepo(db);
    const permissions = new PermissionEngine(db, new Audit(db), settings);
    permissions.addPolicy({ name: 'publish', permission: 'external.publish', resource: null, agent: null, decision: 'allow', scope: 'global', expires_at: null });
    expect(permissions.evaluate({ permission: 'external.publish', resource: 'slack:post' }).decision).toBe('require_approval');
    settings.set('privacy_mode', 'local-only');
    expect(permissions.evaluate({ permission: 'network.http', resource: 'https://example.com' }).decision).toBe('deny');
    db.close();
  });
});
