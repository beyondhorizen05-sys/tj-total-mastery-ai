import type { Agent, Task } from '@tj/schemas';
import type { PlanTask } from '../cognitive/types.js';
import type { TaskService } from '../tasks/service.js';

export type PlanRow = { pt: PlanTask; task: Task; agent: Agent };

export interface TaskResultRow {
  task_id: string; plan_task_id: string; title: string; agent: string; status: string; output: string; error?: string;
}

/**
 * Dependency-aware scheduler: runs ready tasks in parallel up to `concurrency`;
 * tasks whose dependencies failed are marked blocked (never silently skipped).
 */
export async function scheduleRows(rows: PlanRow[], run: (row: PlanRow) => Promise<boolean>, tasks: TaskService, signal: AbortSignal, concurrency: number) {
  concurrency = Math.max(1, Math.min(16, Math.floor(concurrency) || 1));
  const done = new Set<string>(), failed = new Set<string>(), running = new Map<string, Promise<void>>();
  const pending = new Set(rows.map((r) => r.pt.id));
  while ((pending.size || running.size) && !signal.aborted) {
    for (const row of rows) {
      if (!pending.has(row.pt.id) || running.size >= concurrency) continue;
      if (tasks.get(row.task.id)?.status === 'paused') continue;
      if (row.pt.depends_on.some((d) => failed.has(d))) {
        pending.delete(row.pt.id); failed.add(row.pt.id);
        const blockers = row.pt.depends_on.map((id) => rows.find((candidate) => candidate.pt.id === id)).filter((candidate): candidate is PlanRow => Boolean(candidate && failed.has(candidate.pt.id)));
        const why = blockers.map(({ task: dependency }) => {
          const current = tasks.get(dependency.id);
          const status = current?.status ?? dependency.status;
          return `“${dependency.title}” ${status}${current?.error ? `: ${current.error}` : ''}`;
        }).join('; ');
        tasks.setStatus(row.task.id, 'blocked', { error: `Blocked by ${why || 'a failed dependency'}. Use Recover on this task after the upstream failure is repaired; TJ will retry dependencies in order and continue this goal.` });
        continue;
      }
      if (!row.pt.depends_on.every((d) => done.has(d))) continue;
      pending.delete(row.pt.id);
      running.set(row.pt.id, Promise.resolve().then(() => run(row)).then((ok) => {
        (ok ? done : failed).add(row.pt.id);
        if (!ok && !['failed', 'cancelled', 'blocked'].includes(tasks.get(row.task.id)?.status ?? '')) tasks.setStatus(row.task.id, 'failed', { error: 'Execution returned failure' });
      }).catch((error) => {
        failed.add(row.pt.id);
        tasks.setStatus(row.task.id, signal.aborted ? 'cancelled' : 'failed', { error: error instanceof Error ? error.message : String(error) });
      }).finally(() => { running.delete(row.pt.id); }));
    }
    if (running.size) await Promise.race(running.values());
    else if (pending.size && rows.some((row) => pending.has(row.pt.id) && tasks.get(row.task.id)?.status === 'paused')) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 100);
        signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    } else if (pending.size) {
      for (const row of rows) if (pending.has(row.pt.id)) tasks.setStatus(row.task.id, 'blocked', { error: 'The task plan could not be scheduled because dependencies are missing or cyclic. Fix the plan dependencies and start a new goal run.' });
      break;
    }
  }
  if (signal.aborted) {
    await Promise.allSettled(running.values());
    for (const row of rows) if (pending.has(row.pt.id)) tasks.setStatus(row.task.id, 'cancelled', { error: 'Run stopped' });
  }
}

export function summarizeRun(goal: string, status: string, results: TaskResultRow[], verdict: { verdict: string; confidence: number; issues: string[] } | null): string {
  const lines = results.map((r) => `- ${r.status === 'completed' ? '✔' : '✘'} ${r.title} (${r.agent})${r.error ? ` — ${r.error.slice(0, 120)}` : ''}`);
  return [
    `Goal: ${goal}`, `Status: ${status.toUpperCase()}`, ...lines,
    verdict ? `Verification: ${verdict.verdict} (confidence ${verdict.confidence})${verdict.issues.length ? ' — ' + verdict.issues.join('; ') : ''}` : 'Verification: not performed by a model',
  ].join('\n');
}
