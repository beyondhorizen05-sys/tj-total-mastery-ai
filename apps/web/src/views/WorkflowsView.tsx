import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import type { Agent, Automation, Task, Workflow, WorkflowRun, WorkflowStep } from '@tj/schemas';
import { WorkflowGraph } from './WorkflowGraph';
import './workflows.css';

const stepKinds: { kind: WorkflowStep['kind']; label: string; icon: string; group: string; description: string }[] = [
  { kind: 'model', label: 'AI model', icon: '✧', group: 'Intelligence', description: 'Generate a response' },
  { kind: 'agent', label: 'Agent', icon: '◇', group: 'Intelligence', description: 'Delegate to an agent' },
  { kind: 'tool', label: 'Tool', icon: '⌘', group: 'Actions', description: 'Call an available tool' },
  { kind: 'connector', label: 'Connector', icon: '↗', group: 'Actions', description: 'Connect to a service' },
  { kind: 'approval', label: 'Approval', icon: '✓', group: 'Control', description: 'Pause for a decision' },
  { kind: 'wait', label: 'Wait', icon: '◷', group: 'Control', description: 'Delay the next step' },
  { kind: 'transform', label: 'Transform', icon: '{ }', group: 'Data', description: 'Shape step output' },
];

const defaultConfig = (kind: WorkflowStep['kind']): Record<string, unknown> => ({
  model: { prompt: '' }, agent: { agent_id: '', instruction: '' }, tool: { tool: '', input: {} },
  approval: { action: '', description: '' }, wait: { ms: 1000 },
  connector: { connector_id: '', action: '', input: {} }, transform: { value: '' },
} as Record<string, Record<string, unknown>>)[kind] ?? {};

function workflowRecoveryAdvice(reason: string): string {
  const text = reason.toLowerCase();
  if (/permission|denied|approval|not authorized/.test(text)) return 'Open Approvals and Permissions, inspect the denied action, and grant only the minimum required access. Then start a new run.';
  if (/fs_read|filesystem|project folder|path outside/.test(text)) return 'Check that the correct project folder is selected and trusted, then allow the workflow agent the specific file access it needs and rerun.';
  if (/provider|model|401|unauthor|rate limit|offline|no_providers/.test(text)) return 'Open Models, test the selected provider, and fix its credentials, availability, or rate limit. Then start a new run.';
  if (/timeout|timed out/.test(text)) return 'Reduce the step workload or increase its timeout in the workflow definition, save a new version, and run it again.';
  if (/no executor|step kind.*not available/.test(text)) return 'Replace this step with a supported action or enable/register the missing executor, then save and rerun.';
  if (/upstream|dependency|skipped/.test(text)) return 'Fix the failed upstream step shown in the run details. Downstream steps were skipped because they depend on it; start a new run after the fix.';
  return 'Inspect the failed step configuration and inputs below, correct the reported cause, save the workflow if needed, and start a new run.';
}

export const WorkflowsView: React.FC<{ initialMode?: 'studio' | 'hall' }> = ({ initialMode = 'studio' }) => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [workflowPrompt, setWorkflowPrompt] = useState('');
  const [dailyTime, setDailyTime] = useState('08:00');
  const [scheduleTimezone, setScheduleTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dubai');
  const [automationName, setAutomationName] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [inspectedStepId, setInspectedStepId] = useState<string | null>(null);
  const [configDrafts, setConfigDrafts] = useState<Record<string, string>>({});
  const [cron, setCron] = useState('0 8 * * 1-5');
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [componentSearch, setComponentSearch] = useState('');
  const [inspectorTab, setInspectorTab] = useState<'properties' | 'actions' | 'info'>('properties');
  const [activityTab, setActivityTab] = useState<'runs' | 'schedule' | 'create' | 'prompt'>('runs');
  const [workspaceMode, setWorkspaceMode] = useState<'studio' | 'hall'>(initialMode);

  useEffect(() => { setWorkspaceMode(initialMode); }, [initialMode]);

  const load = async () => {
    try {
      const [saved, executed, scheduled] = await Promise.all([
        apiFetch<{ workflows: Workflow[] }>('/api/v1/workflows'),
        apiFetch<{ runs: WorkflowRun[] }>('/api/v1/workflow-runs'),
        apiFetch<{ automations: Automation[] }>('/api/v1/automations'),
      ]);
      setWorkflows(saved.workflows); setRuns(executed.runs); setAutomations(scheduled.automations);
      setWorkflowId((current) => current || saved.workflows[0]?.id || '');
      setSelectedWorkflowId((current) => current || saved.workflows[0]?.id || '');
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
    try { await action(); setNotice(success); await load(); return true; }
    catch (reason: any) { setError(reason.message ?? 'Action failed'); return false; }
    finally { setBusy(null); }
  };

  const createWorkflow = (event: React.FormEvent) => {
    event.preventDefault();
    const step: WorkflowStep = { id: 'main', name: 'AI response', kind: 'model', depends_on: [], config: { prompt: prompt.trim() }, retry: { max_attempts: 2, backoff_ms: 1000, max_backoff_ms: 30000 }, timeout_ms: 120000, permissions: [], risk: 'low', continue_on_error: false };
    act('create-workflow', () => apiFetch('/api/v1/workflows', { method: 'POST', body: JSON.stringify({ name: name.trim(), description: 'Single-step AI workflow', steps: [step] }) }), 'Workflow saved. Run it when a model provider is ready.');
  };

  const createPromptWorkflow = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy('prompt-workflow'); setError(null); setNotice(null);
    try {
      const result = await apiFetch<{ workflow: Workflow; automation: Automation; planner_source: 'model' | 'fallback'; reused_or_created_agents: number }>('/api/v1/workflows/from-prompt', {
        method: 'POST', body: JSON.stringify({ prompt: workflowPrompt.trim(), time: dailyTime, timezone: scheduleTimezone }),
      });
      setNotice(`Saved “${result.workflow.name}” with ${result.workflow.steps.length} agent steps and scheduled it daily at ${dailyTime} (${scheduleTimezone}). ${result.planner_source === 'fallback' ? 'The AI planner was unavailable, so inspect this fallback plan before relying on it.' : 'The saved workflow uses the configured planning model.'} Scheduled runs still follow each agent’s permissions and approval rules; TJ must be running for its scheduler to trigger.`);
      setWorkflowPrompt(''); await load(); setWorkflowId(result.workflow.id); setSelectedWorkflowId(result.workflow.id); setActivityTab('schedule');
    } catch (reason: any) { setError(reason.message ?? 'Could not build and schedule workflow'); }
    finally { setBusy(null); }
  };

  const createAutomation = (event: React.FormEvent) => {
    event.preventDefault();
    const existing = automations.find((item) => item.id === editingAutomationId);
    void act('save-automation', () => apiFetch('/api/v1/automations', { method: 'POST', body: JSON.stringify({
      ...(existing ? { id: existing.id } : {}), name: automationName.trim(), workflow_id: workflowId,
      enabled: existing?.enabled ?? true,
      trigger: { kind: 'schedule', config: { ...existing?.trigger.config, cron: cron.trim() } },
    }) }), existing ? 'Schedule updated.' : 'Schedule saved. It will run at the next matching server-local time.').then((saved) => {
      if (saved) { setEditingAutomationId(null); setAutomationName(''); setCron('0 8 * * 1-5'); }
    });
  };

  const editAutomation = (automation: Automation) => {
    if (automation.trigger.kind !== 'schedule') return;
    setEditingAutomationId(automation.id); setAutomationName(automation.name);
    setWorkflowId(automation.workflow_id); setCron(String(automation.trigger.config.cron ?? ''));
    setError(null); setNotice(null);
  };
  const toggleAutomation = (automation: Automation) => void act(`toggle-${automation.id}`, () => apiFetch('/api/v1/automations', {
    method: 'POST', body: JSON.stringify({ id: automation.id, name: automation.name, description: automation.description,
      workflow_id: automation.workflow_id, enabled: !automation.enabled, trigger: automation.trigger }),
  }), automation.enabled ? 'Schedule disabled.' : 'Schedule enabled.');
  const deleteAutomation = (automation: Automation) => {
    if (!window.confirm(`Delete schedule “${automation.name}”? Past workflow runs will remain in history.`)) return;
    void act(`delete-${automation.id}`, () => apiFetch(`/api/v1/automations/${automation.id}`, { method: 'DELETE' }), 'Schedule deleted.').then((deleted) => {
      if (deleted && editingAutomationId === automation.id) setEditingAutomationId(null);
    });
  };

  const selectedWorkflow = draft ?? workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? workflows[0];
  const selectedRun = runs.find((run) => run.workflow_id === selectedWorkflow?.id);
  const inspectedStep = draft?.steps.find((step) => step.id === selectedStepId);
  const beginEdit = (workflow: Workflow) => {
    setDraft({ ...workflow, steps: workflow.steps.map((step) => ({ ...step, depends_on: [...step.depends_on], config: { ...step.config } })) });
    setSelectedWorkflowId(workflow.id);
    setSelectedStepId(workflow.steps[0]?.id ?? null);
    setConfigDrafts(Object.fromEntries(workflow.steps.map((step) => [step.id, JSON.stringify(step.config, null, 2)])));
    setError(null);
  };
  const beginNewDraft = (kind: WorkflowStep['kind'] = 'model') => {
    const id = crypto.randomUUID();
    const stepId = `step-${crypto.randomUUID().slice(0, 8)}`;
    const step: WorkflowStep = { id: stepId, name: `New ${kind} step`, kind, depends_on: [], config: defaultConfig(kind), retry: { max_attempts: 2, backoff_ms: 1000, max_backoff_ms: 30000 }, timeout_ms: 120000, permissions: [], risk: 'low', continue_on_error: false };
    const now = new Date().toISOString();
    setDraft({ id, workspace_id: 'default', project_id: null, name: 'New visual workflow', description: 'Created in the workflow canvas', version: 1, steps: [step], inputs_schema: {}, created_at: now, updated_at: now });
    setSelectedWorkflowId(id); setSelectedStepId(stepId); setInspectedStepId(stepId); setConfigDrafts({ [stepId]: JSON.stringify(step.config, null, 2) }); setError(null);
    setInspectorTab('properties');
  };
  const addStep = (kind: WorkflowStep['kind'] = 'model') => {
    if (!draft) return;
    const id = `step-${crypto.randomUUID().slice(0, 8)}`;
    const step: WorkflowStep = { id, name: `New ${kind} step`, kind, depends_on: selectedStepId ? [selectedStepId] : draft.steps.length ? [draft.steps[draft.steps.length - 1].id] : [], config: defaultConfig(kind), retry: { max_attempts: 2, backoff_ms: 1000, max_backoff_ms: 30000 }, timeout_ms: 120000, permissions: [], risk: 'low', continue_on_error: false };
    setDraft((current) => current ? { ...current, steps: [...current.steps, step] } : current);
    setConfigDrafts((current) => ({ ...current, [id]: JSON.stringify(step.config, null, 2) }));
    setSelectedStepId(id); setInspectedStepId(id); setInspectorTab('properties');
  };
  const updateDraftStep = (stepId: string, patch: Partial<WorkflowStep>) => setDraft((current) => current ? { ...current, steps: current.steps.map((step) => step.id === stepId ? { ...step, ...patch } : step) } : current);
  const removeDraftStep = (stepId: string) => {
    if (!draft || draft.steps.length <= 1) return;
    const remaining = draft.steps.filter((step) => step.id !== stepId).map((step) => ({ ...step, depends_on: step.depends_on.filter((dependency) => dependency !== stepId) }));
    setDraft({ ...draft, steps: remaining });
    setConfigDrafts((current) => { const next = { ...current }; delete next[stepId]; return next; });
    setSelectedStepId(remaining[0]?.id ?? null);
  };
  const saveDraft = async () => {
    if (!draft) return;
    setBusy('save-draft'); setError(null); setNotice(null);
    try {
      if (!draft.name.trim() || draft.steps.some((step) => !step.name.trim())) throw new Error('Workflow and step names are required.');
      const steps = draft.steps.map((step) => ({ ...step, config: JSON.parse(configDrafts[step.id] ?? '{}') as Record<string, unknown> }));
      const saved = await apiFetch<Workflow>('/api/v1/workflows', { method: 'POST', body: JSON.stringify({ id: draft.id, name: draft.name.trim(), description: draft.description, steps }) });
      setNotice(`Workflow saved as version ${saved.version}.`); setSelectedWorkflowId(saved.id); setDraft(null); await load();
    } catch (reason: any) { setError(reason instanceof Error ? reason.message : 'Workflow could not be saved'); }
    finally { setBusy(null); }
  };

  const visibleKinds = stepKinds.filter((item) => `${item.label} ${item.description} ${item.group}`.toLowerCase().includes(componentSearch.toLowerCase()));
  const activeStep = selectedWorkflow?.steps.find((step) => step.id === (inspectedStepId ?? selectedStepId)) ?? selectedWorkflow?.steps[0];
  const activeStepState = activeStep && !draft ? selectedRun?.step_state[activeStep.id] : undefined;

  return <div className={`tj-workflow-studio-root ${workspaceMode === 'hall' ? 'is-hall' : ''}`}>
    <header className="tj-workflow-studio-toolbar">
      <div className="tj-workflow-studio-identity"><span className="tj-workflow-studio-mark">✦</span><div><small>TJ / {workspaceMode === 'hall' ? 'COLLABORATION HALL' : 'WORKFLOW STUDIO'}</small><h2>{workspaceMode === 'hall' ? 'Collaboration Hall' : selectedWorkflow?.name ?? 'Build a workflow'}</h2></div></div>
      <div className="tj-workflow-studio-toolbar-actions">
        <button type="button" onClick={() => void load()} disabled={busy !== null} title="Refresh live workflow data">↻ <span>Refresh</span></button>
        {workspaceMode === 'studio' && <><button type="button" onClick={() => beginNewDraft()} title="Create a workflow">＋ <span>New</span></button>
        {draft ? <button type="button" className="tj-workflow-primary-action" onClick={() => void saveDraft()} disabled={busy !== null || !draft.name.trim()}>Save workflow</button> : <button type="button" className="tj-workflow-primary-action" disabled={!selectedWorkflow || busy !== null} onClick={() => selectedWorkflow && act(selectedWorkflow.id, () => apiFetch(`/api/v1/workflows/${selectedWorkflow.id}/run`, { method: 'POST' }), 'Workflow run queued. Watch its result below.')}>▷ <span>Run workflow</span></button>}</>}
      </div>
    </header>
    <nav className="tj-workflow-mode-switch" aria-label="Workflow workspace mode">
      <button type="button" aria-current={workspaceMode === 'studio' ? 'page' : undefined} onClick={() => setWorkspaceMode('studio')}>◇ Workflow Studio</button>
      <button type="button" aria-current={workspaceMode === 'hall' ? 'page' : undefined} onClick={() => setWorkspaceMode('hall')}>◎ Collaboration Hall</button>
    </nav>
    {(error || notice) && <div className="tj-workflow-messages">{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}</div>}

    {workspaceMode === 'hall' ? <CollaborationHall workflows={workflows} runs={runs} onOpenWorkflow={(workflow) => { setDraft(null); setSelectedWorkflowId(workflow.id); setInspectedStepId(workflow.steps[0]?.id ?? null); setWorkspaceMode('studio'); }} /> : <>
    <div className="tj-workflow-builder">
    <aside className="tj-workflow-library" aria-label="Workflow components and saved definitions">
      <div className="tj-workflow-pane-heading"><div><strong>Components</strong><small>Select a component to add a step</small></div><span aria-hidden="true">◫</span></div>
      <label className="tj-workflow-component-search"><span aria-hidden="true">⌕</span><input value={componentSearch} onChange={(event) => setComponentSearch(event.target.value)} placeholder="Search components" aria-label="Search workflow components" /></label>
      <div className="tj-workflow-component-groups">
        {['Intelligence', 'Actions', 'Control', 'Data'].map((group) => { const items = visibleKinds.filter((item) => item.group === group); return items.length ? <section className="tj-workflow-component-group" key={group}><h3>{group}</h3><div>{items.map((item) => <button type="button" className={`tj-workflow-component-tile kind-${item.kind}`} key={item.kind} onClick={() => draft ? addStep(item.kind) : beginNewDraft(item.kind)} title={`${draft ? 'Add' : 'Start a new workflow with'} ${item.label}`}><span aria-hidden="true">{item.icon}</span><strong>{item.label}</strong></button>)}</div></section> : null; })}
        {visibleKinds.length === 0 && <p className="tj-workflow-library-empty">No matching components.</p>}
      </div>
      <div className="tj-workflow-library-saved">
        <div className="tj-workflow-library-saved-heading"><strong>Saved workflows</strong><span>{workflows.length}</span></div>
        {workflows.length === 0 ? <p>No workflow saved yet.</p> : workflows.map((workflow) => <div key={workflow.id} className={`tj-workflow-saved-item ${selectedWorkflow?.id === workflow.id ? 'is-selected' : ''}`}><button type="button" className="tj-workflow-saved-open" onClick={() => { setDraft(null); setSelectedWorkflowId(workflow.id); setInspectedStepId(workflow.steps[0]?.id ?? null); }}><strong>{workflow.name}</strong><small>{workflow.steps.length} steps · version {workflow.version}</small></button><button type="button" onClick={() => beginEdit(workflow)} aria-label={`Edit ${workflow.name}`} title={`Edit ${workflow.name}`}>✎</button></div>)}
      </div>
    </aside>

    <main className="tj-workflow-canvas-column">
      <div className="tj-workflow-canvas-heading"><div><small>{draft ? 'UNSAVED DRAFT' : selectedWorkflow ? 'SAVED WORKFLOW' : 'NO WORKFLOW SELECTED'}</small><strong>{selectedWorkflow?.name ?? 'Workflow canvas'}</strong><span>{draft ? 'Save to make this workflow available for execution.' : selectedRun ? `Latest run ${selectedRun.id.slice(0, 8)} · ${selectedRun.status}` : selectedWorkflow ? 'No execution recorded yet' : 'Choose a component or create a workflow to begin.'}</span></div><span className="tj-workflow-canvas-count">{selectedWorkflow?.steps.length ?? 0} NODES</span></div>
      {selectedWorkflow ? <WorkflowGraph workflow={selectedWorkflow} run={draft ? undefined : selectedRun} editable={Boolean(draft)} selectedStepId={activeStep?.id} onSelectStep={(id) => { setSelectedStepId(id); setInspectedStepId(id); setInspectorTab('properties'); }} /> : <div className="tj-workflow-empty-canvas"><span aria-hidden="true">✧</span><strong>Start with a component</strong><p>Build a real workflow from model, agent, tool, and control steps.</p><button type="button" onClick={() => beginNewDraft()}>Create workflow</button></div>}
      <div className="tj-workflow-canvas-foot"><span>● Connections show saved dependencies</span><span>Live status comes from the latest recorded run</span></div>
    </main>

    <aside className="tj-workflow-properties" aria-label="Workflow inspector">
      <div className="tj-workflow-pane-heading"><div><strong>{activeStep?.name ?? 'Inspector'}</strong><small>{activeStep ? `${activeStep.kind} component` : 'Select a step to inspect'}</small></div><span aria-hidden="true">⌘</span></div>
      <div className="tj-workflow-inspector-tabs" role="tablist" aria-label="Inspector sections">{(['properties', 'actions', 'info'] as const).map((tab) => <button type="button" role="tab" aria-selected={inspectorTab === tab} key={tab} onClick={() => setInspectorTab(tab)}>{tab}</button>)}</div>
      <div className="tj-workflow-properties-content">
        {inspectorTab === 'properties' && <>
          {draft ? <form className="tj-workflow-editor" onSubmit={(event) => { event.preventDefault(); void saveDraft(); }}>
            <label className="tj-workflow-editor-name">Workflow name<input value={draft.name} required maxLength={100} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            {inspectedStep ? <div className="tj-workflow-step-form"><div className="tj-workflow-step-fields"><label>Step name<input value={inspectedStep.name} required maxLength={100} onChange={(event) => updateDraftStep(inspectedStep.id, { name: event.target.value })} /></label><label>Step type<select value={inspectedStep.kind} onChange={(event) => { const kind = event.target.value as WorkflowStep['kind']; const config = defaultConfig(kind); updateDraftStep(inspectedStep.id, { kind, config }); setConfigDrafts((current) => ({ ...current, [inspectedStep.id]: JSON.stringify(config, null, 2) })); }}>{stepKinds.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}</select></label></div>
            <label>Depends on<select multiple size={Math.min(4, Math.max(2, draft.steps.length))} value={inspectedStep.depends_on} onChange={(event) => updateDraftStep(inspectedStep.id, { depends_on: Array.from(event.currentTarget.selectedOptions, (option) => option.value) })}>{draft.steps.filter((step) => step.id !== inspectedStep.id).map((step) => <option key={step.id} value={step.id}>{step.name}</option>)}</select><small>Ctrl or Command selects multiple predecessors.</small></label>
            <label>Configuration · JSON<textarea spellCheck={false} value={configDrafts[inspectedStep.id] ?? '{}'} onChange={(event) => setConfigDrafts((current) => ({ ...current, [inspectedStep.id]: event.target.value }))} /></label>
            <div className="tj-workflow-editor-actions"><button type="button" disabled={draft.steps.length <= 1} onClick={() => removeDraftStep(inspectedStep.id)}>Remove step</button><button type="button" onClick={() => setDraft(null)}>Cancel</button><button id="tj-workflow-draft-save" type="submit" disabled={busy !== null || !draft.name.trim()}>{busy === 'save-draft' ? 'Saving…' : 'Save version'}</button></div></div> : <p>Select a node to edit its workflow step.</p>}
          </form> : activeStep ? <div className="tj-workflow-property-cards"><div><small>COMPONENT</small><strong>{activeStep.name}</strong><p>Type · {activeStep.kind}</p></div><div><small>EXECUTION STATUS</small><strong>{activeStepState?.status?.replaceAll('_', ' ') ?? 'Not run'}</strong><p>{activeStep.depends_on.length ? `${activeStep.depends_on.length} incoming connection${activeStep.depends_on.length === 1 ? '' : 's'}` : 'Trigger step'}</p></div><div><small>CONFIGURATION</small><pre>{JSON.stringify(activeStep.config, null, 2)}</pre></div>{activeStepState?.error && <p role="alert">{activeStepState.error}</p>}<button type="button" onClick={() => beginEdit(selectedWorkflow!)}>Edit workflow</button></div> : <p className="tj-workflow-inspector-placeholder">Select a node on the canvas to view its properties.</p>}
        </>}
        {inspectorTab === 'actions' && <div className="tj-workflow-property-cards"><div><small>WORKFLOW ACTIONS</small><strong>{selectedWorkflow?.name ?? 'No workflow selected'}</strong><p>{draft ? 'Save the draft before running.' : 'Run a saved workflow and inspect its result here.'}</p></div>{selectedWorkflow && !draft && <button type="button" disabled={busy !== null} onClick={() => act(selectedWorkflow.id, () => apiFetch(`/api/v1/workflows/${selectedWorkflow.id}/run`, { method: 'POST' }), 'Workflow run queued. Watch its result below.')}>▷ Run workflow</button>}{selectedRun && !draft && <div><small>LATEST RUN</small><strong>{selectedRun.status}</strong><p>{Object.values(selectedRun.step_state).filter((step) => step.status === 'completed').length}/{Object.keys(selectedRun.step_state).length} steps completed</p>{selectedRun.error && <p role="alert">{selectedRun.error}</p>}{selectedRun.status === 'running' && <button type="button" disabled={busy !== null} onClick={() => act(`pause-${selectedRun.id}`, () => apiFetch(`/api/v1/workflow-runs/${selectedRun.id}/pause`, { method: 'POST' }), 'Run paused')}>Pause run</button>}{selectedRun.status === 'paused' && <button type="button" disabled={busy !== null} onClick={() => act(`resume-${selectedRun.id}`, () => apiFetch(`/api/v1/workflow-runs/${selectedRun.id}/resume`, { method: 'POST' }), 'Run resumed')}>Resume run</button>}{['queued', 'running', 'paused'].includes(selectedRun.status) && <button type="button" disabled={busy !== null} onClick={() => act(`cancel-${selectedRun.id}`, () => apiFetch(`/api/v1/workflow-runs/${selectedRun.id}/cancel`, { method: 'POST' }), 'Run cancellation requested')}>Cancel run</button>}</div>}</div>}
        {inspectorTab === 'info' && <div className="tj-workflow-property-cards"><div><small>WORKFLOW INFO</small><strong>{selectedWorkflow?.name ?? 'No workflow selected'}</strong><p>{selectedWorkflow?.description ?? 'Select a workflow to inspect it.'}</p></div>{selectedWorkflow && <div><small>DEFINITION</small><p>ID · {selectedWorkflow.id}</p><p>Version · {selectedWorkflow.version}</p><p>Steps · {selectedWorkflow.steps.length}</p></div>}{activeStep && <div><small>SELECTED COMPONENT</small><p>ID · {activeStep.id}</p><p>Type · {activeStep.kind}</p><p>Inputs · {activeStep.depends_on.map((id) => selectedWorkflow?.steps.find((step) => step.id === id)?.name ?? id).join(', ') || 'Trigger'}</p></div>}{selectedRun && !draft && <div><small>RUNTIME INFO</small><p>Run · {selectedRun.id}</p><p>Status · {selectedRun.status}</p></div>}</div>}
      </div>
    </aside>
    </div>

    <section className="tj-workflow-operations"><div className="tj-workflow-operations-tabs" role="tablist" aria-label="Workflow operations">{([['runs', 'Recent executions'], ['schedule', 'Schedules'], ['prompt', 'Build daily workflow'], ['create', 'Quick model workflow']] as const).map(([tab, label]) => <button type="button" role="tab" aria-selected={activityTab === tab} key={tab} onClick={() => setActivityTab(tab)}>{label}{tab === 'runs' ? ` (${runs.length})` : tab === 'schedule' ? ` (${automations.length})` : ''}</button>)}</div>
    {activityTab === 'prompt' && <form className="tj-workflow-operations-form" onSubmit={createPromptWorkflow}>
      <h3>Describe it once. TJ builds and schedules it.</h3>
      <label>What should TJ do?<textarea value={workflowPrompt} onChange={(event) => setWorkflowPrompt(event.target.value)} required minLength={8} maxLength={4000} placeholder="Describe the outcome, steps, and how TJ should check its work." /></label>
      <label>Run every day at<input type="time" value={dailyTime} onChange={(event) => setDailyTime(event.target.value)} required /></label>
      <label>Timezone<input value={scheduleTimezone} onChange={(event) => setScheduleTimezone(event.target.value)} required maxLength={100} /></label>
      <div className="tj-workflow-operations-form-actions"><button type="submit" disabled={busy !== null || workflowPrompt.trim().length < 8 || !scheduleTimezone.trim()}>{busy === 'prompt-workflow' ? 'Building and scheduling…' : 'Build workflow & schedule daily'}</button></div>
      <small>TJ will plan agent steps, reuse deployed specialists, create only missing roles, save the workflow, and enable its daily schedule. Runs happen only while TJ is running; permission checks and approval requests remain active.</small>
    </form>}
    {activityTab === 'create' && <form className="tj-workflow-operations-form" onSubmit={createWorkflow}>
      <h3>Create a model workflow</h3>
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} /></label>
      <label>Prompt<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} required /></label>
      <div className="tj-workflow-operations-form-actions"><button type="submit" disabled={busy !== null || !name.trim() || !prompt.trim()}>Save workflow</button><button type="button" onClick={() => beginNewDraft()}>Open visual builder</button></div>
      <small>AI steps need a configured model provider before they can run.</small>
    </form>}

    {activityTab === 'schedule' && <form className="tj-workflow-operations-form" onSubmit={createAutomation}>
      <h3>{editingAutomationId ? 'Edit schedule' : 'Schedule a workflow'}</h3>
      <label>Automation name<input value={automationName} onChange={(event) => setAutomationName(event.target.value)} required /></label>
      <label>Workflow<select value={workflowId} onChange={(event) => setWorkflowId(event.target.value)} required><option value="">Select workflow</option>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select></label>
      <label>Cron schedule · server local time<input value={cron} onChange={(event) => setCron(event.target.value)} required /></label>
      <small>Example: 0 8 * * 1-5 runs Monday to Friday at 08:00.</small>
      <div className="tj-workflow-operations-form-actions"><button type="submit" disabled={busy !== null || !workflowId || !automationName.trim() || !cron.trim()}>{busy === 'save-automation' ? 'Saving…' : editingAutomationId ? 'Update schedule' : 'Save schedule'}</button>{editingAutomationId && <button type="button" disabled={busy !== null} onClick={() => { setEditingAutomationId(null); setAutomationName(''); setCron('0 8 * * 1-5'); }}>Cancel edit</button>}</div>
    </form>}

    {activityTab === 'schedule' && <section className="tj-workflow-operations-list"><h3>Saved schedules ({automations.length})</h3>
      {automations.length === 0 ? <p>No automations saved.</p> : automations.map((automation) => <div key={automation.id} className="tj-workflow-operation-item"><div><b>{automation.name}</b><p>{automation.enabled ? 'Enabled' : 'Disabled'} · {automation.trigger.kind} {String(automation.trigger.config.cron ?? '')} · Next: {automation.next_run_at ? new Date(automation.next_run_at).toLocaleString() : 'not scheduled'} · Runs: {automation.run_count}</p></div><div className="tj-workflow-run-actions"><button type="button" disabled={busy !== null} onClick={() => void act(automation.id, () => apiFetch(`/api/v1/automations/${automation.id}/trigger`, { method: 'POST' }), 'Automation triggered; inspect its workflow run below.')}>Run now</button>{automation.trigger.kind === 'schedule' && <button type="button" disabled={busy !== null} onClick={() => editAutomation(automation)}>Edit</button>}<button type="button" disabled={busy !== null} onClick={() => toggleAutomation(automation)}>{automation.enabled ? 'Disable' : 'Enable'}</button><button type="button" disabled={busy !== null} onClick={() => deleteAutomation(automation)}>Delete</button></div></div>)}
    </section>}

    {activityTab === 'runs' && <section className="tj-workflow-operations-list">
      {runs.length === 0 ? <p>No executions recorded.</p> : runs.map((run) => {
        const workflow = workflows.find((item) => item.id === run.workflow_id);
        const failedSteps = Object.entries(run.step_state).filter(([, step]) => step.status === 'failed' || step.status === 'skipped');
        const cause = failedSteps.find(([, step]) => step.status === 'failed' && step.error)?.[1].error ?? run.error ?? failedSteps.find(([, step]) => step.error)?.[1].error ?? 'No detailed failure was recorded.';
        return <div key={run.id} className="tj-workflow-operation-item"><div><b>Run {run.id.slice(0, 8)}</b><span className={`tj-workflow-run-status is-${run.status}`}>{run.status === 'completed' && run.checkpoint.partial ? 'COMPLETED WITH FAILURES' : run.status.toUpperCase()}</span><p>{Object.values(run.step_state).filter((step) => step.status === 'completed').length}/{Object.keys(run.step_state).length} steps completed{run.error ? ` · ${run.error}` : ''}</p>
          {run.status === 'failed' && <div className="tj-workflow-failure-details" style={{ marginTop: 9, padding: 10, border: '1px solid rgba(251,113,133,.3)', borderRadius: 7, background: 'rgba(67,24,37,.3)' }}><strong>Failure reason</strong>{failedSteps.length ? failedSteps.map(([id, step]) => <p key={id} style={{ margin: '5px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><b>{workflow?.steps.find((item) => item.id === id)?.name ?? id}</b> · {step.status}: {step.error ?? run.error ?? 'The step did not complete.'}</p>) : <p style={{ margin: '5px 0' }}>{run.error ?? 'TJ did not record a detailed failure reason.'}</p>}<strong>Suggested fix</strong><p style={{ margin: '5px 0 0' }}>{workflowRecoveryAdvice(cause)}</p></div>}
        </div><div className="tj-workflow-run-actions">{run.status === 'running' && <button type="button" onClick={() => act(`pause-${run.id}`, () => apiFetch(`/api/v1/workflow-runs/${run.id}/pause`, { method: 'POST' }), 'Run paused')} disabled={busy !== null}>Pause</button>}{run.status === 'paused' && <button type="button" onClick={() => act(`resume-${run.id}`, () => apiFetch(`/api/v1/workflow-runs/${run.id}/resume`, { method: 'POST' }), 'Run resumed')} disabled={busy !== null}>Resume</button>}{['queued', 'running', 'paused'].includes(run.status) && <button type="button" onClick={() => act(`cancel-${run.id}`, () => apiFetch(`/api/v1/workflow-runs/${run.id}/cancel`, { method: 'POST' }), 'Run cancellation requested')} disabled={busy !== null}>Cancel</button>}</div></div>;
      })}
    </section>}
    </section>
    </>}
  </div>;
};

const CollaborationHall: React.FC<{
  workflows: Workflow[];
  runs: WorkflowRun[];
  onOpenWorkflow: (workflow: Workflow) => void;
}> = ({ workflows, runs, onOpenWorkflow }) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rosterFilter, setRosterFilter] = useState<'all' | 'active' | 'meeting'>('active');
  const loadHall = async () => {
    const results = await Promise.allSettled([
      apiFetch<{ agents: Agent[] }>('/api/v1/agents'),
      apiFetch<{ tasks: Task[] }>('/api/v1/tasks'),
    ]);
    if (results[0].status === 'fulfilled') setAgents(results[0].value.agents);
    if (results[1].status === 'fulfilled') setTasks(results[1].value.tasks);
    setError(results.some((result) => result.status === 'rejected') ? 'Some live data could not refresh. Showing the latest available state.' : null);
    setLoading(false);
  };
  useEffect(() => {
    void loadHall();
    const timer = window.setInterval(() => void loadHall(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const meetingAgents = agents.filter((agent) => agent.status === 'meeting');
  const activeAgents = agents.filter((agent) => ['meeting', 'thinking', 'working', 'waiting_approval'].includes(agent.status));
  const visibleAgents = rosterFilter === 'meeting' ? meetingAgents : rosterFilter === 'active' ? activeAgents : agents;
  const activeTasks = tasks.filter((task) => ['analyzing', 'running', 'retrying', 'awaiting_approval'].includes(task.status));
  const currentRuns = runs.filter((run) => ['queued', 'analyzing', 'waiting', 'running', 'paused', 'awaiting_approval', 'retrying'].includes(run.status));
  const recentTasks = [...tasks].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);
  const recentRuns = [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);

  return <main className="tj-collab-hall" aria-label="Collaboration Hall live workspace">
    <div className="tj-collab-scene">
      <div className="tj-collab-architecture" aria-hidden="true">
        <div className="tj-collab-ceiling"><i /></div>
        <div className="tj-collab-window tj-collab-window-left"><i/><i/><i/></div>
        <div className="tj-collab-window tj-collab-window-right"><i/><i/><i/></div>
        <div className="tj-collab-table"><i /></div>
        <div className="tj-collab-chair tj-collab-chair-left" />
        <div className="tj-collab-chair tj-collab-chair-right" />
      </div>
      <div className="tj-collab-display" aria-label="Live meeting participants">
        {meetingAgents.length ? meetingAgents.slice(0, 6).map((agent) => <span key={agent.id}><b>{agent.name.slice(0, 1)}</b><small>{agent.name}</small></span>) : <p>No meeting is active</p>}
      </div>
      <div className="tj-collab-scene-copy">
        <span>THE LIVING NEXUS / COLLABORATION</span>
        <h1>Collaboration Hall</h1>
        <p>Watch deployed agents and work move together across TJ.</p>
      </div>
      <div className="tj-collab-scene-status" aria-label="Live collaboration summary">
        <div><strong>{meetingAgents.length}</strong><span>In a meeting</span></div>
        <div><strong>{activeAgents.length}</strong><span>Active agents</span></div>
        <div><strong>{activeTasks.length + currentRuns.length}</strong><span>Active work items</span></div>
      </div>
      <span className="tj-collab-scene-caption">Live agent and workflow state</span>
    </div>
    <div className="tj-collab-content">
      <div className="tj-collab-intro"><div><span>LIVE COLLABORATION</span><h2>At the table</h2><p>Agent status and execution state update every five seconds.</p></div><button type="button" onClick={() => void loadHall()}>↻ Refresh live state</button></div>
      {error && <p className="tj-collab-error" role="alert">{error}</p>}
      <div className="tj-collab-grid">
        <section className="tj-collab-panel tj-collab-people" aria-labelledby="tj-collab-people-title">
          <div className="tj-collab-panel-head"><div><span>01 / AGENTS</span><h3 id="tj-collab-people-title">Deployed team</h3></div><b>{agents.length}</b></div>
          <div className="tj-collab-filter" role="group" aria-label="Filter agent roster">
            {(['active', 'meeting', 'all'] as const).map((filter) => <button type="button" key={filter} aria-pressed={rosterFilter === filter} onClick={() => setRosterFilter(filter)}>{filter}</button>)}
          </div>
          <div className="tj-collab-panel-list" aria-live="polite">
            {loading ? <p className="tj-collab-empty">Loading agents…</p> : visibleAgents.length === 0 ? <p className="tj-collab-empty">{rosterFilter === 'meeting' ? 'No agent is currently in a meeting.' : rosterFilter === 'active' ? 'No agents are currently active.' : 'No agents have been deployed.'}</p> : visibleAgents.slice(0, 12).map((agent) => <article className="tj-collab-agent" key={agent.id}><span className="tj-collab-avatar" aria-hidden="true">{agent.avatar || agent.name.slice(0, 1)}</span><div><strong>{agent.name}</strong><small>{agent.role}</small>{agent.current_task_id && <small>Task {tasks.find((task) => task.id === agent.current_task_id)?.title ?? agent.current_task_id.slice(0, 8)}</small>}</div><span className={`tj-collab-status is-${agent.status}`}>{agent.status.replaceAll('_', ' ')}</span></article>)}
          </div>
          {visibleAgents.length > 12 && <p className="tj-collab-more">Showing 12 of {visibleAgents.length} matching agents</p>}
        </section>
        <section className="tj-collab-panel tj-collab-work" aria-labelledby="tj-collab-work-title">
          <div className="tj-collab-panel-head"><div><span>02 / WORK</span><h3 id="tj-collab-work-title">Shared task board</h3></div><b>{activeTasks.length} active</b></div>
          <div className="tj-collab-panel-list" aria-live="polite">
            {loading ? <p className="tj-collab-empty">Loading tasks…</p> : recentTasks.length === 0 ? <p className="tj-collab-empty">No tasks have been recorded.</p> : recentTasks.map((task) => <article className="tj-collab-task" key={task.id}><div><strong>{task.title}</strong><small>{task.status.replaceAll('_', ' ')} · {agents.find((agent) => agent.id === task.agent_id)?.name ?? 'Unassigned'}</small></div><span>{Math.round(task.progress * 100)}%</span><div className="tj-collab-progress"><i style={{ width: `${Math.round(task.progress * 100)}%` }} /></div></article>)}
          </div>
        </section>
        <section className="tj-collab-panel tj-collab-runs" aria-labelledby="tj-collab-runs-title">
          <div className="tj-collab-panel-head"><div><span>03 / EXECUTION</span><h3 id="tj-collab-runs-title">Workflow feed</h3></div><b>{runs.length}</b></div>
          <div className="tj-collab-panel-list" aria-live="polite">
            {recentRuns.length === 0 ? <p className="tj-collab-empty">No workflow executions recorded.</p> : recentRuns.map((run) => { const workflow = workflows.find((item) => item.id === run.workflow_id); return <article className="tj-collab-run" key={run.id}><div><strong>{workflow?.name ?? `Workflow ${run.workflow_id.slice(0, 8)}`}</strong><small>Run {run.id.slice(0, 8)} · {new Date(run.created_at).toLocaleString()}</small></div><span className={`tj-collab-status is-${run.status}`}>{run.status.replaceAll('_', ' ')}</span>{workflow && <button type="button" onClick={() => onOpenWorkflow(workflow)}>Inspect</button>}</article>; })}
          </div>
          {workflows.length > 0 && <div className="tj-collab-definitions"><span>SAVED DEFINITIONS</span>{workflows.slice(0, 4).map((workflow) => <button type="button" key={workflow.id} onClick={() => onOpenWorkflow(workflow)}>{workflow.name} <span>↗</span></button>)}</div>}
        </section>
      </div>
    </div>
  </main>;
};
