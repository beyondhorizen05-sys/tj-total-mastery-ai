import type { Model, ModelProvider, ProviderKind } from '@tj/schemas';
import type { Database } from '../db/database.js';
import type { Vault } from '../security/vault.js';
import type { EventBus } from '../core/event-bus.js';
import type { Logger } from '../core/logger.js';
import { uuid, now } from '../core/ids.js';
import { mapRow } from '../db/repo.js';
import { PROVIDER_PRESETS, presetById, hintFor } from './presets.js';
import type { ProviderAdapter, ProviderCredentials, DiscoveredModel } from './types.js';
import { createAdapter } from './adapters/factory.js';
import { ChatGPTPlanAdapter } from './adapters/chatgpt-plan.js';
import type { ChatGPTPlanService } from './chatgpt-plan.js';

const MODEL_JSON = ['modalities'];
const MODEL_BOOL = ['supports_tools', 'supports_streaming', 'supports_vision', 'available'];

/** Model Registry (Spec §5): providers, discovered models, health, latency, usage & cost. */
export class ModelRegistry {
  private adapterCache = new Map<string, ProviderAdapter>();

  constructor(private db: Database, private vault: Vault, private bus: EventBus, private log: Logger, private enableTestProvider: boolean, private chatgptPlan?: ChatGPTPlanService) {}

  presets() { return PROVIDER_PRESETS; }

  // ---------- providers ----------
  listProviders(): ModelProvider[] {
    return this.db.all<any>('SELECT * FROM model_providers ORDER BY created_at').map((r) => mapRow<ModelProvider>(r, [], ['requires_api_key', 'enabled']));
  }
  getProvider(id: string): ModelProvider | undefined {
    const r = this.db.get<any>('SELECT * FROM model_providers WHERE id = ?', [id]);
    return r ? mapRow<ModelProvider>(r, [], ['requires_api_key', 'enabled']) : undefined;
  }

  addProvider(input: { name: string; kind: ProviderKind; preset?: string | null; base_url?: string | null; api_key?: string | null; organization?: string | null; id?: string }): ModelProvider {
    const preset = presetById(input.preset);
    if (input.kind === 'test' && !this.enableTestProvider) throw new Error('Test provider is disabled (set TJ_ENABLE_TEST_PROVIDER=1)');
    const id = input.id ?? (preset && !this.getProvider(preset.id) ? preset.id : `prov_${uuid().slice(0, 8)}`);
    const base_url = input.base_url ?? preset?.base_url ?? null;
    const requires_api_key = preset?.requires_api_key ?? (input.kind === 'anthropic' || input.kind === 'google' || input.kind === 'openai');
    const privacy_class = preset?.privacy_class ?? (base_url && /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/.test(base_url) ? 'local' : 'cloud');
    let credential_ref: string | null = null;
    if (input.api_key) credential_ref = this.vault.put({ label: `${input.name} API key`, scope: `provider:${id}`, value: input.api_key.trim() });
    const p: ModelProvider = { id, name: input.name, kind: input.kind, preset: preset?.id ?? null, base_url, organization: input.organization ?? null, credential_ref, requires_api_key, privacy_class, enabled: true, health: 'unknown', last_checked_at: null, last_error: null, avg_latency_ms: null, created_at: now() };
    this.db.run('INSERT INTO model_providers (id, name, kind, preset, base_url, organization, credential_ref, requires_api_key, privacy_class, enabled, health, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [p.id, p.name, p.kind, p.preset, p.base_url, p.organization, p.credential_ref, p.requires_api_key ? 1 : 0, p.privacy_class, 1, 'unknown', p.created_at]);
    this.adapterCache.delete(id);
    return p;
  }

  updateProvider(id: string, patch: { name?: string; base_url?: string | null; api_key?: string | null; organization?: string | null; enabled?: boolean }): ModelProvider {
    const p = this.getProvider(id);
    if (!p) throw new Error('Provider not found');
    if (patch.api_key) {
      const ref = this.vault.put({ label: `${p.name} API key`, scope: `provider:${id}`, value: patch.api_key.trim(), ref: p.credential_ref ?? undefined });
      this.db.run('UPDATE model_providers SET credential_ref=? WHERE id=?', [ref, id]);
    }
    if (patch.name != null) this.db.run('UPDATE model_providers SET name=? WHERE id=?', [patch.name, id]);
    if (patch.base_url !== undefined) this.db.run('UPDATE model_providers SET base_url=? WHERE id=?', [patch.base_url, id]);
    if (patch.organization !== undefined) this.db.run('UPDATE model_providers SET organization=? WHERE id=?', [patch.organization, id]);
    if (patch.enabled != null) this.db.run('UPDATE model_providers SET enabled=? WHERE id=?', [patch.enabled ? 1 : 0, id]);
    if (patch.api_key || patch.base_url !== undefined) {
      this.db.run('UPDATE model_providers SET health=?, last_error=NULL, last_checked_at=NULL WHERE id=?', ['unknown', id]);
      this.db.run('UPDATE models SET available=0 WHERE provider_id=?', [id]);
    }
    this.adapterCache.delete(id);
    return this.getProvider(id)!;
  }

  removeProvider(id: string) {
    const p = this.getProvider(id);
    if (!p) return;
    if (p.credential_ref) this.vault.delete(p.credential_ref);
    this.db.run('DELETE FROM model_providers WHERE id = ?', [id]);
    this.adapterCache.delete(id);
  }

  /** Masked credential status for UI — never the key. */
  providerView(p: ModelProvider) {
    const hasKey = !!p.credential_ref && this.vault.has(p.credential_ref);
    const preset = presetById(p.preset);
    const status = !p.enabled ? 'UNAVAILABLE' : p.requires_api_key && !hasKey ? 'NEEDS_API_KEY' : p.health === 'healthy' ? 'CONNECTED' : p.health === 'unknown' ? 'NEEDS_SETUP' : 'UNAVAILABLE';
    return { ...p, has_api_key: hasKey, status, docs: preset?.docs ?? null, notes: preset?.notes ?? null, model_count: this.db.get<{ c: number }>('SELECT COUNT(*) c FROM models WHERE provider_id=?', [p.id])?.c ?? 0 };
  }

  adapter(providerId: string): ProviderAdapter {
    const cached = this.adapterCache.get(providerId);
    if (cached) return cached;
    const p = this.getProvider(providerId);
    if (!p) throw new Error(`Provider ${providerId} not found`);
    const creds: ProviderCredentials = { api_key: p.credential_ref ? this.vault.get(p.credential_ref, `provider:${p.id}`, 'model call') : null, base_url: p.base_url, organization: p.organization };
    const a = p.kind === 'chatgpt-plan'
      ? this.chatgptPlan ? new ChatGPTPlanAdapter(this.chatgptPlan, p.id) : (() => { throw new Error('ChatGPT plan sign-in is unavailable'); })()
      : createAdapter(p.kind, creds, p.preset);
    this.adapterCache.set(providerId, a);
    return a;
  }

  // ---------- connection test & discovery ----------
  async testConnection(providerId: string) {
    const p = this.getProvider(providerId);
    if (!p) throw new Error('Provider not found');
    if (p.requires_api_key && !(p.credential_ref && this.vault.has(p.credential_ref))) {
      this.setHealth(providerId, 'unauthorized', 'No API key configured', null);
      return { ok: false, latency_ms: 0, detail: 'No API key configured', status: 'NEEDS_API_KEY' as const };
    }
    let r: { ok: boolean; latency_ms: number; detail: string };
    try { r = await this.adapter(providerId).testConnection(); } catch (e: any) { r = { ok: false, latency_ms: 0, detail: e.message }; }
    const health = r.ok ? 'healthy' : /unauthorized|401|403|api key/i.test(r.detail) ? 'unauthorized' : /429|rate/i.test(r.detail) ? 'rate-limited' : 'offline';
    this.setHealth(providerId, health, r.ok ? null : r.detail, r.latency_ms);
    return { ...r, status: r.ok ? 'CONNECTED' : 'UNAVAILABLE' };
  }

  setHealth(providerId: string, health: string, error: string | null, latency: number | null) {
    const prev = this.getProvider(providerId)?.health;
    this.db.run('UPDATE model_providers SET health=?, last_error=?, last_checked_at=?, avg_latency_ms=COALESCE(?, avg_latency_ms) WHERE id=?', [health, error, now(), latency, providerId]);
    if (prev !== health) this.bus.emit({ name: 'system.health_changed', severity: health === 'healthy' ? 'info' : 'warning', summary: `Provider ${providerId}: ${prev ?? 'unknown'} → ${health}`, data: { component: `provider:${providerId}`, health, error } });
  }

  async fetchModels(providerId: string): Promise<Model[]> {
    const p = this.getProvider(providerId);
    if (!p) throw new Error('Provider not found');
    const discovered = await this.adapter(providerId).listModels();
    this.setHealth(providerId, 'healthy', null, null);
    const ts = now();
    this.db.transaction(() => {
      this.db.run('UPDATE models SET available = 0 WHERE provider_id = ?', [providerId]);
      for (const d of discovered) this.upsertModel(p, d, ts);
    });
    return this.listModels(providerId);
  }

  private upsertModel(p: ModelProvider, d: DiscoveredModel, ts: string) {
    const hint = hintFor(d.id);
    const id = `${p.id}/${d.id}`;
    const existing = this.db.get<any>('SELECT id FROM models WHERE id = ?', [id]);
    const supports_vision = d.supports_vision ?? hint?.vision ?? /vision|gpt-4o|gpt-4\.1|gpt-5|gemini|claude|llava|pixtral|grok-4/i.test(d.id);
    const supports_tools = d.supports_tools ?? hint?.tools ?? !/embed|whisper|tts|dall-e|moderation|rerank/i.test(d.id);
    const isEmbedding = /embed/i.test(d.id);
    const free = p.privacy_class === 'local' || /:free$/i.test(d.id);
    const cost_class = free ? 'free' : hint ? (hint.out >= 15 ? 'high' : hint.out >= 2 ? 'medium' : 'low') : 'unknown';
    const quality = hint?.quality ?? (p.privacy_class === 'local' ? 'standard' : 'unknown');
    const speed = hint ? (hint.quality === 'light' || hint.quality === 'standard' ? 'fast' : 'medium') : 'unknown';
    const vals = [p.id, d.id, d.display_name ?? d.id, JSON.stringify(isEmbedding ? ['text'] : supports_vision ? ['text', 'image'] : ['text']), supports_tools ? 1 : 0, 1, supports_vision ? 1 : 0, d.context_length ?? hint?.ctx ?? null, speed, quality, cost_class, p.privacy_class, free ? 0 : hint?.in ?? null, free ? 0 : hint?.out ?? null, 1, ts, id];
    if (existing) this.db.run('UPDATE models SET provider_id=?, model=?, display_name=?, modalities=?, supports_tools=?, supports_streaming=?, supports_vision=?, context_length=?, speed_class=?, quality_class=?, cost_class=?, privacy_class=?, price_in_per_m=?, price_out_per_m=?, available=?, discovered_at=? WHERE id=?', vals);
    else this.db.run('INSERT INTO models (provider_id, model, display_name, modalities, supports_tools, supports_streaming, supports_vision, context_length, speed_class, quality_class, cost_class, privacy_class, price_in_per_m, price_out_per_m, available, discovered_at, id, health) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,\'unknown\')', vals);
  }

  listModels(providerId?: string, onlyAvailable = false): Model[] {
    const where: string[] = []; const params: unknown[] = [];
    if (providerId) { where.push('provider_id = ?'); params.push(providerId); }
    if (onlyAvailable) where.push('available = 1');
    return this.db.all<any>(`SELECT * FROM models ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY provider_id, model`, params).map((r) => mapRow<Model>(r, MODEL_JSON, MODEL_BOOL));
  }
  getModel(id: string): Model | undefined {
    const r = this.db.get<any>('SELECT * FROM models WHERE id = ?', [id]);
    return r ? mapRow<Model>(r, MODEL_JSON, MODEL_BOOL) : undefined;
  }

  // ---------- usage / cost ----------
  recordUsage(u: { model_id: string; provider_id: string; project_id?: string | null; agent_id?: string | null; tokens_in: number; tokens_out: number; latency_ms: number; success: boolean }) {
    const m = this.getModel(u.model_id);
    const cost = m && m.price_in_per_m != null && m.price_out_per_m != null ? (u.tokens_in * m.price_in_per_m + u.tokens_out * m.price_out_per_m) / 1_000_000 : null;
    this.db.run('INSERT INTO usage (id, ts, model_id, provider_id, project_id, agent_id, tokens_in, tokens_out, cost_usd, latency_ms, success) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [uuid(), now(), u.model_id, u.provider_id, u.project_id ?? null, u.agent_id ?? null, u.tokens_in, u.tokens_out, cost, u.latency_ms, u.success ? 1 : 0]);
    if (m) {
      this.db.run(`UPDATE models SET ${u.success ? 'success_count = success_count + 1' : 'failure_count = failure_count + 1'}, avg_latency_ms = CASE WHEN avg_latency_ms IS NULL THEN ? ELSE avg_latency_ms * 0.8 + ? * 0.2 END, health = ? WHERE id = ?`, [u.latency_ms, u.latency_ms, u.success ? 'healthy' : 'degraded', u.model_id]);
      this.db.run('UPDATE model_providers SET avg_latency_ms = CASE WHEN avg_latency_ms IS NULL THEN ? ELSE avg_latency_ms * 0.8 + ? * 0.2 END WHERE id = ?', [u.latency_ms, u.latency_ms, u.provider_id]);
    }
    return cost;
  }

  costSince(sinceIso: string, filter: { project_id?: string; agent_id?: string } = {}) {
    const where = ['ts >= ?']; const params: unknown[] = [sinceIso];
    if (filter.project_id) { where.push('project_id = ?'); params.push(filter.project_id); }
    if (filter.agent_id) { where.push('agent_id = ?'); params.push(filter.agent_id); }
    const r = this.db.get<any>(`SELECT COALESCE(SUM(cost_usd),0) cost_usd, COALESCE(SUM(tokens_in),0) tokens_in, COALESCE(SUM(tokens_out),0) tokens_out, COUNT(*) calls, COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END),0) unknown_cost_calls FROM usage WHERE ${where.join(' AND ')}`, params);
    return { cost_usd: r.cost_usd as number, tokens_in: r.tokens_in as number, tokens_out: r.tokens_out as number, calls: r.calls as number, unknown_cost_calls: r.unknown_cost_calls as number };
  }

  usageByModel(sinceIso: string) {
    return this.db.all<any>('SELECT model_id, COUNT(*) calls, SUM(tokens_in) tokens_in, SUM(tokens_out) tokens_out, SUM(cost_usd) cost_usd, AVG(latency_ms) avg_latency_ms, SUM(success) successes FROM usage WHERE ts >= ? GROUP BY model_id ORDER BY calls DESC', [sinceIso]);
  }

  /** Bootstrap providers from environment variables (keys are imported into the vault). */
  bootstrapFromEnv() {
    for (const preset of PROVIDER_PRESETS) {
      if (this.getProvider(preset.id)) continue;
      const key = preset.env_key ? process.env[preset.env_key] : null;
      if (preset.env_key && key) {
        this.addProvider({ name: preset.name, kind: preset.kind, preset: preset.id, api_key: key });
        this.log.info('Imported provider key from environment', { provider: preset.id });
      } else if (preset.id === 'ollama') {
        this.addProvider({ name: preset.name, kind: preset.kind, preset: preset.id, base_url: process.env.OLLAMA_BASE_URL || preset.base_url });
      }
    }
    if (this.enableTestProvider && !this.getProvider('test')) this.addProvider({ id: 'test', name: 'Test Provider (deterministic, not AI)', kind: 'test', preset: null });
  }
}
