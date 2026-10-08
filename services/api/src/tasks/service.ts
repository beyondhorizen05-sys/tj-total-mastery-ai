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
    return r ? mapRow<Task>(r, ['result']) : undefined;
  }

  list(f: { project_id?: string; status?: string; agent_id?: string; limit?: number } = {}): Task[] {
    const where: string[] = []; const p: unknown[] = [];
    for (const k of ['project_id', 'status', 'agent_id'] as const) if (f[k]) { where.push(`${k} = ?`); p.push(f[k]); }
    p.push(Math.min(f.limit ?? 200, 1000));
    return this.db.all<any>(`SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`, p).map((r) => mapRow<Task>(r, ['result']));
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
    if (extra.result !== undefined) { sets.push('result = ?'); p.push(J.str(extra.result)); }
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
    for (const a of active) this.setStatus(a.id, 'cancelled', { error: reason });
    return active.length;
  }
}
