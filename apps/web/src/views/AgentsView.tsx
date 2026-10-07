import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Users, Bot, CheckCircle } from 'lucide-react';

export const AgentsView: React.FC = () => {
  const [agents, setAgents] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);

  const load = () => {
    apiFetch<{ agents: any[] }>('/api/v1/agents').then((res) => setAgents(res.agents));
    apiFetch<{ templates: any[] }>('/api/v1/agents/templates').then((res) => setTemplates(res.templates));
  };

  useEffect(() => { load(); }, []);

  const handleSpawn = async (tpl: any) => {
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
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <h2 style={{ marginBottom: 8 }}>Agent Town & Specialist Roster</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9rem' }}>
        Autonomous agents with bounded permissions, tool registries, and state tracking.
      </p>

      <h3 style={{ marginBottom: 12 }}>Active Agents ({agents.length})</h3>
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
              <span>Status: <strong style={{ color: a.status === 'busy' ? '#fbbf24' : '#34d399' }}>{a.status}</strong></span>
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
              onClick={() => handleSpawn(t)}
              style={{ padding: '6px 12px', background: 'var(--border-strong)', border: 'none', borderRadius: 4, color: '#fff', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
            >
              Spawn Agent
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
