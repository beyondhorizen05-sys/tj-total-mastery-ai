import React from 'react';
import {
  Activity,
  Bot,
  Boxes,
  Cpu,
  Download,
  Radio,
  Settings2,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import type { SystemStatus } from '@tj/schemas';
import './main-interface.css';

interface Props {
  status: SystemStatus | null;
  onNavigate: (tab: string) => void;
}

const shortcuts = [
  { label: 'Mission Control', detail: 'Tasks and execution', tab: 'tasks', icon: Download, tone: 'cyan' },
  { label: 'System Settings', detail: 'Identity and controls', tab: 'settings', icon: Settings2, tone: 'teal' },
  { label: 'Local Skills', detail: 'Installed abilities', tab: 'skills', icon: Wrench, tone: 'blue' },
  { label: 'Capabilities', detail: 'Tools and permissions', tab: 'capabilities', icon: Boxes, tone: 'green' },
  { label: 'Approvals', detail: 'Protected actions', tab: 'approvals', icon: ShieldCheck, tone: 'amber' },
] as const;

const formatUptime = (seconds: number | undefined) => {
  if (seconds === undefined) return 'Awaiting telemetry';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h online`;
  if (hours > 0) return `${hours}h ${minutes}m online`;
  return `${minutes}m online`;
};

export const MainInterface: React.FC<Props> = ({ status, onNavigate }) => {
  const healthyComponents = status?.components.filter((component) => component.state === 'healthy').length ?? 0;
  const totalComponents = status?.components.length ?? 0;
  const operational = Boolean(status) && !status?.stop_all_engaged && status?.security_state !== 'alert' && status?.tj_state !== 'error' && status?.tj_state !== 'stopped';
  const activityInProgress = (status?.running_tasks ?? 0) > 0 || (status?.queued_jobs ?? 0) > 0;
  const coreState = status?.stop_all_engaged
    ? 'paused'
    : status?.security_state === 'alert' || status?.tj_state === 'error'
    ? 'critical'
    : activityInProgress || Boolean(status && ['thinking', 'planning', 'working', 'speaking'].includes(status.tj_state))
      ? 'working'
      : 'idle';
  const ramPercent = status?.resources.ram_total_mb
    ? Math.round((status.resources.ram_used_mb / status.resources.ram_total_mb) * 100)
    : null;
  const stateLabel = !status
    ? 'CONNECTING'
    : status.stop_all_engaged
      ? 'PAUSED'
      : status.security_state === 'alert'
        ? 'SECURITY ALERT'
      : status.tj_state.toUpperCase();

  return (
    <main className={`tj-main-interface ${operational ? 'is-operational' : 'is-offline'}`} data-core-state={coreState} aria-label="TJ main interface">
      <div className="tj-chamber-art" aria-hidden="true">
        <div className="tj-chamber-ceiling" />
        <div className="tj-chamber-window"><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
        <div className="tj-chamber-platform"><i /><i /><i /></div>
        <div className="tj-chamber-console" />
      </div>
      <div className="tj-chamber-grid" aria-hidden="true" />

      <header className="tj-chamber-header">
        <div>
          <span className="tj-chamber-kicker"><i className={operational ? 'is-live' : ''} /> TJ TOTAL AI MASTERY</span>
          <h1>The Living Nexus</h1>
          <p>Your system, from one command surface.</p>
        </div>
        <button type="button" className="tj-chamber-health" onClick={() => onNavigate('activity')} aria-label="Open system activity">
          <Radio size={14} aria-hidden="true" />
          <span>{stateLabel}</span>
          <small>{status ? formatUptime(status.uptime_s) : 'System status unavailable'}</small>
        </button>
      </header>

      <section className="tj-chamber-stage" aria-label="System shortcuts and live core">
        <aside className="tj-chamber-vista" aria-label="TJ network overview">
          <span>LOCAL NEXUS</span>
          <strong>{status?.mode.toUpperCase() ?? 'NO LINK'}</strong>
          <p>{status?.network === 'online' ? 'Network connected' : status?.network === 'offline' ? 'Network offline' : 'Network state unknown'}</p>
          <button type="button" onClick={() => onNavigate('connectors')}>Open connections</button>
        </aside>

        <nav className="tj-chamber-shortcuts" aria-label="Command chamber shortcuts">
          {shortcuts.map(({ label, detail, tab, icon: Icon, tone }, index) => {
            const metric = tab === 'tasks'
              ? status?.running_tasks
              : tab === 'approvals'
                ? status?.pending_approvals
                : undefined;
            return (
              <button
                type="button"
                key={tab}
                className={`tj-chamber-tile is-${tone}`}
                onClick={() => onNavigate(tab)}
                aria-label={`Open ${label}`}
              >
                <span className="tj-tile-number">0{index + 1}</span>
                <span className="tj-tile-icon"><Icon size={27} strokeWidth={1.35} aria-hidden="true" /></span>
                <span className="tj-tile-copy"><strong>{label}</strong><small>{detail}</small></span>
                <span className="tj-tile-signal" aria-hidden="true" />
                {metric !== undefined && <em>{metric}</em>}
              </button>
            );
          })}
        </nav>

        <button type="button" className="tj-chamber-core" onClick={() => onNavigate('focus')} aria-label="Open TJ Focus workspace">
          <span className="tj-core-rings" aria-hidden="true"><i /><i /><i /><b /></span>
          <span className="tj-core-beam" aria-hidden="true" />
          <span className="tj-core-orb" aria-hidden="true"><Bot size={31} strokeWidth={1.15} /></span>
          <span className="tj-core-label"><small>INTELLIGENCE CORE</small><strong>{stateLabel}</strong><em>Enter Focus</em></span>
        </button>
      </section>

      <section className="tj-chamber-telemetry" aria-label="Live TJ telemetry">
        <button type="button" onClick={() => onNavigate('activity')} className="tj-live-strip">
          <Activity size={15} aria-hidden="true" />
          <span>LIVE ACTIVITY</span>
          <strong>{status ? `${status.running_tasks} running · ${status.queued_jobs} queued` : 'Waiting for API status'}</strong>
          {activityInProgress && <i aria-hidden="true"><b /><b /><b /><b /><b /><b /></i>}
        </button>

        <div className="tj-chamber-cards">
          <button type="button" onClick={() => onNavigate('agents')}>
            <span><Bot size={16} /> AGENT NETWORK</span>
            <strong>{status?.active_agents ?? '—'}</strong>
            <small>{status ? 'active agents' : 'telemetry pending'}</small>
          </button>
          <button type="button" onClick={() => onNavigate('activity')}>
            <span><Cpu size={16} /> COMPONENTS</span>
            <strong>{status ? `${healthyComponents}/${totalComponents}` : '—'}</strong>
            <small>{status ? 'healthy services' : 'health pending'}</small>
          </button>
          <button type="button" onClick={() => onNavigate('settings')}>
            <span><Activity size={16} /> COMPUTE LOAD</span>
            <strong>{status?.resources.cpu_percent == null ? '—' : `${Math.round(status.resources.cpu_percent)}%`}</strong>
            <small>{ramPercent == null ? 'resource telemetry pending' : `${ramPercent}% memory used`}</small>
          </button>
        </div>
      </section>
    </main>
  );
};
