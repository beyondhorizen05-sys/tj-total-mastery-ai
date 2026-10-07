import { Cron } from 'croner';
import type { Database } from '../db/database.js';
import type { Automation } from '@tj/schemas';
import type { WorkflowEngine } from '../workflows/engine.js';
import type { EventBus } from '../core/event-bus.js';
import { uuid, now } from '../core/ids.js';

export interface SchedulerServiceDeps {
  db: Database;
  engine: WorkflowEngine;
  bus: EventBus;
}

/**
 * Automations scheduler using croner (Spec §10 & §42).
 * Stores schedules in SQLite, starts cron jobs for enabled automations,
 * tracks last_run_at and next_run_at honestly, and dispatches workflow runs.
 */
export class AutomationScheduler {
  private jobs = new Map<string, Cron>();

  constructor(private deps: SchedulerServiceDeps) {}

  async start() {
    const automations = this.list();
    for (const auto of automations) {
      if (auto.enabled) {
        this.schedule(auto);
      }
    }
  }

  stop() {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
  }

  list(): Automation[] {
    const rows = this.deps.db.all<any>('SELECT * FROM automations ORDER BY created_at DESC');
    return rows.map((r) => ({
      ...r,
      enabled: Boolean(r.enabled),
      trigger: typeof r.trigger === 'string' ? JSON.parse(r.trigger) : r.trigger,
    }));
  }

  get(id: string): Automation | null {
    const r = this.deps.db.get<any>('SELECT * FROM automations WHERE id = ?', [id]);
    if (!r) return null;
    return {
      ...r,
      enabled: Boolean(r.enabled),
      trigger: typeof r.trigger === 'string' ? JSON.parse(r.trigger) : r.trigger,
    };
  }

  save(data: {
    id?: string;
    workspace_id?: string;
    name: string;
    description?: string;
    enabled?: boolean;
    trigger: { kind: 'schedule' | 'webhook' | 'event' | 'file_changed' | 'manual'; config: Record<string, unknown> };
    workflow_id: string;
  }): Automation {
    const ts = now();
    const id = data.id ?? uuid();
    const workspaceId = data.workspace_id ?? 'default';
    const enabled = data.enabled ?? true;
    const triggerStr = JSON.stringify(data.trigger);

    this.deps.db.run(
      `INSERT INTO automations (id, workspace_id, name, description, enabled, trigger, workflow_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         enabled = excluded.enabled,
         trigger = excluded.trigger,
         workflow_id = excluded.workflow_id,
         updated_at = excluded.updated_at`,
      [id, workspaceId, data.name, data.description ?? '', enabled ? 1 : 0, triggerStr, data.workflow_id, ts, ts]
    );

    const auto = this.get(id)!;
    this.unschedule(id);
    if (auto.enabled) {
      this.schedule(auto);
    }
    return auto;
  }

  delete(id: string): boolean {
    this.unschedule(id);
    const res = this.deps.db.run('DELETE FROM automations WHERE id = ?', [id]);
    return res.changes > 0;
  }

  private schedule(auto: Automation) {
    if (auto.trigger.kind !== 'schedule') return;
    const cronExpr = String(auto.trigger.config.cron ?? '');
    if (!cronExpr) return;

    try {
      const job = new Cron(cronExpr, async () => {
        await this.trigger(auto.id, 'schedule');
      });
      this.jobs.set(auto.id, job);

      const next = job.nextRun();
      if (next) {
        this.deps.db.run('UPDATE automations SET next_run_at = ? WHERE id = ?', [next.toISOString(), auto.id]);
      }
    } catch {
      // Invalid cron pattern, leave unscheduled
    }
  }

  private unschedule(id: string) {
    const job = this.jobs.get(id);
    if (job) {
      job.stop();
      this.jobs.delete(id);
    }
  }

  async trigger(id: string, reason = 'manual'): Promise<string | null> {
    const auto = this.get(id);
    if (!auto) return null;

    const ts = now();
    this.deps.db.run(
      `UPDATE automations
       SET last_run_at = ?, run_count = run_count + 1
       WHERE id = ?`,
      [ts, id]
    );

    const job = this.jobs.get(id);
    if (job) {
      const next = job.nextRun();
      if (next) {
        this.deps.db.run('UPDATE automations SET next_run_at = ? WHERE id = ?', [next.toISOString(), id]);
      }
    }

    const run = await this.deps.engine.start(auto.workflow_id, {}, `automation:${id}:${reason}`);
    this.deps.bus.emit({
      name: 'system.health_changed',
      summary: `Automation "${auto.name}" started workflow run ${run.id}`,
    });
    return run.id;
  }
}
