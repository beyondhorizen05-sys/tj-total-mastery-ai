import type { Model } from '@tj/schemas';
import type { ModelRegistry } from './registry.js';
import type { SettingsRepo } from '../db/repo.js';
import type { EventBus } from '../core/event-bus.js';
import type { ChatOptions, ChatResult } from './types.js';
import { ProviderError } from './types.js';

export type TaskType = 'chat' | 'planning' | 'coding' | 'research' | 'analysis' | 'vision' | 'verification' | 'classification' | 'summarization' | 'embedding';

export interface RouteRequest {
  task_type: TaskType;
  complexity?: 'low' | 'medium' | 'high';
  needs_tools?: boolean;
  needs_vision?: boolean;
  needs_json?: boolean;
  min_context?: number;
  privacy?: 'any' | 'local-only';
  prefer?: 'balanced' | 'cheapest' | 'fastest' | 'quality' | 'local-only' | 'private-only';
  /** explicit model id (manual mode / per-agent) */
  model_id?: string | null;
  /** exclude models (independent verification, post-failure) */
  exclude?: string[];
  max_cost_class?: 'free' | 'low' | 'medium' | 'high';
}

export interface RouteDecision { model: Model; chain: Model[]; reason: string }

export type RoutedChatResult = ChatResult & { model_id: string; provider_id: string; fallback_from?: string; cost_usd: number | null };

const QUALITY_SCORE = { frontier: 4, strong: 3, standard: 2, light: 1, unknown: 1.5 } as const;
const COST_SCORE = { free: 0, low: 1, medium: 2, high: 3, unknown: 2 } as const;
const SPEED_SCORE = { fast: 3, medium: 2, slow: 1, unknown: 2 } as const;
const NON_CHAT = /embed|whisper|tts|dall-e|moderation|rerank|audio|realtime|image|transcri|guard|:batch$/i;

/**
 * Intelligent Model Router (Spec §5).
 * Scores candidates on task type + complexity + latency + cost + privacy + modality + context + history,
 * then returns an ordered fallback chain used by chat() (Spec §87 provider failover).
 */
export class ModelRouter {
  constructor(private registry: ModelRegistry, private settings: SettingsRepo, private bus: EventBus) {}

  candidates(req: RouteRequest): Model[] {
    const privacyMode = this.settings.get<string>('privacy_mode', 'balanced');
    const prefer = req.prefer ?? this.settings.get<string>('router_priority', 'balanced');
    const localOnly = req.privacy === 'local-only' || privacyMode === 'local-only' || prefer === 'local-only' || prefer === 'private-only';
    const providers = new Map(this.registry.listProviders().map((p) => [p.id, p]));
    return this.registry.listModels(undefined, true).filter((m) => {
      const p = providers.get(m.provider_id);
      if (!p || !p.enabled) return false;
      if (p.health === 'unauthorized' || p.health === 'misconfigured') return false;
      if (p.requires_api_key && !p.credential_ref) return false;
      if (req.task_type === 'embedding' ? !/embed/i.test(m.model) : NON_CHAT.test(m.model)) return false;
      if (req.exclude?.includes(m.id)) return false;
      if (localOnly && m.privacy_class !== 'local') return false;
      if (req.needs_vision && !m.supports_vision) return false;
      if (req.needs_tools && !m.supports_tools) return false;
      if (req.min_context && m.context_length && m.context_length < req.min_context) return false;
      if (req.max_cost_class && COST_SCORE[m.cost_class] > COST_SCORE[req.max_cost_class]) return false;
      return true;
    });
  }

  score(m: Model, req: RouteRequest, prefer: string): number {
    const q = QUALITY_SCORE[m.quality_class];
    const c = COST_SCORE[m.cost_class];
    const s = SPEED_SCORE[m.speed_class];
    const total = m.success_count + m.failure_count;
    const reliability = total ? m.success_count / total : 0.7;
    const healthPenalty = m.health === 'degraded' ? -1 : m.health === 'offline' ? -5 : 0;
    const complexity = req.complexity ?? 'medium';
    let score = 0;
    switch (prefer) {
      case 'cheapest': score = -c * 3 + q * 0.5 + s * 0.5; break;
      case 'fastest': score = s * 3 + q * 0.5 - c * 0.5; break;
      case 'quality': score = q * 3 - c * 0.3 + s * 0.2; break;
      case 'local-only': case 'private-only': score = (m.privacy_class === 'local' ? 5 : -100) + q; break;
      default: {
        const qWeight = complexity === 'high' ? 3 : complexity === 'medium' ? 2 : 1;
        const cWeight = complexity === 'high' ? 0.5 : complexity === 'medium' ? 1 : 2;
        score = q * qWeight - c * cWeight + s * 0.5;
        if (req.task_type === 'classification' || req.task_type === 'summarization') score += s - q * 0.5;
        if (req.task_type === 'coding' || req.task_type === 'planning') score += q;
      }
    }
    const isDefault = this.settings.get<string | null>('default_model_id', null) === m.id;
    return score + reliability * 2 + healthPenalty + (isDefault ? 1.5 : 0);
  }

  route(req: RouteRequest): RouteDecision {
    const prefer = req.prefer ?? this.settings.get<string>('router_priority', 'balanced');
    const mode = this.settings.get<string>('routing_mode', 'auto');
    const defaultId = this.settings.get<string | null>('default_model_id', null);
    const explicit = req.model_id ?? (mode === 'manual' ? defaultId : null);
    let cands = this.candidates(req).sort((a, b) => this.score(b, req, prefer) - this.score(a, req, prefer));
    if (explicit) {
      const m = cands.find((candidate) => candidate.id === explicit);
      if (!m) throw new ProviderError(`Selected model ${explicit} is unavailable under the current provider, privacy, and capability settings.`, 'unavailable', undefined, false);
      // A chosen model is a spending and privacy choice. Never fall back to a
      // different model when that choice fails, especially from a free model.
      cands = [m];
    }
    if (!cands.length) throw new ProviderError('No model available. Add a provider with a valid API key (Models → Add Provider) or start a local model server such as Ollama.', 'unavailable', undefined, false);
    const chain = cands.slice(0, 4);
    return { model: chain[0], chain, reason: explicit && chain[0].id === explicit ? 'explicit selection' : `${prefer} routing for ${req.task_type} (${req.complexity ?? 'medium'} complexity)` };
  }

  /** Execute a chat with automatic fallback across the chain (Spec §87). */
  async chat(req: RouteRequest, opts: Omit<ChatOptions, 'model'>, ctx: { project_id?: string | null; agent_id?: string | null } = {}): Promise<RoutedChatResult> {
    const decision = this.route(req);
    const limits = {
      daily: this.settings.get<number | null>('budget_daily_usd', null),
      monthly: this.settings.get<number | null>('budget_monthly_usd', null),
      request: this.settings.get<number | null>('max_request_cost_usd', null),
    };
    const constrained = Object.values(limits).some((value) => value !== null);
    const boundedOpts = constrained && opts.max_tokens == null ? { ...opts, max_tokens: 2048 } : opts;
    const eligible = constrained ? decision.chain.filter((model) => this.withinBudget(model, boundedOpts, limits)) : decision.chain;
    if (decision.reason === 'explicit selection' && eligible[0]?.id !== decision.model.id) throw new ProviderError('Selected model exceeds the configured estimated spending limit or has unknown pricing.', 'bad_request', undefined, false);
    if (!eligible.length) throw new ProviderError('No model fits the configured estimated spending limits. Adjust limits or select a model with known pricing.', 'bad_request', undefined, false);
    let lastErr: any = null;
    let fallback_from: string | undefined;
    for (let i = 0; i < eligible.length; i++) {
      const m = eligible[i];
      const adapter = this.registry.adapter(m.provider_id);
      this.bus.emit({
        name: i === 0 ? 'model.selected' : 'model.fallback', severity: i === 0 ? 'debug' : 'warning',
        summary: i === 0 ? `Model ${m.id} selected (${decision.reason})` : `Falling back to ${m.id} after failure of ${eligible[i - 1].id}`,
        model_id: m.id, agent_id: ctx.agent_id, project_id: ctx.project_id, data: { reason: decision.reason, attempt: i + 1 },
      });
      const t = performance.now();
      try {
        const r = await this.withRetry(() => adapter.chat({ ...boundedOpts, model: m.model }), 2);
        const cost = this.registry.recordUsage({ model_id: m.id, provider_id: m.provider_id, project_id: ctx.project_id, agent_id: ctx.agent_id, tokens_in: r.usage.tokens_in, tokens_out: r.usage.tokens_out, latency_ms: r.latency_ms, success: true });
        return { ...r, model_id: m.id, provider_id: m.provider_id, fallback_from, cost_usd: cost };
      } catch (e: any) {
        lastErr = e;
        this.registry.recordUsage({ model_id: m.id, provider_id: m.provider_id, project_id: ctx.project_id, agent_id: ctx.agent_id, tokens_in: 0, tokens_out: 0, latency_ms: performance.now() - t, success: false });
        const kind = e instanceof ProviderError ? e.kind : 'unknown';
        this.bus.emit({ name: 'provider.error', severity: 'error', summary: `Provider ${m.provider_id} failed (${kind}): ${e.message}`, model_id: m.id, agent_id: ctx.agent_id, project_id: ctx.project_id, data: { kind } });
        if (kind === 'auth') this.registry.setHealth(m.provider_id, 'unauthorized', e.message, null);
        else if (kind === 'rate_limit') this.registry.setHealth(m.provider_id, 'rate-limited', e.message, null);
        else if (kind === 'unavailable' || kind === 'timeout') this.registry.setHealth(m.provider_id, 'offline', e.message, null);
        if (opts.signal?.aborted) throw e;
        // A subscription-backed request must never silently fall back to a billable API.
        if (this.registry.getProvider(m.provider_id)?.kind === 'chatgpt-plan') throw e;
        fallback_from = fallback_from ?? m.id;
      }
    }
    throw lastErr ?? new ProviderError('All models in fallback chain failed', 'unavailable');
  }

  private withinBudget(model: Model, opts: Omit<ChatOptions, 'model'>, limits: { daily: number | null; monthly: number | null; request: number | null }): boolean {
    const inputTokens = Math.ceil(JSON.stringify(opts.messages).length / 3);
    const estimate = this.estimateCost(model.id, inputTokens, opts.max_tokens ?? 2048);
    if (estimate == null) return false;
    if (limits.request != null && estimate > limits.request) return false;
    if (estimate === 0) return true;
    const now = new Date();
    if (limits.daily != null) {
      const daily = this.registry.costSince(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString());
      if (daily.unknown_cost_calls > 0 || daily.cost_usd + estimate > limits.daily) return false;
    }
    if (limits.monthly != null) {
      const monthly = this.registry.costSince(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString());
      if (monthly.unknown_cost_calls > 0 || monthly.cost_usd + estimate > limits.monthly) return false;
    }
    return true;
  }

  private async withRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
    let delay = 500;
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e: any) {
        const retryable = e instanceof ProviderError ? e.retryable : false;
        if (!retryable || attempt >= retries) throw e;
        await new Promise((r) => setTimeout(r, delay + Math.random() * 200));
        delay = Math.min(delay * 2, 8000);
      }
    }
  }

  /** Embeddings: prefer local providers; honours local-only privacy. Returns null if nothing available. */
  async embed(texts: string[]): Promise<{ vectors: number[][]; model_id: string } | null> {
    const privacyMode = this.settings.get<string>('privacy_mode', 'balanced');
    const providers = this.registry.listProviders()
      .filter((p) => p.enabled && p.health !== 'unauthorized' && p.health !== 'offline')
      .sort((a, b) => (a.privacy_class === 'local' ? 0 : 1) - (b.privacy_class === 'local' ? 0 : 1));
    for (const p of providers) {
      if (privacyMode === 'local-only' && p.privacy_class !== 'local') continue;
      if (p.requires_api_key && !p.credential_ref) continue;
      try {
        const a = this.registry.adapter(p.id);
        if (!a.embed || !a.embeddingModel?.()) continue;
        const r = await a.embed(texts);
        if (r.vectors.length === texts.length) return { vectors: r.vectors, model_id: `${p.id}/${r.model}` };
      } catch { /* try next provider */ }
    }
    return null;
  }

  estimateCost(modelId: string, tokensIn: number, tokensOut: number): number | null {
    const m = this.registry.getModel(modelId);
    if (!m || m.price_in_per_m == null || m.price_out_per_m == null) return null;
    return (tokensIn * m.price_in_per_m + tokensOut * m.price_out_per_m) / 1_000_000;
  }
}
