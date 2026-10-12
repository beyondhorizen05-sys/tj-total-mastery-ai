import React, { useEffect, useState } from 'react';
import type { AgentStatus, TownAgent } from '@tj/schemas';
import { apiFetch } from '../api';
import { LivingHQScene } from './LivingHQScene';

type Mode = 'hq' | 'operations' | 'list';
type AgentCommunication = { id: string; ts: string; from_agent_id: string | null; to_agent_id: string | null; kind: string; task_id?: string | null };
const active = (status: AgentStatus) => ['thinking', 'working', 'waiting_approval', 'meeting'].includes(status);
const statusColor = (status: AgentStatus) => status === 'failed' || status === 'blocked' ? '#ff7189' : active(status) ? '#74e7da' : '#94a9bb';

export const AgentTown3D: React.FC<{ onSelectAgent: (id: string) => void; onOpenBuilding?: (destination: string) => void; expanded?: boolean }> = ({ onSelectAgent, onOpenBuilding = () => {}, expanded = false }) => {
  const [mode, setMode] = useState<Mode>('hq');
  const [agents, setAgents] = useState<TownAgent[]>([]);
  const [messages, setMessages] = useState<AgentCommunication[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let loading = false;
    let queued = false;
    const controller = new AbortController();
    const load = async () => {
      if (loading) { queued = true; return; }
      loading = true;
      try {
        const response = await apiFetch<{ agents: TownAgent[]; messages?: AgentCommunication[] }>('/api/v1/town/state', { signal: controller.signal });
        if (alive) {
          const next = response.agents ?? [];
          setAgents(next);
          setMessages(response.messages ?? []);
          setHasLoaded(true);
          setLoadFailed(false);
          setSelected(id => next.some(agent => agent.id === id) ? id : null);
        }
      } catch {
        if (alive) setLoadFailed(true);
      } finally {
        loading = false;
        if (alive && queued) { queued = false; void load(); }
      }
    };
    void load();
    const timer = window.setInterval(load, 15000);
    const stream = new EventSource('/api/v1/system/events');
    stream.onopen = () => { if (alive) { setConnected(true); void load(); } };
    stream.onerror = () => { if (alive) setConnected(false); };
    for (const name of ['agent.created', 'agent.updated', 'agent.deleted', 'agent.started', 'agent.completed', 'agent.failed', 'agent.message', 'task.started', 'task.progress', 'task.failed', 'task.cancelled', 'task.completed', 'approval.requested', 'approval.granted', 'approval.denied', 'workflow.step', 'workflow.paused', 'workflow.resumed', 'workflow.completed', 'workflow.failed', 'workflow.cancelled', 'system.stop_all']) stream.addEventListener(name, load);
    return () => { alive = false; controller.abort(); clearInterval(timer); stream.close(); };
  }, []);

  const selectedAgent = agents.find(agent => agent.id === selected);
  const syncLabel = loadFailed ? (hasLoaded ? 'LAST KNOWN STATE · RETRYING' : 'DATA UNAVAILABLE · RETRYING') : !hasLoaded ? 'CONNECTING TO AGENT STATE' : connected ? 'LIVE EVENT SYNC' : 'POLLING · 15 SEC';
  return <section className={`glass-panel tj-agent-town ${expanded ? 'is-expanded' : ''}`} aria-label="Living headquarters" style={{ overflow: 'hidden', minHeight: expanded ? 0 : 344, height: expanded ? '100%' : undefined, display: 'flex', flexDirection: 'column', position: 'relative' }}>
    <header className="tj-agent-town-toolbar" style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div><b style={{ fontSize: 12, letterSpacing: '.11em' }}>LIVING NEXUS HQ</b><span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 9 }}>{agents.length} deployed · {agents.filter(agent => active(agent.status)).length} active · {syncLabel}</span></div>
      <div role="group" aria-label="Headquarters views" style={{ display: 'flex', gap: 4 }}>
        {(['hq', 'operations', 'list'] as const).map(view => <button key={view} type="button" aria-pressed={mode === view} onClick={() => setMode(view)} style={{ fontSize: 10, padding: '5px 9px', cursor: 'pointer', border: '1px solid var(--border-subtle)', borderRadius: 4, color: mode === view ? 'var(--accent-cyan)' : 'var(--text-muted)', background: mode === view ? 'var(--accent-cyan-dim)' : 'transparent' }}>{view === 'hq' ? 'HQ SCENE' : view === 'operations' ? 'OPERATIONS' : 'AGENT LIST'}</button>)}
      </div>
    </header>
    {mode === 'hq' ? <div className="tj-agent-town-canvas" style={{ flex: 1, minHeight: expanded ? 0 : 300, position: 'relative' }}>
      <LivingHQScene agents={agents} messages={messages} selectedAgentId={selected} onSelectAgent={setSelected} onOpenRoom={onOpenBuilding} height="100%" />
      {loadFailed && <div role="status" style={{ position: 'absolute', top: 12, left: 12, padding: '7px 10px', borderRadius: 6, background: 'rgba(50,20,31,.9)', color: '#ffc2ca', fontSize: 10 }}>{syncLabel}</div>}
      {!hasLoaded && !loadFailed && <div role="status" style={{ position: 'absolute', top: 12, left: 12, padding: '7px 10px', borderRadius: 6, background: 'rgba(7,16,29,.86)', color: '#b7d4e8', fontSize: 10 }}>{syncLabel}</div>}
    </div> : <div style={{ minHeight: expanded ? 0 : 300, flex: 1, overflowY: 'auto', padding: 14 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 11, color: 'var(--text-muted)' }}><span>{agents.filter(agent => agent.workstation_id).length} desks reserved</span><span>{agents.filter(agent => agent.task_id).length} linked tasks</span><span>{syncLabel}</span></div>
      {agents.length === 0 ? <p role="status" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{loadFailed ? 'Agent state unavailable. Retrying automatically.' : hasLoaded ? 'No agents deployed.' : 'Loading agents…'}</p> : agents.map(agent => <button key={agent.id} type="button" aria-pressed={selected === agent.id} onClick={() => setSelected(agent.id)} style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', gap: 9, alignItems: 'center', color: 'var(--text-main)', background: selected === agent.id ? 'rgba(35,82,105,.72)' : 'rgba(13,35,55,.55)', border: '1px solid var(--border-subtle)', borderRadius: 5, padding: 9, marginBottom: 6, cursor: 'pointer', fontSize: 11 }}><span><b>{agent.name}</b><small style={{ display: 'block', color: 'var(--text-muted)', marginTop: 3 }}>{agent.area.replaceAll('_', ' ')}{agent.task_id ? ` · task ${agent.task_id.slice(0, 8)}` : ''}</small></span><span style={{ color: statusColor(agent.status), whiteSpace: 'nowrap' }}>{agent.status.replaceAll('_', ' ')}</span></button>)}
    </div>}
    <footer className="tj-agent-town-detail" style={{ minHeight: 36, padding: '8px 14px', borderTop: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: 11 }}>{selectedAgent ? <><b style={{ color: '#eaf9ff' }}>{selectedAgent.name}</b> · {selectedAgent.status.replaceAll('_', ' ')} · {selectedAgent.area.replaceAll('_', ' ')}{selectedAgent.task_id && <> · task {selectedAgent.task_id.slice(0, 8)}</>}{selectedAgent.workstation_id && <> · {selectedAgent.workstation_id.split(':').at(-1)} reserved</>} <button type="button" onClick={() => onSelectAgent(selectedAgent.id)} style={{ border: 0, color: 'var(--accent-cyan)', background: 'none', cursor: 'pointer' }}>Agent details →</button></> : 'Select a deployed agent or a room to inspect its live status'} </footer>
  </section>;
};
