import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import type { Agent, AgentTemplate } from '@tj/schemas';

export const AgentsView: React.FC<{ selectedAgentId?: string | null }> = ({ selectedAgentId }) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [busyTemplate, setBusyTemplate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    Promise.all([apiFetch<{ agents: Agent[] }>('/api/v1/agents'), apiFetch<{ templates: AgentTemplate[] }>('/api/v1/agents/templates')])
      .then(([deployed, available]) => { setAgents(deployed.agents); setTemplates(available.templates); setError(null); })
      .catch((reason) => setError(reason.message ?? 'Could not load agents'));
  };

  useEffect(() => { load(); }, []);

  const handleSpawn = async (tpl: AgentTemplate) => {
    setBusyTemplate(tpl.id);
    try {
      await apiFetch('/api/v1/agents', {
        method: 'POST',
        body: JSON.stringify({
          template_id: tpl.id,
          name: tpl.name,
          role: tpl.role,
          description: tpl.description,
          personality: tpl.personality,
          system_instructions: tpl.system_instructions,
          tools: tpl.tools,
          permissions: tpl.permissions,
        }),
      });
      load();
    } catch (e: any) { setError(e.message ?? 'Could not deploy agent'); }
    finally { setBusyTemplate(null); }
  };

  const selected = agents.find((agent) => agent.id === selectedAgentId);

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <h2 style={{ marginBottom: 8 }}>Agent Town & Specialist Roster</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9rem' }}>
        Autonomous agents with bounded permissions, tool registries, and state tracking.
      </p>

      {error && <p role="alert" style={{ color: '#fb7185', marginBottom: 12 }}>{error}</p>}
      {selectedAgentId && !selected && <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>Selected agent is no longer deployed.</p>}
      {selected && <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--accent-cyan)', borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h3>{selected.avatar} {selected.name}</h3>
        <p style={{ color: 'var(--text-muted)', marginTop: 6 }}>{selected.role} · {selected.status} · {selected.town_area.replaceAll('_', ' ')}</p>
        <p style={{ marginTop: 8 }}>{selected.description}</p>
        <p style={{ color: 'var(--text-muted)', marginTop: 8, fontSize: 12 }}>Current task: {selected.current_task_id ?? 'none'} · Completed: {selected.metrics.tasks_completed} · Failed: {selected.metrics.tasks_failed}</p>
        <p style={{ color: 'var(--text-muted)', marginTop: 4, fontSize: 12 }}>Tools: {selected.tools.length ? selected.tools.join(', ') : 'none'} · Permissions: {selected.permissions.length ? selected.permissions.join(', ') : 'none'}</p>
      </div>}
      <h3 style={{ marginBottom: 12 }}>Deployed Agents ({agents.length})</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 32 }}>
        {agents.map((a) => (
          <div key={a.id} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: '1.4rem' }}>{a.avatar || '🤖'}</span>
              <div>
                <div style={{ fontWeight: 700 }}>{a.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)' }}>{a.role}</div>
              </div>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>{a.description}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span>Status: <strong style={{ color: ['thinking', 'working', 'waiting_approval', 'meeting'].includes(a.status) ? '#fbbf24' : a.status === 'failed' || a.status === 'blocked' ? '#fb7185' : '#34d399' }}>{a.status}</strong></span>
              <span>Tasks: {a.metrics?.tasks_completed ?? 0}</span>
            </div>
          </div>
        ))}
      </div>

      <h3 style={{ marginBottom: 12 }}>Specialist Templates</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {templates.map((t) => (
          <div key={t.id} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: '1.4rem' }}>{t.avatar}</span>
              <div>
                <div style={{ fontWeight: 700 }}>{t.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--accent-purple)' }}>{t.role}</div>
              </div>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', flex: 1, marginBottom: 12 }}>{t.description}</div>
            <button
              onClick={() => handleSpawn(t)} disabled={busyTemplate === t.id}
              style={{ padding: '6px 12px', background: 'var(--border-strong)', border: 'none', borderRadius: 4, color: '#fff', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
            >
              {busyTemplate === t.id ? 'Deploying…' : 'Deploy Agent'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
