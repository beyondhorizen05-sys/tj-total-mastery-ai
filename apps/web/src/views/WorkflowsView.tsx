import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import type { Automation, Workflow, WorkflowRun, WorkflowStep } from '@tj/schemas';

const fieldStyle: React.CSSProperties = { width: '100%', padding: '9px 11px', color: 'var(--text-main)', background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: 5 };
const panelStyle: React.CSSProperties = { background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 16 };

export const WorkflowsView: React.FC = () => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [automationName, setAutomationName] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [cron, setCron] = useState('0 8 * * 1-5');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    try {
      const [saved, executed, scheduled] = await Promise.all([
        apiFetch<{ workflows: Workflow[] }>('/api/v1/workflows'),
        apiFetch<{ runs: WorkflowRun[] }>('/api/v1/workflow-runs'),
        apiFetch<{ automations: Automation[] }>('/api/v1/automations'),
      ]);
      setWorkflows(saved.workflows); setRuns(executed.runs); setAutomations(scheduled.automations);
      setWorkflowId((current) => current || saved.workflows[0]?.id || '');
    } catch (reason: any) { setError(reason.message ?? 'Could not load workflows'); }
  };

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 5000);
    const stream = new EventSource('/api/v1/system/events');
    for (const event of ['workflow.created', 'workflow.started', 'workflow.step', 'workflow.completed', 'workflow.failed', 'workflow.paused', 'workflow.resumed', 'workflow.cancelled']) stream.addEventListener(event, load);
    return () => { window.clearInterval(timer); stream.close(); };
  }, []);

  const act = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key); setError(null); setNotice(null);
    try { await action(); setNotice(success); await load(); }
    catch (reason: any) { setError(reason.message ?? 'Action failed'); }
    finally { setBusy(null); }
  };

  const createWorkflow = (event: React.FormEvent) => {
    event.preventDefault();
    const step: WorkflowStep = { id: 'main', name: 'AI response', kind: 'model', depends_on: [], config: { prompt: prompt.trim() }, retry: { max_attempts: 2, backoff_ms: 1000, max_backoff_ms: 30000 }, timeout_ms: 120000, permissions: [], risk: 'low', continue_on_error: false };
    act('create-workflow', () => apiFetch('/api/v1/workflows', { method: 'POST', body: JSON.stringify({ name: name.trim(), description: 'Single-step AI workflow', steps: [step] }) }), 'Workflow saved. Run it when a model provider is ready.');
  };

  const createAutomation = (event: React.FormEvent) => {
    event.preventDefault();
    act('create-automation', () => apiFetch('/api/v1/automations', { method: 'POST', body: JSON.stringify({ name: automationName.trim(), workflow_id: workflowId, enabled: true, trigger: { kind: 'schedule', config: { cron: cron.trim() } } }) }), 'Schedule saved. It will run at the next matching server-local time.');
  };

  return <div style={{ padding: 16, height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
    <div><h2>Workflows & Automation</h2><p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 5 }}>Saved definitions, real executions, and scheduled runs. A model provider is required for AI steps.</p></div>
    {error && <p role="alert" style={{ color: '#fb7185' }}>{error}</p>}
    {notice && <p role="status" style={{ color: '#34d399' }}>{notice}</p>}

    <form onSubmit={createWorkflow} style={{ ...panelStyle, display: 'grid', gap: 9, maxWidth: 650 }}>
      <h3>Create a model workflow</h3>
      <label style={{ fontSize: 12 }}>Name<input style={fieldStyle} value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} /></label>
      <label style={{ fontSize: 12 }}>Prompt<textarea style={{ ...fieldStyle, minHeight: 70, resize: 'vertical' }} value={prompt} onChange={(event) => setPrompt(event.target.value)} required /></label>
      <button type="submit" disabled={busy !== null || !name.trim() || !prompt.trim()} style={{ justifySelf: 'start', padding: '8px 14px', background: 'var(--accent-blue)', color: '#fff', border: 0, borderRadius: 5, cursor: 'pointer' }}>Save workflow</button>
      <small style={{ color: 'var(--text-muted)' }}>For multi-step DAGs, the validated workflow API supports agent, tool, model, connector, approval, wait, and transform steps.</small>
    </form>

    <section><h3 style={{ marginBottom: 10 }}>Saved Workflows ({workflows.length})</h3>
      {workflows.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No workflow saved yet.</p> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>{workflows.map((workflow) => <div key={workflow.id} style={panelStyle}>
        <b>{workflow.name}</b><p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '5px 0 12px' }}>{workflow.description || 'No description'} · {workflow.steps.length} steps · v{workflow.version}</p>
        <button type="button" disabled={busy !== null} onClick={() => act(workflow.id, () => apiFetch(`/api/v1/workflows/${workflow.id}/run`, { method: 'POST' }), 'Workflow run queued. Watch its result below.')} style={{ padding: '7px 12px', background: 'var(--accent-blue)', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer' }}>{busy === workflow.id ? 'Starting…' : 'Run workflow'}</button>
      </div>)}</div>}
    </section>

    <form onSubmit={createAutomation} style={{ ...panelStyle, display: 'grid', gap: 9, maxWidth: 650 }}>
      <h3>Schedule a workflow</h3>
      <label style={{ fontSize: 12 }}>Automation name<input style={fieldStyle} value={automationName} onChange={(event) => setAutomationName(event.target.value)} required /></label>
      <label style={{ fontSize: 12 }}>Workflow<select style={fieldStyle} value={workflowId} onChange={(event) => setWorkflowId(event.target.value)} required><option value="">Select workflow</option>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select></label>
      <label style={{ fontSize: 12 }}>Cron schedule (server local time)<input style={fieldStyle} value={cron} onChange={(event) => setCron(event.target.value)} required /></label>
      <small style={{ color: 'var(--text-muted)' }}>Example: 0 8 * * 1-5 runs Monday to Friday at 08:00.</small>
      <button type="submit" disabled={busy !== null || !workflowId || !automationName.trim() || !cron.trim()} style={{ justifySelf: 'start', padding: '8px 14px', background: 'var(--accent-blue)', color: '#fff', border: 0, borderRadius: 5, cursor: 'pointer' }}>Save schedule</button>
    </form>

    <section><h3 style={{ marginBottom: 10 }}>Automations ({automations.length})</h3>
      {automations.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No automations saved.</p> : automations.map((automation) => <div key={automation.id} style={{ ...panelStyle, marginBottom: 8, display: 'flex', justifyContent: 'space-between', gap: 12 }}><div><b>{automation.name}</b><p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 5 }}>{automation.enabled ? 'Enabled' : 'Disabled'} · {automation.trigger.kind} {String(automation.trigger.config.cron ?? '')} · Next: {automation.next_run_at ? new Date(automation.next_run_at).toLocaleString() : 'not scheduled'} · Runs: {automation.run_count}</p></div><button type="button" disabled={busy !== null} onClick={() => act(automation.id, () => apiFetch(`/api/v1/automations/${automation.id}/trigger`, { method: 'POST' }), 'Automation triggered; inspect its workflow run below.')} style={{ height: 30, padding: '4px 10px', border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: '#fff', borderRadius: 4, cursor: 'pointer' }}>Run now</button></div>)}
    </section>

    <section><h3 style={{ marginBottom: 10 }}>Recent Executions</h3>
      {runs.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No executions recorded.</p> : runs.map((run) => <div key={run.id} style={{ ...panelStyle, marginBottom: 8, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><b>Run {run.id.slice(0, 8)}</b><span style={{ marginLeft: 8, color: run.status === 'completed' && !run.checkpoint.partial ? '#34d399' : run.status === 'failed' ? '#fb7185' : '#fbbf24' }}>{run.status === 'completed' && run.checkpoint.partial ? 'COMPLETED WITH FAILURES' : run.status.toUpperCase()}</span><p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 5 }}>{Object.values(run.step_state).filter((step) => step.status === 'completed').length}/{Object.keys(run.step_state).length} steps completed{run.error ? ` · ${run.error}` : ''}</p></div><div style={{ display: 'flex', gap: 6 }}>{run.status === 'running' && <button onClick={() => act(`pause-${run.id}`, () => apiFetch(`/api/v1/workflow-runs/${run.id}/pause`, { method: 'POST' }), 'Run paused')} disabled={busy !== null}>Pause</button>}{run.status === 'paused' && <button onClick={() => act(`resume-${run.id}`, () => apiFetch(`/api/v1/workflow-runs/${run.id}/resume`, { method: 'POST' }), 'Run resumed')} disabled={busy !== null}>Resume</button>}{['queued', 'running', 'paused'].includes(run.status) && <button onClick={() => act(`cancel-${run.id}`, () => apiFetch(`/api/v1/workflow-runs/${run.id}/cancel`, { method: 'POST' }), 'Run cancellation requested')} disabled={busy !== null}>Cancel</button>}</div></div>)}
    </section>
  </div>;
};
