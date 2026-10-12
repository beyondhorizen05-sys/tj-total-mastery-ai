import type { ComponentHealth, SystemStatus, TJState } from '@tj/schemas';
import type { Database } from '../db/database.js';
import os from 'node:os';
import type { ModelRouter } from '../models/router.js';
import type { ApprovalService } from '../security/approvals.js';
import type { SettingsRepo } from '../db/repo.js';
import type { ModelRegistry } from '../models/registry.js';

const MODEL_HEALTH_MAX_AGE_MS = 5 * 60 * 1000;

export interface HealthMonitorDeps {
  db: Database;
  router: ModelRouter;
  approvals: ApprovalService;
  settings: SettingsRepo;
  registry?: ModelRegistry;
  version?: string;
}

export class HealthMonitor {
  private startTime = Date.now();
  private stopAllEngaged = false;
  private tjState: TJState = 'idle';
  private microphoneStatusProvider: (() => 'off' | 'on' | 'unknown') | null = null;

  constructor(private deps: HealthMonitorDeps) {}

  setState(state: TJState) {
    this.tjState = state;
  }

  setStopAll(stopped: boolean) {
    this.stopAllEngaged = stopped;
    if (stopped) this.tjState = 'stopped';
  }

  isStopped(): boolean {
    return this.stopAllEngaged;
  }

  setMicrophoneStatusProvider(provider: () => 'off' | 'on' | 'unknown') {
    this.microphoneStatusProvider = provider;
  }

  async getStatus(): Promise<SystemStatus> {
    const now = new Date().toISOString();
    const components: ComponentHealth[] = [];

    let dbState: ComponentHealth['state'] = 'healthy';
    let dbDetail = 'Database query succeeded';
    let dbLat: number | null = null;
    try {
      const t0 = performance.now();
      this.deps.db.get('SELECT 1');
      const journal = this.deps.db.get<{ journal_mode: string }>('PRAGMA journal_mode');
      dbDetail = `Journal mode: ${journal?.journal_mode ?? 'unknown'}`;
      dbLat = Math.round(performance.now() - t0);
    } catch (e: any) {
      dbState = 'offline';
      dbDetail = e.message;
    }
    components.push({
      component: 'database',
      state: dbState,
      detail: dbDetail,
      latency_ms: dbLat,
      checked_at: now,
    });

    const routingMode = this.deps.settings.get<string>('routing_mode', 'auto');
    const defaultModelId = this.deps.settings.get<string | null>('default_model_id', null);
    const eligibleModels = this.deps.router.candidates({ task_type: 'chat' });
    const candidates = routingMode === 'manual' && defaultModelId
      ? eligibleModels.filter((model) => model.id === defaultModelId)
      : eligibleModels;
    const hasActive = candidates.length > 0;
    const providerById = new Map((this.deps.registry?.listProviders() ?? []).map((provider) => [provider.id, provider]));
    const candidateProviders = [...new Set(candidates.map((model) => model.provider_id))].map((id) => providerById.get(id)).filter((provider) => provider !== undefined);
    const freshHealthyProviderIds = new Set(candidateProviders.filter((provider) => provider.health === 'healthy' && provider.last_checked_at
      && Number.isFinite(Date.parse(provider.last_checked_at)) && Date.now() - Date.parse(provider.last_checked_at) <= MODEL_HEALTH_MAX_AGE_MS).map((provider) => provider.id));
    const hasPreviouslySuccessfulRoute = candidates.some((model) => model.health === 'healthy' && freshHealthyProviderIds.has(model.provider_id));
    const hasDiscoveredRoute = candidates.some((model) => model.health === 'unknown' && freshHealthyProviderIds.has(model.provider_id));
    const providerFailure = candidateProviders.find((provider) => ['offline', 'unauthorized', 'rate-limited', 'degraded', 'misconfigured'].includes(provider.health));
    const hasStaleOrUnknownProvider = candidateProviders.some((provider) => provider.health !== 'healthy' || !provider.last_checked_at
      || !Number.isFinite(Date.parse(provider.last_checked_at)) || Date.now() - Date.parse(provider.last_checked_at) > MODEL_HEALTH_MAX_AGE_MS);
    const modelState: ComponentHealth['state'] = !hasActive ? 'misconfigured'
      : this.deps.registry
          ? hasPreviouslySuccessfulRoute || hasDiscoveredRoute ? 'healthy'
          : providerFailure?.health === 'offline' ? 'offline'
          : providerFailure?.health === 'unauthorized' ? 'unauthorized'
            : providerFailure?.health === 'rate-limited' ? 'rate-limited'
              : providerFailure ? 'degraded'
                : candidateProviders.length === 0 || hasStaleOrUnknownProvider ? 'unknown' : 'degraded'
        : candidates.some((model) => model.health === 'healthy') ? 'healthy'
          : candidates.some((model) => model.health === 'unknown') ? 'unknown' : 'degraded';
    components.push({
      component: 'model_router',
      state: modelState,
      detail: hasActive ? `${candidates.length} eligible model(s); ${modelState === 'healthy' ? hasPreviouslySuccessfulRoute ? 'provider reachable and a model has prior inference success' : 'provider reachable and a model was discovered; inference has not been tested' : modelState === 'offline' ? 'provider connectivity check failed' : modelState === 'unauthorized' ? 'provider credentials were rejected' : modelState === 'rate-limited' ? 'provider rate limit reached' : modelState === 'degraded' ? 'provider or model failures recorded' : modelState === 'misconfigured' ? 'provider configuration is invalid' : 'provider health is stale or inference is not verified'}` : 'No active model provider configured',
      latency_ms: null,
      checked_at: now,
    });

    const runningTasks = this.deps.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM tasks WHERE status = 'running'")?.c ?? 0;
    const activeAgents = this.deps.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM agents WHERE status IN ('thinking','working','waiting_approval','meeting')")?.c ?? 0;
    const pendingApprovals = this.deps.approvals.pendingCount();
    const queuedJobs = (this.deps.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM tasks WHERE status = 'queued'")?.c ?? 0)
      + (this.deps.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM workflow_runs WHERE status = 'queued'")?.c ?? 0);
    const costToday = this.deps.db.get<{ cost: number }>("SELECT COALESCE(SUM(cost_usd), 0) AS cost FROM usage WHERE date(ts) = date('now')")?.cost ?? 0;
    const costMonth = this.deps.db.get<{ cost: number }>("SELECT COALESCE(SUM(cost_usd), 0) AS cost FROM usage WHERE strftime('%Y-%m', ts) = strftime('%Y-%m', 'now')")?.cost ?? 0;
    const privacy = this.deps.settings.get<string>('privacy_mode', 'balanced');
    let microphone: 'off' | 'on' | 'unknown' = 'unknown';
    try { microphone = this.microphoneStatusProvider?.() ?? 'unknown'; } catch { /* Report unknown if the listener is unavailable. */ }

    const totalMem = os.totalmem() / (1024 * 1024);
    const freeMem = os.freemem() / (1024 * 1024);
    const usedMem = Math.round(totalMem - freeMem);

    return {
      tj_state: this.stopAllEngaged ? 'stopped' : pendingApprovals > 0 ? 'awaiting_approval' : runningTasks > 0 || activeAgents > 0 ? 'executing' : this.tjState,
      version: this.deps.version ?? '1.0.0',
      uptime_s: Math.round((Date.now() - this.startTime) / 1000),
      current_model_id: candidates[0]?.id ?? null,
      active_agents: activeAgents,
      running_tasks: runningTasks,
      queued_jobs: queuedJobs,
      pending_approvals: pendingApprovals,
      network: 'unknown',
      mode: privacy === 'local-only' ? 'local' : 'hybrid',
      cost_today_usd: costToday,
      cost_month_usd: costMonth,
      security_state: pendingApprovals > 0 ? 'attention' : 'secure',
      microphone,
      unread_notifications: pendingApprovals,
      stop_all_engaged: this.stopAllEngaged,
      components,
      resources: {
        cpu_percent: null,
        ram_used_mb: usedMem,
        ram_total_mb: Math.round(totalMem),
        platform: `${os.platform()} ${os.arch()}`,
      },
    };
  }
}
