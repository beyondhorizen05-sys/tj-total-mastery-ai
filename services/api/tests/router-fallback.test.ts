import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../src/db/database.js';
import { EventBus } from '../src/core/event-bus.js';
import { Logger } from '../src/core/logger.js';
import { Vault } from '../src/security/vault.js';
import { SettingsRepo } from '../src/db/repo.js';
import { ModelRegistry } from '../src/models/registry.js';
import { ModelRouter } from '../src/models/router.js';
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
});

