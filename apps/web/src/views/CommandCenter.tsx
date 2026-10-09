import React, { useState } from 'react';
import { IdentityScene } from '../components/IdentityScene';
import { AgentTown3D } from '../components/AgentTown3D';
import { ArrowUpRight, HardDrive, Cpu, Users, Boxes, Sliders, ShieldAlert, Send, Sparkles, Activity, Orbit } from 'lucide-react';
import type { SystemStatus, TJPersona } from '@tj/schemas';
import './future-hub.css';

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
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput('');
    void onSendChat(text, mode);
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
    <main className="tj-command-center tj-future-hub">
      <section className="tj-future-hero" aria-label="TJ command environment">
        <div className="tj-future-grain" aria-hidden="true" />
        <div className="tj-future-topline">
          <span className="tj-future-eyebrow"><Orbit size={14} aria-hidden="true" /> TOTAL MASTERY / COMMAND ENVIRONMENT</span>
          <span className="tj-future-live"><span className="tj-future-live-dot" /> SYSTEM {status?.stop_all_engaged ? 'PAUSED' : 'ONLINE'}</span>
        </div>
        <div className="tj-future-hero-body">
          <div className="tj-future-intro">
            <span className="tj-future-index">01 / THE INTELLIGENCE LAYER</span>
            <h1>Your next<br /><em>move starts here.</em></h1>
            <p>One thought can set everything in motion. Tell {persona.name} what you want to make possible.</p>
            <div className="tj-future-context"><Activity size={13} aria-hidden="true" /><span>{persona.name.toUpperCase()} / {orbState.toUpperCase()}</span><span className="tj-future-context-divider" /><span>{status?.active_agents ?? 0} AGENTS ACTIVE</span></div>
          </div>
          <div className="tj-future-portal">
            <div className="tj-future-portal-ring ring-one" aria-hidden="true" />
            <div className="tj-future-portal-ring ring-two" aria-hidden="true" />
            <div className="tj-future-portal-ring ring-three" aria-hidden="true" />
            <div className="tj-future-portal-label north" aria-hidden="true">T J / 0 1</div>
            <IdentityScene embodiment={persona.embodiment} state={orbState} speechPulse={voicePulse} className="tj-command-identity" />
            <div className="tj-future-portal-label south" aria-hidden="true">AWARE · READY · YOURS</div>
          </div>
        </div>
        <div className="tj-future-bottomline">
          <div className="tj-future-form-choice" role="group" aria-label="TJ visual form">
            <span>FORM</span>
            {(['core', 'female', 'male'] as const).map((form) => <button key={form} type="button" onClick={() => void onChooseForm(form)} aria-pressed={persona.embodiment === form} className={persona.embodiment === form ? 'is-selected' : ''}>{form}</button>)}
          </div>
          <span className="tj-future-edition">PERSONAL INTELLIGENCE / v01</span>
        </div>
      </section>

      <section className="tj-future-directive" aria-label="Give TJ a directive">
        <div className="tj-future-directive-head">
          <div><span className="tj-future-kicker"><Sparkles size={14} aria-hidden="true" /> DIRECTIVE INPUT</span><h2>What shall we do next?</h2></div>
          <div className="tj-future-modes" role="group" aria-label="Directive mode">
            {(['auto', 'chat', 'build'] as const).map((nextMode) => <button key={nextMode} type="button" onClick={() => setMode(nextMode)} aria-pressed={mode === nextMode} className={mode === nextMode ? 'is-selected' : ''}>{nextMode}</button>)}
          </div>
        </div>
        <form onSubmit={handleSubmit} className="tj-future-directive-form">
          <input type="text" value={input} onChange={(event) => setInput(event.target.value)} disabled={loading} aria-label="Your directive for TJ" placeholder={mode === 'auto' ? 'Describe a goal. TJ will plan the next steps…' : mode === 'build' ? 'Describe what you want to build…' : 'Ask TJ anything…'} />
          <button type="submit" disabled={loading || !input.trim()} aria-label="Send directive to TJ"><span>{loading ? 'WORKING' : 'EXECUTE'}</span><Send size={14} aria-hidden="true" /></button>
        </form>
        <div className="tj-future-directive-foot"><span>YOUR INTENT → TJ'S NEXT MOVE</span><span>ENTER TO SEND ↗</span></div>
      </section>

      <section className="tj-future-systems" aria-label="TJ systems">
        <div className="tj-future-section-head"><div><span className="tj-future-index">02 / CONNECTED SYSTEMS</span><h2>Every part, within reach.</h2></div><span>SIX CORE SYSTEMS <ArrowUpRight size={14} aria-hidden="true" /></span></div>
        <div className="tj-module-grid tj-future-module-grid">
          {modules.map((mod, index) => {
            const Icon = mod.icon;
            return <button type="button" key={mod.id} onClick={() => onNavigate(mod.id)} className="tj-future-module">
              <span className="tj-future-module-number">0{index + 1}</span>
              <Icon size={21} color={mod.color} aria-hidden="true" />
              <strong>{mod.label}</strong>
              <small title={mod.count}>{mod.count}</small>
              <ArrowUpRight size={15} className="tj-future-module-arrow" aria-hidden="true" />
            </button>;
          })}
        </div>
      </section>
      <AgentTown3D onSelectAgent={onSelectAgent} />
    </main>
  );
};
