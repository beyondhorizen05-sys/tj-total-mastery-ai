import type { Connector, CapabilityStatus, HealthState } from '@tj/schemas';
import type { Database } from '../db/database.js';
import type { Vault } from '../security/vault.js';
import type { ConnectorRuntime } from './sdk.js';
import { brave, github, openweather, tavily } from './builtin-a.js';
import { genericWebhook, homeAssistant, PLANNED, slackWebhook } from './builtin-b.js';

export interface ConnectorServiceDeps {
  db: Database;
  vault: Vault;
}

export class ConnectorService {
  private runtimes = new Map<string, ConnectorRuntime>();

  constructor(private deps: ConnectorServiceDeps) {
    this.register(tavily);
    this.register(brave);
    this.register(openweather);
    this.register(github);
    this.register(homeAssistant);
    this.register(slackWebhook);
    this.register(genericWebhook);
  }

  register(r: ConnectorRuntime) {
    this.runtimes.set(r.manifest.id, r);
  }

  getRuntime(id: string): ConnectorRuntime | undefined {
    return this.runtimes.get(id);
  }

  getPlanned() {
    return PLANNED;
  }

  /**
   * Resolve secret + non-secret config for a connector.
   * Values are stored in vault under `connector:<id>:<field>`.
   */
  async getConfig(connectorId: string): Promise<Record<string, string>> {
    const r = this.runtimes.get(connectorId);
    if (!r) return {};
    const out: Record<string, string> = {};
    for (const f of r.manifest.config_fields) {
      const val = this.deps.vault.get(`connector:${connectorId}:${f.key}`, 'connector_service', 'read_config');
      if (val) out[f.key] = val;
    }
    return out;
  }

  async setConfig(connectorId: string, values: Record<string, string>): Promise<void> {
    const r = this.runtimes.get(connectorId);
    if (!r) throw new Error(`Unknown connector: ${connectorId}`);
    for (const [k, v] of Object.entries(values)) {
      const ref = `connector:${connectorId}:${k}`;
      if (v === '' || v === null || v === undefined) {
        this.deps.vault.delete(ref);
      } else {
        this.deps.vault.put({
          ref,
          label: `${connectorId} ${k}`,
          scope: 'connector',
          value: v,
        });
      }
    }
  }

  /**
   * Compute honest status:
   * - NEEDS_SETUP / NEEDS_API_KEY: missing required fields
   * - CONNECTED / AVAILABLE: all required fields present, health ok
   * - UNAVAILABLE: health test failed
   */
  async get(id: string): Promise<Connector | null> {
    const r = this.runtimes.get(id);
    if (!r) return null;

    const cfg = await this.getConfig(id);
    const configuredKeys = Object.keys(cfg);
    const missing = r.manifest.config_fields
      .filter((f) => f.required && !cfg[f.key])
      .map((f) => f.key);

    // Look up last test health from db if stored, or compute default
    const row = this.deps.db.get<{ health?: string; last_error?: string; last_checked_at?: string }>(
      'SELECT health, last_error, last_checked_at FROM connector_configs WHERE connector_id = ?',
      [id]
    );

    let status: CapabilityStatus = 'NEEDS_API_KEY';
    let health: HealthState = (row?.health as HealthState) ?? 'unknown';

    if (missing.length === 0) {
      status = health === 'degraded' || health === 'offline' ? 'UNAVAILABLE' : 'CONNECTED';
    } else {
      status = r.manifest.auth_scheme === 'none' ? 'AVAILABLE' : 'NEEDS_API_KEY';
    }

    return {
      ...r.manifest,
      status,
      health,
      last_error: row?.last_error ?? null,
      last_checked_at: row?.last_checked_at ?? null,
      configured_keys: configuredKeys,
      missing: missing.length > 0 ? missing.join(', ') : null,
    };
  }

  async list(): Promise<Connector[]> {
    const all: Connector[] = [];
    for (const id of this.runtimes.keys()) {
      const c = await this.get(id);
      if (c) all.push(c);
    }
    return all;
  }

  async test(id: string): Promise<{ ok: boolean; detail: string; latency_ms?: number }> {
    const r = this.runtimes.get(id);
    if (!r) return { ok: false, detail: `Unknown connector: ${id}` };
    const cfg = await this.getConfig(id);
    const missing = r.manifest.config_fields.filter((f) => f.required && !cfg[f.key]);
    if (missing.length > 0) {
      return { ok: false, detail: `Missing required fields: ${missing.map((m) => m.key).join(', ')}` };
    }

    const res = await r.test(cfg);
    const now = new Date().toISOString();
    const health: HealthState = res.ok ? 'healthy' : 'offline';
    const lastError = res.ok ? null : res.detail;

    this.deps.db.run(
      `INSERT INTO connector_configs (connector_id, health, last_error, last_checked_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(connector_id) DO UPDATE SET
         health = excluded.health,
         last_error = excluded.last_error,
         last_checked_at = excluded.last_checked_at,
         updated_at = excluded.updated_at`,
      [id, health, lastError, now, now]
    );

    return res;
  }

  async execute(id: string, actionId: string, input: Record<string, any>): Promise<unknown> {
    const r = this.runtimes.get(id);
    if (!r) throw new Error(`Unknown connector: ${id}`);
    const fn = r.actions[actionId];
    if (!fn) throw new Error(`Unknown action "${actionId}" on connector "${id}"`);
    const cfg = await this.getConfig(id);
    const missing = r.manifest.config_fields.filter((f) => f.required && !cfg[f.key]);
    if (missing.length > 0) {
      throw new Error(`Connector "${id}" is not configured (missing: ${missing.map((m) => m.key).join(', ')})`);
    }
    return await fn(cfg, input);
  }
}

