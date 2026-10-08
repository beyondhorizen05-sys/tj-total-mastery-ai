import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { MapPin } from 'lucide-react';
import type { Agent, AgentTemplate } from '@tj/schemas';

interface AgentTownProps {
  onSelectAgent?: (id: string) => void;
  onBrowseAgents?: () => void;
}

export const AgentTown: React.FC<AgentTownProps> = ({ onSelectAgent, onBrowseAgents }) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [activeArea, setActiveArea] = useState<string>('all');

  const loadData = async () => {
    try {
      const [agRes, tplRes] = await Promise.all([
        apiFetch<{ agents: Agent[] }>('/api/v1/agents'),
        apiFetch<{ templates: AgentTemplate[] }>('/api/v1/agents/templates'),
      ]);
      setAgents(agRes.agents ?? []);
      setTemplates(tplRes.templates ?? []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 5000);
    return () => clearInterval(timer);
  }, []);

  const areas = [
    { id: 'all', label: 'All Quarters' },
    { id: 'command_center', label: 'Command Hub' },
    { id: 'research_lab', label: 'Research Lab' },
    { id: 'dev_studio', label: 'Dev Studio' },
    { id: 'meeting_hall', label: 'Council / Hall' },
    { id: 'creative_studio', label: 'Creative' },
    { id: 'operations', label: 'Operations' },
  ];

  const displayItems = [
    ...agents.map((agent) => ({ key: agent.id, name: agent.name, role: agent.role, avatar: agent.avatar, status: agent.status, area: agent.town_area, agent })),
    ...templates.filter((template) => !agents.some((agent) => agent.template_id === template.id)).map((template) => ({ key: template.id, name: template.name, role: template.role, avatar: template.avatar, status: 'not deployed', area: template.town_area, agent: null })),
  ].filter((item) => activeArea === 'all' || item.area === activeArea);

  return (
    <div className="glass-panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MapPin size={16} color="var(--accent-cyan)" />
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: '0.8rem', fontWeight: 800, letterSpacing: '0.1em', color: '#fff' }}>
            AGENT TOWN // VISUAL HUB
          </span>
          <span style={{ fontSize: '0.65rem', background: 'rgba(0, 242, 254, 0.1)', color: 'var(--accent-cyan)', padding: '2px 6px', borderRadius: 4 }}>
            {agents.length} DEPLOYED / {templates.length} TEMPLATES
          </span>
        </div>

        {/* Area tabs */}
        <div style={{ display: 'flex', gap: 4 }}>
          {areas.map((ar) => (
            <button
              key={ar.id} onClick={() => setActiveArea(ar.id)}
              style={{
                padding: '3px 8px', fontSize: '0.65rem', fontFamily: 'JetBrains Mono',
                borderRadius: 4, border: '1px solid',
                borderColor: activeArea === ar.id ? 'var(--accent-cyan)' : 'transparent',
                background: activeArea === ar.id ? 'rgba(0, 242, 254, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                color: activeArea === ar.id ? 'var(--accent-cyan)' : 'var(--text-muted)', cursor: 'pointer',
              }}
            >
              {ar.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Agent Nodes */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 10,
        maxHeight: 220,
        overflowY: 'auto',
        paddingRight: 4,
      }}>
        {displayItems.map(({ key, name, role, avatar, status, agent }) => {
          const isBusy = status === 'working' || status === 'thinking';
          const isIdle = status === 'idle';
          return (
            <div
              key={key}
              onClick={() => agent ? onSelectAgent?.(agent.id) : onBrowseAgents?.()}
              style={{
                padding: '10px 12px', borderRadius: 8,
                background: isBusy ? 'rgba(0, 242, 254, 0.08)' : 'rgba(10, 18, 34, 0.6)',
                border: `1px solid ${isBusy ? 'var(--accent-cyan)' : 'rgba(30, 58, 102, 0.4)'}`,
                display: 'flex', alignItems: 'center', gap: 10, cursor: agent ? 'pointer' : onBrowseAgents ? 'pointer' : 'default',
                transition: 'all 0.2s ease', position: 'relative', overflow: 'hidden',
              }}
            >
              {/* Avatar */}
              <div style={{
                width: 32, height: 32, borderRadius: 6, fontSize: '1.1rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)',
              }}>
                {avatar || '🤖'}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {name}
                  </span>
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                  {role} · {status === 'not deployed' ? 'template only · open roster to deploy' : status}
                </div>
              </div>

              {/* Live State Pulse */}
              <div
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: isBusy ? 'var(--accent-emerald)' : isIdle ? 'var(--accent-cyan)' : 'var(--text-dim)',
                  boxShadow: isBusy ? '0 0 8px var(--accent-emerald)' : 'none',
                }}
                title={`Status: ${status}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
