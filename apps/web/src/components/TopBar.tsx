import React from 'react';
import { Cpu, ShieldCheck, Sliders, Power, Lock, Globe2, Focus, Workflow, Bell, Mic } from 'lucide-react';
import type { SystemStatus } from '@tj/schemas';

interface TopBarProps {
  status: SystemStatus | null;
  stopping: boolean;
  onStopAll: () => void;
  onNavigate: (tab: string) => void;
  activeTab: string;
  onOpenLiveVoice?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ status, stopping, onStopAll, onNavigate, activeTab }) => {
  const isHealthy = status?.components.every((c) => c.state === 'healthy');
  const isStopped = status?.stop_all_engaged;
  const modelHealth = status?.components.find((component) => component.component === 'model_router')?.state;
  const healthLabel = isStopped ? 'STOPPED' : !status ? 'CONNECTING' : isHealthy ? 'SYSTEM READY' : modelHealth === 'unknown' ? 'MODEL UNVERIFIED' : 'NEEDS ATTENTION';

  return (
    <header className="tj-topbar" style={{
      height: 60, background: 'var(--bg-secondary)', backdropFilter: 'blur(22px)',
      borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', padding: '0 20px', zIndex: 50,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: isStopped ? 'var(--accent-rose)' : 'var(--accent-cyan)',
            boxShadow: isStopped ? 'var(--glow-rose)' : 'var(--glow-cyan)',
            animation: 'none',
          }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 9, whiteSpace: 'nowrap' }}>
            <span className="tj-topbar-logo">T<span>J</span></span><span className="tj-topbar-full-name" style={{ fontFamily: 'JetBrains Mono', fontWeight: 800, fontSize: 12, letterSpacing: '.12em' }}>TOTAL MASTERY AI</span>
          </span>
          <span className="tj-topbar-version" style={{ fontSize: '0.68rem', fontFamily: 'JetBrains Mono', background: 'rgba(0, 242, 254, 0.1)', color: 'var(--accent-cyan)', padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0, 242, 254, 0.3)' }}>
            v{status?.version ?? '2.0.0'}
          </span>
        </div>

        <div className="tj-topbar-mode" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.7rem', color: 'var(--text-muted)', padding: '2px 8px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 4, border: '1px solid var(--border-subtle)' }}>
          <Lock size={11} color="var(--accent-emerald)" />
          <span>PRIVACY:</span>
          <strong style={{ color: 'var(--text-main)', textTransform: 'uppercase' }}>{status?.mode ?? 'local'}</strong>
        </div>
      </div>

      <nav className="tj-mode-switch" aria-label="Workspace mode">
        {[
          { id: 'command', label: 'Living World', icon: Globe2, active: activeTab === 'command' },
          { id: 'focus', label: 'Focus', icon: Focus, active: activeTab === 'focus' || activeTab === 'chat' },
          { id: 'workflows', label: 'Workflow', icon: Workflow, active: activeTab === 'workflows' },
        ].map((mode) => {
          const Icon = mode.icon;
          return <button key={mode.id} type="button" aria-pressed={mode.active} onClick={() => onNavigate(mode.id)} className={mode.active ? 'is-active' : ''}><Icon size={14} /><span>{mode.label}</span></button>;
        })}
      </nav>

      <div className="tj-topbar-metrics" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" className="tj-topbar-model" onClick={() => onNavigate('models')}><Cpu size={13} /><span>{status?.current_model_id ?? 'Choose AI provider'}</span></button>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', padding: '2px 8px', borderRadius: 4,
          background: isHealthy ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
          border: `1px solid ${isHealthy ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
        }}>
          <ShieldCheck size={12} color={isHealthy ? 'var(--accent-emerald)' : 'var(--accent-amber)'} />
          <span style={{ color: isHealthy ? 'var(--accent-emerald)' : 'var(--accent-amber)', fontWeight: 600 }}>
            {healthLabel}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {onOpenLiveVoice && (
          <button
            type="button"
            onClick={onOpenLiveVoice}
            className="tj-topbar-live-voice"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 13px',
              borderRadius: 9999,
              background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.22), rgba(56, 189, 248, 0.12))',
              border: '1px solid rgba(56, 189, 248, 0.45)',
              color: '#7dd3fc',
              fontWeight: 700,
              fontSize: '0.74rem',
              letterSpacing: '0.04em',
              cursor: 'pointer',
              boxShadow: '0 0 12px rgba(56, 189, 248, 0.2)',
            }}
            title="Start Live Voice Conversation like ChatGPT / Gemini"
          >
            <Mic size={13} color="#38bdf8" />
            <span>LIVE VOICE</span>
          </button>
        )}
        <button type="button" onClick={() => onNavigate('activity')} aria-label="Open notifications and recent activity" title="Open notifications and event history" className="tj-notification-toggle"><Bell size={15} /><span>Notifications</span></button>
        <button onClick={() => onNavigate('settings')} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex' }}>
          <Sliders size={15} />
        </button>

        <button
          onClick={onStopAll} disabled={stopping}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 5,
            border: isStopped ? '1px solid var(--accent-emerald)' : '1px solid var(--accent-rose)',
            background: isStopped ? 'rgba(16, 185, 129, 0.2)' : 'rgba(244, 63, 94, 0.2)',
            color: isStopped ? 'var(--accent-emerald)' : 'var(--accent-rose)',
            fontWeight: 800, fontSize: '0.72rem', letterSpacing: '0.08em', cursor: 'pointer',
          }}
        >
          <Power size={12} />
          {isStopped ? 'RESUME ALL' : 'STOP ALL'}
        </button>
      </div>
    </header>
  );
};
