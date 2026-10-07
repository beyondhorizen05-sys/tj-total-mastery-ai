import type { ComponentHealth, SystemStatus, TJState } from '@tj/schemas';
import type { Database } from '../db/database.js';
import os from 'node:os';
import type { ModelRouter } from '../models/router.js';
import type { ApprovalService } from '../security/approvals.js';

export interface HealthMonitorDeps {
  db: Database;
  router: ModelRouter;
  approvals: ApprovalService;
  version?: string;
}

export class HealthMonitor {
  private startTime = Date.now();
  private stopAllEngaged = false;
  private tjState: TJState = 'idle';

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

  async getStatus(): Promise<SystemStatus> {
    const now = new Date().toISOString();
    const components: ComponentHealth[] = [];

    let dbState: ComponentHealth['state'] = 'healthy';
    let dbDetail = 'WAL mode active';
    let dbLat: number | null = null;
    try {
      const t0 = performance.now();
      this.deps.db.get('SELECT 1');
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

    const candidates = this.deps.router.candidates({ task_type: 'chat' });
    const hasActive = candidates.length > 0;
    components.push({
      component: 'model_router',
      state: hasActive ? 'healthy' : 'misconfigured',
      detail: hasActive ? `Default: ${candidates[0]?.display_name ?? candidates[0]?.model}` : 'No active model provider configured',
      latency_ms: null,
      checked_at: now,
    });

    const runningTasks = this.deps.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM tasks WHERE status = 'running'")?.c ?? 0;
    const activeAgents = this.deps.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM agents WHERE status = 'busy'")?.c ?? 0;
    const pendingApprovals = this.deps.approvals.pendingCount();

    const totalMem = os.totalmem() / (1024 * 1024);
    const freeMem = os.freemem() / (1024 * 1024);
    const usedMem = Math.round(totalMem - freeMem);

    return {
      tj_state: this.stopAllEngaged ? 'stopped' : this.tjState,
      version: this.deps.version ?? '1.0.0',
      uptime_s: Math.round((Date.now() - this.startTime) / 1000),
      current_model_id: candidates[0]?.id ?? null,
      active_agents: activeAgents,
      running_tasks: runningTasks,
      queued_jobs: 0,
      pending_approvals: pendingApprovals,
      network: 'online',
      mode: 'local',
      cost_today_usd: 0,
      cost_month_usd: 0,
      security_state: pendingApprovals > 0 ? 'attention' : 'secure',
      microphone: 'unknown',
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
