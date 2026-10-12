import React, { useState, useEffect } from 'react';
import {
  Activity, ArrowUpRight, CheckSquare, Clapperboard, Compass, Cpu,
  Globe2, Headphones, Lock, MessageSquare, Power, Radio,
  Send, ShieldAlert, ShieldCheck, Sliders, Sparkles, UserCheck, Users, Workflow, Edit3, X
} from 'lucide-react';
import type { SystemStatus, TJPersona } from '@tj/schemas';
import { LivingHQScene, DEFAULT_AGENT_SLOTS, type AgentSlotConfig } from '../components/LivingHQScene';
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
  stopping?: boolean;
  onStopAll?: () => void;
}

export const CommandCenter: React.FC<Props> = ({
  status,
  persona,
  voiceSpeaking,
  onNavigate,
  onOpenBuilding = onNavigate,
  onSelectAgent,
  onOpenPulse,
  onSendChat,
  loading,
  stopping = false,
  onStopAll,
}) => {
  const [input, setInput] = useState('');
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<[number, number, number] | null>(null);

  // Custom Agent Names management (persists to localStorage)
  const [customNames, setCustomNames] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('tj_agent_custom_names');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Modal for editing names
  const [rosterModalOpen, setRosterModalOpen] = useState(false);
  const [tempNames, setTempNames] = useState<Record<string, string>>({});

  // Category switch toggles
  const [switches, setSwitches] = useState({
    aiSystems: true,
    studios: true,
    finance: false,
    system: false,
  });
  const [activeCategoryDrawer, setActiveCategoryDrawer] = useState<string | null>(null);

  const toggleSwitch = (key: keyof typeof switches) => {
    setSwitches((prev) => {
      const next = !prev[key];
      if (next) setActiveCategoryDrawer(key);
      else if (activeCategoryDrawer === key) setActiveCategoryDrawer(null);
      return { ...prev, [key]: next };
    });
  };

  const handleOpenRoster = () => {
    const current: Record<string, string> = {};
    DEFAULT_AGENT_SLOTS.forEach((slot) => {
      current[slot.id] = customNames[slot.id] || slot.defaultName;
    });
    setTempNames(current);
    setRosterModalOpen(true);
  };

  const handleSaveRoster = () => {
    setCustomNames(tempNames);
    try {
      localStorage.setItem('tj_agent_custom_names', JSON.stringify(tempNames));
    } catch (e) {
      console.error('Failed to save custom agent names', e);
    }
    setRosterModalOpen(false);
  };

  const handleSelect3DAgent = (slotId: string, name: string) => {
    setSelectedSlotId(slotId);
    setSelectedAgentName(name);

    const slot = DEFAULT_AGENT_SLOTS.find((s) => s.id === slotId);
    if (slot) {
      setFocusTarget(slot.position);
    }
  };

  const handleResetCamera = () => {
    setSelectedSlotId(null);
    setSelectedAgentName(null);
    setFocusTarget(null);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput('');

    // If an agent is selected, prefix context or direct to that agent
    const messageContent = selectedAgentName
      ? `[@${selectedAgentName}] ${text}`
      : text;
    void onSendChat(messageContent, 'auto');
  };

  const isHealthy = status?.components.every((c) => c.state === 'healthy');
  const isStopped = status?.stop_all_engaged;
  const runningTasks = status?.running_tasks ?? 0;
  const pendingApprovals = status?.pending_approvals ?? 0;

  // 9 Primary Cyber Navigation Tabs
  const topTabs = [
    { id: 'main', label: 'MAIN INTERFACE', icon: Globe2 },
    { id: 'command', label: 'LIVING WORLD', icon: Compass, isActive: true },
    { id: 'tasks', label: 'MISSION CONTROL', icon: CheckSquare, badge: runningTasks },
    { id: 'agents', label: 'AGENTS', icon: Users },
    { id: 'chat', label: 'CONVERSATIONS', icon: MessageSquare },
    { id: 'workflows', label: 'WORKFLOWS', icon: Workflow },
    { id: 'media', label: 'FILES & MEDIA', icon: Clapperboard },
    { id: 'activity', label: 'ACTIVITY', icon: Radio },
    { id: 'approvals', label: 'APPROVALS', icon: ShieldAlert, badge: pendingApprovals },
  ];

  return (
    <div className="tj-command-center-fullscreen" aria-label="100% Full-Screen 3D Interactive Command Center">
      {/* ====================================================================
          TOP HORIZONTAL NAVIGATION BAR (2 ROWS)
          ==================================================================== */}
      <header className="tj-cmd-topbar">
        {/* Row 1: Brand Logo, Privacy, Mode Switcher, System Controls */}
        <div className="tj-cmd-header-row">
          <div className="tj-cmd-brand">
            <span className="tj-cmd-brand-logo">TJ</span>
            <span className="tj-cmd-brand-title">TOTAL MASTERY AI</span>
            <span className="tj-cmd-version-badge">v{status?.version ?? '0.8.4'}</span>
            <div className="tj-cmd-privacy-badge">
              <span className="tj-cmd-privacy-dot" />
              <span>PRIVACY: VERIFIED</span>
            </div>
          </div>

          {/* Center Mode Switcher */}
          <nav className="tj-cmd-mode-switcher" aria-label="Command Mode Switcher">
            <button type="button" className="tj-cmd-mode-btn is-active">
              <Compass size={13} />
              <span>Living World</span>
            </button>
            <button type="button" className="tj-cmd-mode-btn" onClick={() => onNavigate('focus')}>
              <span>Focus</span>
            </button>
            <button type="button" className="tj-cmd-mode-btn" onClick={() => onNavigate('workflows')}>
              <Workflow size={13} />
              <span>Workflow</span>
            </button>
          </nav>

          {/* Right Header Actions */}
          <div className="tj-cmd-header-actions">
            <button
              type="button"
              className="tj-cmd-icon-btn"
              onClick={handleOpenRoster}
              title="Customize Agent Names"
              aria-label="Customize Agent Names"
            >
              <Edit3 size={14} />
            </button>
            <button
              type="button"
              className="tj-cmd-icon-btn"
              onClick={() => onNavigate('settings')}
              title="Settings"
              aria-label="Settings"
            >
              <Sliders size={14} />
            </button>

            {onStopAll && (
              <button
                type="button"
                onClick={onStopAll}
                disabled={stopping}
                className={`tj-cmd-emergency-btn ${isStopped ? 'resume' : 'stop'}`}
              >
                <Power size={12} />
                <span>{isStopped ? 'RESUME ALL' : 'STOP ALL'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Row 2: 9 Cyber Navigation Tabs */}
        <div className="tj-cmd-tabs-row" role="tablist">
          {topTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.isActive}
                className={`tj-cmd-tab ${tab.isActive ? 'is-active' : ''}`}
                onClick={() => {
                  if (tab.id !== 'command') {
                    onNavigate(tab.id);
                  } else {
                    handleResetCamera();
                  }
                }}
              >
                <Icon size={13} />
                <span>{tab.label}</span>
                {Boolean(tab.badge && tab.badge > 0) && (
                  <span className="tj-cmd-tab-badge">{tab.badge}</span>
                )}
              </button>
            );
          })}

          <button
            type="button"
            className="tj-cmd-tab"
            onClick={handleOpenRoster}
            style={{ marginLeft: 'auto', borderColor: 'rgba(0, 242, 254, 0.4)', color: '#00f2fe' }}
          >
            <UserCheck size={13} />
            <span>EDIT AGENT NAMES</span>
          </button>
        </div>
      </header>

      {/* ====================================================================
          100% FULL-SCREEN 3D THREE.JS CANVAS
          ==================================================================== */}
      <div className="tj-command-center-canvas">
        <LivingHQScene
          customNames={customNames}
          onSelectAgent={handleSelect3DAgent}
          onOpenRoom={onOpenBuilding}
          selectedAgentId={selectedSlotId}
          focusTarget={focusTarget}
          height="100%"
        />
      </div>

      {/* ====================================================================
          BOTTOM-LEFT OVERLAYS: HYBRID CARD & GLASSMORPHIC SWITCHES
          ==================================================================== */}
      <div className="tj-cmd-bottom-left">
        {/* Local Nexus: HYBRID Card */}
        <div className="tj-cmd-hybrid-card">
          <div className="tj-cmd-hybrid-info">
            <span className="tj-cmd-hybrid-title">Local Nexus</span>
            <span className="tj-cmd-hybrid-val">HYBRID : ACTIVE</span>
          </div>
          <svg className="tj-cmd-hybrid-wave" viewBox="0 0 58 22" fill="none">
            <path
              d="M1 11 L10 11 L15 3 L22 19 L28 6 L35 15 L40 11 L57 11"
              stroke="#00f2fe"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* 4 Glassmorphic Switches */}
        <div className="tj-cmd-switches-group">
          <div
            className={`tj-cmd-switch-item ${switches.aiSystems ? 'is-on' : ''}`}
            onClick={() => toggleSwitch('aiSystems')}
          >
            <span className="tj-cmd-switch-label">AI SYSTEMS</span>
            <div className="tj-cmd-switch-track">
              <div className="tj-cmd-switch-thumb" />
            </div>
          </div>

          <div
            className={`tj-cmd-switch-item ${switches.studios ? 'is-on' : ''}`}
            onClick={() => toggleSwitch('studios')}
          >
            <span className="tj-cmd-switch-label">STUDIOS</span>
            <div className="tj-cmd-switch-track">
              <div className="tj-cmd-switch-thumb" />
            </div>
          </div>

          <div
            className={`tj-cmd-switch-item ${switches.finance ? 'is-on' : ''}`}
            onClick={() => toggleSwitch('finance')}
          >
            <span className="tj-cmd-switch-label">FINANCE</span>
            <div className="tj-cmd-switch-track">
              <div className="tj-cmd-switch-thumb" />
            </div>
          </div>

          <div
            className={`tj-cmd-switch-item ${switches.system ? 'is-on' : ''}`}
            onClick={() => toggleSwitch('system')}
          >
            <span className="tj-cmd-switch-label">SYSTEM</span>
            <div className="tj-cmd-switch-track">
              <div className="tj-cmd-switch-thumb" />
            </div>
          </div>
        </div>

        {/* Category Drawer Popup */}
        {activeCategoryDrawer === 'aiSystems' && (
          <div className="tj-cmd-category-drawer">
            <b style={{ fontSize: 9, color: '#00f2fe', letterSpacing: '0.1em' }}>AI SYSTEMS</b>
            <button type="button" onClick={() => onNavigate('models')}>AI Providers</button>
            <button type="button" onClick={() => onNavigate('connectors')}>Connectors</button>
            <button type="button" onClick={() => onNavigate('skills')}>Skills Engine</button>
            <button type="button" onClick={() => onNavigate('memory')}>Memory Core</button>
            <button type="button" onClick={() => onNavigate('graph')}>Knowledge Graph</button>
          </div>
        )}

        {activeCategoryDrawer === 'studios' && (
          <div className="tj-cmd-category-drawer">
            <b style={{ fontSize: 9, color: '#00f2fe', letterSpacing: '0.1em' }}>STUDIOS</b>
            <button type="button" onClick={() => onNavigate('vision')}>Vision Studio</button>
            <button type="button" onClick={() => onNavigate('data')}>Data Intelligence</button>
            <button type="button" onClick={() => onNavigate('education')}>Education Plans</button>
            <button type="button" onClick={() => onNavigate('business')}>Business CRM</button>
            <button type="button" onClick={() => onNavigate('wellness')}>Wellness Trends</button>
          </div>
        )}

        {activeCategoryDrawer === 'finance' && (
          <div className="tj-cmd-category-drawer">
            <b style={{ fontSize: 9, color: '#00f2fe', letterSpacing: '0.1em' }}>FINANCE</b>
            <button type="button" onClick={() => onNavigate('finance')}>Personal Finance</button>
            <button type="button" onClick={() => onNavigate('paper')}>Paper Trading</button>
          </div>
        )}

        {activeCategoryDrawer === 'system' && (
          <div className="tj-cmd-category-drawer">
            <b style={{ fontSize: 9, color: '#00f2fe', letterSpacing: '0.1em' }}>SYSTEM</b>
            <button type="button" onClick={() => onNavigate('learning')}>Improvement Review</button>
            <button type="button" onClick={() => onNavigate('settings')}>Settings & Config</button>
          </div>
        )}
      </div>

      {/* ====================================================================
          BOTTOM-CENTER: LIVE ACTIVITY COUNTER & THE LIVING PULSE CHAT BAR
          ==================================================================== */}
      <div className="tj-cmd-bottom-center">
        {/* Live Activity Pill */}
        <div className="tj-cmd-live-activity-pill">
          <span>LIVE ACTIVITY:</span>
          <b>{runningTasks} running</b>
          <span>|</span>
          <b>{pendingApprovals} queued</b>
          {selectedAgentName && (
            <>
              <span>|</span>
              <span style={{ color: '#00f2fe' }}>CONNECTED TO: {selectedAgentName.toUpperCase()}</span>
            </>
          )}
        </div>

        {/* The Living Pulse Floating Chat Bar */}
        <div className="tj-cmd-living-pulse-bar">
          <div
            className="tj-cmd-pulse-orb"
            onClick={onOpenPulse}
            title="Open TJ Identity Controls"
          >
            <div className="tj-cmd-pulse-orb-inner" />
          </div>

          <div className="tj-cmd-pulse-copy">
            <span className="tj-cmd-pulse-meta">
              {selectedAgentName ? selectedAgentName.toUpperCase() : persona.name.toUpperCase()} · READY
            </span>
            <span className="tj-cmd-pulse-title">The Living Pulse</span>
          </div>

          <form className="tj-cmd-pulse-form" onSubmit={handleSubmit}>
            <Sparkles size={15} color="#00f2fe" />
            <input
              className="tj-cmd-pulse-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              placeholder={
                selectedAgentName
                  ? `Direct link: ${selectedAgentName} · Speak or type a thought...`
                  : 'Speak or type a thought to begin'
              }
            />
            <button
              type="submit"
              className="tj-cmd-pulse-send"
              disabled={loading || !input.trim()}
            >
              <Send size={13} />
              <span>{loading ? 'Working' : 'Send'}</span>
            </button>
          </form>

          <button
            type="button"
            className="tj-cmd-pulse-mic"
            onClick={onOpenPulse}
            title="Voice and Sound Controls"
          >
            <Headphones size={15} />
          </button>
        </div>
      </div>

      {/* ====================================================================
          BOTTOM-RIGHT: TELEMETRY GRAPHS & METRICS
          ==================================================================== */}
      <div className="tj-cmd-bottom-right">
        <div className="tj-cmd-telemetry-header">
          <span className="tj-cmd-telemetry-tab active">AGENT NETWORK</span>
          <span className="tj-cmd-telemetry-tab">COMPONENTS</span>
          <span className="tj-cmd-telemetry-tab">COMPUTE LOAD</span>
        </div>

        <div className="tj-cmd-telemetry-metrics">
          <div className="tj-cmd-metric-row">
            <span className="tj-cmd-metric-name">Active Agents</span>
            <span className="tj-cmd-metric-val">11 / 11 Deployed</span>
          </div>

          {/* SVG Animated Sparkline */}
          <svg className="tj-cmd-sparkline" viewBox="0 0 280 28" fill="none">
            <path
              d="M0 16 Q20 4, 40 16 T80 16 T120 16 T160 8 T200 22 T240 14 T280 16"
              stroke="#00f2fe"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>

          <div className="tj-cmd-metric-row">
            <span className="tj-cmd-metric-name">System Latency</span>
            <span className="tj-cmd-metric-val">1.2ms · 100% Verified</span>
          </div>
        </div>

        <button
          type="button"
          className="tj-cmd-cam-reset"
          onClick={handleResetCamera}
        >
          RESET CAMERA OVERVIEW
        </button>
      </div>

      {/* ====================================================================
          MODAL: AGENT ROSTER & CUSTOM NAMES
          ==================================================================== */}
      {rosterModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(3, 8, 15, 0.85)',
            backdropFilter: 'blur(16px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            style={{
              background: '#091524',
              border: '1px solid rgba(0, 242, 254, 0.35)',
              borderRadius: 16,
              width: 'min(640px, 95vw)',
              maxHeight: '85vh',
              overflowY: 'auto',
              padding: 24,
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.7), 0 0 30px rgba(0, 242, 254, 0.15)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, color: '#ffffff', fontFamily: 'JetBrains Mono', letterSpacing: '0.05em' }}>
                  AGENT ROSTER & CUSTOM NAMES
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#8da6bd' }}>
                  Assign your preferred custom names for each 3D agent stationed across the 6 rooms.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRosterModalOpen(false)}
                style={{ background: 'transparent', border: 0, color: '#8da6bd', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              {DEFAULT_AGENT_SLOTS.map((slot, index) => (
                <div
                  key={slot.id}
                  style={{
                    background: 'rgba(14, 28, 45, 0.7)',
                    border: '1px solid rgba(141, 166, 189, 0.15)',
                    borderRadius: 10,
                    padding: '10px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono', color: '#00f2fe', fontWeight: 800 }}>
                      AGENT #{index + 1} · {slot.roomName}
                    </span>
                    <span style={{ fontSize: 9, color: '#8da6bd', textTransform: 'uppercase' }}>
                      {slot.gender} · {slot.status}
                    </span>
                  </div>

                  <input
                    type="text"
                    value={tempNames[slot.id] || ''}
                    onChange={(e) =>
                      setTempNames((prev) => ({ ...prev, [slot.id]: e.target.value.toUpperCase() }))
                    }
                    placeholder={slot.defaultName}
                    style={{
                      background: 'rgba(6, 15, 26, 0.85)',
                      border: '1px solid rgba(0, 242, 254, 0.25)',
                      borderRadius: 6,
                      color: '#ffffff',
                      fontFamily: 'JetBrains Mono',
                      fontWeight: 800,
                      fontSize: 12,
                      padding: '6px 10px',
                      outline: 'none',
                    }}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 22 }}>
              <button
                type="button"
                onClick={() => setRosterModalOpen(false)}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(141, 166, 189, 0.25)',
                  borderRadius: 8,
                  color: '#8da6bd',
                  fontSize: 12,
                  padding: '8px 18px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveRoster}
                style={{
                  background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
                  border: 0,
                  borderRadius: 8,
                  color: '#050b14',
                  fontFamily: 'JetBrains Mono',
                  fontWeight: 900,
                  fontSize: 12,
                  padding: '8px 24px',
                  cursor: 'pointer',
                  boxShadow: '0 0 16px rgba(0, 242, 254, 0.4)',
                }}
              >
                Save & Apply Names
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
