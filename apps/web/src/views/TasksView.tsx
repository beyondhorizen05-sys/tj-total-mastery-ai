import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Badge } from '../components/Badges';
import { CheckCircle2, Clock3, AlertTriangle, Play, RefreshCw, Activity, Trash2, RotateCcw, Pause, PlayCircle } from 'lucide-react';
import type { Task } from '@tj/schemas';

type TaskFilter = 'all' | 'running' | 'queued' | 'paused' | 'completed' | 'failed';
const filters: TaskFilter[] = ['all', 'running', 'queued', 'paused', 'completed', 'failed'];

export const TasksView: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);
  const [controllingId, setControllingId] = useState<string | null>(null);

  const loadTasks = async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await apiFetch<{ tasks: Task[] }>('/api/v1/tasks');
      setTasks(res.tasks ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tasks');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadTasks();
    const timer = setInterval(() => { void loadTasks(); }, 1000);
    return () => clearInterval(timer);
  }, []);

  const filtered = tasks.filter((task) => filter === 'all' || task.status === filter);
  const count = (status: TaskFilter) => status === 'all' ? tasks.length : tasks.filter((task) => task.status === status).length;
  const activeCount = tasks.filter((task) => ['analyzing', 'running', 'retrying'].includes(task.status)).length;
  const needsAttention = tasks.filter((task) => ['awaiting_approval', 'blocked', 'failed'].includes(task.status)).length;
  const pausedCount = tasks.filter((task) => task.status === 'paused').length;
  const deleteTask = async (task: Task) => {
    if (!window.confirm(`Delete this ${task.status} task “${task.title}”? Its execution history will be removed.`)) return;
    setDeletingId(task.id); setError(null);
    try {
      await apiFetch(`/api/v1/tasks/${task.id}`, { method: 'DELETE' });
      setTasks((current) => current.filter((item) => item.id !== task.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete this task'); }
    finally { setDeletingId(null); }
  };
  const recoverTask = async (task: Task) => {
    setRecoveringId(task.id); setError(null);
    try {
      const result = await apiFetch<{ recovered: boolean; task: Task; attempted: string[] }>(`/api/v1/tasks/${task.id}/recover`, { method: 'POST' });
      await loadTasks();
      if (!result.recovered) setError(`TJ tried a bounded recovery for “${task.title}”, but it still needs attention. Review the updated failure details.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'TJ could not safely recover this task'); }
    finally { setRecoveringId(null); }
  };
  const controlTask = async (task: Task) => {
    setControllingId(task.id); setError(null);
    try {
      const action = task.status === 'paused' ? 'resume' : 'pause';
      await apiFetch<Task>(`/api/v1/tasks/${task.id}/${action}`, { method: 'POST' });
      await loadTasks();
    } catch (reason) { setError(reason instanceof Error ? reason.message : `Could not ${task.status === 'paused' ? 'resume' : 'pause'} task`); }
    finally { setControllingId(null); }
  };
  const recoveryHint = (task: Task) => {
    const message = (task.error ?? '').toLowerCase();
    if (task.status === 'blocked' && /stale status|upstream tasks completed/i.test(task.error ?? '')) return 'This is a stale record, not a current dependency failure. Try safe repair; TJ will reuse completed prerequisites and re-run this task once.';
    if (task.status === 'blocked' && /missing, cyclic|graph is inconsistent/i.test(task.error ?? '')) return 'Correct the goal plan’s missing or cyclic dependencies, then start a fresh goal run.';
    if (task.status === 'blocked') return 'Try safe repair; TJ will diagnose recoverable failed prerequisites in order. Credential, permission, provider, and approval blockers still need your action.';
    if (/permission|denied|fs_read|filesystem/.test(message)) return 'Review the task’s agent permissions and approved project folder access; grant only the required read/write permission, then rerun.';
    if (/provider|model|401|unauthor|rate limit|offline|no_providers/.test(message)) return 'Open Models, test the selected provider, and resolve its credential, availability, or rate-limit issue before rerunning.';
    if (/timeout|timed out/.test(message)) return 'Reduce the task scope or raise the relevant timeout, then rerun the task.';
    return 'Review the failure details, correct the upstream task or its inputs, then start a new goal run.';
  };

  return (
    <main className="tj-mission-room">
      <div className="tj-mission-shell">
        <header className="tj-mission-hero">
          <div className="tj-mission-architecture" aria-hidden="true">
            <div className="tj-mission-ceiling"><i /></div>
            <div className="tj-mission-wall tj-mission-wall-left"><div className="tj-mission-wall-grid"><i/><i/><i/><i/><i/><i/></div></div>
            <div className="tj-mission-wall tj-mission-wall-right"><div className="tj-mission-wall-grid"><i/><i/><i/><i/><i/><i/></div></div>
            <div className="tj-mission-core"><div className="tj-mission-core-orb" /></div>
            <div className="tj-mission-table"><i /></div>
            <div className="tj-mission-chair tj-mission-chair-left" />
            <div className="tj-mission-chair tj-mission-chair-right" />
          </div>
          <div className="tj-mission-hero-copy">
            <span className="tj-room-eyebrow"><Activity size={14} aria-hidden="true" /> TJ OPERATIONS / LIVE TASKS</span>
            <h1>Mission Control</h1>
            <p>Watch work move through the system as agents execute your tasks.</p>
            <span className="tj-mission-poll-note">Live updates · every second</span>
          </div>
          <div className="tj-mission-metrics" aria-label="Task overview">
            <div><strong>{tasks.length}</strong><span>Total tasks</span></div>
            <div><strong>{activeCount}</strong><span>Active now</span></div>
            <div><strong>{needsAttention}</strong><span>Need attention</span></div>
            <div><strong>{pausedCount}</strong><span>Paused</span></div>
          </div>
        </header>

        <section className="tj-mission-console" aria-labelledby="mission-queue-title">
          <div className="tj-mission-console-head">
            <div>
              <span className="tj-room-eyebrow">EXECUTION FEED</span>
              <h2 id="mission-queue-title">Task queue</h2>
            </div>
            <button className="tj-room-refresh" type="button" onClick={() => { void loadTasks(true); }} disabled={refreshing} aria-label="Refresh tasks">
              <RefreshCw size={15} aria-hidden="true" className={refreshing ? 'tj-room-spin' : ''} /> Refresh
            </button>
          </div>
          <div className="tj-mission-filters" role="group" aria-label="Filter tasks by status">
            {filters.map((status) => (
              <button key={status} type="button" className={filter === status ? 'is-active' : ''} aria-pressed={filter === status} onClick={() => setFilter(status)}>
                <span>{status}</span><span className="tj-mission-filter-count">{count(status)}</span>
              </button>
            ))}
          </div>
          {error && <p className="tj-room-error" role="alert">{error}</p>}
          <div className="tj-mission-list" aria-live="polite" aria-busy={loading}>
            {loading ? <p className="tj-room-empty">Loading tasks…</p> : filtered.length === 0 && !error ? (
              <p className="tj-room-empty">No tasks found matching this filter.</p>
            ) : filtered.map((task) => (
              <article className="tj-mission-task-card" key={task.id}>
                <div className="tj-mission-task-icon" aria-hidden="true">
                  {task.status === 'completed' ? <CheckCircle2 size={20} /> : task.status === 'running' ? <Play size={20} /> : ['failed', 'blocked'].includes(task.status) ? <AlertTriangle size={20} /> : <Clock3 size={20} />}
                </div>
                <div className="tj-mission-task-main">
                  <h3>{task.title}</h3>
                  {task.description && <p>{task.description}</p>}
                  {(task.execution_stage || task.execution_steps.length > 0) && <div className="tj-mission-execution-stage" aria-live="polite" style={{ marginTop: 10, padding: '9px 11px', borderRadius: 8, background: 'rgba(10,31,47,.76)', border: '1px solid rgba(92,211,232,.2)' }}>
                    <strong style={{ display: 'block', fontSize: 12, color: task.status === 'paused' ? '#f3c982' : '#77e5f2' }}>{['queued', 'analyzing', 'waiting', 'running', 'retrying', 'paused'].includes(task.status) ? (task.status === 'paused' ? 'Paused' : 'Live execution') : 'Last recorded step'} · {task.execution_stage ?? task.status.replaceAll('_', ' ')}</strong>
                    {task.execution_steps.length > 1 && <ol style={{ margin: '7px 0 0', paddingLeft: 18, color: '#adc7d5', fontSize: 11, lineHeight: 1.5 }}>
                      {task.execution_steps.slice(-3).reverse().map((step, index) => <li key={`${step.at}-${index}`}>{step.stage}{step.detail ? ` — ${step.detail}` : ''}</li>)}
                    </ol>}
                    <span style={{ display: 'block', marginTop: 5, fontSize: 10, color: '#7997a8' }}>Updated {task.stage_updated_at ? new Date(task.stage_updated_at).toLocaleTimeString() : 'just now'}</span>
                  </div>}
                  {['failed', 'blocked'].includes(task.status) && <div className="tj-mission-task-failure" style={{ marginTop: 10, padding: 11, borderRadius: 8, border: '1px solid rgba(255,143,150,.24)', background: 'rgba(44,20,33,.36)', color: '#f2d8de', whiteSpace: 'normal', overflow: 'visible', overflowWrap: 'anywhere' }}><strong>{task.status === 'blocked' ? 'Why it is blocked' : 'Why it failed'}</strong><p style={{ margin: '5px 0 9px', color: '#ffd5dc', lineHeight: 1.45, whiteSpace: 'normal', overflow: 'visible' }}>{task.error || 'TJ did not receive a failure detail for this task.'}</p><strong>Next step</strong><p style={{ margin: '5px 0 0', color: '#b7d3df', lineHeight: 1.45, whiteSpace: 'normal', overflow: 'visible' }}>{recoveryHint(task)}</p></div>}
                  <div className="tj-mission-task-progress" role="progressbar" aria-label={`${task.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(task.progress * 100)}>
                    <span style={{ width: `${Math.round(task.progress * 100)}%` }} />
                  </div>
                </div>
                <div className="tj-mission-task-meta">
                  <div className="tj-mission-task-badges">
                    <Badge variant={['high', 'critical'].includes(task.risk) ? 'danger' : task.risk === 'medium' ? 'warning' : 'neutral'}>{task.risk} risk</Badge>
                    <Badge variant={task.status === 'completed' ? 'success' : task.status === 'running' ? 'accent' : ['failed', 'blocked'].includes(task.status) ? 'danger' : 'neutral'}>{task.status.replaceAll('_', ' ')}</Badge>
                  </div>
                  <span>{Math.round(task.progress * 100)}% complete</span>
                  {['queued', 'analyzing', 'waiting', 'running', 'retrying', 'paused'].includes(task.status) && <button type="button" className="tj-mission-task-delete" disabled={controllingId === task.id} onClick={() => void controlTask(task)} aria-label={`${task.status === 'paused' ? 'Resume' : 'Pause'} ${task.title}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 8px', border: '1px solid rgba(87,221,235,.35)', borderRadius: 6, background: 'rgba(11,59,72,.5)', color: '#7ce8f1', cursor: 'pointer' }}>
                    {task.status === 'paused' ? <PlayCircle size={14} /> : <Pause size={14} />}{controllingId === task.id ? 'Updating…' : task.status === 'paused' ? 'Resume task' : 'Pause task'}
                  </button>}
                  {['failed', 'blocked'].includes(task.status) && <>
                    <button type="button" className="tj-mission-task-delete" disabled={deletingId === task.id || recoveringId === task.id} onClick={() => void recoverTask(task)} aria-label={`Try safe repair for ${task.title}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 8px', border: '1px solid rgba(87,221,235,.35)', borderRadius: 6, background: 'rgba(11,59,72,.5)', color: '#7ce8f1', cursor: 'pointer' }}><RotateCcw size={14} />{recoveringId === task.id ? 'Diagnosing…' : 'Try safe repair'}</button>
                    <button type="button" className="tj-mission-task-delete" disabled={deletingId === task.id || recoveringId === task.id} onClick={() => void deleteTask(task)} aria-label={`Delete ${task.status} task ${task.title}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 8px', border: '1px solid rgba(255,143,150,.35)', borderRadius: 6, background: 'rgba(60,23,36,.5)', color: '#ffadb8', cursor: 'pointer' }}><Trash2 size={14} />{deletingId === task.id ? 'Deleting…' : 'Delete task'}</button>
                  </>}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
};
