import React, { useState, useEffect, lazy, Suspense } from 'react';
import {
  Activity, ArrowUpRight, CheckSquare, Clapperboard, Compass, Cpu,
  Globe2, Headphones, Lock, MessageSquare, Power, Radio,
  Send, ShieldAlert, ShieldCheck, Sliders, Sparkles, UserCheck, Users, Workflow,
  Edit3, X, Maximize2, Minimize2, Minus, Eye, BarChart3, GraduationCap,
  Briefcase, HeartPulse, Wallet, LineChart, Wrench, HardDrive, Network
} from 'lucide-react';
import type { SystemStatus, TJPersona } from '@tj/schemas';
import { LivingHQScene, DEFAULT_AGENT_SLOTS } from '../components/LivingHQScene';
import './living-world.css';

// Lazy-loaded Views for Floating Windows
const TasksView = lazy(() => import('./TasksView').then((m) => ({ default: m.TasksView })));
const AgentsView = lazy(() => import('./AgentsView').then((m) => ({ default: m.AgentsView })));
const ChatView = lazy(() => import('./ChatView').then((m) => ({ default: m.ChatView })));
const WorkflowsView = lazy(() => import('./WorkflowsView').then((m) => ({ default: m.WorkflowsView })));
const MediaView = lazy(() => import('./MediaView').then((m) => ({ default: m.MediaView })));
const ActivityView = lazy(() => import('./ActivityView').then((m) => ({ default: m.ActivityView })));
const ApprovalsView = lazy(() => import('./ApprovalsView').then((m) => ({ default: m.ApprovalsView })));
const SettingsView = lazy(() => import('./SettingsView').then((m) => ({ default: m.SettingsView })));
const SkillsView = lazy(() => import('./SkillsView').then((m) => ({ default: m.SkillsView })));
const ConnectorsView = lazy(() => import('./ConnectorsView').then((m) => ({ default: m.ConnectorsView })));
const ModelsView = lazy(() => import('./ModelsView').then((m) => ({ default: m.ModelsView })));
const MemoryView = lazy(() => import('./MemoryView').then((m) => ({ default: m.MemoryView })));
const GraphView = lazy(() => import('./GraphView').then((m) => ({ default: m.GraphView })));
const VisionView = lazy(() => import('./VisionView').then((m) => ({ default: m.VisionView })));
const DataIntelligenceView = lazy(() => import('./DataIntelligenceView').then((m) => ({ default: m.DataIntelligenceView })));
const EducationView = lazy(() => import('./EducationView').then((m) => ({ default: m.EducationView })));
const BusinessView = lazy(() => import('./BusinessView').then((m) => ({ default: m.BusinessView })));
const WellnessView = lazy(() => import('./WellnessView').then((m) => ({ default: m.WellnessView })));
const FinanceView = lazy(() => import('./FinanceView').then((m) => ({ default: m.FinanceView })));
const PaperTradingView = lazy(() => import('./PaperTradingView').then((m) => ({ default: m.PaperTradingView })));
const FocusWorkspace = lazy(() => import('./FocusWorkspace').then((m) => ({ default: m.FocusWorkspace })));

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
  onOpenBuilding,
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

  // Floating Window Management
  const [activeFloatingWindow, setActiveFloatingWindow] = useState<string | null>(null);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  // Overlay Panels Visibility (Allow closing/minimizing everything)
  const [showBottomLeft, setShowBottomLeft] = useState(true);
  const [showBottomRight, setShowBottomRight] = useState(true);
  const [showBottomPulse, setShowBottomPulse] = useState(true);

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
  const [tempNames, setTempNames] = useState<Record<string, string>>({});

  // Category switch toggles
  const [switches, setSwitches] = useState({
    aiSystems: true,
    studios: true,
    finance: false,
    system: false,
  });
  const [activeCategoryDrawer, setActiveCategoryDrawer] = useState<string | null>(null);

  // Keyboard shortcut: Escape closes floating window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeFloatingWindow) {
        setActiveFloatingWindow(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeFloatingWindow]);

  const toggleSwitch = (key: keyof typeof switches) => {
    setSwitches((prev) => {
      const next = !prev[key];
      if (next) setActiveCategoryDrawer(key);
      else if (activeCategoryDrawer === key) setActiveCategoryDrawer(null);
      return { ...prev, [key]: next };
    });
  };

  const openFloating = (windowId: string) => {
    setActiveCategoryDrawer(null);
    if (windowId === 'roster') {
      const current: Record<string, string> = {};
      DEFAULT_AGENT_SLOTS.forEach((slot) => {
        current[slot.id] = customNames[slot.id] || slot.defaultName;
      });
      setTempNames(current);
    }
    setActiveFloatingWindow(windowId);
  };

  const closeFloating = () => {
    setActiveFloatingWindow(null);
    setIsWindowMaximized(false);
  };

  const handleSaveRoster = () => {
    setCustomNames(tempNames);
    try {
      localStorage.setItem('tj_agent_custom_names', JSON.stringify(tempNames));
    } catch (e) {
      console.error('Failed to save custom agent names', e);
    }
    closeFloating();
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
    closeFloating();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput('');

    const messageContent = selectedAgentName
      ? `[@${selectedAgentName}] ${text}`
      : text;
    void onSendChat(messageContent, 'auto');
  };

  const isStopped = status?.stop_all_engaged;
  const runningTasks = status?.running_tasks ?? 0;
  const pendingApprovals = status?.pending_approvals ?? 0;

  // 9 Primary Cyber Navigation Tabs
  const topTabs = [
    { id: 'main', label: 'MAIN INTERFACE', icon: Globe2 },
    { id: 'command', label: 'LIVING WORLD', icon: Compass, isActive: !activeFloatingWindow },
    { id: 'tasks', label: 'MISSION CONTROL', icon: CheckSquare, badge: runningTasks, isWindow: true },
    { id: 'agents', label: 'AGENTS', icon: Users, isWindow: true },
    { id: 'chat', label: 'CONVERSATIONS', icon: MessageSquare, isWindow: true },
    { id: 'workflows', label: 'WORKFLOWS', icon: Workflow, isWindow: true },
    { id: 'media', label: 'FILES & MEDIA', icon: Clapperboard, isWindow: true },
    { id: 'activity', label: 'ACTIVITY', icon: Radio, isWindow: true },
    { id: 'approvals', label: 'APPROVALS', icon: ShieldAlert, badge: pendingApprovals, isWindow: true },
  ];

  // Helper to render component inside floating window
  const renderFloatingContent = (windowId: string) => {
    switch (windowId) {
      case 'tasks':
        return <TasksView />;
      case 'agents':
        return <AgentsView selectedAgentId={selectedSlotId} />;
      case 'chat':
        return <ChatView personaName={persona.name} onNavigate={openFloating} />;
      case 'workflows':
        return <WorkflowsView initialMode="studio" />;
      case 'media':
        return <MediaView />;
      case 'activity':
        return <ActivityView />;
      case 'approvals':
        return <ApprovalsView />;
      case 'settings':
        return <SettingsView />;
      case 'skills':
        return <SkillsView />;
      case 'connectors':
        return <ConnectorsView />;
      case 'models':
        return <ModelsView />;
      case 'memory':
        return <MemoryView />;
      case 'graph':
        return <GraphView />;
      case 'vision':
        return <VisionView />;
      case 'data':
        return <DataIntelligenceView />;
      case 'education':
        return <EducationView />;
      case 'business':
        return <BusinessView />;
      case 'wellness':
        return <WellnessView />;
      case 'finance':
        return <FinanceView />;
      case 'paper':
        return <PaperTradingView />;
      case 'focus':
        return <FocusWorkspace personaName={persona.name} />;
      case 'roster':
        return (
          <div style={{ padding: 12 }}>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: '#8da6bd' }}>
              Assign your custom names for each 3D agent stationed across the rooms:
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
              {DEFAULT_AGENT_SLOTS.map((slot, index) => (
                <div
                  key={slot.id}
                  style={{
                    background: 'rgba(14, 28, 45, 0.75)',
                    border: '1px solid rgba(0, 242, 254, 0.2)',
                    borderRadius: 10,
                    padding: '12px 14px',
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
                      border: '1px solid rgba(0, 242, 254, 0.3)',
                      borderRadius: 6,
                      color: '#ffffff',
                      fontFamily: 'JetBrains Mono',
                      fontWeight: 800,
                      fontSize: 13,
                      padding: '8px 12px',
                      outline: 'none',
                    }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
              <button
                type="button"
                onClick={closeFloating}
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
        );
      default:
        return <div>Subsystem view ready.</div>;
    }
  };

  const getWindowTitle = (id: string) => {
    switch (id) {
      case 'tasks': return { title: 'MISSION CONTROL · TASKS & EXECUTION', icon: CheckSquare };
      case 'agents': return { title: 'AGENT NETWORK · SPECIALISTS ROSTER', icon: Users };
      case 'chat': return { title: 'CONVERSATIONS · THE LIVING NEXUS', icon: MessageSquare };
      case 'workflows': return { title: 'WORKFLOW ENGINE & AUTOMATION', icon: Workflow };
      case 'media': return { title: 'FILES & MEDIA STUDIO', icon: Clapperboard };
      case 'activity': return { title: 'REAL-TIME TELEMETRY & ACTIVITY', icon: Radio };
      case 'approvals': return { title: 'SECURITY APPROVALS & PERMISSIONS', icon: ShieldAlert };
      case 'settings': return { title: 'SYSTEM SETTINGS & ENVIRONMENT', icon: Sliders };
      case 'skills': return { title: 'UNIVERSAL SKILLS REPOSITORY', icon: Wrench };
      case 'connectors': return { title: 'INTEGRATIONS & CONNECTORS', icon: Activity };
      case 'models': return { title: 'AI MODEL PROVIDERS & ROUTING', icon: Cpu };
      case 'memory': return { title: 'PERSISTENT KNOWLEDGE & MEMORY', icon: HardDrive };
      case 'graph': return { title: 'NEURAL KNOWLEDGE GRAPH', icon: Network };
      case 'vision': return { title: 'VISION & MULTIMODAL STUDIO', icon: Eye };
      case 'data': return { title: 'DATA INTELLIGENCE & ANALYTICS', icon: BarChart3 };
      case 'education': return { title: 'EDUCATION & STUDY PLANS', icon: GraduationCap };
      case 'business': return { title: 'BUSINESS CRM & PIPELINE', icon: Briefcase };
      case 'wellness': return { title: 'WELLNESS & BIOMETRICS', icon: HeartPulse };
      case 'finance': return { title: 'PERSONAL FINANCE & BUDGETS', icon: Wallet };
      case 'paper': return { title: 'PAPER TRADING SIMULATION', icon: LineChart };
      case 'focus': return { title: 'FOCUS WORKSPACE', icon: Compass };
      case 'roster': return { title: 'AGENT ROSTER & CUSTOM NAMES', icon: Edit3 };
      default: return { title: 'SUBSYSTEM WINDOW', icon: Globe2 };
    }
  };

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
            <span className="tj-cmd-version-badge">v{status?.version ?? '2.0.0'}</span>
            <div className="tj-cmd-privacy-badge">
              <span className="tj-cmd-privacy-dot" />
              <span>PRIVACY: VERIFIED</span>
            </div>
          </div>

          {/* Center Mode Switcher */}
          <nav className="tj-cmd-mode-switcher" aria-label="Command Mode Switcher">
            <button
              type="button"
              className={`tj-cmd-mode-btn ${!activeFloatingWindow ? 'is-active' : ''}`}
              onClick={handleResetCamera}
            >
              <Compass size={13} />
              <span>Living World</span>
            </button>
            <button
              type="button"
              className={`tj-cmd-mode-btn ${activeFloatingWindow === 'focus' ? 'is-active' : ''}`}
              onClick={() => openFloating('focus')}
            >
              <span>Focus</span>
            </button>
            <button
              type="button"
              className={`tj-cmd-mode-btn ${activeFloatingWindow === 'workflows' ? 'is-active' : ''}`}
              onClick={() => openFloating('workflows')}
            >
              <Workflow size={13} />
              <span>Workflow</span>
            </button>
          </nav>

          {/* Right Header Actions */}
          <div className="tj-cmd-header-actions">
            <button
              type="button"
              className="tj-cmd-icon-btn"
              onClick={() => openFloating('roster')}
              title="Customize Agent Names"
              aria-label="Customize Agent Names"
            >
              <Edit3 size={14} />
            </button>
            <button
              type="button"
              className="tj-cmd-icon-btn"
              onClick={() => openFloating('settings')}
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
            const isTabActive = tab.isWindow ? activeFloatingWindow === tab.id : (!activeFloatingWindow && tab.isActive);

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isTabActive}
                className={`tj-cmd-tab ${isTabActive ? 'is-active' : ''}`}
                onClick={() => {
                  if (tab.isWindow) {
                    openFloating(tab.id);
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
            onClick={() => openFloating('roster')}
            style={{ marginLeft: 'auto', borderColor: 'rgba(0, 242, 254, 0.4)', color: '#00f2fe' }}
          >
            <UserCheck size={13} />
            <span>EDIT AGENT NAMES</span>
          </button>
        </div>
      </header>

      {/* ====================================================================
          100% FULL-SCREEN 3D THREE.JS CANVAS (ALWAYS RUNNING IN BACKGROUND)
          ==================================================================== */}
      <div className="tj-command-center-canvas">
        <LivingHQScene
          customNames={customNames}
          onSelectAgent={handleSelect3DAgent}
          onOpenRoom={(dest) => openFloating(dest)}
          selectedAgentId={selectedSlotId}
          focusTarget={focusTarget}
          height="100%"
        />
      </div>

      {/* ====================================================================
          BOTTOM-LEFT OVERLAYS: HYBRID CARD & GLASSMORPHIC SWITCHES
          (WITH CLOSE / MINIMIZE BUTTON)
          ==================================================================== */}
      <div className="tj-cmd-bottom-left">
        {showBottomLeft ? (
          <>
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
              <button
                type="button"
                className="tj-cmd-panel-close-btn"
                onClick={() => setShowBottomLeft(false)}
                title="Minimize Panel"
                aria-label="Minimize Panel"
              >
                <Minus size={13} />
              </button>
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

            {/* Category Drawer Popup (Opens floating windows!) */}
            {activeCategoryDrawer === 'aiSystems' && (
              <div className="tj-cmd-category-drawer">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <b style={{ fontSize: 9, color: '#00f2fe', letterSpacing: '0.1em' }}>AI SYSTEMS</b>
                  <button type="button" onClick={() => setActiveCategoryDrawer(null)} style={{ padding: 0 }}><X size={12} /></button>
                </div>
                <button type="button" onClick={() => openFloating('models')}>AI Providers</button>
                <button type="button" onClick={() => openFloating('connectors')}>Connectors</button>
                <button type="button" onClick={() => openFloating('skills')}>Skills Engine</button>
                <button type="button" onClick={() => openFloating('memory')}>Memory Core</button>
                <button type="button" onClick={() => openFloating('graph')}>Knowledge Graph</button>
              </div>
            )}

            {activeCategoryDrawer === 'studios' && (
              <div className="tj-cmd-category-drawer">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <b style={{ fontSize: 9, color: '#00f2fe', letterSpacing: '0.1em' }}>STUDIOS</b>
                  <button type="button" onClick={() => setActiveCategoryDrawer(null)} style={{ padding: 0 }}><X size={12} /></button>
                </div>
                <button type="button" onClick={() => openFloating('vision')}>Vision Studio</button>
                <button type="button" onClick={() => openFloating('data')}>Data Intelligence</button>
                <button type="button" onClick={() => openFloating('education')}>Education Plans</button>
                <button type="button" onClick={() => openFloating('business')}>Business CRM</button>
                <button type="button" onClick={() => openFloating('wellness')}>Wellness Trends</button>
              </div>
            )}

            {activeCategoryDrawer === 'finance' && (
              <div className="tj-cmd-category-drawer">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <b style={{ fontSize: 9, color: '#00f2fe', letterSpacing: '0.1em' }}>FINANCE</b>
                  <button type="button" onClick={() => setActiveCategoryDrawer(null)} style={{ padding: 0 }}><X size={12} /></button>
                </div>
                <button type="button" onClick={() => openFloating('finance')}>Personal Finance</button>
                <button type="button" onClick={() => openFloating('paper')}>Paper Trading</button>
              </div>
            )}

            {activeCategoryDrawer === 'system' && (
              <div className="tj-cmd-category-drawer">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <b style={{ fontSize: 9, color: '#00f2fe', letterSpacing: '0.1em' }}>SYSTEM</b>
                  <button type="button" onClick={() => setActiveCategoryDrawer(null)} style={{ padding: 0 }}><X size={12} /></button>
                </div>
                <button type="button" onClick={() => openFloating('settings')}>Settings & Config</button>
              </div>
            )}
          </>
        ) : (
          <button
            type="button"
            className="tj-cmd-pill-btn"
            onClick={() => setShowBottomLeft(true)}
            title="Restore Switches Panel"
          >
            <Compass size={13} />
            <span>HYBRID NEXUS</span>
          </button>
        )}
      </div>

      {/* ====================================================================
          BOTTOM-CENTER: LIVE ACTIVITY & THE LIVING PULSE
          (WITH CLOSE / MINIMIZE BUTTON)
          ==================================================================== */}
      <div className="tj-cmd-bottom-center">
        {showBottomPulse ? (
          <>
            {/* Live Activity Pill */}
            <div className="tj-cmd-live-activity-pill">
              <span>LIVE ACTIVITY:</span>
              <b>{runningTasks} running</b>
              <span>|</span>
              <b>{pendingApprovals} queued</b>
              {selectedAgentName && (
                <>
                  <span>|</span>
                  <span style={{ color: '#00f2fe' }}>LINKED: {selectedAgentName.toUpperCase()}</span>
                </>
              )}
              <button
                type="button"
                className="tj-cmd-panel-close-btn"
                onClick={() => setShowBottomPulse(false)}
                title="Minimize Living Pulse"
                style={{ marginLeft: 6 }}
              >
                <Minus size={11} />
              </button>
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
          </>
        ) : (
          <button
            type="button"
            className="tj-cmd-pill-btn"
            onClick={() => setShowBottomPulse(true)}
            title="Restore Living Pulse"
          >
            <Sparkles size={13} />
            <span>THE LIVING PULSE</span>
          </button>
        )}
      </div>

      {/* ====================================================================
          BOTTOM-RIGHT: TELEMETRY GRAPHS & METRICS
          (WITH CLOSE / MINIMIZE BUTTON)
          ==================================================================== */}
      <div className="tj-cmd-bottom-right">
        {showBottomRight ? (
          <>
            <div className="tj-cmd-telemetry-header">
              <span className="tj-cmd-telemetry-tab active">AGENT NETWORK</span>
              <span className="tj-cmd-telemetry-tab">COMPONENTS</span>
              <span className="tj-cmd-telemetry-tab">COMPUTE LOAD</span>
              <button
                type="button"
                className="tj-cmd-panel-close-btn"
                onClick={() => setShowBottomRight(false)}
                title="Minimize Telemetry"
                aria-label="Minimize Telemetry"
              >
                <Minus size={13} />
              </button>
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
          </>
        ) : (
          <button
            type="button"
            className="tj-cmd-pill-btn"
            onClick={() => setShowBottomRight(true)}
            title="Restore Telemetry"
          >
            <Activity size={13} />
            <span>TELEMETRY</span>
          </button>
        )}
      </div>

      {/* ====================================================================
          FLOATING WINDOW OVERLAY (CAN BE CLOSED ANYTIME!)
          ==================================================================== */}
      {activeFloatingWindow && (
        <div
          className="tj-floating-window-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeFloating();
          }}
        >
          <div className={`tj-floating-window ${isWindowMaximized ? 'is-maximized' : ''}`}>
            {/* Window Header */}
            <div className="tj-floating-window-header">
              <div className="tj-floating-window-title">
                {(() => {
                  const info = getWindowTitle(activeFloatingWindow);
                  const Icon = info.icon;
                  return (
                    <>
                      <Icon size={16} />
                      <span>{info.title}</span>
                      <span className="tj-floating-window-badge">LIVE MODULE</span>
                    </>
                  );
                })()}
              </div>

              <div className="tj-floating-window-actions">
                <button
                  type="button"
                  className="tj-floating-win-btn"
                  onClick={() => setIsWindowMaximized(!isWindowMaximized)}
                  title={isWindowMaximized ? 'Restore Size' : 'Maximize Window'}
                >
                  {isWindowMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                </button>
                <button
                  type="button"
                  className="tj-floating-win-btn close"
                  onClick={closeFloating}
                  title="Close Window (Esc)"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Window Body with Full Live Interactive View */}
            <div className="tj-floating-window-body">
              <Suspense
                fallback={
                  <div style={{ padding: 32, textAlign: 'center', color: '#00f2fe', fontFamily: 'JetBrains Mono' }}>
                    INITIALIZING QUANTUM TELEMETRY INTERFACE…
                  </div>
                }
              >
                {renderFloatingContent(activeFloatingWindow)}
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
