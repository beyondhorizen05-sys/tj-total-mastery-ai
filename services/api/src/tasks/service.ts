import type { Task, TaskStatus } from '@tj/schemas';
import type { Database } from '../db/database.js';
import type { EventBus } from '../core/event-bus.js';
import { uuid, now } from '../core/ids.js';
import { J, mapRow } from '../db/repo.js';

const TERMINAL: TaskStatus[] = ['completed', 'failed', 'cancelled'];

export interface CreateTaskInput {
  workspace_id: string;
  title: string;
  description?: string;
  project_id?: string | null;
  workflow_run_id?: string | null;
  parent_task_id?: string | null;
  agent_id?: string | null;
  priority?: number;
  risk?: Task['risk'];
  depends_on?: string[];
  max_attempts?: number;
}

/** Task graph (Spec §6, §60): tasks + dependency edges with real status transitions. */
export class TaskService {
  private resumeWaiters = new Map<string, Set<() => void>>();
  constructor(private db: Database, private bus: EventBus) {}

  create(i: CreateTaskInput): Task {
    const id = uuid();
    this.db.run(
      `INSERT INTO tasks (id, workspace_id, project_id, workflow_run_id, parent_task_id, agent_id, title, description, status, priority, risk, progress, attempts, max_attempts, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, i.workspace_id, i.project_id ?? null, i.workflow_run_id ?? null, i.parent_task_id ?? null, i.agent_id ?? null, i.title, i.description ?? '', 'queued', i.priority ?? 3, i.risk ?? 'low', 0, 0, i.max_attempts ?? 3, now()],
    );
    for (const d of i.depends_on ?? []) this.db.run('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?,?)', [id, d]);
    this.bus.emit({ name: 'task.created', summary: `Task created: ${i.title}`, task_id: id, project_id: i.project_id, agent_id: i.agent_id, workflow_run_id: i.workflow_run_id });
    return this.get(id)!;
  }

  get(id: string): Task | undefined {
    const r = this.db.get<any>('SELECT * FROM tasks WHERE id = ?', [id]);
    return r ? this.withExecutionDetails(this.explainBlockage(mapRow<Task>(r, ['result']))) : undefined;
  }

  list(f: { project_id?: string; status?: string; agent_id?: string; limit?: number } = {}): Task[] {
    const where: string[] = []; const p: unknown[] = [];
    for (const k of ['project_id', 'status', 'agent_id'] as const) if (f[k]) { where.push(`${k} = ?`); p.push(f[k]); }
    p.push(Math.min(f.limit ?? 200, 1000));
    return this.db.all<any>(`SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`, p).map((r) => this.withExecutionDetails(this.explainBlockage(mapRow<Task>(r, ['result']))));
  }

  private withExecutionDetails(task: Task): Task {
    const result = task.result && typeof task.result === 'object' ? task.result as Record<string, unknown> : {};
    return {
      ...task,
      execution_stage: typeof result.execution_stage === 'string' ? result.execution_stage : null,
      stage_updated_at: typeof result.stage_updated_at === 'string' ? result.stage_updated_at : null,
      execution_steps: Array.isArray(result.execution_steps) ? result.execution_steps as Task['execution_steps'] : [],
    };
  }

  /** Persist a human-readable execution step and publish it for Mission Control. */
  setStage(id: string, stage: string, progress?: number, detail?: string | null) {
    const task = this.get(id);
    if (!task) return;
    const previous = task.result && typeof task.result === 'object' ? task.result as Record<string, unknown> : {};
    const history = Array.isArray(previous.execution_steps) ? previous.execution_steps as Array<{ at: string; stage: string; detail: string | null }> : [];
    const at = now();
    const entry = { at, stage: stage.slice(0, 180), detail: detail ? detail.slice(0, 500) : null };
    const next = { ...previous, execution_stage: entry.stage, stage_updated_at: at, execution_steps: [...history, entry].slice(-40) };
    if (progress === undefined) this.db.run('UPDATE tasks SET result = ? WHERE id = ?', [J.str(next), id]);
    else this.db.run('UPDATE tasks SET result = ?, progress = ? WHERE id = ?', [J.str(next), Math.max(0, Math.min(1, progress)), id]);
    const current = this.get(id);
    this.bus.emit({ name: 'task.progress', severity: 'info', summary: `${task.title}: ${entry.stage}${entry.detail ? ` — ${entry.detail}` : ''}`.slice(0, 500), task_id: id, project_id: task.project_id, agent_id: task.agent_id, workflow_run_id: task.workflow_run_id, data: { stage: entry.stage, detail: entry.detail, progress: current?.progress } });
  }

  pause(id: string): Task | undefined {
    const task = this.get(id);
    if (!task) return undefined;
    if (!['queued', 'analyzing', 'waiting', 'running', 'retrying'].includes(task.status)) throw new Error(`Task cannot be paused while it is ${task.status}.`);
    const previous = task.result && typeof task.result === 'object' ? task.result as Record<string, unknown> : {};
    this.db.run('UPDATE tasks SET status = ?, result = ? WHERE id = ?', ['paused', J.str({ ...previous, pause_previous_status: task.status }), id]);
    this.setStage(id, task.status === 'queued' ? 'Paused before execution' : 'Pause requested; finishing current action safely');
    this.bus.emit({ name: 'task.progress', summary: `Task paused by user: ${task.title}`, task_id: id, project_id: task.project_id, agent_id: task.agent_id, workflow_run_id: task.workflow_run_id, data: { status: 'paused' } });
    return this.get(id);
  }

  resume(id: string): Task | undefined {
    const task = this.get(id);
    if (!task) return undefined;
    if (task.status !== 'paused') throw new Error(`Task cannot be resumed while it is ${task.status}.`);
    const previous = task.result && typeof task.result === 'object' ? task.result as Record<string, unknown> : {};
    const status = ['queued', 'analyzing', 'waiting', 'running', 'retrying'].includes(String(previous.pause_previous_status)) ? String(previous.pause_previous_status) : 'queued';
    this.db.run('UPDATE tasks SET status = ?, result = ? WHERE id = ?', [status, J.str({ ...previous, pause_previous_status: null }), id]);
    this.setStage(id, status === 'queued' ? 'Resumed; waiting for execution' : 'Resuming execution');
    for (const resolve of this.resumeWaiters.get(id) ?? []) resolve();
    this.resumeWaiters.delete(id);
    this.bus.emit({ name: 'task.progress', summary: `Task resumed: ${task.title}`, task_id: id, project_id: task.project_id, agent_id: task.agent_id, workflow_run_id: task.workflow_run_id, data: { status } });
    return this.get(id);
  }

  /** Cooperative pause checkpoint used between model and tool actions. */
  async checkpoint(id: string | null | undefined, signal?: AbortSignal): Promise<boolean> {
    if (!id) return !signal?.aborted;
    while (!signal?.aborted && this.get(id)?.status === 'paused') {
      this.setStage(id, 'Paused at a safe checkpoint');
      await new Promise<void>((resolve) => {
        if (signal?.aborted) { resolve(); return; }
        const waiters = this.resumeWaiters.get(id) ?? new Set<() => void>();
        const finish = () => { waiters.delete(finish); signal?.removeEventListener('abort', finish); resolve(); };
        waiters.add(finish);
        this.resumeWaiters.set(id, waiters);
        signal?.addEventListener('abort', finish, { once: true });
      });
    }
    return !signal?.aborted;
  }

  /** Mark volatile execution lost on process restart instead of leaving ghost tasks as running forever. */
  recoverInterruptedOnStartup() {
    const interrupted = this.db.all<any>("SELECT * FROM tasks WHERE status IN ('analyzing','waiting','running','retrying','awaiting_approval') OR (status='queued' AND (workflow_run_id IS NOT NULL OR agent_id IS NOT NULL)) OR (status='paused' AND agent_id IS NOT NULL)");
    for (const row of interrupted) {
      const task = mapRow<Task>(row, ['result']);
      const previous = task.result && typeof task.result === 'object' ? task.result as Record<string, unknown> : {};
      const stage = typeof previous.execution_stage === 'string' ? previous.execution_stage : task.status;
      const reason = `Execution was interrupted when the TJ service restarted. Last recorded step: ${stage}. The in-memory runner no longer exists, so TJ stopped this stale task instead of showing it as running or replaying possibly completed actions. Review the step history before using safe repair.`;
      this.setStatus(task.id, 'failed', { error: reason });
      this.setStage(task.id, 'Interrupted after service restart', undefined, `Last recorded step: ${stage}`);
    }
    return interrupted.length;
  }

  private explainBlockage(task: Task): Task {
    if (task.status !== 'blocked' || !/dependency failed|unreachable or cyclic/i.test(task.error ?? '')) return task;
    const blockers = this.dependencies(task.id).map((id) => this.db.get<{ title: string; status: string; error: string | null }>('SELECT title, status, error FROM tasks WHERE id = ?', [id]))
      .filter((item): item is { title: string; status: string; error: string | null } => Boolean(item && ['failed', 'cancelled', 'blocked'].includes(item.status)));
    if (!blockers.length) {
      const dependencies = this.dependencies(task.id).map((id) => this.db.get<{ title: string; status: string }>('SELECT title, status FROM tasks WHERE id = ?', [id])).filter((item): item is { title: string; status: string } => Boolean(item));
      if (dependencies.length && dependencies.every((item) => item.status === 'completed')) {
        return { ...task, error: `This task is still marked blocked even though all recorded upstream tasks completed (${dependencies.map((item) => `“${item.title}”`).join(', ')}). This is a stale status from an earlier run. Start a new goal run to execute it; completed upstream work does not need to be repeated.` };
      }
      return { ...task, error: 'The task plan could not be scheduled because a dependency is missing, cyclic, or the saved run graph is inconsistent. Correct the plan and start a new goal run.' };
    }
    const cause = blockers.slice(0, 3).map((item) => `“${item.title}” is ${item.status}${item.error ? `: ${item.error}` : ''}`).join('; ');
    return { ...task, error: `Blocked by ${cause}. Fix or rerun the upstream task, then start a new goal run; blocked tasks do not resume automatically.` };
  }

  delete(id: string): boolean {
    const task = this.get(id);
    if (!task) return false;
    if (!['failed', 'blocked', 'cancelled'].includes(task.status)) throw new Error('Only failed, blocked, or cancelled tasks can be deleted.');
    const dependents = this.db.all<{ title: string; status: string }>(
      'SELECT t.title, t.status FROM task_dependencies d JOIN tasks t ON t.id = d.task_id WHERE d.depends_on_task_id = ?', [id],
    );
    if (dependents.length) throw new Error(`Cannot delete this task while ${dependents.length} dependent task${dependents.length === 1 ? '' : 's'} still reference it. Delete or replan those tasks first.`);
    this.db.transaction(() => { this.db.run('DELETE FROM tasks WHERE id = ?', [id]); });
    return true;
  }

  dependencies(id: string): string[] {
    return this.db.all<{ depends_on_task_id: string }>('SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?', [id]).map((r) => r.depends_on_task_id);
  }

  addDependency(taskId: string, dependsOnTaskId: string) {
    if (taskId === dependsOnTaskId || !this.get(taskId) || !this.get(dependsOnTaskId)) throw new Error('Invalid task dependency');
    this.db.run('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?,?)', [taskId, dependsOnTaskId]);
  }

  allDependencies(projectId: string): Array<{ task_id: string; depends_on_task_id: string }> {
    return this.db.all('SELECT d.task_id, d.depends_on_task_id FROM task_dependencies d JOIN tasks t ON t.id = d.task_id WHERE t.project_id = ?', [projectId]);
  }

  /** A task is ready when every dependency has completed. */
  isReady(id: string): boolean {
    return this.dependencies(id).every((d) => this.get(d)?.status === 'completed');
  }

  hasFailedDependency(id: string): boolean {
    return this.dependencies(id).some((d) => ['failed', 'cancelled', 'blocked'].includes(this.get(d)?.status ?? ''));
  }

  setStatus(id: string, status: TaskStatus, extra: { progress?: number; result?: Record<string, unknown> | null; error?: string | null; agent_id?: string | null } = {}) {
    const t = this.get(id);
    if (!t) return;
    const sets = ['status = ?']; const p: unknown[] = [status];
    if (status === 'running' && !t.started_at) { sets.push('started_at = ?'); p.push(now()); }
    if (TERMINAL.includes(status)) { sets.push('completed_at = ?'); p.push(now()); sets.push('progress = ?'); p.push(status === 'completed' ? 1 : t.progress); }
    if (status === 'running' || status === 'retrying') { sets.push('attempts = attempts + 1'); }
    if (extra.progress != null && !TERMINAL.includes(status)) { sets.push('progress = ?'); p.push(extra.progress); }
    if (extra.result !== undefined) {
      const prior = t.result && typeof t.result === 'object' ? t.result as Record<string, unknown> : {};
      const next = extra.result && typeof extra.result === 'object' ? { ...prior, ...extra.result } : extra.result;
      sets.push('result = ?'); p.push(J.str(next));
    }
    if (extra.error !== undefined) { sets.push('error = ?'); p.push(extra.error); }
    if (extra.agent_id !== undefined) { sets.push('agent_id = ?'); p.push(extra.agent_id); }
    this.db.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, [...p, id]);
    const name = status === 'running' ? 'task.started' : status === 'completed' ? 'task.completed' : status === 'failed' ? 'task.failed' : status === 'cancelled' ? 'task.cancelled' : 'task.progress';
    this.bus.emit({ name, severity: status === 'failed' ? 'error' : 'info', summary: `Task ${status}: ${t.title}${extra.error ? ' — ' + extra.error.slice(0, 120) : ''}`, task_id: id, project_id: t.project_id, agent_id: extra.agent_id ?? t.agent_id, workflow_run_id: t.workflow_run_id });
  }

  progress(id: string, progress: number, note?: string) {
    this.db.run('UPDATE tasks SET progress = ? WHERE id = ?', [Math.max(0, Math.min(1, progress)), id]);
    const t = this.get(id);
    this.bus.emit({ name: 'task.progress', severity: 'debug', summary: note ?? `Progress ${Math.round(progress * 100)}%`, task_id: id, project_id: t?.project_id, agent_id: t?.agent_id });
  }

  counts() {
    const rows = this.db.all<{ status: string; c: number }>('SELECT status, COUNT(*) c FROM tasks GROUP BY status');
    const m: Record<string, number> = {};
    for (const r of rows) m[r.status] = r.c;
    return m;
  }

  /** STOP ALL / crash recovery: mark in-flight tasks as cancelled. */
  cancelActive(reason: string) {
    const active = this.db.all<{ id: string }>("SELECT id FROM tasks WHERE status IN ('queued','analyzing','waiting','running','retrying','awaiting_approval','paused')");
    for (const a of active) {
      this.setStatus(a.id, 'cancelled', { error: reason });
      for (const resolve of this.resumeWaiters.get(a.id) ?? []) resolve();
      this.resumeWaiters.delete(a.id);
    }
    return active.length;
  }
}
