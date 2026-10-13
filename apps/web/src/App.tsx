import React, { Suspense, lazy, useEffect, useState } from 'react';
import { apiChatStream, apiFetch, getApiBaseUrl, setApiBaseUrl, isNativePlatform, isDesktopApp } from './api';
import { TopBar } from './components/TopBar';
import { InteractionPanel } from './components/InteractionPanel';
import { WelcomeExperience } from './components/WelcomeExperience';
import { CommandPalette, type PaletteAction } from './components/CommandPalette';
import { LiveVoiceModal } from './components/LiveVoiceModal';
import { MainInterface } from './views/MainInterface';
import './views/reference-scenes.css';
const ChatView = lazy(() => import('./views/ChatView').then((m) => ({ default: m.ChatView })));
const CommandCenter = lazy(() => import('./views/CommandCenter').then((m) => ({ default: m.CommandCenter })));
const FocusWorkspace = lazy(() => import('./views/FocusWorkspace').then((m) => ({ default: m.FocusWorkspace })));
const CapabilitiesView = lazy(() => import('./views/CapabilitiesView').then((m) => ({ default: m.CapabilitiesView })));
const ConnectorsView = lazy(() => import('./views/ConnectorsView').then((m) => ({ default: m.ConnectorsView })));
const ApprovalsView = lazy(() => import('./views/ApprovalsView').then((m) => ({ default: m.ApprovalsView })));
const AgentsView = lazy(() => import('./views/AgentsView').then((m) => ({ default: m.AgentsView })));
const WorkflowsView = lazy(() => import('./views/WorkflowsView').then((m) => ({ default: m.WorkflowsView })));
const MemoryView = lazy(() => import('./views/MemoryView').then((m) => ({ default: m.MemoryView })));
const ModelsView = lazy(() => import('./views/ModelsView').then((m) => ({ default: m.ModelsView })));
const SettingsView = lazy(() => import('./views/SettingsView').then((m) => ({ default: m.SettingsView })));
const TasksView = lazy(() => import('./views/TasksView').then((m) => ({ default: m.TasksView })));
const ActivityView = lazy(() => import('./views/ActivityView').then((m) => ({ default: m.ActivityView })));
const VisionView = lazy(() => import('./views/VisionView').then((m) => ({ default: m.VisionView })));
const SkillsView = lazy(() => import('./views/SkillsView').then((m) => ({ default: m.SkillsView })));
const LearningView = lazy(() => import('./views/LearningView').then((m) => ({ default: m.LearningView })));
const DataIntelligenceView = lazy(() => import('./views/DataIntelligenceView').then((m) => ({ default: m.DataIntelligenceView })));
const GraphView = lazy(() => import('./views/GraphView').then((m) => ({ default: m.GraphView })));
const WorkbenchView = lazy(() => import('./views/WorkbenchView').then((m) => ({ default: m.WorkbenchView })));
const EducationView = lazy(() => import('./views/EducationView').then((m) => ({ default: m.EducationView })));
const BusinessView = lazy(() => import('./views/BusinessView').then((m) => ({ default: m.BusinessView })));
const MediaView = lazy(() => import('./views/MediaView').then((m) => ({ default: m.MediaView })));
const WellnessView = lazy(() => import('./views/WellnessView').then((m) => ({ default: m.WellnessView })));
const PaperTradingView = lazy(() => import('./views/PaperTradingView').then((m) => ({ default: m.PaperTradingView })));
const FinanceView = lazy(() => import('./views/FinanceView').then((m) => ({ default: m.FinanceView })));
import { navLabel, uiLanguage } from './i18n';
import {
  Compass, MessageSquare, Users, Cpu, Boxes, Workflow, ShieldAlert,
  HardDrive, Sliders, Activity, CheckSquare, Radio, Search, Eye, Wrench, Lightbulb, BarChart3, Network, Globe2, GraduationCap, BriefcaseBusiness, Clapperboard, HeartPulse, LineChart, Wallet
} from 'lucide-react';
import { DEFAULT_TJ_PERSONA, type SystemStatus, type TJPersona } from '@tj/schemas';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('command');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [persona, setPersona] = useState<TJPersona>(DEFAULT_TJ_PERSONA);
  const [locale, setLocale] = useState(navigator.language || 'en-US');
  const [stopping, setStopping] = useState(false);
  const [showWizard, setShowWizard] = useState<boolean | null>(() => new URLSearchParams(window.location.search).has('welcome') ? true : null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [bootDone, setBootDone] = useState(false);
  const [serverUrlDraft, setServerUrlDraft] = useState(() => getApiBaseUrl() || (isDesktopApp() ? 'http://127.0.0.1:4780' : isNativePlatform() ? 'http://192.168.13.167:4780' : ''));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [liveVoiceOpen, setLiveVoiceOpen] = useState(false);

  useEffect(() => {
    const handleOpenLive = () => setLiveVoiceOpen(true);
    window.addEventListener('tj:open-live-voice', handleOpenLive);
    return () => window.removeEventListener('tj:open-live-voice', handleOpenLive);
  }, []);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [openNavGroups, setOpenNavGroups] = useState<string[]>(['nexus', 'work']);
  const [contextOpen, setContextOpen] = useState(false);
  const [workflowInitialMode, setWorkflowInitialMode] = useState<'studio' | 'hall'>('studio');
  const openTab = (tab: string) => {
    setWorkflowInitialMode('studio');
    setActiveTab(tab === 'main' ? 'command' : tab);
  };
  const openBuilding = (destination: string) => {
    if (destination === 'collaboration_hall') {
      setWorkflowInitialMode('hall');
      setActiveTab('workflows');
      return;
    }
    setWorkflowInitialMode('studio');
    setActiveTab(destination);
  };
  useEffect(() => {
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1200;
    const timer = window.setTimeout(() => setBootDone(true), duration);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k' && showWizard === false) {
        event.preventDefault(); setPaletteOpen((open) => !open);
      } else if (event.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [showWizard]);

  // Shared chat messages for Command Center & Interaction Panel
  const [messages, setMessages] = useState<Array<{ id: string; role: 'user' | 'assistant' | 'system'; content: string }>>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [voiceSpeaking, setVoiceSpeaking] = useState(false);
  const [voicePulse, setVoicePulse] = useState(0);
  const [eventNotice, setEventNotice] = useState<{ name: string; summary: string } | null>(null);
  useEffect(() => {
    const update = (event: Event) => setVoiceSpeaking((event as CustomEvent<string>).detail === 'speaking');
    const pulse = () => setVoicePulse(performance.now());
    window.addEventListener('tj:voice-state', update);
    window.addEventListener('tj:voice-pulse', pulse);
    return () => { window.removeEventListener('tj:voice-state', update); window.removeEventListener('tj:voice-pulse', pulse); };
  }, []);

  useEffect(() => {
    let notificationsEnabled = true;
    const loadPreference = () => { void apiFetch<{ settings: Record<string, unknown> }>('/api/v1/settings').then((result) => { notificationsEnabled = result.settings.notifications_enabled !== false; }).catch(() => {}); };
    loadPreference();
    const stream = new EventSource('/api/v1/system/events');
    stream.addEventListener('system.settings_changed', loadPreference);
    const alert = (event: Event) => {
      if (!notificationsEnabled) return;
      const item = JSON.parse((event as MessageEvent).data) as { name: string; summary: string };
      setEventNotice({ name: item.name, summary: item.summary });
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('TJ · Action needed', { body: item.summary });
    };
    for (const name of ['approval.requested', 'task.failed', 'workflow.failed', 'agent.failed']) stream.addEventListener(name, alert);
    return () => stream.close();
  }, []);

  const loadStatus = async () => {
    try {
      const res = await apiFetch<SystemStatus>('/api/v1/system/status');
      setStatus(res);
      // Check first-run setting
      const firstRun = await apiFetch<{ first_run_completed: boolean }>('/api/v1/system/first-run');
      setShowWizard(!firstRun.first_run_completed || new URLSearchParams(window.location.search).has('welcome'));
      setStartupError(null);
    } catch (e) {
      console.error(e);
      if (showWizard === null) {
        setRetryCount((prev) => {
          const next = prev + 1;
          const maxRetries = isDesktopApp() ? 15 : isNativePlatform() ? 6 : 4;
          if (next >= maxRetries) {
            setStartupError(e instanceof Error ? e.message : 'API connection failed');
          }
          return next;
        });
      }
    }
  };
  const loadPersona = async () => {
    try { const result = await apiFetch<{ persona: TJPersona }>('/api/v1/persona'); setPersona(result.persona); }
    catch (error) { console.error(error); }
  };
  useEffect(() => {
    loadStatus();
    loadPersona();
    const refreshLocale = () => { void apiFetch<{ profile: { locale: string } | null }>('/api/v1/system/setup').then((result) => { if (result.profile?.locale) setLocale(result.profile.locale); }).catch(() => {}); };
    refreshLocale();
    window.addEventListener('tj:locale-changed', refreshLocale);
    const intervalTime = status ? 4000 : 1200;
    const timer = setInterval(loadStatus, intervalTime);
    const stream = new EventSource('/api/v1/system/events');
    for (const name of ['agent.updated', 'agent.started', 'agent.completed', 'agent.failed', 'task.started', 'task.completed', 'task.failed', 'approval.requested', 'approval.granted', 'approval.denied', 'system.health_changed']) stream.addEventListener(name, loadStatus);
    stream.addEventListener('system.persona_changed', loadPersona);
    return () => { clearInterval(timer); stream.close(); window.removeEventListener('tj:locale-changed', refreshLocale); };
  }, [status]);

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

  const handleSendChat = async (text: string, mode: 'auto' | 'chat' | 'build' = 'auto') => {
    if (!text.trim() || chatLoading) return;
    setChatError(null);
    setChatLoading(true);
    const responseId = `bot-${Date.now()}`;
    setMessages((prev) => [...prev, { id: `user-${responseId}`, role: 'user', content: text }, { id: responseId, role: 'assistant', content: '' }]);

    try {
      const res = await apiChatStream<any>({ conversation_id: activeConvId ?? undefined, content: text, mode }, (delta) => {
        setMessages((prev) => prev.map((message) => message.id === responseId ? { ...message, content: message.content + delta } : message));
      });
      if (!activeConvId && res.conversation_id) {
        setActiveConvId(res.conversation_id);
      }
      setMessages((prev) => prev.map((message) => message.id === responseId ? { id: res.message?.id ?? responseId, role: 'assistant', content: res.content } : message));
    } catch (err: any) {
      setMessages((prev) => prev.filter((message) => message.id !== responseId || !!message.content));
      setChatError(err.message || 'Chat error');
    } finally {
      setChatLoading(false);
      loadStatus();
    }
  };

  if (showWizard === null || (showWizard === false && !bootDone)) {
    const isNative = isNativePlatform();
    const isDesktop = isDesktopApp();
    const hasError = !!startupError;
    return (
      <div className="tj-boot-screen" style={{ padding: 20 }}>
        <div className="tj-boot-gate"><div className="tj-brand-mark">T<span>J</span></div></div>
        <p style={{ letterSpacing: '0.18em', margin: '4px 0', textAlign: 'center' }}>
          {hasError
            ? 'CONNECTION NEEDS ATTENTION'
            : status
            ? `SYSTEM CONNECTED · ${status.tj_state.toUpperCase()}`
            : isDesktop
            ? 'STARTING EMBEDDED TJ ENGINE…'
            : 'CONNECTING TO YOUR SYSTEM…'}
        </p>

        {hasError && (
          <div style={{ maxWidth: 440, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, background: 'rgba(8, 20, 36, 0.88)', padding: '22px 24px', borderRadius: 14, border: '1px solid rgba(81, 190, 251, 0.35)', backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)' }}>
            <p role="alert" style={{ fontSize: 13, color: '#fca5a5', textAlign: 'center', lineHeight: 1.5, letterSpacing: 0, margin: 0 }}>
              {startupError.includes('<!doctype') || startupError.includes('Unexpected token')
                ? (isNative ? 'Mobile app needs to connect to your TJ Server.' : 'Server returned invalid response. Reconnect below.')
                : startupError}
            </p>

            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              <label style={{ fontSize: 11, color: '#94a3b8', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 600 }}>
                {isDesktop ? 'Embedded TJ Engine Port / URL:' : isNative ? 'TJ Host Server Address (PC / Cloud IP):' : 'TJ Server URL:'}
              </label>
              <input
                type="text"
                value={serverUrlDraft}
                onChange={(e) => setServerUrlDraft(e.target.value)}
                placeholder={isDesktop ? 'http://127.0.0.1:4780' : 'http://192.168.13.167:4780'}
                style={{
                  width: '100%',
                  padding: '11px 14px',
                  background: 'rgba(3, 7, 17, 0.85)',
                  border: '1px solid rgba(81, 190, 251, 0.45)',
                  borderRadius: 8,
                  color: '#e2f4fe',
                  fontSize: 14,
                  fontFamily: 'monospace',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
              <span style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>
                {isDesktop
                  ? 'Desktop runs the backend automatically at http://127.0.0.1:4780.'
                  : "Enter your computer's local Wi-Fi IP and port (default: http://192.168.13.167:4780). Ensure both devices are on the same Wi-Fi."}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10, width: '100%', marginTop: 6 }}>
              <button
                onClick={() => {
                  setApiBaseUrl(serverUrlDraft);
                  setStartupError(null);
                  setRetryCount(0);
                  loadStatus();
                }}
                style={{
                  flex: 1,
                  padding: '11px 16px',
                  background: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
                  border: 'none',
                  borderRadius: 8,
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  letterSpacing: '0.05em'
                }}
              >
                Save & Connect
              </button>
              <button
                onClick={() => {
                  setStartupError(null);
                  setRetryCount(0);
                  loadStatus();
                }}
                style={{
                  padding: '11px 18px',
                  background: 'transparent',
                  border: '1px solid rgba(81, 190, 251, 0.4)',
                  borderRadius: 8,
                  color: '#7dd3fc',
                  fontSize: 13,
                  cursor: 'pointer'
                }}
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
  if (showWizard) return <WelcomeExperience onComplete={() => { window.history.replaceState(null, '', window.location.pathname); loadPersona(); setShowWizard(false); }} />;

  const navItems = [
    { id: 'main', label: 'Main Interface', icon: Globe2 },
    { id: 'command', label: 'Living World', icon: Compass },
    { id: 'chat', label: 'Conversations', icon: MessageSquare },
    { id: 'vision', label: 'Vision', icon: Eye },
    { id: 'data', label: 'Data Intelligence', icon: BarChart3 },
    { id: 'education', label: 'Education', icon: GraduationCap },
    { id: 'business', label: 'Business CRM', icon: BriefcaseBusiness },
    { id: 'media', label: 'Files & Media', icon: Clapperboard },
    { id: 'wellness', label: 'Wellness', icon: HeartPulse },
    { id: 'finance', label: 'Personal Finance', icon: Wallet },
    { id: 'paper', label: 'Paper Trading', icon: LineChart },
    { id: 'tasks', label: 'Mission Control', icon: CheckSquare, badge: status?.running_tasks },
    { id: 'activity', label: 'Activity', icon: Radio },
    { id: 'agents', label: 'Agents', icon: Users },
    { id: 'workflows', label: 'Workflows', icon: Workflow },
    { id: 'capabilities', label: 'Capabilities', icon: Boxes },
    { id: 'skills', label: 'Local Skills', icon: Wrench },
    { id: 'learning', label: 'Improvement Review', icon: Lightbulb },
    { id: 'connectors', label: 'Connectors', icon: Activity },
    { id: 'workbench', label: 'API Workbench', icon: Globe2 },
    { id: 'approvals', label: 'Approvals', icon: ShieldAlert, badge: status?.pending_approvals },
    { id: 'memory', label: 'Memory', icon: HardDrive },
    { id: 'graph', label: 'Knowledge Graph', icon: Network },
    { id: 'models', label: 'AI Providers', icon: Cpu },
    { id: 'settings', label: 'Settings', icon: Sliders },
  ];
  const navGroups = [
    { id: 'nexus', label: 'NEXUS', items: ['main', 'command', 'tasks', 'agents'] },
    { id: 'work', label: 'WORKSPACE', items: ['chat', 'workflows', 'media', 'activity', 'approvals'] },
    { id: 'intelligence', label: 'AI SYSTEMS', items: ['models', 'connectors', 'capabilities', 'skills', 'workbench', 'memory', 'graph'] },
    { id: 'studios', label: 'STUDIOS', items: ['vision', 'data', 'education', 'business', 'wellness'] },
    { id: 'finance', label: 'FINANCE', items: ['finance', 'paper'] },
    { id: 'system', label: 'SYSTEM', items: ['learning', 'settings'] },
  ];
  const paletteActions: PaletteAction[] = [
    { id: 'ask', label: 'Ask TJ', detail: 'Open the Focus workspace and send a question or goal', keywords: 'conversation', run: () => setActiveTab('focus') },
    { id: 'voice', label: 'Start voice listening', detail: 'Use the Windows microphone for hands-free conversation', keywords: 'microphone speak', run: async () => { await apiFetch('/api/v1/voice/start', { method: 'POST' }); } },
    { id: 'memory', label: 'Search memory', detail: 'Open your saved knowledge and search', keywords: 'find knowledge', run: () => setActiveTab('memory') },
    { id: 'graph', label: 'Explore knowledge graph', detail: 'Inspect real saved project, task, agent and memory links', keywords: 'relationships network', run: () => setActiveTab('graph') },
    { id: 'vision', label: 'Analyze an image', detail: 'Open image understanding with an explicit upload', keywords: 'camera picture', run: () => setActiveTab('vision') },
    { id: 'data', label: 'Analyze CSV data', detail: 'Import a local CSV and inspect real statistics', keywords: 'dataset chart', run: () => setActiveTab('data') },
    { id: 'education', label: 'Open study plans', detail: 'Create lessons, quizzes and track progress', keywords: 'learn education course', run: () => setActiveTab('education') },
    { id: 'business', label: 'Open business CRM', detail: 'Manage saved companies, contacts, deals and tasks', keywords: 'crm sales', run: () => setActiveTab('business') },
    { id: 'media', label: 'Open media studio', detail: 'Organize local media and creative briefs', keywords: 'assets library creative', run: () => setActiveTab('media') },
    { id: 'wellness', label: 'Open wellness trends', detail: 'Record health metrics and prepare questions', keywords: 'sleep fitness heart rate', run: () => setActiveTab('wellness') },
    { id: 'finance', label: 'Open finance analysis', detail: 'Import transactions and review budgets locally', keywords: 'spending budget money', run: () => setActiveTab('finance') },
    { id: 'paper', label: 'Open paper trading', detail: 'Backtest user supplied price data with risk limits', keywords: 'simulation investing strategy', run: () => setActiveTab('paper') },
    { id: 'agents', label: 'Create an agent', detail: 'Open available specialist templates', keywords: 'deploy specialist', run: () => setActiveTab('agents') },
    { id: 'workflows', label: 'Create a workflow', detail: 'Open workflow builder and saved runs', keywords: 'automation', run: () => openTab('workflows') },
    { id: 'automation', label: 'Run an automation', detail: 'Open scheduled automations and workflow controls', keywords: 'schedule cron', run: () => openTab('workflows') },
    { id: 'connectors', label: 'Use a connector', detail: 'Open configured integrations and connection tests', keywords: 'integration app', run: () => setActiveTab('connectors') },
    { id: 'workbench', label: 'Open API Workbench', detail: 'Save and run a bounded public HTTP request', keywords: 'http api request', run: () => setActiveTab('workbench') },
    { id: 'skills', label: 'Run a local skill', detail: 'Install, review, enable and run a declarative skill', keywords: 'plugin template', run: () => setActiveTab('skills') },
    { id: 'learning', label: 'Review improvements', detail: 'Review feedback and proposals based on recorded results', keywords: 'self improvement feedback', run: () => setActiveTab('learning') },
    { id: 'recent', label: 'Open recent results', detail: 'Inspect live activity and completed work', keywords: 'history events', run: () => setActiveTab('activity') },
    { id: 'tasks', label: 'Open tasks', detail: 'Review active and saved tasks', keywords: 'projects', run: () => setActiveTab('tasks') },
    { id: 'approvals', label: 'Open approvals', detail: 'Review pending actions and their risks', keywords: 'permissions', run: () => setActiveTab('approvals') },
    { id: 'themes', label: 'Change atmosphere', detail: 'Choose from ten TJ interface themes', keywords: 'theme color appearance design', run: () => setActiveTab('settings') },
  ];

  if (activeTab === 'command' || activeTab === 'main') {
    return (
      <div className="tj-app-shell" style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#050b14', position: 'relative' }}>
        <Suspense fallback={<div role="status" style={{ padding: 24, color: '#00f2fe' }}>Opening Living World…</div>}>
          <CommandCenter
            status={status}
            persona={persona}
            voiceSpeaking={voiceSpeaking}
            voicePulse={voicePulse}
            onNavigate={openTab}
            onOpenBuilding={openBuilding}
            onSelectAgent={(id) => { setSelectedAgentId(id || null); openTab('agents'); }}
            onSendChat={handleSendChat}
            onOpenPulse={() => setContextOpen((open) => !open)}
            loading={chatLoading}
            stopping={stopping}
            onStopAll={handleStopAll}
            onOpenLiveVoice={() => setLiveVoiceOpen(true)}
          />
        </Suspense>
        <div className={`tj-pulse-drawer ${contextOpen ? 'is-open' : ''}`} aria-hidden={!contextOpen}>
          <InteractionPanel persona={persona} status={status} messages={messages} loading={chatLoading} error={chatError} onSend={(txt) => handleSendChat(txt, 'chat')} />
        </div>
        {paletteOpen && <CommandPalette actions={paletteActions} onClose={() => setPaletteOpen(false)} />}
        <LiveVoiceModal
          isOpen={liveVoiceOpen}
          onClose={() => setLiveVoiceOpen(false)}
          activeConversationId={activeConvId}
          onConversationCreated={(id) => setActiveConvId(id)}
          onMessageLogged={(role, content) => {
            setMessages((prev) => [...prev, { id: `voice-${Date.now()}-${Math.random()}`, role, content }]);
          }}
        />
        {eventNotice && <button type="button" onClick={() => { setActiveTab(eventNotice.name === 'approval.requested' ? 'approvals' : 'activity'); setEventNotice(null); }} style={{ position: 'fixed', left: 24, bottom: 24, zIndex: 111, maxWidth: 390, padding: '12px 16px', border: '1px solid var(--accent-cyan)', borderRadius: 10, background: 'var(--bg-secondary)', color: '#fff', textAlign: 'left', cursor: 'pointer' }} role="alert">{eventNotice.summary} · Open {eventNotice.name === 'approval.requested' ? 'Approvals' : 'Activity'}</button>}
      </div>
    );
  }

  return (
    <div className="tj-app-shell" style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: 'var(--bg-primary)' }}>
      <TopBar
        status={status}
        stopping={stopping}
        onStopAll={handleStopAll}
        onNavigate={openTab}
        activeTab={activeTab}
        onOpenLiveVoice={() => setLiveVoiceOpen(true)}
      />

      <div style={{ display: 'flex', flex: 1, height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
        <aside className="tj-side-rail" style={{
          width: navCollapsed ? 62 : 238, minWidth: navCollapsed ? 62 : 238, background: 'var(--bg-secondary)', borderRight: '1px solid var(--border-subtle)', overflowY: 'auto', overflowX: 'hidden',
          display: 'flex', flexDirection: 'column', alignItems: 'stretch', padding: '12px 10px', gap: 6, zIndex: 10, transition: 'width .22s ease,min-width .22s ease',
        }}>
          <div className="tj-nav-brand-row">
            {!navCollapsed && <span className="tj-nav-brand"><span className="tj-nav-brand-mark">T<span>J</span></span><span><b>THE LIVING NEXUS</b><small>INTELLIGENCE OS</small></span></span>}
            <button type="button" onClick={() => setNavCollapsed((value) => !value)} aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'} className="tj-nav-icon-button">{navCollapsed ? '›' : '‹'}</button>
          </div>
          <button type="button" onClick={() => setPaletteOpen(true)} title="Search commands (Ctrl+K)" aria-label="Open command palette" className="tj-nav-search"><Search size={16} /><span>{navCollapsed ? '' : 'Search anything'}</span><kbd>⌘ K</kbd></button>
          {navGroups.map((group) => {
            const expanded = navCollapsed || openNavGroups.includes(group.id);
            return <section className={`tj-nav-group ${expanded ? 'is-expanded' : ''}`} key={group.id}>
              {!navCollapsed && <button type="button" className="tj-nav-group-toggle" aria-expanded={expanded} onClick={() => setOpenNavGroups((current) => current.includes(group.id) ? current.filter((id) => id !== group.id) : [...current, group.id])}><span>{group.label}</span><span>{expanded ? '−' : '+'}</span></button>}
              {expanded && <div className="tj-nav-group-items">{group.items.map((id) => {
                const item = navItems.find((entry) => entry.id === id)!;
                const Icon = item.icon;
                const isActive = activeTab === item.id || (activeTab === 'focus' && item.id === 'chat');
                return <button key={item.id} type="button" onClick={() => openTab(item.id)} className={`tj-side-rail-button ${isActive ? 'is-active' : ''}`} title={navLabel(item.id, item.label, uiLanguage(locale))} aria-label={navLabel(item.id, item.label, uiLanguage(locale))} aria-current={isActive ? 'page' : undefined}>
                  <Icon size={17} /><span>{navLabel(item.id, item.label, uiLanguage(locale))}</span>{Boolean(item.badge && item.badge > 0) && <i className="tj-nav-badge" />}
                </button>;
              })}</div>}
            </section>;
          })}
        </aside>

        {activeTab === 'main' ? (
          <MainInterface status={status} onNavigate={openTab} />
        ) : activeTab === 'focus' ? (
          <div style={{ flex: 1, height: '100%', minWidth: 0, overflow: 'hidden', padding: 16 }}>
            <Suspense fallback={<div role="status" style={{ padding: 24, color: 'var(--text-muted)' }}>Opening Focus workspace…</div>}><FocusWorkspace personaName={persona.name} /></Suspense>
          </div>
        ) : (
          <div style={{ flex: 1, height: '100%', overflow: 'hidden', padding: 16 }}>
            <Suspense fallback={<div role="status" style={{ padding: 24, color: 'var(--text-muted)' }}>Loading workspace…</div>}>
            {activeTab === 'chat' && <ChatView personaName={persona.name} onNavigate={openTab} />}
            {activeTab === 'vision' && <VisionView />}
            {activeTab === 'data' && <DataIntelligenceView />}
            {activeTab === 'education' && <EducationView />}
            {activeTab === 'business' && <BusinessView />}
            {activeTab === 'media' && <MediaView />}
            {activeTab === 'wellness' && <WellnessView />}
            {activeTab === 'finance' && <FinanceView />}
            {activeTab === 'paper' && <PaperTradingView />}
            {activeTab === 'tasks' && <TasksView />}
            {activeTab === 'activity' && <ActivityView />}
            {activeTab === 'agents' && <AgentsView selectedAgentId={selectedAgentId} />}
            {activeTab === 'workflows' && <WorkflowsView key={workflowInitialMode} initialMode={workflowInitialMode} />}
            {activeTab === 'capabilities' && <CapabilitiesView />}
            {activeTab === 'skills' && <SkillsView />}
            {activeTab === 'learning' && <LearningView />}
            {activeTab === 'connectors' && <ConnectorsView />}
            {activeTab === 'workbench' && <WorkbenchView />}
            {activeTab === 'approvals' && <ApprovalsView />}
            {activeTab === 'memory' && <MemoryView />}
            {activeTab === 'graph' && <GraphView />}
            {activeTab === 'models' && <ModelsView />}
            {activeTab === 'settings' && <SettingsView />}
            </Suspense>
          </div>
        )}
      </div>
      <div className={`tj-pulse-drawer ${contextOpen ? 'is-open' : ''}`} aria-hidden={!contextOpen}><InteractionPanel persona={persona} status={status} messages={messages} loading={chatLoading} error={chatError} onSend={(txt) => handleSendChat(txt, 'chat')} /></div>
      {paletteOpen && <CommandPalette actions={paletteActions} onClose={() => setPaletteOpen(false)} />}
      <LiveVoiceModal
        isOpen={liveVoiceOpen}
        onClose={() => setLiveVoiceOpen(false)}
        activeConversationId={activeConvId}
        onConversationCreated={(id) => setActiveConvId(id)}
        onMessageLogged={(role, content) => {
          setMessages((prev) => [...prev, { id: `voice-${Date.now()}-${Math.random()}`, role, content }]);
        }}
      />
      {eventNotice && <button type="button" onClick={() => { setActiveTab(eventNotice.name === 'approval.requested' ? 'approvals' : 'activity'); setEventNotice(null); }} style={{ position: 'fixed', left: 82, bottom: 20, zIndex: 111, maxWidth: 390, padding: '12px 16px', border: '1px solid var(--accent-cyan)', borderRadius: 10, background: 'var(--bg-secondary)', color: '#fff', textAlign: 'left', cursor: 'pointer' }} role="alert">{eventNotice.summary} · Open {eventNotice.name === 'approval.requested' ? 'Approvals' : 'Activity'}</button>}
    </div>
  );
};
