import React from 'react';
import { Cpu, HardDrive, ShieldCheck, Radio, Sliders, Power, Lock, Activity } from 'lucide-react';
import type { SystemStatus } from '@tj/schemas';

interface TopBarProps {
  status: SystemStatus | null;
  stopping: boolean;
  onStopAll: () => void;
  onNavigate: (tab: string) => void;
}

export const TopBar: React.FC<TopBarProps> = ({ status, stopping, onStopAll, onNavigate }) => {
  const isHealthy = status?.components.every((c) => c.state === 'healthy');
  const isStopped = status?.stop_all_engaged;
  const modelHealth = status?.components.find((component) => component.component === 'model_router')?.state;
  const healthLabel = isStopped ? 'STOPPED' : !status ? 'CONNECTING' : isHealthy ? 'SYSTEM READY' : modelHealth === 'unknown' ? 'MODEL UNVERIFIED' : 'NEEDS ATTENTION';

  return (
    <header className="tj-topbar" style={{
      height: 48, background: 'rgba(5, 10, 22, 0.92)', backdropFilter: 'blur(16px)',
      borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', padding: '0 16px', zIndex: 50,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: isStopped ? 'var(--accent-rose)' : 'var(--accent-cyan)',
            boxShadow: isStopped ? 'var(--glow-rose)' : 'var(--glow-cyan)',
            animation: 'pulseSlow 2s infinite ease-in-out',
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
          <span>MODE:</span>
          <strong style={{ color: 'var(--text-main)', textTransform: 'uppercase' }}>{status?.mode ?? 'local'}</strong>
        </div>
      </div>

      <div className="tj-topbar-metrics" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="tj-topbar-model" onClick={() => onNavigate('models')} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', cursor: 'pointer', padding: '3px 6px' }}>
          <Cpu size={13} color="var(--accent-purple)" />
          <span style={{ color: 'var(--text-muted)' }}>MODEL:</span>
          <span style={{ color: status?.current_model_id ? 'var(--text-main)' : 'var(--accent-amber)', fontFamily: 'JetBrains Mono', fontWeight: 600 }}>
            {status?.current_model_id ?? 'NO PROVIDER'}
          </span>
        </div>

        <div onClick={() => onNavigate('agents')} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', cursor: 'pointer', padding: '3px 6px' }}>
          <Radio size={13} color="var(--accent-cyan)" />
          <span style={{ color: 'var(--text-muted)' }}>ACTIVE AGENTS:</span>
          <span style={{ color: 'var(--text-main)', fontFamily: 'JetBrains Mono', fontWeight: 600 }}>{status?.active_agents ?? 0}</span>
        </div>

        <div onClick={() => onNavigate('tasks')} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', cursor: 'pointer', padding: '3px 6px' }}>
          <Activity size={13} color="var(--accent-emerald)" />
          <span style={{ color: 'var(--text-muted)' }}>RUNNING TASKS:</span>
          <span style={{ color: 'var(--text-main)', fontFamily: 'JetBrains Mono', fontWeight: 600 }}>{status?.running_tasks ?? 0}</span>
        </div>

        {status?.resources?.ram_total_mb && (
          <div className="tj-topbar-ram" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <HardDrive size={13} />
            <span>RAM:</span>
            <span style={{ color: 'var(--text-main)', fontFamily: 'JetBrains Mono' }}>
              {Math.round(status.resources.ram_used_mb / 1024)}/{Math.round(status.resources.ram_total_mb / 1024)}GB
            </span>
          </div>
        )}

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
