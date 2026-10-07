import type { Workflow, WorkflowRun, WorkflowStep, StepState } from '@tj/schemas';
import type { Database } from '../db/database.js';
import type { EventBus } from '../core/event-bus.js';
import { uuid, now } from '../core/ids.js';
import { J, mapRow } from '../db/repo.js';
import { interpolate, evalCondition } from './template.js';

export interface StepContext {
  run: WorkflowRun;
  workflow: Workflow;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  signal: AbortSignal;
}
export type StepExecutor = (step: WorkflowStep, config: Record<string, unknown>, ctx: StepContext) => Promise<unknown>;

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
});

/**
 * Durable workflow engine (Spec §10). DAG scheduling, parallel steps, retries with exponential backoff,
 * timeouts, pause/resume/cancel, continue-on-error (partial results) and persisted per-step state.
 */
export class WorkflowEngine {
  private executors = new Map<string, StepExecutor>();
  private live = new Map<string, { ctrl: AbortController; paused: boolean; promise: Promise<WorkflowRun> }>();

  constructor(private db: Database, private bus: EventBus, private workspaceId: () => string) {}

  registerExecutor(kind: string, fn: StepExecutor) { this.executors.set(kind, fn); }

  // ---- definitions ----
  save(def: { id?: string; name: string; description?: string; project_id?: string | null; steps: WorkflowStep[] }): Workflow {
    this.validate(def.steps);
    const ts = now();
    const existing = def.id ? this.get(def.id) : undefined;
    const id = existing?.id ?? def.id ?? uuid();
    const version = existing ? existing.version + 1 : 1;
    if (existing) this.db.run('UPDATE workflows SET name=?, description=?, version=?, steps=?, updated_at=? WHERE id=?', [def.name, def.description ?? '', version, J.str(def.steps), ts, id]);
    else this.db.run('INSERT INTO workflows (id, workspace_id, project_id, name, description, version, steps, inputs_schema, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [id, this.workspaceId(), def.project_id ?? null, def.name, def.description ?? '', version, J.str(def.steps), '{}', ts, ts]);
    this.db.run('INSERT OR REPLACE INTO workflow_versions (workflow_id, version, steps, created_at) VALUES (?,?,?,?)', [id, version, J.str(def.steps), ts]);
    this.bus.emit({ name: 'workflow.created', summary: `Workflow ${existing ? 'updated' : 'created'}: ${def.name} v${version}`, data: { workflow_id: id } });
    return this.get(id)!;
  }

  get(id: string): Workflow | undefined {
    const r = this.db.get<any>('SELECT * FROM workflows WHERE id = ?', [id]);
    return r ? mapRow<Workflow>(r, ['steps', 'inputs_schema']) : undefined;
  }
  list(): Workflow[] { return this.db.all<any>('SELECT * FROM workflows ORDER BY updated_at DESC').map((r) => mapRow<Workflow>(r, ['steps', 'inputs_schema'])); }
  versions(id: string) { return this.db.all<any>('SELECT workflow_id, version, created_at FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC', [id]); }
  delete(id: string) { this.db.run('DELETE FROM workflows WHERE id = ?', [id]); }

  /** Reject duplicate ids, unknown dependencies and cycles. */
  validate(steps: WorkflowStep[]) {
    if (!steps.length) throw new Error('Workflow needs at least one step');
    const ids = new Set(steps.map((s) => s.id));
    if (ids.size !== steps.length) throw new Error('Duplicate step ids');
    for (const s of steps) for (const d of s.depends_on ?? []) if (!ids.has(d)) throw new Error(`Step ${s.id} depends on unknown step ${d}`);
    const state = new Map<string, number>();
    const byId = new Map(steps.map((s) => [s.id, s]));
    const visit = (id: string) => {
      if (state.get(id) === 1) throw new Error(`Cycle detected at step ${id}`);
      if (state.get(id) === 2) return;
      state.set(id, 1);
      for (const d of byId.get(id)!.depends_on ?? []) visit(d);
      state.set(id, 2);
    };
    steps.forEach((s) => visit(s.id));
  }

  // ---- runs ----
  getRun(id: string): WorkflowRun | undefined {
    const r = this.db.get<any>('SELECT * FROM workflow_runs WHERE id = ?', [id]);
    return r ? mapRow<WorkflowRun>(r, ['inputs', 'step_state', 'checkpoint']) : undefined;
  }
  listRuns(f: { workflow_id?: string; status?: string; limit?: number } = {}): WorkflowRun[] {
    const w: string[] = []; const p: unknown[] = [];
    if (f.workflow_id) { w.push('workflow_id = ?'); p.push(f.workflow_id); }
    if (f.status) { w.push('status = ?'); p.push(f.status); }
    p.push(Math.min(f.limit ?? 100, 500));
    return this.db.all<any>(`SELECT * FROM workflow_runs ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`, p).map((r) => mapRow<WorkflowRun>(r, ['inputs', 'step_state', 'checkpoint']));
  }
  activeRunCount() { return this.live.size; }

  private persist(run: WorkflowRun) {
    this.db.run('UPDATE workflow_runs SET status=?, step_state=?, checkpoint=?, error=?, started_at=?, completed_at=? WHERE id=?', [run.status, J.str(run.step_state), J.str(run.checkpoint), run.error, run.started_at, run.completed_at, run.id]);
  }

  /** Start a run. Returns immediately with the queued run; execution continues in the background. */
  start(workflowId: string, inputs: Record<string, unknown> = {}, triggeredBy = 'manual'): WorkflowRun {
    const wf = this.get(workflowId);
    if (!wf) throw new Error('Workflow not found');
    const run: WorkflowRun = {
      id: uuid(), workflow_id: wf.id, workflow_version: wf.version, project_id: wf.project_id, status: 'queued', inputs, step_state: {}, checkpoint: {}, error: null, triggered_by: triggeredBy, created_at: now(), started_at: null, completed_at: null,
    };
    for (const s of wf.steps) run.step_state[s.id] = { status: 'pending', attempts: 0, output: null, error: null, started_at: null, completed_at: null };
    this.db.run('INSERT INTO workflow_runs (id, workflow_id, workflow_version, project_id, status, inputs, step_state, checkpoint, error, triggered_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [run.id, run.workflow_id, run.workflow_version, run.project_id, run.status, J.str(inputs), J.str(run.step_state), '{}', null, triggeredBy, run.created_at]);
    this.launch(run, wf);
    return run;
  }

  /** Await a run's completion (used by tests, automations and goal flows). */
  async wait(runId: string): Promise<WorkflowRun> {
    const live = this.live.get(runId);
    if (live) return live.promise;
    return this.getRun(runId)!;
  }

  private launch(run: WorkflowRun, wf: Workflow) {
    const ctrl = new AbortController();
    const entry = { ctrl, paused: false, promise: Promise.resolve(run) as Promise<WorkflowRun> };
    entry.promise = this.execute(run, wf, entry).finally(() => this.live.delete(run.id));
    this.live.set(run.id, entry);
  }

  private setRunStatus(run: WorkflowRun, status: WorkflowRun['status'], eventName: Parameters<EventBus['emit']>[0]['name'], summary: string, severity: 'info' | 'warning' | 'error' = 'info') {
    run.status = status;
    this.persist(run);
    this.bus.emit({ name: eventName, severity, summary, workflow_run_id: run.id, project_id: run.project_id, data: { status, workflow_id: run.workflow_id } });
  }

  private async execute(run: WorkflowRun, wf: Workflow, entry: { ctrl: AbortController; paused: boolean }): Promise<WorkflowRun> {
    run.started_at = run.started_at ?? now();
    this.setRunStatus(run, 'running', 'workflow.started', `Workflow started: ${wf.name}`);
    const outputs: Record<string, unknown> = {};
    for (const [id, st] of Object.entries(run.step_state)) if (st.status === 'completed') outputs[id] = st.output;
    const running = new Map<string, Promise<void>>();
    const finished = (id: string) => ['completed', 'failed', 'skipped', 'cancelled'].includes(run.step_state[id].status);

    try {
      while (!entry.ctrl.signal.aborted) {
        while (entry.paused && !entry.ctrl.signal.aborted) { await sleep(150, entry.ctrl.signal); }
        if (entry.ctrl.signal.aborted) break;
        let progressed = false;
        for (const step of wf.steps) {
          const st = run.step_state[step.id];
          if (st.status !== 'pending' || running.has(step.id)) continue;
          const deps = step.depends_on ?? [];
          if (!deps.every((d) => finished(d))) continue;
          progressed = true;
          const blocked = deps.some((d) => { const ds = run.step_state[d]; const depStep = wf.steps.find((s) => s.id === d)!; return (ds.status === 'failed' && !depStep.continue_on_error) || ds.status === 'cancelled'; });
          if (blocked) { st.status = 'skipped'; st.error = 'Upstream step failed'; this.persist(run); continue; }
          running.set(step.id, this.runStep(step, run, wf, outputs, entry).finally(() => { running.delete(step.id); this.persist(run); }));
        }
        if (running.size) await Promise.race(running.values());
        else if (!progressed) break;
      }
      await Promise.allSettled(running.values());
    } catch (e: any) {
      run.error = e.message;
    }

    const steps = Object.entries(run.step_state);
    const anyFailed = steps.some(([id, s]) => s.status === 'failed' && !wf.steps.find((x) => x.id === id)!.continue_on_error);
    const partial = steps.some(([, s]) => s.status === 'failed');
    run.completed_at = now();
    if (entry.ctrl.signal.aborted) {
      for (const [, s] of steps) if (['pending', 'running', 'retrying', 'awaiting_approval'].includes(s.status)) s.status = 'cancelled';
      this.setRunStatus(run, 'cancelled', 'workflow.cancelled', `Workflow cancelled: ${wf.name}`, 'warning');
    } else if (anyFailed || steps.some(([, s]) => s.status === 'pending')) {
      run.error = run.error ?? steps.filter(([, s]) => s.status === 'failed').map(([id, s]) => `${id}: ${s.error}`).join('; ');
      this.setRunStatus(run, 'failed', 'workflow.failed', `Workflow failed: ${wf.name} — ${run.error}`, 'error');
    } else {
      if (partial) run.checkpoint = { ...run.checkpoint, partial: true };
      this.setRunStatus(run, 'completed', 'workflow.completed', `Workflow completed${partial ? ' (with partial failures)' : ''}: ${wf.name}`);
    }
    return this.getRun(run.id)!;
  }

  /** Execute one step with condition check, timeout, retry + exponential backoff and persisted state. */
  private async runStep(step: WorkflowStep, run: WorkflowRun, wf: Workflow, outputs: Record<string, unknown>, entry: { ctrl: AbortController; paused: boolean }): Promise<void> {
    const st: StepState = run.step_state[step.id];
    const scope = { inputs: run.inputs, steps: Object.fromEntries(Object.entries(outputs).map(([k, v]) => [k, { output: v }])) };
    const when = (step.config as any)?.when;
    if (typeof when === 'string' && !evalConditionSafe(when, scope)) {
      st.status = 'skipped'; st.error = `Condition not met: ${when}`; st.completed_at = now();
      this.bus.emit({ name: 'workflow.step', severity: 'debug', summary: `Step skipped (condition): ${step.name}`, workflow_run_id: run.id, data: { step: step.id, status: 'skipped' } });
      return;
    }
    const exec = this.executors.get(step.kind);
    const maxAttempts = Math.max(1, step.retry?.max_attempts ?? 1);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (entry.ctrl.signal.aborted) { st.status = 'cancelled'; return; }
      st.status = attempt === 1 ? 'running' : 'retrying';
      st.attempts = attempt; st.started_at = st.started_at ?? now(); st.error = null; st.next_retry_at = null;
      this.persist(run);
      this.bus.emit({ name: 'workflow.step', summary: `Step ${attempt > 1 ? `retry ${attempt}/${maxAttempts}` : 'started'}: ${step.name}`, workflow_run_id: run.id, project_id: run.project_id, data: { step: step.id, attempt, kind: step.kind } });
      try {
        if (!exec) throw new Error(`No executor registered for step kind "${step.kind}"`);
        const config = interpolate(step.config ?? {}, scope) as Record<string, unknown>;
        const ctx: StepContext = { run, workflow: wf, inputs: run.inputs, outputs, signal: entry.ctrl.signal };
        const out = await withTimeout(exec(step, config, ctx), step.timeout_ms ?? 120000, entry.ctrl.signal, `Step "${step.name}" timed out after ${step.timeout_ms}ms`);
        outputs[step.id] = out;
        st.output = out as any; st.status = 'completed'; st.completed_at = now();
        run.checkpoint = { ...run.checkpoint, last_completed_step: step.id };
        this.bus.emit({ name: 'workflow.step', severity: 'debug', summary: `Step completed: ${step.name}`, workflow_run_id: run.id, project_id: run.project_id, data: { step: step.id, status: 'completed' } });
        return;
      } catch (e: any) {
        if (entry.ctrl.signal.aborted) { st.status = 'cancelled'; st.error = 'Cancelled'; return; }
        st.error = e.message ?? String(e);
        if (attempt >= maxAttempts || e?.noRetry) {
          st.status = 'failed'; st.completed_at = now();
          this.bus.emit({ name: 'workflow.step', severity: 'error', summary: `Step failed: ${step.name} — ${st.error}`, workflow_run_id: run.id, project_id: run.project_id, data: { step: step.id, status: 'failed', attempts: attempt } });
          return;
        }
        const delay = Math.min((step.retry?.backoff_ms ?? 1000) * 2 ** (attempt - 1), step.retry?.max_backoff_ms ?? 30000);
        st.status = 'retrying'; st.next_retry_at = new Date(Date.now() + delay).toISOString();
        this.persist(run);
        this.bus.emit({ name: 'workflow.retrying', severity: 'warning', summary: `Retrying ${step.name} in ${delay}ms: ${st.error}`, workflow_run_id: run.id, project_id: run.project_id, data: { step: step.id, attempt, delay_ms: delay } });
        await sleep(delay, entry.ctrl.signal);
      }
    }
  }

  // ---- controls ----
  pause(runId: string) {
    const l = this.live.get(runId);
    const run = this.getRun(runId);
    if (!l || !run) throw new Error('Run is not active');
    l.paused = true;
    this.setRunStatus(run, 'paused', 'workflow.paused', 'Workflow paused', 'warning');
  }
  resume(runId: string) {
    const l = this.live.get(runId);
    const run = this.getRun(runId);
    if (!l || !run) throw new Error('Run is not active');
    l.paused = false;
    this.setRunStatus(run, 'running', 'workflow.resumed', 'Workflow resumed');
  }
  cancel(runId: string) {
    const l = this.live.get(runId);
    if (l) { l.paused = false; l.ctrl.abort(); }
  }
  cancelAll() { for (const id of [...this.live.keys()]) this.cancel(id); }

  /** Crash recovery: resume runs that were mid-flight when the process died (durability). */
  recover(): number {
    const stale = this.listRuns({ limit: 500 }).filter((r) => ['running', 'retrying', 'paused', 'queued', 'awaiting_approval', 'analyzing', 'waiting'].includes(r.status) && !this.live.has(r.id));
    let n = 0;
    for (const run of stale) {
      const wf = this.get(run.workflow_id);
      if (!wf) continue;
      for (const s of Object.values(run.step_state)) if (['running', 'retrying', 'awaiting_approval'].includes(s.status)) { s.status = 'pending'; }
      run.checkpoint = { ...run.checkpoint, recovered_at: now() };
      this.launch(run, wf);
      n++;
    }
    return n;
  }
}

function evalConditionSafe(expr: string, scope: Record<string, unknown>): boolean {
  try { return evalCondition(expr, scope); } catch { return false; }
}

function withTimeout<T>(p: Promise<T>, ms: number, signal: AbortSignal, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    const onAbort = () => { clearTimeout(t); reject(new Error('Cancelled')); };
    signal.addEventListener('abort', onAbort, { once: true });
    p.then((v) => { clearTimeout(t); signal.removeEventListener('abort', onAbort); resolve(v); }, (e) => { clearTimeout(t); signal.removeEventListener('abort', onAbort); reject(e); });
  });
}
