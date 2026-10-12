import React, { useState } from 'react';
import { Activity, ArrowUpRight, Headphones, Send, Sparkles, Users } from 'lucide-react';
import type { SystemStatus, TJPersona } from '@tj/schemas';
import { IdentityScene } from '../components/IdentityScene';
import { AgentTown3D } from '../components/AgentTown3D';
import './living-world.css';

interface Props {
  status: SystemStatus | null;
  persona: TJPersona;
  voiceSpeaking?: boolean;
  voicePulse?: number;
  onNavigate: (tab: string) => void;
  onOpenBuilding?: (tab: string) => void;
  onSelectAgent: (id: string) => void;
  onOpenPulse: () => void;
  onSendChat: (text: string, mode: 'auto' | 'chat' | 'build') => Promise<void>;
  loading: boolean;
}

export const CommandCenter: React.FC<Props> = ({ status, persona, voiceSpeaking, voicePulse, onNavigate, onOpenBuilding = onNavigate, onSelectAgent, onOpenPulse, onSendChat, loading }) => {
  const [input, setInput] = useState('');
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    void onSendChat(text, 'auto');
  };
  const soulState = status?.stop_all_engaged ? 'stopped' : voiceSpeaking ? 'speaking' : status?.tj_state ?? 'idle';
  const connected = status?.components?.every((component) => component.state === 'healthy') ?? false;

  return <main className="tj-living-world" aria-label="TJ Living World">
    <div className="tj-world-atmosphere" aria-hidden="true"><span /><i /><b /></div>
    <header className="tj-world-header">
      <div className="tj-world-title"><span className="tj-world-overline"><span className={`tj-world-live-dot ${connected ? 'is-live' : ''}`} /> THE LIVING NEXUS</span><h1>Living World</h1><p>Your intelligence headquarters</p></div>
      <div className="tj-world-status">
        <div><Users size={14} /><strong>{status?.active_agents ?? 0}</strong><span>agents active</span></div>
        <div><Activity size={14} /><strong>{status?.running_tasks ?? 0}</strong><span>missions running</span></div>
        <button type="button" onClick={() => onNavigate('approvals')}><span>{status?.pending_approvals ?? 0}</span> approvals <ArrowUpRight size={13} /></button>
      </div>
    </header>

    <section className="tj-world-scene" aria-label="Interactive agent headquarters">
      <div className="tj-world-scene-caption"><span>HEADQUARTERS / EARTH LOCAL</span><span>{status?.stop_all_engaged ? 'OPERATIONS PAUSED' : 'LIVE SYSTEM STATE'}</span></div>
      <AgentTown3D onSelectAgent={onSelectAgent} onOpenBuilding={onOpenBuilding} expanded />
    </section>

    <section className="tj-living-pulse" aria-label="Talk to TJ">
      <button type="button" className="tj-pulse-orb-button" aria-label="Open Living Pulse conversation" onClick={onOpenPulse}>
        <span className="tj-pulse-orb"><IdentityScene embodiment={persona.embodiment} state={soulState} speechPulse={voicePulse} /></span>
        <span className="tj-pulse-orb-indicator"><i className={voiceSpeaking ? 'is-speaking' : ''} /></span>
      </button>
      <div className="tj-pulse-copy"><span>{persona.name.toUpperCase()} <b>·</b> {soulState.toUpperCase()}</span><strong>The Living Pulse</strong></div>
      <form className="tj-pulse-composer" onSubmit={handleSubmit}>
        <Sparkles size={16} aria-hidden="true" />
        <input value={input} onChange={(event) => setInput(event.target.value)} disabled={loading} aria-label="Tell TJ what to do" placeholder={loading ? 'TJ is working on it…' : 'Speak or type a thought to begin'} />
        <button type="submit" disabled={loading || !input.trim()} aria-label="Send to TJ"><Send size={16} /><span>{loading ? 'Working' : 'Send'}</span></button>
      </form>
      <button type="button" className="tj-pulse-voice" onClick={onOpenPulse} aria-label="Open voice and conversation controls"><Headphones size={17} /></button>
    </section>
  </main>;
};
