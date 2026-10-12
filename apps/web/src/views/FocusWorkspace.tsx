import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Activity, ArrowLeft, ArrowUpRight, CheckSquare, Clapperboard, Code2, FileText, Hexagon, LayoutGrid, MessageSquare, RefreshCw, ShieldCheck, Sparkles, Users, Workflow } from 'lucide-react';
import type { Task, TJEvent } from '@tj/schemas';
import { apiFetch } from '../api';
import './focus-workspace.css';

const ChatView = lazy(() => import('./ChatView').then((module) => ({ default: module.ChatView })));
const TasksView = lazy(() => import('./TasksView').then((module) => ({ default: module.TasksView })));
const AgentsView = lazy(() => import('./AgentsView').then((module) => ({ default: module.AgentsView })));
const MediaView = lazy(() => import('./MediaView').then((module) => ({ default: module.MediaView })));
const ActivityView = lazy(() => import('./ActivityView').then((module) => ({ default: module.ActivityView })));
const WorkbenchView = lazy(() => import('./WorkbenchView').then((module) => ({ default: module.WorkbenchView })));
const ApprovalsView = lazy(() => import('./ApprovalsView').then((module) => ({ default: module.ApprovalsView })));

const panes = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'conversations', label: 'Conversations', icon: MessageSquare },
  { id: 'missions', label: 'Missions', icon: CheckSquare },
  { id: 'agents', label: 'Agents', icon: Users },
  { id: 'deliverables', label: 'Deliverables', icon: Clapperboard },
  { id: 'workbench', label: 'Workbench', icon: Code2 },
  { id: 'activity', label: 'Activity & logs', icon: Activity },
  { id: 'approvals', label: 'Approvals', icon: ShieldCheck },
] as const;
type PaneId = typeof panes[number]['id'];
type Asset = { id: string; filename: string; mime_type: string };
type SavedRequest = { id: string; name: string; method: string };
type Overview = { tasks: Task[]; events: TJEvent[]; assets: Asset[]; requests: SavedRequest[] };
const capabilities = [
  { pane: 'conversations', label: 'Chat', description: 'Ask questions. Explore ideas.', icon: MessageSquare, color: 'blue' },
  { pane: 'workbench', label: 'Develop', description: 'Inspect APIs. Build connections.', icon: Code2, color: 'violet' },
  { pane: 'agents', label: 'Collaborate', description: 'Give your agents a direction.', icon: Users, color: 'green' },
  { pane: 'missions', label: 'Missions', description: 'Follow work through to delivery.', icon: Workflow, color: 'gold' },
] as const;
const timestamp = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const FocusWorkspace: React.FC<{ personaName: string }> = ({ personaName }) => {
  const [activePane, setActivePane] = useState<PaneId>('overview');
  const [openedPanes, setOpenedPanes] = useState<PaneId[]>([]);
  const [overview, setOverview] = useState<Overview>({ tasks: [], events: [], assets: [], requests: [] });
  const [errors, setErrors] = useState<Partial<Record<keyof Overview, string>>>({});
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const load = async () => {
      const results = await Promise.allSettled([
        apiFetch<{ tasks: Task[] }>('/api/v1/tasks', { signal: controller.signal }),
        apiFetch<{ events: TJEvent[] }>('/api/v1/system/activity?limit=6', { signal: controller.signal }),
        apiFetch<{ assets: Asset[] }>('/api/v1/media/assets', { signal: controller.signal }),
        apiFetch<{ requests: SavedRequest[] }>('/api/v1/workbench/requests', { signal: controller.signal }),
      ]);
      if (!alive) return;
      const nextErrors: Partial<Record<keyof Overview, string>> = {};
      results.forEach((result, index) => {
        const key = (['tasks', 'events', 'assets', 'requests'] as const)[index];
        if (result.status === 'fulfilled') setOverview((current) => ({ ...current, ...result.value }));
        else nextErrors[key] = 'Could not refresh. Try again.';
      });
      setErrors(nextErrors);
      setLoading(false);
    };
    void load();
    const interval = window.setInterval(() => void load(), 10000);
    return () => { alive = false; controller.abort(); window.clearInterval(interval); };
  }, [refresh]);

  const openPane = (pane: PaneId) => {
    setActivePane(pane);
    if (pane !== 'overview') setOpenedPanes((opened) => opened.includes(pane) ? opened : [...opened, pane]);
  };
  const renderPane = (pane: PaneId) => {
    switch (pane) {
      case 'conversations': return <ChatView personaName={personaName} onNavigate={(tab) => { if (panes.some((item) => item.id === tab)) openPane(tab as PaneId); }} />;
      case 'missions': return <TasksView />;
      case 'agents': return <AgentsView />;
      case 'deliverables': return <MediaView />;
      case 'activity': return <ActivityView />;
      case 'workbench': return <WorkbenchView />;
      case 'approvals': return <ApprovalsView />;
    }
  };
  const recentTasks = [...overview.tasks].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 4);
  const activeTasks = overview.tasks.filter((task) => ['running', 'analyzing', 'retrying'].includes(task.status));
  const empty = (key: keyof Overview, message: string) => <p className="tj-focus-empty" role={errors[key] ? 'alert' : undefined}>{errors[key] || (loading ? 'Loading workspace…' : message)}</p>;

  return <main className={`tj-focus-workspace ${activePane === 'overview' ? 'is-overview' : 'is-expanded'}`} aria-label="Focus productivity workspace">
    <header className="tj-focus-header">
      <div><span>THE LIVING NEXUS / FOCUS</span><h1>Multiple modes. One {personaName || 'TJ'}.</h1></div>
      <button className="tj-focus-refresh" onClick={() => setRefresh((value) => value + 1)} aria-label="Refresh Focus workspace"><RefreshCw size={14} /><span>Refresh</span></button>
    </header>
    <nav className="tj-focus-tabs" role="tablist" aria-label="Focus workspace sections">
      {panes.map(({ id, label, icon: Icon }) => <button key={id} id={`focus-tab-${id}`} type="button" role="tab" aria-selected={activePane === id} aria-controls={`focus-pane-${id}`} onClick={() => openPane(id)} className={activePane === id ? 'is-active' : ''}><Icon size={14} /><span>{label}</span></button>)}
    </nav>
    <section id="focus-pane-overview" role="tabpanel" aria-labelledby="focus-tab-overview" className="tj-focus-overview" hidden={activePane !== 'overview'}>
      <div className="tj-focus-left">
        <section className="tj-focus-glass tj-focus-library">
          <header><h2><FileText size={15} /> Your deliverables</h2><button onClick={() => openPane('deliverables')} aria-label="Open deliverables"><ArrowUpRight size={16} /></button></header>
          {overview.assets.length === 0 || errors.assets ? empty('assets', 'Your uploaded and generated assets will appear here.') : overview.assets.slice(0, 4).map((asset) => <button key={asset.id} className="tj-focus-resource" onClick={() => openPane('deliverables')}><span className="tj-focus-file-icon"><FileText size={17} /></span><span>{asset.filename}<small>{asset.mime_type}</small></span><ArrowUpRight size={13} /></button>)}
          <button className="tj-focus-text-link" onClick={() => openPane('deliverables')}>Open your library <ArrowUpRight size={13} /></button>
        </section>
        <section className="tj-focus-glass tj-focus-code">
          <header><h2><Code2 size={15} /> Development workbench</h2><span>API</span></header>
          <div className="tj-focus-code-chrome"><span /><span /><span /><span>Saved requests</span></div>
          {overview.requests.length === 0 || errors.requests ? empty('requests', 'Connect your first API to start building in this workspace.') : overview.requests.slice(0, 5).map((request, index) => <button className="tj-focus-request" key={request.id} onClick={() => openPane('workbench')}><span>{String(index + 1).padStart(2, '0')}</span><b>{request.method}</b><span>{request.name}</span></button>)}
          <button className="tj-focus-text-link" onClick={() => openPane('workbench')}>Open workbench <ArrowUpRight size={13} /></button>
        </section>
      </div>
      <div className="tj-focus-center">
        <p className="tj-focus-center-intro">A clear space for your next idea.</p>
        <div className="tj-focus-capabilities" aria-label="Workspace capabilities">{capabilities.map(({ pane, label, description, icon: Icon, color }) => <button key={pane} className={`tj-focus-capability is-${color}`} onClick={() => openPane(pane)}><Icon size={29} strokeWidth={1.6} /><strong>{label}</strong><span>{description}</span></button>)}</div>
        <div className="tj-focus-connections" aria-hidden="true"><i /><i /><i /><i /></div>
        <section className="tj-focus-glass tj-focus-companion">
          <div className="tj-focus-emblem" aria-hidden="true"><Hexagon size={58} strokeWidth={1.2} /><Sparkles size={22} /></div>
          <span className="tj-focus-eyebrow">YOUR INTELLIGENCE, IN FOCUS</span>
          <h2>{personaName || 'TJ'}</h2><p>From a thought to something real.</p>
          <button className="tj-focus-ask" onClick={() => openPane('conversations')}><span>What would you like to work on?</span><ArrowUpRight size={23} /></button>
          <div className="tj-focus-assurance"><span><MessageSquare size={12} /> Conversations</span><span><ShieldCheck size={12} /> Review approvals</span></div>
          <div className="tj-focus-action-review"><header><h3>Your work, moving forward</h3><span>{errors.tasks ? 'Unavailable' : loading ? 'Loading…' : `${activeTasks.length} active`}</span></header>{errors.tasks ? empty('tasks', '') : activeTasks.length ? activeTasks.slice(0, 2).map((task) => <button key={task.id} onClick={() => openPane('missions')}><CheckSquare size={15} /><span>{task.title}</span><small>{task.status}</small></button>) : <p>Set a direction. Follow each task and review decisions along the way.</p>}<button className="tj-focus-review-button" onClick={() => openPane('approvals')}><ShieldCheck size={15} /> Review approvals <ArrowUpRight size={14} /></button></div>
        </section>
        <div className="tj-focus-platform" aria-hidden="true" />
        <div className="tj-focus-shortcuts"><button onClick={() => openPane('conversations')}><MessageSquare size={13} /> Start a conversation</button><button onClick={() => openPane('missions')}><CheckSquare size={13} /> Follow a mission</button><button onClick={() => openPane('activity')}><Activity size={13} /> What changed?</button></div>
      </div>
      <div className="tj-focus-right">
        <section className="tj-focus-glass tj-focus-timeline"><header><h2><Workflow size={15} /> Mission timeline</h2><button onClick={() => openPane('missions')} aria-label="Open missions"><ArrowUpRight size={16} /></button></header>{recentTasks.length === 0 || errors.tasks ? empty('tasks', 'New missions will appear here when work begins.') : <ol>{recentTasks.map((task) => <li key={task.id}><time dateTime={task.created_at}>{timestamp(task.created_at)}</time><button onClick={() => openPane('missions')}><FileText size={19} /><span>{task.title}<small className={`is-${task.status}`}>{task.status.replaceAll('_', ' ')}</small></span></button></li>)}</ol>}</section>
        <section className="tj-focus-glass tj-focus-audit"><header><h2><ShieldCheck size={15} /> Activity log</h2><span>Recorded events</span></header>{overview.events.length === 0 || errors.events ? empty('events', 'No activity has been recorded yet.') : <ol>{overview.events.slice(0, 5).map((event) => <li key={event.id}><time dateTime={event.ts}>{timestamp(event.ts)}</time><span title={event.summary}>{event.summary || event.name}</span><i className={`is-${event.severity}`} aria-label={event.severity} /></li>)}</ol>}<button className="tj-focus-text-link" onClick={() => openPane('activity')}>View full activity log <ArrowUpRight size={13} /></button></section>
      </div>
    </section>
    {activePane !== 'overview' && <button className="tj-focus-back" onClick={() => openPane('overview')}><ArrowLeft size={14} /> Back to Focus overview</button>}
    <div className="tj-focus-content" hidden={activePane === 'overview'}>
      {openedPanes.map((pane) => <section key={pane} id={`focus-pane-${pane}`} role="tabpanel" aria-labelledby={`focus-tab-${pane}`} aria-hidden={activePane !== pane} className="tj-focus-pane" style={{ display: activePane === pane ? 'flex' : 'none' }}>
        <Suspense fallback={<div role="status" className="tj-focus-loading">Opening workspace…</div>}>{renderPane(pane)}</Suspense>
      </section>)}
    </div>
  </main>;
};
