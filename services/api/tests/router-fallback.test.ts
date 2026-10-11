import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../src/db/database.js';
import { EventBus } from '../src/core/event-bus.js';
import { Logger } from '../src/core/logger.js';
import { Vault } from '../src/security/vault.js';
import { SettingsRepo } from '../src/db/repo.js';
import { ModelRegistry } from '../src/models/registry.js';
import { ModelRouter } from '../src/models/router.js';
import { TestProviderControl } from '../src/models/adapters/test-provider.js';
import { ProviderError } from '../src/models/types.js';
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
  it('runs a non-native-tool model through validated structured adapter', async () => {
    db.run('UPDATE models SET supports_tools=0 WHERE id=?', ['test/tj-test-echo']);
    const adapter = registry.adapter('test');
    const mock = vi.spyOn(adapter, 'chat').mockResolvedValue({
      text: JSON.stringify({ type: 'tool_call', name: 'fs_read', arguments: { path: 'notes.txt' } }),
      tool_calls: [], finish_reason: 'stop',
      usage: { tokens_in: 12, tokens_out: 10 }, latency_ms: 1, raw_model: 'tj-test-echo',
    });
    const result = await router.chat(
      { task_type: 'chat', model_id: 'test/tj-test-echo', needs_tools: true, allow_emulated_tools: true },
      { messages: [{ role: 'user', content: 'Read notes.txt' }], tools: [{
        name: 'fs_read', description: 'Read', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      }] },
    );
    expect(result.tool_calls).toMatchObject([{ name: 'fs_read', arguments: { path: 'notes.txt' } }]);
    expect(mock.mock.calls[0]?.[0].tools).toBeUndefined();
    expect(mock.mock.calls[0]?.[0].messages[0]?.content).toContain('structured');
  });

  it('does not execute or accept a malicious tool request from non-native models', async () => {
    db.run('UPDATE models SET supports_tools=0 WHERE id=?', ['test/tj-test-echo']);
    const adapter = registry.adapter('test');
    vi.spyOn(adapter, 'chat').mockResolvedValue({
      text: '{"type":"tool_call","name":"shell_exec","arguments":{"command":"echo unsafe"}}',
      tool_calls: [], finish_reason: 'stop',
      usage: { tokens_in: 12, tokens_out: 10 }, latency_ms: 1, raw_model: 'tj-test-echo',
    });
    await expect(router.chat(
      { task_type: 'chat', model_id: 'test/tj-test-echo', needs_tools: true, allow_emulated_tools: true },
      { messages: [{ role: 'user', content: 'Read notes.txt' }], tools: [{
        name: 'fs_read', description: 'Read', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      }] },
    )).rejects.toThrow(/Rejected generated tool arguments/);
  });

  it('enforces free/local routing and rejects costly explicit selections while free-only is on', async () => {
    db.run("UPDATE models SET cost_class='high' WHERE provider_id='test'");
    settings.set('router_free_only_enabled', true);
    expect(router.candidates({ task_type: 'chat' })).toHaveLength(0);
    await expect(router.chat({ task_type: 'chat', model_id: 'test/tj-test-echo' },
      { messages: [{ role: 'user', content: 'Hello' }] })).rejects.toThrow(/unavailable/);
    db.run("UPDATE models SET cost_class='free' WHERE provider_id='test'");
    expect(router.candidates({ task_type: 'chat' }).length).toBeGreaterThan(0);
    const result = await router.chat({ task_type: 'chat', model_id: 'test/tj-test-echo' },
      { messages: [{ role: 'user', content: 'Hello' }] });
    expect(result.text).toContain('[test-echo]');
  });

  it('never retries or falls back after a partial streamed model response', async () => {
    const adapter = registry.adapter('test');
    const calls = vi.spyOn(adapter, 'chat').mockImplementation(async (options) => {
      options.onDelta?.('already visible');
      throw new ProviderError('stream connection lost', 'unavailable');
    });
    await expect(router.chat({ task_type: 'chat' }, {
      messages: [{ role: 'user', content: 'stream' }], onDelta: () => {},
    })).rejects.toThrow(/stream connection lost/);
    expect(calls).toHaveBeenCalledTimes(1);
  });
  it('does not retry after cancellation even for retryable provider failures', async () => {
    const adapter = registry.adapter('test');
    const ctrl = new AbortController();
    const calls = vi.spyOn(adapter, 'chat').mockImplementation(async () => {
      ctrl.abort();
      throw new ProviderError('temporary provider issue', 'rate_limit');
    });
    await expect(router.chat({ task_type: 'chat' }, {
      messages: [{ role: 'user', content: 'stop' }], signal: ctrl.signal,
    })).rejects.toThrow(/temporary/);
    expect(calls).toHaveBeenCalledTimes(1);
  });

});

