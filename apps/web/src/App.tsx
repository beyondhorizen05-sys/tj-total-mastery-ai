import React, { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { Orb } from './components/Orb';
import { FirstRunWizard } from './components/FirstRunWizard';
import { ChatView } from './views/ChatView';
import { CapabilitiesView } from './views/CapabilitiesView';
import { ConnectorsView } from './views/ConnectorsView';
import { ApprovalsView } from './views/ApprovalsView';
import { AgentsView } from './views/AgentsView';
import { WorkflowsView } from './views/WorkflowsView';
import { MemoryView } from './views/MemoryView';
import { ModelsView } from './views/ModelsView';
import { SettingsView } from './views/SettingsView';
import { TasksView } from './views/TasksView';
import { ActivityView } from './views/ActivityView';
import {
  MessageSquare, Users, Cpu, Boxes, Workflow, ShieldAlert,
  HardDrive, Sliders, Activity, Power, CheckSquare, Radio
} from 'lucide-react';
import type { SystemStatus } from '@tj/schemas';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('chat');
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [stopping, setStopping] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  const loadStatus = async () => {
    try {
      const res = await apiFetch<SystemStatus>('/api/v1/system/status');
      setStatus(res);
      // Check first-run setting
      const sets = await apiFetch<{ settings: Record<string, any> }>('/api/v1/system/settings');
      if (sets.settings && sets.settings.first_run_completed === false) {
        setShowWizard(true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadStatus();
    const timer = setInterval(loadStatus, 4000);
    return () => clearInterval(timer);
  }, []);

  const handleStopAll = async () => {
    setStopping(true);
    try {
      if (status?.stop_all_engaged) {
        await apiFetch('/api/v1/system/resume', { method: 'POST' });
      } else {
        await apiFetch('/api/v1/system/stop-all', { method: 'POST' });
      }
      loadStatus();
    } catch (e) {
      console.error(e);
    } finally {
      setStopping(false);
    }
  };

  const navItems = [
    { id: 'chat', label: 'Chat & Goal', icon: MessageSquare },
    { id: 'tasks', label: 'Tasks', icon: CheckSquare, badge: status?.running_tasks },
    { id: 'activity', label: 'Activity', icon: Radio },
    { id: 'agents', label: 'Agents', icon: Users },
    { id: 'workflows', label: 'Workflows', icon: Workflow },
    { id: 'capabilities', label: 'Capabilities', icon: Boxes },
    { id: 'connectors', label: 'Connectors', icon: Activity },
    { id: 'approvals', label: 'Approvals', icon: ShieldAlert, badge: status?.pending_approvals },
    { id: 'memory', label: 'Memory', icon: HardDrive },
    { id: 'models', label: 'Models', icon: Cpu },
    { id: 'settings', label: 'Settings', icon: Sliders },
  ];

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: 'var(--bg-primary)' }}>
      {/* Sidebar Navigation */}
      <div style={{ width: 220, background: 'var(--bg-secondary)', borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', padding: '16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, padding: '0 8px' }}>
          <Orb state={status?.tj_state ?? 'idle'} size={32} />
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '0.05em' }}>TJ</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Total Mastery AI</div>
          </div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 6, border: 'none',
                  background: isActive ? 'var(--bg-card-hover)' : 'transparent', color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  fontSize: '0.85rem', fontWeight: isActive ? 600 : 500, cursor: 'pointer', textAlign: 'left',
                }}
              >
                <Icon size={18} />
                <span style={{ flex: 1 }}>{item.label}</span>
                {Boolean(item.badge && item.badge > 0) && (
                  <span style={{ background: 'var(--accent-rose)', color: '#fff', fontSize: '0.7rem', fontWeight: 700, padding: '2px 6px', borderRadius: 10 }}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* STOP ALL Killswitch */}
        <button
          onClick={handleStopAll} disabled={stopping}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 14px', borderRadius: 6, border: 'none',
            background: status?.stop_all_engaged ? 'var(--accent-emerald)' : 'var(--accent-rose)', color: '#fff', fontWeight: 700,
            fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.2s ease',
          }}
        >
          <Power size={18} />
          {status?.stop_all_engaged ? 'RESUME ALL' : 'STOP ALL'}
        </button>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
        {showWizard && <FirstRunWizard onComplete={() => setShowWizard(false)} />}
        {activeTab === 'chat' && <ChatView />}
        {activeTab === 'tasks' && <TasksView />}
        {activeTab === 'activity' && <ActivityView />}
        {activeTab === 'agents' && <AgentsView />}
        {activeTab === 'workflows' && <WorkflowsView />}
        {activeTab === 'capabilities' && <CapabilitiesView />}
        {activeTab === 'connectors' && <ConnectorsView />}
        {activeTab === 'approvals' && <ApprovalsView />}
        {activeTab === 'memory' && <MemoryView />}
        {activeTab === 'models' && <ModelsView />}
        {activeTab === 'settings' && <SettingsView />}
      </div>
    </div>
  );
};
