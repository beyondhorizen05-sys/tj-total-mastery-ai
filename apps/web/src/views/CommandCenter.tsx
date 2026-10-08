import React, { useState } from 'react';
import { IdentityScene } from '../components/IdentityScene';
import { AgentTown3D } from '../components/AgentTown3D';
import { HardDrive, Cpu, Users, Boxes, Sliders, ShieldAlert, Send, Sparkles, Activity } from 'lucide-react';
import type { SystemStatus, TJPersona } from '@tj/schemas';

interface Props {
  status: SystemStatus | null;
  persona: TJPersona;
  onChooseForm: (form: TJPersona['embodiment']) => Promise<void>;
  voiceSpeaking?: boolean;
  voicePulse?: number;
  onNavigate: (tab: string) => void;
  onSelectAgent: (id: string) => void;
  onSendChat: (text: string, mode: 'auto' | 'chat' | 'build') => Promise<void>;
  loading: boolean;
}

export const CommandCenter: React.FC<Props> = ({ status, persona, onChooseForm, voiceSpeaking, voicePulse, onNavigate, onSelectAgent, onSendChat, loading }) => {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'auto' | 'chat' | 'build'>('auto');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const txt = input;
    setInput('');
    onSendChat(txt, mode);
  };

  const orbState = status?.stop_all_engaged ? 'stopped' : voiceSpeaking ? 'speaking' : status?.tj_state ?? 'idle';

  const modules = [
    { id: 'memory', label: 'Memory Core', icon: HardDrive, count: 'Searchable', color: 'var(--accent-purple)' },
    { id: 'capabilities', label: 'Skills & Tools', icon: Boxes, count: 'Sandboxed', color: 'var(--accent-cyan)' },
    { id: 'agents', label: 'Agent Mesh', icon: Users, count: `${status?.active_agents ?? 0} Active`, color: 'var(--accent-emerald)' },
    { id: 'approvals', label: 'Approvals', icon: ShieldAlert, count: `${status?.pending_approvals ?? 0} Pending`, color: 'var(--accent-amber)' },
    { id: 'models', label: 'Model Router', icon: Cpu, count: status?.current_model_id ?? 'Unbound', color: 'var(--accent-blue)' },
    { id: 'settings', label: 'Policy', icon: Sliders, count: status?.mode === 'local' ? 'Local only' : 'Hybrid', color: 'var(--text-muted)' },
  ];

  return (
    <div className="tj-command-center" style={{ flex: 1, height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 18px' }}>
      <div className="glass-panel" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
        <div style={{ position: 'absolute', top: 12, left: 16, display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}>
          <Activity size={13} color="var(--accent-cyan)" />
          <span>TJ COMMAND ENVIRONMENT</span>
        </div>

        <div style={{ width: '100%', height: 190, margin: '10px 0 4px' }}>
          <IdentityScene embodiment={persona.embodiment} state={orbState} speechPulse={voicePulse} className="tj-command-identity" />
        </div>
        <div style={{ fontSize: 10, color: 'var(--accent-cyan)', letterSpacing: '.18em', marginBottom: 9 }}>{persona.name.toUpperCase()} / {orbState.toUpperCase()}</div>
        <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>{(['core', 'female', 'male'] as const).map((form) => <button key={form} onClick={() => onChooseForm(form)} style={{ cursor: 'pointer', padding: '5px 10px', borderRadius: 12, border: `1px solid ${persona.embodiment === form ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`, color: persona.embodiment === form ? 'var(--accent-cyan)' : 'var(--text-muted)', background: persona.embodiment === form ? 'var(--accent-cyan-dim)' : 'transparent', fontSize: 10, textTransform: 'uppercase' }}>{form}</button>)}</div>

        <div className="tj-module-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, width: '100%', maxWidth: 940 }}>
          {modules.map((mod) => {
            const Icon = mod.icon;
            return (
              <div
                key={mod.id} onClick={() => onNavigate(mod.id)}
                style={{
                  padding: '8px 6px', borderRadius: 6, background: 'rgba(8, 15, 30, 0.6)',
                  border: '1px solid rgba(30, 58, 102, 0.4)', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 3, cursor: 'pointer', textAlign: 'center',
                }}
              >
                <Icon size={15} color={mod.color} />
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#fff' }}>{mod.label}</span>
                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}>{mod.count}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="glass-panel-glow" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={15} color="var(--accent-cyan)" />
            <span style={{ fontFamily: 'JetBrains Mono', fontSize: '0.78rem', fontWeight: 800, color: '#fff' }}>DIRECTIVE</span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['auto', 'chat', 'build'] as const).map((m) => (
              <button
                key={m} type="button" onClick={() => setMode(m)}
                style={{
                  padding: '3px 8px', fontSize: '0.65rem', fontFamily: 'JetBrains Mono', borderRadius: 4,
                  border: '1px solid', borderColor: mode === m ? 'var(--accent-cyan)' : 'var(--border-subtle)',
                  background: mode === m ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
                  color: mode === m ? 'var(--accent-cyan)' : 'var(--text-muted)', cursor: 'pointer',
                }}
              >{m}</button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text" value={input} onChange={(e) => setInput(e.target.value)} disabled={loading}
            placeholder={mode === 'auto' ? 'Instruct TJ to plan and orchestrate...' : 'Ask TJ anything...'}
            style={{
              flex: 1, padding: '10px 14px', background: 'rgba(5, 10, 22, 0.85)',
              border: '1px solid var(--border-subtle)', borderRadius: 6, color: '#fff', fontSize: '0.82rem', outline: 'none',
            }}
          />
          <button
            type="submit" disabled={loading || !input.trim()}
            style={{
              padding: '0 16px', borderRadius: 6, border: 'none',
              background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))',
              color: '#000', fontWeight: 800, fontSize: '0.75rem', cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6, opacity: loading || !input.trim() ? 0.5 : 1,
            }}
          >
            <span>RUN</span><Send size={13} />
          </button>
        </form>
      </div>

      <AgentTown3D onSelectAgent={onSelectAgent} />
    </div>
  );
};
