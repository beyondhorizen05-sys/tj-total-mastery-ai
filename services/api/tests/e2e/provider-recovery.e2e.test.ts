import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer } from '../../src/server/app.js';
import { loadConfig } from '../../src/config.js';
import { TestProviderControl } from '../../src/models/adapters/test-provider.js';

describe('provider recovery over HTTP', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-provider-recovery-e2e-'));
  let server: Awaited<ReturnType<typeof createServer>>;
  let baseUrl: string;

  beforeAll(async () => {
    server = await createServer(loadConfig({
      dataDir,
      dbPath: path.join(dataDir, 'tj.sqlite'),
      vaultPath: path.join(dataDir, 'vault'),
      artifactsDir: path.join(dataDir, 'artifacts'),
      projectsDir: path.join(dataDir, 'projects'),
      backupsDir: path.join(dataDir, 'backups'),
      logsDir: path.join(dataDir, 'logs'),
      enableTestProvider: true,
      enableChatGPTPlanSignIn: false,
    }));
    await server.app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = server.app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    TestProviderControl.failKind = null;
    TestProviderControl.failCount = 0;
    if (server) {
      await server.app.close();
      server.db.close();
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('recovers from a primary outage using the next allowed free model and exposes the recovery event', async () => {
    const providerResponse = await fetch(`${baseUrl}/api/v1/models/providers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Deterministic recovery provider', kind: 'test' }),
    });
    expect(providerResponse.status).toBe(200);
    const provider = await providerResponse.json() as { id: string };
    const refresh = await fetch(`${baseUrl}/api/v1/models/providers/${provider.id}/refresh`, { method: 'POST' });
    expect(refresh.status).toBe(200);
    const models = (await refresh.json() as { models: Array<{ id: string }> }).models;
    const primaryModel = `${provider.id}/tj-test-echo`;
    expect(models.map((model) => model.id)).toEqual(expect.arrayContaining([primaryModel, `${provider.id}/tj-test-planner`]));

    const settings = await fetch(`${baseUrl}/api/v1/settings`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ routing_mode: 'auto', default_model_id: primaryModel, router_priority: 'balanced' }),
    });
    expect(settings.status).toBe(200);

    // Three simulated outage responses consume the primary model's initial
    // call plus two retries. Auto routing may then try the other test model.
    TestProviderControl.failKind = 'unavailable';
    TestProviderControl.failCount = 3;
    const response = await fetch(`${baseUrl}/api/v1/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'chat', content: 'Verify that automatic recovery preserves my free-provider routing.' }),
    });
    expect(response.status).toBe(200);
    const result = await response.json() as { content: string; model_id: string; provider_id: string };
    expect(result.content).toContain('[test-echo]');
    expect(result.provider_id).toBe(provider.id);
    expect(result.model_id).not.toBe(primaryModel);
    expect(TestProviderControl.failCount).toBe(0);

    const selected = await fetch(`${baseUrl}/api/v1/settings`);
    const selectedSettings = (await selected.json() as { settings: Record<string, unknown> }).settings;
    expect(selectedSettings.routing_mode).toBe('auto');
    expect(selectedSettings.default_model_id).toBe(primaryModel);

    const usage = server.db.all<{ model_id: string; success: number }>(
      'SELECT model_id, success FROM usage ORDER BY ts ASC',
    );
    // Usage is recorded per model attempt after the router's three internal
    // retries, while the control confirms each of those retries occurred.
    expect(usage.filter((row) => row.model_id === primaryModel && row.success === 0)).toHaveLength(1);
    expect(usage.at(-1)).toMatchObject({ model_id: result.model_id, success: 1 });

    const activity = await fetch(`${baseUrl}/api/v1/system/activity?limit=100`);
    const events = (await activity.json() as { events: Array<{ name: string; model_id: string | null }> }).events;
    expect(events.some((event) => event.name === 'provider.error' && event.model_id === primaryModel)).toBe(true);
    expect(events.some((event) => event.name === 'model.fallback' && event.model_id === result.model_id)).toBe(true);
  });
});
