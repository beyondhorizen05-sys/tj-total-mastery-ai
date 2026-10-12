import { describe, expect, it, vi } from 'vitest';
import { HealthMonitor } from '../src/core/health.js';

function monitor(provider: Record<string, unknown> | Record<string, unknown>[], candidates = [{ id: 'provider/model', provider_id: 'provider', health: 'healthy' }], settingsValues: Record<string, unknown> = {}) {
  const db = {
    get: (sql: string) => sql === 'PRAGMA journal_mode' ? { journal_mode: 'wal' }
      : sql.includes('COUNT(*)') ? { c: 0 } : sql.includes('SUM(cost_usd)') ? { cost: 0 } : { ok: 1 },
  };
  const router = { candidates: vi.fn(() => candidates) };
  const registry = { listProviders: vi.fn(() => [
    ...(Array.isArray(provider) ? provider : [{ id: 'provider', enabled: true, ...provider }]),
  ]) };
  const health = new HealthMonitor({ db: db as never, router: router as never, registry: registry as never, approvals: { pendingCount: () => 0 } as never, settings: { get: (key: string, fallback: unknown) => settingsValues[key] ?? fallback } as never });
  return health;
}

describe('HealthMonitor model-provider freshness', () => {
  it('does not report healthy inference when the provider is currently offline', async () => {
    const status = await monitor({ health: 'offline', last_checked_at: new Date().toISOString(), last_error: 'connection refused' }).getStatus();
    expect(status.components.find((component) => component.component === 'model_router')).toMatchObject({ state: 'offline', detail: expect.stringContaining('provider connectivity check failed') });
  });

  it('reports stale provider health as unknown instead of trusting historical model success', async () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const status = await monitor({ health: 'healthy', last_checked_at: stale }).getStatus();
    expect(status.components.find((component) => component.component === 'model_router')).toMatchObject({ state: 'unknown', detail: expect.stringContaining('stale') });
  });

  it('reports healthy after a recent provider check and a prior successful model inference', async () => {
    const status = await monitor({ health: 'healthy', last_checked_at: new Date().toISOString() }).getStatus();
    expect(status.components.find((component) => component.component === 'model_router')).toMatchObject({ state: 'healthy', detail: expect.stringContaining('model has prior inference success') });
  });

  it('reports router ready after fresh provider reachability and model discovery without probing inference', async () => {
    const status = await monitor({ health: 'healthy', last_checked_at: new Date().toISOString() }, [
      { id: 'provider/model', provider_id: 'provider', health: 'unknown' },
    ]).getStatus();
    expect(status.components.find((component) => component.component === 'model_router')).toMatchObject({
      state: 'healthy', detail: expect.stringContaining('inference has not been tested'),
    });
  });

  it('stays healthy when a verified fallback route works despite another provider being offline', async () => {
    const providers = [
      { id: 'offline', health: 'offline', last_checked_at: new Date().toISOString() },
      { id: 'fallback', health: 'healthy', last_checked_at: new Date().toISOString() },
    ];
    const candidates = [
      { id: 'offline/model', provider_id: 'offline', health: 'healthy' },
      { id: 'fallback/model', provider_id: 'fallback', health: 'healthy' },
    ];
    const status = await monitor(providers, candidates).getStatus();
    expect(status.components.find((component) => component.component === 'model_router')).toMatchObject({ state: 'healthy' });
  });

  it('checks the selected manual model instead of reporting a healthy fallback route', async () => {
    const providers = [
      { id: 'selected', health: 'offline', last_checked_at: new Date().toISOString() },
      { id: 'fallback', health: 'healthy', last_checked_at: new Date().toISOString() },
    ];
    const candidates = [
      { id: 'selected/model', provider_id: 'selected', health: 'healthy' },
      { id: 'fallback/model', provider_id: 'fallback', health: 'healthy' },
    ];
    const status = await monitor(providers, candidates, { routing_mode: 'manual', default_model_id: 'selected/model' }).getStatus();
    expect(status.current_model_id).toBe('selected/model');
    expect(status.components.find((component) => component.component === 'model_router')).toMatchObject({ state: 'offline' });
  });
});
