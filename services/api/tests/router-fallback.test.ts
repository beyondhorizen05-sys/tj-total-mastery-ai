import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../src/db/database.js';
import { EventBus } from '../src/core/event-bus.js';
import { Logger } from '../src/core/logger.js';
import { Vault } from '../src/security/vault.js';
import { SettingsRepo } from '../src/db/repo.js';
import { ModelRegistry } from '../src/models/registry.js';
import { ModelRouter } from '../src/models/router.js';
import { ApprovalService } from '../src/security/approvals.js';
import { Audit } from '../src/security/audit.js';
import { PermissionEngine } from '../src/security/permissions.js';
import { TestProviderControl } from '../src/models/adapters/test-provider.js';
import fs from 'node:fs';
import path from 'node:path';

describe('ModelRouter Failover & Fallback', () => {
  let db: Database;
  let vault: Vault;
  let bus: EventBus;
  let log: Logger;
  let settings: SettingsRepo;
  let registry: ModelRegistry;
  let router: ModelRouter;
  const testDir = path.resolve('tests/tmp-router');

  beforeEach(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    db = new Database(path.join(testDir, 'test.sqlite'));
    db.migrate();
    bus = new EventBus(db);
    log = new Logger('test');
    vault = new Vault(db, path.join(testDir, 'vault'));
    settings = new SettingsRepo(db);

    registry = new ModelRegistry(db, vault, bus, log, true); // enableTestProvider = true
    registry.bootstrapFromEnv();
    await registry.fetchModels('test');

    router = new ModelRouter(registry, settings, bus);
    TestProviderControl.failKind = null;
    TestProviderControl.failCount = 0;
  });

  afterEach(() => {
    TestProviderControl.failKind = null;
    TestProviderControl.failCount = 0;
    try {
      db.close();
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('successfully routes chat through deterministic test provider', async () => {
    const res = await router.chat({ task_type: 'chat' }, {
      messages: [{ role: 'user', content: 'Hello TJ' }],
    });

    expect(res.text).toContain('[test-echo] Hello TJ');
    expect(res.provider_id).toBe('test');
  });

  it('reuses an already approved paid model instead of requesting a fresh approval for each ordinary chat', async () => {
    const audit = new Audit(db);
    const approvalService = new ApprovalService(db, bus, audit, new PermissionEngine(db, audit, settings));
    const routed = new ModelRouter(registry, settings, bus, approvalService);
    const approval = approvalService.request({
      workspace_id: 'default',
      project_id: null,
      agent_id: null,
      task_id: null,
      workflow_run_id: null,
      action: 'Use paid or unpriced AI model',
      target: 'test/tj-test-echo',
      why: 'Reuse the approved model for ordinary chat.',
      tools: ['model.inference'],
      resources_affected: ['test'],
      estimated_cost: '$0.000021 maximum estimate for this request',
      risks: ['The provider may charge for this inference'],
      rollback_available: false,
      permission: 'payments.execute',
      risk: 'high',
      payload: { model_id: 'test/tj-test-echo', provider_id: 'test' },
    });
    approvalService.decide(approval.id, 'approve_workflow');
    db.run('UPDATE model_providers SET privacy_class = ? WHERE id = ?', ['cloud', 'test']);
    db.run('UPDATE models SET privacy_class = ?, cost_class = ?, price_in_per_m = ?, price_out_per_m = ? WHERE id = ?', ['cloud', 'unknown', 20, 20, 'test/tj-test-echo']);

    const requestSpy = vi.spyOn(approvalService, 'request').mockImplementation(() => {
      throw new Error('Fresh approval should not be requested when the model was already approved.');
    });

    for (let i = 0; i < 20; i++) {
      const res = await routed.chat({ task_type: 'chat', model_id: 'test/tj-test-echo' }, {
        messages: [{ role: 'user', content: `This should reuse the prior approval ${i + 1}` }],
      });
      expect(res.model_id).toBe('test/tj-test-echo');
      expect(res.text).toContain(`This should reuse the prior approval ${i + 1}`);
    }

    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('does not reuse an approve-once decision as permanent model authorization', async () => {
    const audit = new Audit(db);
    const approvalService = new ApprovalService(db, bus, audit, new PermissionEngine(db, audit, settings));
    const routed = new ModelRouter(registry, settings, bus, approvalService);
    const approval = approvalService.request({
      workspace_id: 'default', project_id: null, agent_id: null, task_id: null, workflow_run_id: null,
      action: 'Use paid or unpriced AI model', target: 'test/tj-test-echo',
      why: 'One-time approval semantics regression.', tools: ['model.inference'], resources_affected: ['test'],
      estimated_cost: '$0.000021 maximum estimate for this request', risks: ['The provider may charge for this inference'],
      rollback_available: false, permission: 'payments.execute', risk: 'high',
      payload: { model_id: 'test/tj-test-echo', provider_id: 'test' },
    });
    approvalService.decide(approval.id, 'approve_once');
    db.run('UPDATE model_providers SET privacy_class = ? WHERE id = ?', ['cloud', 'test']);
    db.run('UPDATE models SET privacy_class = ?, cost_class = ?, price_in_per_m = ?, price_out_per_m = ? WHERE id = ?', ['cloud', 'unknown', 20, 20, 'test/tj-test-echo']);

    const inference = routed.chat({ task_type: 'chat', model_id: 'test/tj-test-echo' }, {
      messages: [{ role: 'user', content: 'A new turn requires a new one-time approval.' }],
    });
    const pending = approvalService.list('pending').find((item) => item.target === 'test/tj-test-echo');
    expect(pending).toBeDefined();
    approvalService.decide(pending!.id, 'approve_once');
    await expect(inference).resolves.toMatchObject({ model_id: 'test/tj-test-echo' });
  });

  it('never auto-routes or falls back to the connected subscription plan unless explicitly selected', () => {
    const plan = registry.addProvider({ id: 'plan-test', name: 'Subscription plan test', kind: 'chatgpt-plan' });
    const modelId = `${plan.id}/subscription-model`;
    db.run(`INSERT INTO models (id, provider_id, model, display_name, modalities, supports_tools, supports_streaming, supports_vision, context_length, speed_class, quality_class, cost_class, privacy_class, available, discovered_at, health)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [modelId, plan.id, 'subscription-model', 'Subscription Model', '["text"]', 1, 0, 0, 128_000, 'medium', 'frontier', 'unknown', 'cloud', 1, new Date().toISOString(), 'healthy']);

    expect(router.candidates({ task_type: 'chat' }).some((model) => model.id === modelId)).toBe(false);
    settings.set('routing_mode', 'manual');
    settings.set('default_model_id', modelId);
    expect(router.route({ task_type: 'chat' }).model.id).toBe(modelId);
    settings.set('routing_mode', 'auto');
    expect(router.candidates({ task_type: 'chat' }).some((model) => model.id === modelId)).toBe(false);
  });

  it('explains when manual selection cannot run a tool-using task without switching models', () => {
    settings.set('routing_mode', 'manual');
    settings.set('default_model_id', 'test/tj-test-echo');
    db.run('UPDATE models SET supports_tools = 0 WHERE id = ?', ['test/tj-test-echo']);

    expect(() => router.route({ task_type: 'coding', needs_tools: true })).toThrow(/selected model .* does not support tool calling.*kept your manual model selection and did not switch providers/i);
    expect(router.route({ task_type: 'chat', needs_tools: false }).model.id).toBe('test/tj-test-echo');
    expect(settings.get('default_model_id', null)).toBe('test/tj-test-echo');
    expect(settings.get('routing_mode', null)).toBe('manual');
  });

  it('stores and replaces a custom provider API key in the vault', () => {
    const provider = registry.addProvider({ name: 'FreeLLM Router', kind: 'openai-compatible', base_url: 'https://router.example.test/v1', api_key: 'first-test-key' });
    expect(provider.credential_ref).toBeTruthy();
    expect(vault.get(provider.credential_ref!, `provider:${provider.id}`, 'test')).toBe('first-test-key');
    const updated = registry.updateProvider(provider.id, { api_key: 'replacement-test-key' });
    expect(updated.credential_ref).toBe(provider.credential_ref);
    expect(vault.get(updated.credential_ref!, `provider:${provider.id}`, 'test')).toBe('replacement-test-key');
    expect(updated.health).toBe('unknown');
  });

  it('records health penalty when failure occurs and tracks error', async () => {
    // Put test provider in failure mode
    TestProviderControl.failKind = 'unavailable';
    TestProviderControl.failCount = 1;

    let caught = false;
    try {
      await router.chat({ task_type: 'chat' }, {
        messages: [{ role: 'user', content: 'FAIL:unavailable test' }],
      });
    } catch (e: any) {
      caught = true;
      expect(e.message).toContain('unavailable');
    }
    expect(caught).toBe(true);

    const m = registry.getModel('test/tj-test-echo');
    expect(m?.failure_count).toBeGreaterThan(0);
  });

  it('restores provider health when an allowed same-provider fallback succeeds', async () => {
    TestProviderControl.failKind = 'unavailable';
    TestProviderControl.failCount = 3; // Exhaust the primary model's three retry attempts.

    const result = await router.chat({ task_type: 'chat', prefer: 'quality' }, {
      messages: [{ role: 'user', content: 'Recover using the next allowed model.' }],
    });

    expect(result.fallback_from).toBeTruthy();
    expect(result.model_id).not.toBe(result.fallback_from);
    expect(registry.getModel(result.fallback_from!)?.health).toBe('degraded');
    expect(registry.getModel(result.model_id)?.health).toBe('healthy');
    expect(registry.getProvider('test')?.health).toBe('healthy');
  });

  it('blocks a manually selected model before calling it when the estimated request exceeds the cap', async () => {
    settings.set('routing_mode', 'manual');
    settings.set('default_model_id', 'test/tj-test-echo');
    settings.set('max_request_cost_usd', 0.01);
    // Simulate a known-price provider so this exercises the cap calculation,
    // not the separate unknown-price refusal path.
    db.run('UPDATE models SET price_in_per_m = ?, price_out_per_m = ? WHERE id = ?', [20, 20, 'test/tj-test-echo']);

    const before = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM usage WHERE model_id = ?', ['test/tj-test-echo'])?.count ?? 0;
    await expect(router.chat({ task_type: 'chat' }, {
      messages: [{ role: 'user', content: 'This request should exceed the configured spend cap.' }],
    })).rejects.toThrow(/exceeds the configured estimated spending limit/i);
    const after = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM usage WHERE model_id = ?', ['test/tj-test-echo'])?.count ?? 0;
    expect(after).toBe(before);
  });
});

