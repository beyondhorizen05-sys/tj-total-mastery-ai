import React, { Suspense, lazy, useEffect, useState } from 'react';
import { apiFetch } from './api';
import { TopBar } from './components/TopBar';
import { IntelligenceFeed } from './components/IntelligenceFeed';
import { InteractionPanel } from './components/InteractionPanel';
import { WelcomeExperience } from './components/WelcomeExperience';
import { VoiceControl } from './components/VoiceControl';
import { CommandPalette, type PaletteAction } from './components/CommandPalette';
import { CommandCenter } from './views/CommandCenter';
const ChatView = lazy(() => import('./views/ChatView').then((m) => ({ default: m.ChatView })));
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
  const [bootDone, setBootDone] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
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
      if (showWizard === null) setStartupError(e instanceof Error ? e.message : 'API connection failed');
    }
  };
  const loadPersona = async () => {
    try { const result = await apiFetch<{ persona: TJPersona }>('/api/v1/persona'); setPersona(result.persona); }
    catch (error) { console.error(error); }
  };
  const chooseForm = async (embodiment: TJPersona['embodiment']) => {
    try {
      const result = await apiFetch<{ persona: TJPersona }>('/api/v1/persona', { method: 'PUT', body: JSON.stringify({ ...persona, embodiment }) });
      setPersona(result.persona);
    } catch (error) { console.error(error); }
  };

  useEffect(() => {
    loadStatus();
    loadPersona();
    const refreshLocale = () => { void apiFetch<{ profile: { locale: string } | null }>('/api/v1/system/setup').then((result) => { if (result.profile?.locale) setLocale(result.profile.locale); }).catch(() => {}); };
    refreshLocale();
    window.addEventListener('tj:locale-changed', refreshLocale);
    const timer = setInterval(loadStatus, 4000);
    const stream = new EventSource('/api/v1/system/events');
    for (const name of ['agent.updated', 'agent.started', 'agent.completed', 'agent.failed', 'task.started', 'task.completed', 'task.failed', 'approval.requested', 'approval.granted', 'approval.denied', 'system.health_changed']) stream.addEventListener(name, loadStatus);
    stream.addEventListener('system.persona_changed', loadPersona);
    return () => { clearInterval(timer); stream.close(); window.removeEventListener('tj:locale-changed', refreshLocale); };
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

  const handleSendChat = async (text: string, mode: 'auto' | 'chat' | 'build' = 'auto') => {
    if (!text.trim() || chatLoading) return;
    setChatError(null);
    setChatLoading(true);
    setMessages((prev) => [...prev, { id: 'temp-' + Date.now(), role: 'user', content: text }]);

    try {
      const res = await apiFetch<any>('/api/v1/chat', {
        method: 'POST',
        body: JSON.stringify({ conversation_id: activeConvId ?? undefined, content: text, mode }),
      });
      if (!activeConvId && res.conversation_id) {
        setActiveConvId(res.conversation_id);
      }
      setMessages((prev) => [...prev, { id: res.message?.id ?? 'bot-' + Date.now(), role: 'assistant', content: res.content }]);
    } catch (err: any) {
      setChatError(err.message || 'Chat error');
    } finally {
      setChatLoading(false);
      loadStatus();
    }
  };

  if (showWizard === null || (showWizard === false && !bootDone)) return <div className="tj-boot-screen"><div className="tj-boot-gate"><div className="tj-brand-mark">T<span>J</span></div></div><p>{startupError ? 'CONNECTION NEEDS ATTENTION' : status ? `SYSTEM CONNECTED · ${status.tj_state.toUpperCase()}` : 'CONNECTING TO YOUR SYSTEM…'}</p>{startupError && <><p role="alert" style={{ maxWidth: 420, textAlign: 'center', letterSpacing: 0 }}>{startupError}</p><button onClick={loadStatus} style={{ padding: '10px 18px', border: '1px solid var(--accent-cyan)', color: 'var(--accent-cyan)', background: 'transparent', borderRadius: 6, cursor: 'pointer' }}>Retry connection</button></>}</div>;
  if (showWizard) return <><WelcomeExperience onComplete={() => { window.history.replaceState(null, '', window.location.pathname); loadPersona(); setShowWizard(false); }} /><VoiceControl /></>;

  const navItems = [
    { id: 'command', label: 'Command Hub', icon: Compass },
    { id: 'chat', label: 'Chat & Goal', icon: MessageSquare },
    { id: 'vision', label: 'Vision', icon: Eye },
    { id: 'data', label: 'Data Intelligence', icon: BarChart3 },
    { id: 'education', label: 'Education', icon: GraduationCap },
    { id: 'business', label: 'Business CRM', icon: BriefcaseBusiness },
    { id: 'media', label: 'Media Studio', icon: Clapperboard },
    { id: 'wellness', label: 'Wellness', icon: HeartPulse },
    { id: 'finance', label: 'Personal Finance', icon: Wallet },
    { id: 'paper', label: 'Paper Trading', icon: LineChart },
    { id: 'tasks', label: 'Tasks', icon: CheckSquare, badge: status?.running_tasks },
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
    { id: 'models', label: 'Models', icon: Cpu },
    { id: 'settings', label: 'Settings', icon: Sliders },
  ];
  const paletteActions: PaletteAction[] = [
    { id: 'ask', label: 'Ask TJ', detail: 'Open chat and send a question or goal', keywords: 'conversation', run: () => setActiveTab('chat') },
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
    { id: 'workflows', label: 'Create a workflow', detail: 'Open workflow builder and saved runs', keywords: 'automation', run: () => setActiveTab('workflows') },
    { id: 'automation', label: 'Run an automation', detail: 'Open scheduled automations and workflow controls', keywords: 'schedule cron', run: () => setActiveTab('workflows') },
    { id: 'connectors', label: 'Use a connector', detail: 'Open configured integrations and connection tests', keywords: 'integration app', run: () => setActiveTab('connectors') },
    { id: 'workbench', label: 'Open API Workbench', detail: 'Save and run a bounded public HTTP request', keywords: 'http api request', run: () => setActiveTab('workbench') },
    { id: 'skills', label: 'Run a local skill', detail: 'Install, review, enable and run a declarative skill', keywords: 'plugin template', run: () => setActiveTab('skills') },
    { id: 'learning', label: 'Review improvements', detail: 'Review feedback and proposals based on recorded results', keywords: 'self improvement feedback', run: () => setActiveTab('learning') },
    { id: 'recent', label: 'Open recent results', detail: 'Inspect live activity and completed work', keywords: 'history events', run: () => setActiveTab('activity') },
    { id: 'tasks', label: 'Open tasks', detail: 'Review active and saved tasks', keywords: 'projects', run: () => setActiveTab('tasks') },
    { id: 'approvals', label: 'Open approvals', detail: 'Review pending actions and their risks', keywords: 'permissions', run: () => setActiveTab('approvals') },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: 'var(--bg-primary)' }}>
      <TopBar
        status={status}
        stopping={stopping}
        onStopAll={handleStopAll}
        onNavigate={(tab) => setActiveTab(tab)}
      />

      <div style={{ display: 'flex', flex: 1, height: 'calc(100vh - 48px)', overflow: 'hidden' }}>
        <aside style={{
          width: 60, background: 'rgba(5, 10, 22, 0.95)', borderRight: '1px solid var(--border-subtle)', overflowY: 'auto',
          display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0', gap: 6, zIndex: 10,
        }}>
          <button type="button" onClick={() => setPaletteOpen(true)} title="Search commands (Ctrl+K)" aria-label="Open command palette" style={{ width: 42, height: 42, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'rgba(0, 242, 254, 0.07)', color: 'var(--accent-cyan)', display: 'grid', placeItems: 'center', cursor: 'pointer', marginBottom: 8 }}><Search size={18} /></button>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                title={navLabel(item.id, item.label, uiLanguage(locale))}
                aria-label={navLabel(item.id, item.label, uiLanguage(locale))}
                style={{
                  width: 42, height: 42, borderRadius: 8, border: 'none',
                  background: isActive ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
                  color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', position: 'relative', transition: 'all 0.2s ease',
                  borderBottom: isActive ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                }}
              >
                <Icon size={18} />
                {Boolean(item.badge && item.badge > 0) && (
                  <span style={{
                    position: 'absolute', top: 4, right: 4, width: 7, height: 7,
                    borderRadius: '50%', background: 'var(--accent-rose)', boxShadow: '0 0 6px var(--accent-rose)',
                  }} />
                )}
              </button>
            );
          })}
        </aside>

        {activeTab === 'command' ? (
          <div style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden' }}>
            <IntelligenceFeed status={status} onNavigate={(tab) => setActiveTab(tab)} />
            <CommandCenter
              status={status}
              persona={persona}
              onChooseForm={chooseForm}
              voiceSpeaking={voiceSpeaking}
              voicePulse={voicePulse}
              onNavigate={(tab) => setActiveTab(tab)}
              onSelectAgent={(id) => { setSelectedAgentId(id || null); setActiveTab('agents'); }}
              onSendChat={handleSendChat}
              loading={chatLoading}
            />
            <InteractionPanel
              persona={persona}
              messages={messages}
              loading={chatLoading}
              error={chatError}
              onSend={(txt) => handleSendChat(txt, 'chat')}
            />
          </div>
        ) : (
          <div style={{ flex: 1, height: '100%', overflow: 'hidden', padding: 16 }}>
            <Suspense fallback={<div role="status" style={{ padding: 24, color: 'var(--text-muted)' }}>Loading workspace…</div>}>
            {activeTab === 'chat' && <ChatView personaName={persona.name} />}
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
            {activeTab === 'workflows' && <WorkflowsView />}
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
      <VoiceControl />
      {paletteOpen && <CommandPalette actions={paletteActions} onClose={() => setPaletteOpen(false)} />}
      {eventNotice && <button type="button" onClick={() => { setActiveTab(eventNotice.name === 'approval.requested' ? 'approvals' : 'activity'); setEventNotice(null); }} style={{ position: 'fixed', left: 82, bottom: 20, zIndex: 111, maxWidth: 390, padding: '12px 16px', border: '1px solid var(--accent-cyan)', borderRadius: 10, background: 'var(--bg-secondary)', color: '#fff', textAlign: 'left', cursor: 'pointer' }} role="alert">{eventNotice.summary} · Open {eventNotice.name === 'approval.requested' ? 'Approvals' : 'Activity'}</button>}
    </div>
  );
};
