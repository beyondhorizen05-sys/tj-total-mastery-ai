import React, { useState, useEffect, lazy, Suspense } from 'react';
import {
  Activity, ArrowUpRight, CheckSquare, Clapperboard, Compass, Cpu,
  Headphones, MessageSquare, Power, Radio,
  Send, ShieldAlert, Sliders, Sparkles, UserCheck, Users, Workflow,
  Edit3, X, Maximize2, Minimize2, Minus, Eye, BarChart3, GraduationCap,
  Briefcase, HeartPulse, Wallet, LineChart, Wrench, HardDrive, Network,
  Plus, Trash2, Zap, Brain, Terminal, Sun, Moon, RotateCcw, Palette,
  Move, Layers, Grid, History, ChevronDown, Boxes, Globe2, Mic
} from 'lucide-react';
import type { SystemStatus, TJPersona, TownAgent } from '@tj/schemas';
import { apiFetch } from '../api';
import {
  LivingHQScene,
  type AgentSoul,
  type CustomRoom,
  DEFAULT_DEPARTMENT_POSITIONS,
} from '../components/LivingHQScene';
import { THEMES, loadTheme, setTheme, type ThemeId } from '../themes';
import './living-world.css';

// Lazy-loaded Subsystem Views for Floating Windows
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
const CapabilitiesView = lazy(() => import('./CapabilitiesView').then((m) => ({ default: m.CapabilitiesView })));
const LearningView = lazy(() => import('./LearningView').then((m) => ({ default: m.LearningView })));
const WorkbenchView = lazy(() => import('./WorkbenchView').then((m) => ({ default: m.WorkbenchView })));

const INITIAL_SOULS: AgentSoul[] = [
  {
    id: 'soul-1',
    name: 'LEO',
    role: 'Researcher',
    gender: 'male',
    personality: 'Deep mathematical focus, relentless experimentalist.',
    energy: 94,
    status: 'working',
    currentThought: 'Calibrating anti-gravity drift parameters to 0.02G tolerance.',
    workstationPos: [-18.4, 0.22, -11.12],
    restPos: [-18.7, 0, -9.8],
    assignedRoom: 'ANTIGRAVITY RESEARCH LAB',
    jacketColor: '#253d56',
    hairColor: '#2b231f',
    skinColor: '#d69e80',
  },
  {
    id: 'soul-2',
    name: 'BEN',
    role: 'Health Information Agent',
    gender: 'male',
    personality: 'Methodical precision, robotics specialist.',
    energy: 88,
    status: 'working',
    currentThought: 'Robotic calibration rig servo latency measured at 0.8ms.',
    workstationPos: [-9.5, 0.22, 5.38],
    restPos: [-9.9, 0, 6.6],
    assignedRoom: 'BIOMETRICS & CYBERNETICS LAB',
    jacketColor: '#24374a',
    hairColor: '#1e1c1b',
    skinColor: '#cf997c',
  },
  {
    id: 'soul-3',
    name: 'MIA',
    role: 'Debugger',
    gender: 'female',
    personality: 'Intuitive pattern recognition, high diagnostic ability.',
    energy: 85,
    status: 'working',
    currentThought: 'Tracing runtime state diffs and memory heap bounds.',
    workstationPos: [-7.5, 0.22, 5.38],
    restPos: [-7.1, 0, 6.6],
    assignedRoom: 'BIOMETRICS & CYBERNETICS LAB',
    jacketColor: '#384d63',
    hairColor: '#4a2e1d',
    skinColor: '#d9a285',
  },
  {
    id: 'soul-4',
    name: 'SAM',
    role: 'Finance Analyst',
    gender: 'male',
    personality: 'Vigilant risk evaluator, quantitative trader.',
    energy: 92,
    status: 'working',
    currentThought: 'Analyzing price tick spreads across backtesting windows.',
    workstationPos: [-18.4, 0.22, 5.88],
    restPos: [-18.7, 0, 7.2],
    assignedRoom: 'FINANCE & TRADING FLOOR',
    jacketColor: '#1c2e42',
    hairColor: '#181818',
    skinColor: '#e0af94',
  },
  {
    id: 'soul-5',
    name: 'JACS',
    role: 'Security Reviewer',
    gender: 'male',
    personality: 'Observant, tactical, alert to vulnerability vectors.',
    energy: 96,
    status: 'transit',
    currentThought: 'Patrolling central boulevard; all perimeter credentials valid.',
    workstationPos: [-9.5, 0.22, 14.38],
    restPos: [-9.9, 0, 15.6],
    assignedRoom: 'SECURITY CITADEL & APPROVALS VAULT',
    jacketColor: '#2b3f54',
    hairColor: '#222222',
    skinColor: '#ca9478',
  },
  {
    id: 'soul-6',
    name: 'ELIAS',
    role: 'Optimizer',
    gender: 'male',
    personality: 'Evolutionary tuner, model performance architect.',
    energy: 90,
    status: 'collaborating',
    currentThought: 'Fine-tuning provider token distribution and prompt cache.',
    workstationPos: [16.5, 0.22, -11.12],
    restPos: [16.1, 0, -9.8],
    assignedRoom: 'AI MODELS & NEURAL ENGINE BAY',
    jacketColor: '#22384c',
    hairColor: '#332722',
    skinColor: '#d8a186',
  },
  {
    id: 'soul-7',
    name: 'SARA',
    role: 'Automation Engineer',
    gender: 'female',
    personality: 'Insightful workflow architect, pipeline orchestrator.',
    energy: 91,
    status: 'collaborating',
    currentThought: 'Validating workflow DAG branching with real-time approval gates.',
    workstationPos: [16.5, 0.22, -2.62],
    restPos: [16.1, 0, -1.3],
    assignedRoom: 'WORKFLOWS & AUTOMATION FACTORY',
    jacketColor: '#d8e4ef',
    hairColor: '#1c1b1a',
    skinColor: '#dba98f',
  },
  {
    id: 'soul-8',
    name: 'TARA',
    role: 'Data Analyst',
    gender: 'female',
    personality: 'Database optimization guru, holographic analytics specialist.',
    energy: 87,
    status: 'working',
    currentThought: 'Optimizing holographic data globe cluster indexes.',
    workstationPos: [16.6, 0.22, 5.88],
    restPos: [16.3, 0, 7.2],
    assignedRoom: 'DATA INTELLIGENCE & ANALYTICS BAY',
    jacketColor: '#33485c',
    hairColor: '#4f301d',
    skinColor: '#d1997d',
  },
  {
    id: 'soul-9',
    name: 'KATE',
    role: 'TJ Orchestrator',
    gender: 'female',
    personality: 'Cool under pressure, central command director.',
    energy: 95,
    status: 'working',
    currentThought: 'Tracking world map geopolitical relays and active approval queues.',
    workstationPos: [-1.8, 0.22, -14.62],
    restPos: [-2.2, 0, -13.2],
    assignedRoom: 'MISSION CONTROL BRIDGE',
    jacketColor: '#203244',
    hairColor: '#2a2220',
    skinColor: '#dca48a',
  },
  {
    id: 'soul-10',
    name: 'CHLOE',
    role: 'DevOps Engineer',
    gender: 'female',
    personality: 'Algorithmic perfectionist, cooling circuit engineer.',
    energy: 89,
    status: 'working',
    currentThought: 'Monitoring RGB cryogenic cooling conduits at 3.4 Kelvin.',
    workstationPos: [-9.4, 0.22, -14.62],
    restPos: [-9.7, 0, -13.2],
    assignedRoom: 'QUANTUM COMPUTE HUB',
    jacketColor: '#2c4257',
    hairColor: '#5c3a21',
    skinColor: '#caa085',
  },
  {
    id: 'soul-11',
    name: 'DAN',
    role: 'Developer',
    gender: 'male',
    personality: 'Full-stack software artisan, low-latency engineer.',
    energy: 93,
    status: 'working',
    currentThought: 'Compiling optimized binary routes for high-throughput messaging.',
    workstationPos: [18.5, 0.22, -11.12],
    restPos: [18.9, 0, -9.8],
    assignedRoom: 'AI MODELS & NEURAL ENGINE BAY',
    jacketColor: '#1e3042',
    hairColor: '#1c1c1c',
    skinColor: '#d89e82',
  },
  {
    id: 'soul-12',
    name: 'ALEC',
    role: 'Planner',
    gender: 'male',
    personality: 'Strategic visionary, multi-step dependency decomposition.',
    energy: 91,
    status: 'working',
    currentThought: 'Decomposing autonomous compound objectives into linear stages.',
    workstationPos: [0.0, 0.22, -14.62],
    restPos: [0.0, 0, -13.2],
    assignedRoom: 'MISSION CONTROL BRIDGE',
    jacketColor: '#283e52',
    hairColor: '#36281e',
    skinColor: '#d49b7e',
  },
  {
    id: 'soul-13',
    name: 'NOVA',
    role: 'Computer Operator',
    gender: 'female',
    personality: 'Lightning-fast desktop automation & vision agent.',
    energy: 94,
    status: 'working',
    currentThought: 'Scanning active OS viewport bounds for input dispatch.',
    workstationPos: [1.8, 0.22, -14.62],
    restPos: [2.2, 0, -13.2],
    assignedRoom: 'MISSION CONTROL BRIDGE',
    jacketColor: '#34475c',
    hairColor: '#1a1918',
    skinColor: '#e2ab90',
  },
  {
    id: 'soul-14',
    name: 'ZEPHYR',
    role: 'Designer',
    gender: 'male',
    personality: 'Aesthetic perfectionist, cyberpunk UI/UX visual architect.',
    energy: 90,
    status: 'working',
    currentThought: 'Refining glassmorphic HUD shader highlights and color tokens.',
    workstationPos: [-18.5, 0.22, -2.62],
    restPos: [-18.9, 0, -1.3],
    assignedRoom: 'MEDIA & CREATIVE STUDIO',
    jacketColor: '#3a2e48',
    hairColor: '#443228',
    skinColor: '#cf987a',
  },
  {
    id: 'soul-15',
    name: 'VANCE',
    role: 'Writer',
    gender: 'male',
    personality: 'Eloquent chronicler, crisp documentation specialist.',
    energy: 88,
    status: 'working',
    currentThought: 'Archiving real-time agent execution transcripts into knowledge base.',
    workstationPos: [7.6, 0.22, -14.62],
    restPos: [7.3, 0, -13.2],
    assignedRoom: 'PERSISTENT MEMORY VAULT',
    jacketColor: '#23364a',
    hairColor: '#282320',
    skinColor: '#dc9f82',
  },
  {
    id: 'soul-16',
    name: 'CYRUS',
    role: 'Analyst',
    gender: 'male',
    personality: 'Objective evaluator, trade-off specialist, risk assessor.',
    energy: 92,
    status: 'working',
    currentThought: 'Calculating risk-reward ratios on pending tool approvals.',
    workstationPos: [16.5, 0.22, 14.38],
    restPos: [16.1, 0, 15.6],
    assignedRoom: 'KNOWLEDGE GRAPH LAB',
    jacketColor: '#1d2f40',
    hairColor: '#1f1e1d',
    skinColor: '#cb967b',
  },
  {
    id: 'soul-17',
    name: 'ELENA',
    role: 'QA Engineer',
    gender: 'female',
    personality: 'Zero-tolerance verification, test suite architect.',
    energy: 93,
    status: 'working',
    currentThought: 'Executing synthetic integration tests against API gateways.',
    workstationPos: [18.5, 0.22, -2.62],
    restPos: [18.9, 0, -1.3],
    assignedRoom: 'WORKFLOWS & AUTOMATION FACTORY',
    jacketColor: '#2a4258',
    hairColor: '#4f3422',
    skinColor: '#dba68c',
  },
  {
    id: 'soul-18',
    name: 'KAI',
    role: 'Executive Agent',
    gender: 'male',
    personality: 'Enterprise governor, resource allocator, strategic director.',
    energy: 96,
    status: 'working',
    currentThought: 'Allocating global compute budgets across multi-agent pipelines.',
    workstationPos: [7.5, 0.22, 5.38],
    restPos: [7.1, 0, 6.6],
    assignedRoom: 'BUSINESS CRM & WAR ROOM',
    jacketColor: '#223446',
    hairColor: '#242120',
    skinColor: '#d39a7e',
  },
  {
    id: 'soul-19',
    name: 'REX',
    role: 'Business Strategist',
    gender: 'male',
    personality: 'Growth strategist, market expansion architect.',
    energy: 89,
    status: 'working',
    currentThought: 'Synthesizing client deal conversion probabilities in pipeline.',
    workstationPos: [9.5, 0.22, 5.38],
    restPos: [9.9, 0, 6.6],
    assignedRoom: 'BUSINESS CRM & WAR ROOM',
    jacketColor: '#1b2d3f',
    hairColor: '#1c1c1b',
    skinColor: '#cea085',
  },
  {
    id: 'soul-20',
    name: 'IRIS',
    role: 'Marketing Agent',
    gender: 'female',
    personality: 'Creative communicator, branding and outreach strategist.',
    energy: 91,
    status: 'working',
    currentThought: 'Composing interactive media campaigns for external releases.',
    workstationPos: [-16.5, 0.22, -2.62],
    restPos: [-16.1, 0, -1.3],
    assignedRoom: 'MEDIA & CREATIVE STUDIO',
    jacketColor: '#432d4a',
    hairColor: '#5a3824',
    skinColor: '#dca48a',
  },
  {
    id: 'soul-21',
    name: 'FELIX',
    role: 'Customer Support Agent',
    gender: 'male',
    personality: 'Empathetic communicator, rapid incident responder.',
    energy: 94,
    status: 'working',
    currentThought: 'Streaming telemetry responses through The Living Pulse bridge.',
    workstationPos: [-0.9, 0.22, 14.38],
    restPos: [-1.2, 0, 15.6],
    assignedRoom: 'CONNECTORS & API WORKBENCH',
    jacketColor: '#273c50',
    hairColor: '#262220',
    skinColor: '#d69d80',
  },
  {
    id: 'soul-22',
    name: 'TESSA',
    role: 'Legal Research Agent',
    gender: 'female',
    personality: 'Regulatory scholar, compliance and ethics supervisor.',
    energy: 88,
    status: 'working',
    currentThought: 'Auditing data isolation boundaries against privacy directives.',
    workstationPos: [-18.4, 0.22, 14.38],
    restPos: [-18.7, 0, 15.6],
    assignedRoom: 'EDUCATION & SKILL ACADEMY',
    jacketColor: '#2e3a4e',
    hairColor: '#3a291f',
    skinColor: '#d8a287',
  },
  {
    id: 'soul-23',
    name: 'NIKOLAI',
    role: 'Critic',
    gender: 'male',
    personality: 'Adversarial thinker, edge-case validator, devil advocate.',
    energy: 90,
    status: 'working',
    currentThought: 'Stress-testing neural cluster consensus against edge-case failures.',
    workstationPos: [18.5, 0.22, 14.38],
    restPos: [18.9, 0, 15.6],
    assignedRoom: 'KNOWLEDGE GRAPH LAB',
    jacketColor: '#1c2838',
    hairColor: '#1e1c1b',
    skinColor: '#ca9579',
  },
  {
    id: 'soul-24',
    name: 'AURA',
    role: 'Verifier',
    gender: 'female',
    personality: 'Cryptographic certifier, zero-knowledge integrity auditor.',
    energy: 95,
    status: 'working',
    currentThought: 'Cryptographically validating task execution evidence hashes.',
    workstationPos: [-7.5, 0.22, 14.38],
    restPos: [-7.1, 0, 15.6],
    assignedRoom: 'SECURITY CITADEL & APPROVALS VAULT',
    jacketColor: '#263d54',
    hairColor: '#2c221e',
    skinColor: '#ddab92',
  },
];

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
  onOpenLiveVoice?: () => void;
}

export const CommandCenter: React.FC<Props> = ({
  status,
  persona,
  onNavigate,
  onOpenPulse,
  onSendChat,
  loading,
  stopping = false,
  onStopAll,
  onOpenLiveVoice,
}) => {
  const [input, setInput] = useState('');
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<[number, number, number] | null>(null);

  // Floating Window Management
  const [activeFloatingWindow, setActiveFloatingWindow] = useState<string | null>(null);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  // Day / Night Cycle Management
  const [dayNightMode, setDayNightMode] = useState<'day' | 'night' | 'auto'>('night');
  const [timeOfDay, setTimeOfDay] = useState<number>(23);

  const cycleDayNight = () => {
    setDayNightMode((prev) => {
      if (prev === 'night') return 'day';
      if (prev === 'day') return 'auto';
      return 'night';
    });
  };

  // Department 3D Room Coordinates for Smooth Camera Focus (All Ground Floor y = 1.2)
  const ROOM_COORDINATES: Record<string, [number, number, number]> = {
    vision: [-17.5, 1.2, -11.0],
    wellness: [-8.5, 1.2, 5.5],
    approvals: [-8.5, 1.2, 14.5],
    business: [8.5, 1.2, 5.5],
    graph: [17.5, 1.2, 14.5],
    memory: [8.5, 1.2, -14.5],
    tasks: [0.0, 1.2, -14.5],
    models: [17.5, 1.2, -11.0],
    workflows: [17.5, 1.2, -2.5],
    data: [17.5, 1.2, 6.0],
    finance: [-17.5, 1.2, 6.0],
    paper: [-17.5, 1.2, 6.0],
    media: [-17.5, 1.2, -2.5],
    connectors: [0.0, 1.2, 14.5],
    workbench: [0.0, 1.2, 14.5],
    skills: [-17.5, 1.2, 14.5],
    education: [-17.5, 1.2, 14.5],
    agents: [-8.5, 1.2, -14.5],
    chat: [0.0, 2.5, 0.0],
    command: [0.0, 1.8, 0.0],
  };

  const DEPARTMENT_ROOM_NAMES: Record<string, string> = {
    RES: 'RESEARCH & ANTIGRAVITY LAB',
    BIO: 'BIOMETRICS & CYBERNETICS LAB',
    SEC: 'SECURITY CITADEL & DEFENSE',
    MEM: 'PERSISTENT MEMORY VAULT',
    GRAPH: 'KNOWLEDGE GRAPH LAB',
    CRM: 'BUSINESS CRM WAR ROOM',
    CMD: 'MISSION CONTROL BRIDGE',
    MEDIA: 'MEDIA & SYNTHESIS STUDIO',
    FIN: 'TRADING & FINANCE FLOOR',
    SKILL: 'SKILL ACADEMY & DISCOVERY',
    MODELS: 'AI MODELS & NEURAL BAY',
    FLOW: 'WORKFLOWS & AUTOMATION FACTORY',
    DATA: 'DATA INTELLIGENCE BAY',
    QUANTUM: 'QUANTUM COMPUTE HUB',
    API: 'CONNECTORS & TOOLS WORKBENCH',
  };

  const DEPARTMENT_WINDOW_MAP: Record<string, string> = {
    RES: 'vision',
    BIO: 'wellness',
    SEC: 'approvals',
    MEM: 'memory',
    GRAPH: 'graph',
    CRM: 'business',
    CMD: 'tasks',
    MEDIA: 'media',
    FIN: 'finance',
    SKILL: 'skills',
    MODELS: 'models',
    FLOW: 'workflows',
    DATA: 'data',
    QUANTUM: 'agents',
    API: 'connectors',
  };

  // Architect Mode & Department Positions State
  const [departmentPositions, setDepartmentPositions] = useState<Record<string, [number, number, number]>>(() => {
    try {
      const saved = localStorage.getItem('tj_department_positions');
      return saved ? JSON.parse(saved) : DEFAULT_DEPARTMENT_POSITIONS;
    } catch {
      return DEFAULT_DEPARTMENT_POSITIONS;
    }
  });
  const [isArchitectMode, setIsArchitectMode] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

  // 360 Degree View & Continuous Orbit
  const [isAutoOrbit, setIsAutoOrbit] = useState(false);

  // Dynamic Theme Selection State
  const [activeTheme, setActiveTheme] = useState<ThemeId>(loadTheme);
  const [showThemePicker, setShowThemePicker] = useState(false);

  // AI Command Chat Popup State (Full Conversation Engine)
  const [showChatPopup, setShowChatPopup] = useState(false);
  const [telemetryTab, setTelemetryTab] = useState<'agents' | 'components' | 'compute'>('agents');

  const handleOpenRoom = (roomId: string) => {
    if (roomId === 'chat') {
      setShowChatPopup(true);
      return;
    }
    if (ROOM_COORDINATES[roomId]) {
      setFocusTarget(ROOM_COORDINATES[roomId]);
    }
    if (roomId !== 'command') {
      openFloating(roomId);
    }
  };

  // Overlay Panels Visibility (Allow closing/minimizing everything)
  const [showBottomRight, setShowBottomRight] = useState(true);
  const [showBottomPulse, setShowBottomPulse] = useState(true);

  // Live Agent Souls (Realistic human behavior & state machine)
  const [agentSouls, setAgentSouls] = useState<AgentSoul[]>(() => {
    try {
      const saved = localStorage.getItem('tj_agent_souls_v3');
      return saved ? JSON.parse(saved) : INITIAL_SOULS;
    } catch {
      return INITIAL_SOULS;
    }
  });

  // Selected Agent Soul Dossier
  const [inspectingSoul, setInspectingSoul] = useState<AgentSoul | null>(null);
  const [assignedDirective, setAssignedDirective] = useState('');

  // Custom User Rooms Management (Room Expansion System)
  const [customRooms, setCustomRooms] = useState<CustomRoom[]>(() => {
    try {
      const saved = localStorage.getItem('tj_custom_rooms');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Form state for creating a new room
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomTheme, setNewRoomTheme] = useState<CustomRoom['theme']>('quantum');
  const [newRoomBay, setNewRoomBay] = useState<CustomRoom['bay']>('ground_right');
  const [newRoomColor, setNewRoomColor] = useState('#00f2fe');
  const [newRoomWorkstationsCount, setNewRoomWorkstationsCount] = useState<number>(2);
  const [newRoomAssignedAgentIds, setNewRoomAssignedAgentIds] = useState<string[]>([]);

  // Category switch toggles
  const [activeCategoryDrawer, setActiveCategoryDrawer] = useState<string | null>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.tj-cmd-tab-dropdown-wrap') && !target?.closest('.tj-cmd-cat-drawer')) {
        setActiveCategoryDrawer(null);
      }
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  // --------------------------------------------------------------------------
  // LIVE BACKEND INTEGRATION & REAL-TIME EVENT STREAM
  // --------------------------------------------------------------------------
  useEffect(() => {
    // Fetch live backend agents and map them to souls
    const fetchLiveAgents = async () => {
      try {
        const res = await apiFetch<{ agents: TownAgent[] }>('/api/v1/town/state');
        if (res.agents && res.agents.length > 0) {
          setAgentSouls((prevSouls) =>
            prevSouls.map((soul, idx) => {
              const liveAgent = res.agents[idx % res.agents.length];
              if (liveAgent) {
                const isWorking = liveAgent.status === 'working' || liveAgent.status === 'thinking';
                return {
                  ...soul,
                  name: liveAgent.name || soul.name,
                  status: isWorking ? 'working' : soul.status === 'working' ? 'resting' : soul.status,
                  taskId: liveAgent.task_id,
                  currentThought: isWorking
                    ? `Executing live task ${liveAgent.task_id?.slice(0, 8)}: processing neural weights.`
                    : soul.currentThought,
                  energy: isWorking ? Math.max(30, soul.energy - 0.5) : Math.min(100, soul.energy + 0.2),
                };
              }
              return soul;
            })
          );
        }
      } catch (e) {
        // Fallback to internal simulation loop
      }
    };

    void fetchLiveAgents();
    const interval = setInterval(fetchLiveAgents, 10000);

    // Live EventSource for real-time reactivity
    const stream = new EventSource('/api/v1/system/events');
    stream.addEventListener('task.started', (event: any) => {
      const data = JSON.parse(event.data || '{}');
      setAgentSouls((prev) =>
        prev.map((soul, i) =>
          i === 0 || soul.id === data.agent_id
            ? {
                ...soul,
                status: 'working',
                taskId: data.task_id,
                currentThought: `Received live task: ${data.name || 'Running model synthesis'}. Moving to workstation.`,
                energy: Math.max(20, soul.energy - 5),
              }
            : soul
        )
      );
    });

    stream.addEventListener('task.completed', (event: any) => {
      const data = JSON.parse(event.data || '{}');
      setAgentSouls((prev) =>
        prev.map((soul) =>
          soul.taskId === data.task_id
            ? {
                ...soul,
                status: 'resting',
                taskId: null,
                currentThought: 'Task completed successfully! Taking a rest on the catwalk.',
                energy: Math.min(100, soul.energy + 15),
              }
            : soul
        )
      );
    });

    return () => {
      clearInterval(interval);
      stream.close();
    };
  }, []);

  // Keyboard shortcut: Escape closes floating window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (inspectingSoul) setInspectingSoul(null);
        else if (activeFloatingWindow) setActiveFloatingWindow(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeFloatingWindow, inspectingSoul]);

  const toggleCategoryDrawer = (key: string) => {
    setActiveCategoryDrawer((prev) => (prev === key ? null : key));
  };

  const openFloating = (windowId: string) => {
    setActiveCategoryDrawer(null);
    setInspectingSoul(null);
    setActiveFloatingWindow(windowId);
  };

  const closeFloating = () => {
    setActiveFloatingWindow(null);
    setInspectingSoul(null);
    setIsWindowMaximized(false);
  };

  // Add Custom Room Handler
  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;

    const bayPositions: Record<CustomRoom['bay'], [number, number, number]> = {
      ground_right: [24.0, 0, 4.0],
      mezzanine_right: [24.0, 0, 12.0],
      observation_high: [24.0, 0, -12.0],
      extended_left: [-24.0, 0, 0],
    };

    const newRoom: CustomRoom = {
      id: `custom-room-${Date.now()}`,
      name: newRoomName.trim().toUpperCase(),
      theme: newRoomTheme,
      bay: newRoomBay,
      position: bayPositions[newRoomBay] || [0, 0, 0],
      accentColor: newRoomColor,
      workstationsCount: newRoomWorkstationsCount,
      assignedAgentIds: newRoomAssignedAgentIds,
    };

    const updated = [...customRooms, newRoom];
    setCustomRooms(updated);
    try {
      localStorage.setItem('tj_custom_rooms', JSON.stringify(updated));
    } catch (err) {
      console.error(err);
    }

    if (newRoomAssignedAgentIds.length > 0) {
      setAgentSouls((prev) =>
        prev.map((soul) => {
          if (newRoomAssignedAgentIds.includes(soul.id)) {
            const slotIndex = newRoomAssignedAgentIds.indexOf(soul.id);
            const offsetX = slotIndex === 0 ? -1.0 : slotIndex === 1 ? 1.0 : slotIndex === 2 ? -1.0 : 1.0;
            const offsetZ = slotIndex < 2 ? 0.3 : -0.6;
            return {
              ...soul,
              assignedRoom: newRoom.name,
              workstationPos: [newRoom.position[0] + offsetX, 0.22, newRoom.position[2] + offsetZ],
              restPos: [newRoom.position[0] + offsetX, 0, newRoom.position[2] + offsetZ + 1.2],
            };
          }
          return soul;
        })
      );
    }

    setNewRoomName('');
    setNewRoomAssignedAgentIds([]);
    closeFloating();
  };

  const handleNudgeRoom = (dx: number, dz: number) => {
    if (!selectedRoomId) return;

    const isCustom = customRooms.some((r) => r.id === selectedRoomId);
    if (isCustom) {
      setCustomRooms((prev) => {
        const next = prev.map((r) =>
          r.id === selectedRoomId
            ? { ...r, position: [r.position[0] + dx, r.position[1], r.position[2] + dz] as [number, number, number] }
            : r
        );
        try { localStorage.setItem('tj_custom_rooms', JSON.stringify(next)); } catch {}
        return next;
      });
    } else {
      const current = departmentPositions[selectedRoomId] || DEFAULT_DEPARTMENT_POSITIONS[selectedRoomId] || [0, 0, 0];
      const newPos: [number, number, number] = [
        Math.round((current[0] + dx) * 10) / 10,
        0,
        Math.round((current[2] + dz) * 10) / 10,
      ];
      setDepartmentPositions((prev) => {
        const next = { ...prev, [selectedRoomId]: newPos };
        try { localStorage.setItem('tj_department_positions', JSON.stringify(next)); } catch {}
        return next;
      });
    }

    // Shift assigned agents' workstationPos and restPos by the same delta!
    setAgentSouls((prevSouls) =>
      prevSouls.map((soul) => {
        const roomName = DEPARTMENT_ROOM_NAMES[selectedRoomId];
        if (soul.assignedRoom === roomName || soul.assignedRoom?.includes(selectedRoomId)) {
          return {
            ...soul,
            workstationPos: [soul.workstationPos[0] + dx, soul.workstationPos[1], soul.workstationPos[2] + dz],
            restPos: [soul.restPos[0] + dx, soul.restPos[1], soul.restPos[2] + dz],
          };
        }
        return soul;
      })
    );
  };

  const handleSnapToGrid = () => {
    if (!selectedRoomId) return;
    const isCustom = customRooms.some((r) => r.id === selectedRoomId);
    if (isCustom) {
      setCustomRooms((prev) => {
        const next = prev.map((r) =>
          r.id === selectedRoomId
            ? {
                ...r,
                position: [
                  Math.round(r.position[0] / 2) * 2,
                  r.position[1],
                  Math.round(r.position[2] / 2) * 2,
                ] as [number, number, number],
              }
            : r
        );
        try { localStorage.setItem('tj_custom_rooms', JSON.stringify(next)); } catch {}
        return next;
      });
    } else {
      const current = departmentPositions[selectedRoomId] || DEFAULT_DEPARTMENT_POSITIONS[selectedRoomId] || [0, 0, 0];
      const newPos: [number, number, number] = [
        Math.round(current[0] / 2) * 2,
        0,
        Math.round(current[2] / 2) * 2,
      ];
      setDepartmentPositions((prev) => {
        const next = { ...prev, [selectedRoomId]: newPos };
        try { localStorage.setItem('tj_department_positions', JSON.stringify(next)); } catch {}
        return next;
      });
    }
  };

  const handleResetDepartmentPositions = () => {
    setDepartmentPositions(DEFAULT_DEPARTMENT_POSITIONS);
    try {
      localStorage.setItem('tj_department_positions', JSON.stringify(DEFAULT_DEPARTMENT_POSITIONS));
    } catch {}
  };

  const handleSelectTheme = (themeId: ThemeId) => {
    setTheme(themeId);
    setActiveTheme(themeId);
    setShowThemePicker(false);
  };


  const handleDeleteRoom = (roomId: string) => {
    const updated = customRooms.filter((r) => r.id !== roomId);
    setCustomRooms(updated);
    try {
      localStorage.setItem('tj_custom_rooms', JSON.stringify(updated));
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelect3DAgent = (slotId: string) => {
    setSelectedSlotId(slotId);
    const soul = agentSouls.find((s) => s.id === slotId);
    if (soul) {
      setFocusTarget(soul.status === 'working' ? soul.workstationPos : soul.restPos);
    }
  };

  const handleInspectSoul = (soul: AgentSoul) => {
    setInspectingSoul(soul);
    setSelectedSlotId(soul.id);
    setFocusTarget(soul.status === 'working' ? soul.workstationPos : soul.restPos);
  };

  const handleAssignDirectiveToSoul = (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignedDirective.trim() || !inspectingSoul) return;

    const taskText = assignedDirective.trim();
    setAssignedDirective('');

    // Update agent soul to working state
    setAgentSouls((prev) =>
      prev.map((s) =>
        s.id === inspectingSoul.id
          ? {
              ...s,
              status: 'working',
              currentThought: `Direct user instruction received: "${taskText}". Transitioning to workstation.`,
              energy: Math.max(10, s.energy - 8),
            }
          : s
      )
    );

    // Dispatch chat/task
    void onSendChat(`[@${inspectingSoul.name}] ${taskText}`, 'auto');
    setInspectingSoul(null);
  };

  const handleResetCamera = () => {
    setSelectedSlotId(null);
    setFocusTarget(null);
    closeFloating();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput('');

    const activeSoul = agentSouls.find((s) => s.id === selectedSlotId);
    const messageContent = activeSoul
      ? `[@${activeSoul.name}] ${text}`
      : text;
    void onSendChat(messageContent, 'auto');
  };

  const isStopped = status?.stop_all_engaged;
  const runningTasks = status?.running_tasks ?? 0;
  const pendingApprovals = status?.pending_approvals ?? 0;

  // PRIMARY TOP NAVIGATION TABS (WITHOUT DUMMY "MAIN INTERFACE" & CONVERSATIONS WINDOW REMOVED)
  const topTabs = [
    { id: 'command', label: 'LIVING WORLD', icon: Compass, isActive: !activeFloatingWindow && !inspectingSoul },
    { id: 'tasks', label: 'MISSION CONTROL', icon: CheckSquare, badge: runningTasks, isWindow: true },
    { id: 'agents', label: 'AGENTS', icon: Users, isWindow: true },
    { id: 'workflows', label: 'WORKFLOWS', icon: Workflow, isWindow: true },
    { id: 'media', label: 'FILES & MEDIA', icon: Clapperboard, isWindow: true },
    { id: 'activity', label: 'ACTIVITY', icon: Radio, isWindow: true },
    { id: 'approvals', label: 'APPROVALS', icon: ShieldAlert, badge: pendingApprovals, isWindow: true },
  ];

  // Helper to render component inside floating window
  const renderFloatingContent = (windowId: string) => {
    switch (windowId) {
      case 'tasks': return <TasksView />;
      case 'agents': return <AgentsView selectedAgentId={selectedSlotId} />;
      case 'chat': return <ChatView personaName={persona.name} onNavigate={openFloating} />;
      case 'workflows': return <WorkflowsView initialMode="studio" />;
      case 'media': return <MediaView />;
      case 'activity': return <ActivityView />;
      case 'approvals': return <ApprovalsView />;
      case 'settings': return <SettingsView />;
      case 'skills': return <SkillsView />;
      case 'connectors': return <ConnectorsView />;
      case 'models': return <ModelsView />;
      case 'memory': return <MemoryView />;
      case 'graph': return <GraphView />;
      case 'vision': return <VisionView />;
      case 'data': return <DataIntelligenceView />;
      case 'education': return <EducationView />;
      case 'business': return <BusinessView />;
      case 'wellness': return <WellnessView />;
      case 'finance': return <FinanceView />;
      case 'paper': return <PaperTradingView />;
      case 'focus': return <FocusWorkspace personaName={persona.name} />;
      case 'capabilities': return <CapabilitiesView />;
      case 'learning': return <LearningView />;
      case 'workbench': return <WorkbenchView />;
      case 'add_room':
        return (
          <div style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Plus size={18} color="#00f2fe" />
              <h3 style={{ margin: 0, fontSize: 16, color: '#ffffff', fontFamily: 'JetBrains Mono' }}>
                EXPAND BUILDING · ADD NEW CYBER ROOM
              </h3>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 11, color: '#8da6bd' }}>
              Design and construct a new interactive room inside your 3D Command Headquarters.
            </p>

            <form onSubmit={handleCreateRoom} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 10, color: '#00f2fe', fontFamily: 'JetBrains Mono', marginBottom: 4 }}>
                  ROOM NAME / TITLE
                </label>
                <input
                  className="tj-room-builder-input"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder="e.g. WAR ROOM, NEURAL SYNAPSE LAB, CODE FOUNDRY"
                  required
                />
              </div>

              <div className="tj-room-builder-grid">
                <div>
                  <label style={{ display: 'block', fontSize: 10, color: '#8da6bd', fontFamily: 'JetBrains Mono', marginBottom: 4 }}>
                    EQUIPMENT & THEME
                  </label>
                  <select
                    className="tj-room-builder-select"
                    value={newRoomTheme}
                    onChange={(e) => setNewRoomTheme(e.target.value as any)}
                  >
                    <option value="quantum">Quantum Mainframe & Servers</option>
                    <option value="cybernetics">Cybernetics & Robotics Rig</option>
                    <option value="research">Research Lab & Zero-G Pod</option>
                    <option value="command">Command & Tactical Console</option>
                    <option value="data">Data Bay & Hologram Terminal</option>
                    <option value="lounge">Executive Cyber Lounge & Rest</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 10, color: '#8da6bd', fontFamily: 'JetBrains Mono', marginBottom: 4 }}>
                    BUILDING TIER & LOCATION
                  </label>
                  <select
                    className="tj-room-builder-select"
                    value={newRoomBay}
                    onChange={(e) => setNewRoomBay(e.target.value as any)}
                  >
                    <option value="ground_right">Ground Floor · East Wing</option>
                    <option value="mezzanine_right">Mezzanine 2nd Tier · East Deck</option>
                    <option value="observation_high">Central High Observation Tier</option>
                    <option value="extended_left">Ground Floor · West Expansion</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 10, color: '#8da6bd', fontFamily: 'JetBrains Mono', marginBottom: 4 }}>
                    ACCENT NEON COLOR
                  </label>
                  <select
                    className="tj-room-builder-select"
                    value={newRoomColor}
                    onChange={(e) => setNewRoomColor(e.target.value)}
                  >
                    <option value="#00f2fe">Cyan Glow (#00f2fe)</option>
                    <option value="#4cd997">Emerald Glow (#4cd997)</option>
                    <option value="#f5a623">Amber Alert (#f5a623)</option>
                    <option value="#a855f7">Quantum Violet (#a855f7)</option>
                    <option value="#ff476f">Crimson Core (#ff476f)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 10, color: '#8da6bd', fontFamily: 'JetBrains Mono', marginBottom: 4 }}>
                    WORKSTATIONS COUNT (DESKS & CHAIRS)
                  </label>
                  <select
                    className="tj-room-builder-select"
                    value={newRoomWorkstationsCount}
                    onChange={(e) => setNewRoomWorkstationsCount(Number(e.target.value))}
                  >
                    <option value={1}>1 Workstation (Solo Executive Desk)</option>
                    <option value={2}>2 Workstations (Dual Collaborative Desks)</option>
                    <option value={3}>3 Workstations (Triple Pod Bay)</option>
                    <option value={4}>4 Workstations (Quad Engineering Lab)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 10, color: '#8da6bd', fontFamily: 'JetBrains Mono', marginBottom: 4 }}>
                    ASSIGN AGENTS TO THIS ROOM (MAX {newRoomWorkstationsCount})
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 90, overflowY: 'auto', padding: 6, background: 'rgba(5, 12, 20, 0.8)', border: '1px solid rgba(141, 166, 189, 0.2)', borderRadius: 6 }}>
                    {agentSouls.map((soul) => {
                      const isAssigned = newRoomAssignedAgentIds.includes(soul.id);
                      return (
                        <button
                          key={soul.id}
                          type="button"
                          onClick={() => {
                            if (isAssigned) {
                              setNewRoomAssignedAgentIds(newRoomAssignedAgentIds.filter((id) => id !== soul.id));
                            } else {
                              if (newRoomAssignedAgentIds.length < newRoomWorkstationsCount) {
                                setNewRoomAssignedAgentIds([...newRoomAssignedAgentIds, soul.id]);
                              }
                            }
                          }}
                          style={{
                            padding: '3px 8px',
                            borderRadius: 4,
                            background: isAssigned ? 'rgba(0, 242, 254, 0.2)' : 'rgba(15, 23, 42, 0.6)',
                            border: `1px solid ${isAssigned ? '#00f2fe' : 'rgba(148, 163, 184, 0.2)'}`,
                            color: isAssigned ? '#00f2fe' : '#94a3b8',
                            fontSize: 10,
                            fontFamily: 'JetBrains Mono',
                            cursor: 'pointer',
                          }}
                        >
                          {soul.name} ({soul.role.slice(0, 10)})
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
                <button
                  type="button"
                  onClick={closeFloating}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(141, 166, 189, 0.25)',
                    borderRadius: 6,
                    color: '#8da6bd',
                    fontSize: 11,
                    padding: '8px 16px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
                    border: 0,
                    borderRadius: 6,
                    color: '#050b14',
                    fontFamily: 'JetBrains Mono',
                    fontWeight: 900,
                    fontSize: 11,
                    padding: '8px 22px',
                    cursor: 'pointer',
                    boxShadow: '0 0 16px rgba(0, 242, 254, 0.4)',
                  }}
                >
                  Construct Room in 3D
                </button>
              </div>
            </form>

            {customRooms.length > 0 && (
              <div style={{ marginTop: 24, borderTop: '1px solid rgba(0, 242, 254, 0.15)', paddingTop: 14 }}>
                <b style={{ fontSize: 11, color: '#00f2fe', fontFamily: 'JetBrains Mono' }}>
                  ACTIVE CUSTOM EXPANSIONS ({customRooms.length})
                </b>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {customRooms.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: 'rgba(8, 18, 30, 0.7)',
                        border: '1px solid rgba(141, 166, 189, 0.15)',
                        borderRadius: 6,
                      }}
                    >
                      <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: '#ffffff' }}>
                        {r.name} · <small style={{ color: r.accentColor }}>{r.theme}</small>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteRoom(r.id)}
                        style={{ background: 'transparent', border: 0, color: '#ff476f', cursor: 'pointer' }}
                        title="Delete Room"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
      case 'capabilities': return { title: 'CAPABILITIES & PERMISSIONS VAULT', icon: Boxes };
      case 'learning': return { title: 'SELF-IMPROVEMENT & LEARNING REVIEW', icon: Sparkles };
      case 'workbench': return { title: 'API WORKBENCH & TESTING SANDBOX', icon: Globe2 };
      case 'add_room': return { title: 'BUILDING ARCHITECT · ADD ROOM', icon: Plus };
      default: return { title: 'SUBSYSTEM WINDOW', icon: Compass };
    }
  };

  const selectedSoul = agentSouls.find((s) => s.id === selectedSlotId);

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
              className={`tj-cmd-mode-btn ${!activeFloatingWindow && !inspectingSoul ? 'is-active' : ''}`}
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
          </nav>

          {/* Right Header Actions */}
          <div className="tj-cmd-header-actions">
            {/* Live Voice Conversation Button */}
            {onOpenLiveVoice && (
              <button
                type="button"
                className="tj-cmd-live-voice-btn"
                onClick={onOpenLiveVoice}
                title="Start Real-time Live Voice Conversation (ChatGPT / Gemini style)"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  borderRadius: 20,
                  background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.28), rgba(56, 189, 248, 0.14))',
                  border: '1px solid rgba(56, 189, 248, 0.55)',
                  color: '#7dd3fc',
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  boxShadow: '0 0 15px rgba(56, 189, 248, 0.25)',
                  transition: 'all 0.2s ease',
                }}
              >
                <Mic size={13} color="#38bdf8" />
                <span>LIVE VOICE</span>
              </button>
            )}

            {/* Architect Mode Toggle Button */}
            <button
              type="button"
              className={`tj-cmd-cat-btn ${isArchitectMode ? 'is-active' : ''}`}
              onClick={() => setIsArchitectMode(!isArchitectMode)}
              title="Architect Studio: Select & Reposition Buildings"
              style={{
                color: isArchitectMode ? '#050b14' : 'var(--tj-theme-primary)',
                background: isArchitectMode ? 'var(--tj-theme-primary)' : 'rgba(14, 27, 44, 0.82)',
                fontWeight: 800,
              }}
            >
              <Move size={12} />
              <span>ARCHITECT</span>
            </button>

            {/* 360 Degree Continuous Orbit Tour Toggle */}
            <button
              type="button"
              className={`tj-cmd-cat-btn ${isAutoOrbit ? 'is-active' : ''}`}
              onClick={() => setIsAutoOrbit(!isAutoOrbit)}
              title="360 Degree Continuous Orbit Tour"
              style={{
                color: isAutoOrbit ? '#00f2fe' : '#94a3b8',
                borderColor: isAutoOrbit ? '#00f2fe' : undefined,
              }}
            >
              <RotateCcw size={12} />
              <span>360° ORBIT</span>
            </button>

            {/* Day / Night Mode Cycle Button */}
            <button
              type="button"
              className={`tj-cmd-daynight-btn is-${dayNightMode}`}
              onClick={cycleDayNight}
              title={`Day/Night Mode: ${dayNightMode.toUpperCase()} (Click to toggle Day, Night, Auto)`}
              aria-label="Toggle Day and Night mode"
            >
              {dayNightMode === 'day' ? (
                <>
                  <Sun size={13} color="#f59e0b" />
                  <span>DAY 12:00</span>
                </>
              ) : dayNightMode === 'night' ? (
                <>
                  <Moon size={13} color="#60a5fa" />
                  <span>NIGHT 00:00</span>
                </>
              ) : (
                <>
                  <Sparkles size={13} color="#c084fc" />
                  <span>CYCLE ({Math.floor(timeOfDay).toString().padStart(2, '0')}:00)</span>
                </>
              )}
            </button>

            <button
              type="button"
              className="tj-cmd-icon-btn"
              onClick={() => openFloating('add_room')}
              title="Add Custom Room"
              aria-label="Add Custom Room"
            >
              <Plus size={15} />
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

        {/* Row 2: Clean Tabs Row (Dummy MAIN INTERFACE removed!) */}
        <div className="tj-cmd-tabs-row" role="tablist">
          {topTabs.map((tab) => {
            const Icon = tab.icon;
            const isTabActive = tab.isWindow
              ? activeFloatingWindow === tab.id
              : (!activeFloatingWindow && !inspectingSoul && tab.isActive);

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

          {/* RIGHT AFTER APPROVALS: AI SYSTEMS, STUDIOS, FINANCE, SYSTEM */}
          <div className="tj-cmd-tab-dropdown-wrap" style={{ position: 'relative' }}>
            <button
              type="button"
              className={`tj-cmd-tab ${activeCategoryDrawer === 'aiSystems' ? 'is-active' : ''}`}
              onClick={() => setActiveCategoryDrawer(activeCategoryDrawer === 'aiSystems' ? null : 'aiSystems')}
              title="AI Systems & Neural Mesh"
            >
              <Cpu size={13} />
              <span>AI SYSTEMS</span>
              <ChevronDown size={11} style={{ opacity: 0.7 }} />
            </button>
            {activeCategoryDrawer === 'aiSystems' && (
              <div className="tj-cmd-cat-drawer">
                <div className="tj-cmd-cat-drawer-header">AI SYSTEMS & NEURAL MESH</div>
                <button type="button" onClick={() => { openFloating('models'); setActiveCategoryDrawer(null); }}>
                  <Cpu size={12} color="var(--tj-theme-primary)" />
                  <span>AI Models & Providers</span>
                </button>
                <button type="button" onClick={() => { openFloating('connectors'); setActiveCategoryDrawer(null); }}>
                  <Activity size={12} color="#4cd997" />
                  <span>Connectors & Tools</span>
                </button>
                <button type="button" onClick={() => { openFloating('skills'); setActiveCategoryDrawer(null); }}>
                  <Wrench size={12} color="#00f2fe" />
                  <span>Skills Engine</span>
                </button>
                <button type="button" onClick={() => { openFloating('capabilities'); setActiveCategoryDrawer(null); }}>
                  <Boxes size={12} color="#f59e0b" />
                  <span>Capabilities Vault</span>
                </button>
                <button type="button" onClick={() => { openFloating('memory'); setActiveCategoryDrawer(null); }}>
                  <HardDrive size={12} color="#38bdf8" />
                  <span>Memory Core</span>
                </button>
                <button type="button" onClick={() => { openFloating('graph'); setActiveCategoryDrawer(null); }}>
                  <Network size={12} color="#a855f7" />
                  <span>Knowledge Graph</span>
                </button>
                <button type="button" onClick={() => { openFloating('workbench'); setActiveCategoryDrawer(null); }}>
                  <Globe2 size={12} color="#ec4899" />
                  <span>API Workbench</span>
                </button>
              </div>
            )}
          </div>

          <div className="tj-cmd-tab-dropdown-wrap" style={{ position: 'relative' }}>
            <button
              type="button"
              className={`tj-cmd-tab ${activeCategoryDrawer === 'studios' ? 'is-active' : ''}`}
              onClick={() => setActiveCategoryDrawer(activeCategoryDrawer === 'studios' ? null : 'studios')}
              title="Creative & Analytic Studios"
            >
              <Layers size={13} />
              <span>STUDIOS</span>
              <ChevronDown size={11} style={{ opacity: 0.7 }} />
            </button>
            {activeCategoryDrawer === 'studios' && (
              <div className="tj-cmd-cat-drawer">
                <div className="tj-cmd-cat-drawer-header">CREATIVE & ANALYTIC STUDIOS</div>
                <button type="button" onClick={() => { openFloating('vision'); setActiveCategoryDrawer(null); }}>
                  <Eye size={12} color="#00f2fe" />
                  <span>Vision & Multimodal Studio</span>
                </button>
                <button type="button" onClick={() => { openFloating('data'); setActiveCategoryDrawer(null); }}>
                  <BarChart3 size={12} color="#4cd997" />
                  <span>Data Intelligence & Analytics</span>
                </button>
                <button type="button" onClick={() => { openFloating('education'); setActiveCategoryDrawer(null); }}>
                  <GraduationCap size={12} color="#f59e0b" />
                  <span>Education & Study Plans</span>
                </button>
                <button type="button" onClick={() => { openFloating('business'); setActiveCategoryDrawer(null); }}>
                  <Briefcase size={12} color="#38bdf8" />
                  <span>Business CRM & Pipeline</span>
                </button>
                <button type="button" onClick={() => { openFloating('wellness'); setActiveCategoryDrawer(null); }}>
                  <HeartPulse size={12} color="#f43f5e" />
                  <span>Wellness Trends & Health</span>
                </button>
                <button type="button" onClick={() => { openFloating('media'); setActiveCategoryDrawer(null); }}>
                  <Clapperboard size={12} color="#a855f7" />
                  <span>Files & Media Studio</span>
                </button>
                <button type="button" onClick={() => { openFloating('workflows'); setActiveCategoryDrawer(null); }}>
                  <Workflow size={12} color="#06b6d4" />
                  <span>Workflows Factory</span>
                </button>
              </div>
            )}
          </div>

          <div className="tj-cmd-tab-dropdown-wrap" style={{ position: 'relative' }}>
            <button
              type="button"
              className={`tj-cmd-tab ${activeCategoryDrawer === 'finance' ? 'is-active' : ''}`}
              onClick={() => setActiveCategoryDrawer(activeCategoryDrawer === 'finance' ? null : 'finance')}
              title="Finance & Trading Floor"
            >
              <Wallet size={13} />
              <span>FINANCE</span>
              <ChevronDown size={11} style={{ opacity: 0.7 }} />
            </button>
            {activeCategoryDrawer === 'finance' && (
              <div className="tj-cmd-cat-drawer">
                <div className="tj-cmd-cat-drawer-header">FINANCE & TRADING SUITE</div>
                <button type="button" onClick={() => { openFloating('finance'); setActiveCategoryDrawer(null); }}>
                  <Wallet size={12} color="#10b981" />
                  <span>Personal Finance & Budgets</span>
                </button>
                <button type="button" onClick={() => { openFloating('paper'); setActiveCategoryDrawer(null); }}>
                  <LineChart size={12} color="#00f2fe" />
                  <span>Paper Trading Simulation</span>
                </button>
              </div>
            )}
          </div>

          <div className="tj-cmd-tab-dropdown-wrap" style={{ position: 'relative' }}>
            <button
              type="button"
              className={`tj-cmd-tab ${activeCategoryDrawer === 'system' ? 'is-active' : ''}`}
              onClick={() => setActiveCategoryDrawer(activeCategoryDrawer === 'system' ? null : 'system')}
              title="System Configuration & Themes"
            >
              <Sliders size={13} />
              <span>SYSTEM</span>
              <ChevronDown size={11} style={{ opacity: 0.7 }} />
            </button>
            {activeCategoryDrawer === 'system' && (
              <div className="tj-cmd-cat-drawer">
                <div className="tj-cmd-cat-drawer-header">CORE SYSTEM CONTROLS</div>
                <button type="button" onClick={() => { openFloating('settings'); setActiveCategoryDrawer(null); }}>
                  <Sliders size={12} color="var(--tj-theme-primary)" />
                  <span>Settings & Environment</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowThemePicker(true);
                    setActiveCategoryDrawer(null);
                  }}
                  style={{ color: 'var(--tj-theme-primary)', fontWeight: 800 }}
                >
                  <Palette size={12} color="var(--tj-theme-primary)" />
                  <span>Theme Atmosphere ({activeTheme.toUpperCase()})</span>
                </button>
                <button type="button" onClick={() => { openFloating('learning'); setActiveCategoryDrawer(null); }}>
                  <Sparkles size={12} color="#a855f7" />
                  <span>Self-Improvement Review</span>
                </button>
                <button type="button" onClick={() => { openFloating('approvals'); setActiveCategoryDrawer(null); }}>
                  <ShieldAlert size={12} color="#f59e0b" />
                  <span>Security Approvals Vault</span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            className="tj-cmd-tab"
            onClick={() => openFloating('add_room')}
            style={{ marginLeft: 'auto', borderColor: 'var(--tj-theme-primary)', color: 'var(--tj-theme-primary)' }}
          >
            <Plus size={13} />
            <span>+ ADD ROOM</span>
          </button>
        </div>
      </header>

      {/* ====================================================================
          100% FULL-SCREEN 3D THREE.JS CANVAS
          ==================================================================== */}
      <div className="tj-command-center-canvas">
        <LivingHQScene
          agentSouls={agentSouls}
          customRooms={customRooms}
          departmentPositions={departmentPositions}
          selectedRoomId={selectedRoomId}
          isArchitectMode={isArchitectMode}
          onSelectRoomForMove={(id) => {
            setSelectedRoomId(id);
            if (!isArchitectMode) {
              const winKey = DEPARTMENT_WINDOW_MAP[id];
              if (winKey) openFloating(winKey);
            }
          }}
          onSelectAgent={handleSelect3DAgent}
          onOpenAgentSoul={handleInspectSoul}
          onOpenRoom={(dest) => {
            if (dest === 'chat') {
              setShowChatPopup(true);
            } else {
              handleOpenRoom(dest);
            }
          }}
          selectedAgentId={selectedSlotId}
          focusTarget={focusTarget}
          dayNightMode={dayNightMode}
          timeOfDay={timeOfDay}
          onToggleDayNight={cycleDayNight}
          onTimeOfDayChange={setTimeOfDay}
          isAutoOrbit={isAutoOrbit}
          height="100%"
        />
      </div>

      {/* ====================================================================
          THEME PICKER POPUP MODAL (10 DYNAMIC ATMOSPHERES)
          ==================================================================== */}
      {showThemePicker && (
        <div className="tj-theme-picker-modal">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Palette size={14} color="var(--tj-theme-primary)" />
              <b style={{ fontSize: 11, fontFamily: 'JetBrains Mono', color: '#ffffff' }}>SELECT CAMPUS THEME</b>
            </div>
            <button
              type="button"
              onClick={() => setShowThemePicker(false)}
              style={{ background: 'transparent', border: 0, color: '#94a3b8', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          </div>
          <p style={{ fontSize: 10, color: '#94a3b8', margin: '0 0 10px' }}>
            Transform the command center lighting, atmosphere, glassmorphism, and neon palette instantly.
          </p>
          <div className="tj-theme-grid">
            {THEMES.map((th) => (
              <button
                key={th.id}
                type="button"
                className={`tj-theme-card-btn ${activeTheme === th.id ? 'is-active' : ''}`}
                onClick={() => handleSelectTheme(th.id)}
              >
                <div className="tj-theme-chips">
                  <div className="tj-theme-chip" style={{ background: th.colors[0] }} />
                  <div className="tj-theme-chip" style={{ background: th.colors[1] }} />
                  <div className="tj-theme-chip" style={{ background: th.colors[2] }} />
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#ffffff', fontFamily: 'JetBrains Mono' }}>
                    {th.name.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 8, color: '#94a3b8' }}>{th.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ====================================================================
          ARCHITECT STUDIO HUD (MOVE & ALIGN CAMPUS BUILDINGS)
          ==================================================================== */}
      {isArchitectMode && (
        <div className="tj-architect-hud">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Move size={14} color="var(--tj-theme-primary)" />
              <b style={{ fontSize: 11, fontFamily: 'JetBrains Mono', color: '#ffffff' }}>ARCHITECT STUDIO</b>
            </div>
            <button
              type="button"
              onClick={() => setIsArchitectMode(false)}
              style={{ background: 'transparent', border: 0, color: '#94a3b8', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          </div>

          <p style={{ fontSize: 10, color: '#94a3b8', margin: '0 0 10px' }}>
            Click any building in 3D or choose below to reposition. Interior workstations & assigned agents follow automatically.
          </p>

          <select
            value={selectedRoomId || ''}
            onChange={(e) => setSelectedRoomId(e.target.value || null)}
            style={{
              width: '100%',
              background: 'rgba(15, 23, 42, 0.9)',
              border: '1px solid var(--tj-theme-border)',
              borderRadius: 6,
              color: '#ffffff',
              padding: '6px 8px',
              fontFamily: 'JetBrains Mono',
              fontSize: 10,
              marginBottom: 10,
            }}
          >
            <option value="">-- Select Room to Move --</option>
            {Object.entries(DEPARTMENT_ROOM_NAMES).map(([code, name]) => (
              <option key={code} value={code}>
                [{code}] {name}
              </option>
            ))}
            {customRooms.map((r) => (
              <option key={r.id} value={r.id}>
                [EXP] {r.name}
              </option>
            ))}
          </select>

          {selectedRoomId && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: 'JetBrains Mono', color: 'var(--tj-theme-primary)', marginBottom: 8 }}>
                <span>TARGET: {selectedRoomId}</span>
                <span>
                  COORD: [
                  {departmentPositions[selectedRoomId]?.[0] ?? customRooms.find((r) => r.id === selectedRoomId)?.position[0] ?? 0},{' '}
                  {departmentPositions[selectedRoomId]?.[2] ?? customRooms.find((r) => r.id === selectedRoomId)?.position[2] ?? 0}
                  ]
                </span>
              </div>

              <div className="tj-architect-dpad">
                <div />
                <button type="button" onClick={() => handleNudgeRoom(0, -1)} title="Nudge North">▲ North</button>
                <div />
                <button type="button" onClick={() => handleNudgeRoom(-1, 0)} title="Nudge West">◀ West</button>
                <button type="button" onClick={handleSnapToGrid} title="Snap to 2m Grid" style={{ color: 'var(--tj-theme-primary)', fontWeight: 800 }}>SNAP 2M</button>
                <button type="button" onClick={() => handleNudgeRoom(1, 0)} title="Nudge East">▶ East</button>
                <div />
                <button type="button" onClick={() => handleNudgeRoom(0, 1)} title="Nudge South">▼ South</button>
                <div />
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button
              type="button"
              onClick={handleResetDepartmentPositions}
              style={{
                flex: 1,
                padding: '6px 8px',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 6,
                color: '#f87171',
                fontSize: 10,
                fontFamily: 'JetBrains Mono',
                cursor: 'pointer',
              }}
            >
              Reset Campus Layout
            </button>
          </div>
        </div>
      )}



      {/* ====================================================================
          BOTTOM-CENTER: LIVE ACTIVITY & THE LIVING PULSE (CLOSABLE)
          ==================================================================== */}
      <div className="tj-cmd-bottom-center">
        {showBottomPulse ? (
          <>
            <div className="tj-cmd-live-activity-pill">
              <span>LIVE ACTIVITY:</span>
              <b>{runningTasks} running</b>
              <span>|</span>
              <b>{pendingApprovals} queued</b>
              {selectedSoul && (
                <>
                  <span>|</span>
                  <span style={{ color: '#00f2fe' }}>
                    LINKED: {selectedSoul.name.toUpperCase()} (⚡{Math.round(selectedSoul.energy)}%)
                  </span>
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
                  {selectedSoul ? selectedSoul.name.toUpperCase() : persona.name.toUpperCase()} · READY
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
                    selectedSoul
                      ? `Direct link: ${selectedSoul.name} (${selectedSoul.role}) · Speak or type...`
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
          BOTTOM-LEFT: NEXUS HYBRID STATUS BADGE
          ==================================================================== */}
      <div className="tj-cmd-bottom-left" style={{ pointerEvents: 'auto', zIndex: 25 }}>
        <div className="tj-cmd-hybrid-card">
          <div className="tj-cmd-hybrid-info">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="tj-cmd-privacy-dot" />
              <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono', color: 'var(--tj-theme-primary)', fontWeight: 800, letterSpacing: '0.08em' }}>
                NEXUS: HYBRID
              </span>
            </div>
            <span style={{ fontSize: 9, color: '#8da6bd', fontFamily: 'JetBrains Mono' }}>
              LOCAL MESH · ZERO LEAKAGE
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
            <span style={{ fontSize: 9, color: '#10b981', fontFamily: 'JetBrains Mono', fontWeight: 700 }}>SYNCHRONIZED</span>
          </div>
        </div>
      </div>

      {/* ====================================================================
          BOTTOM-RIGHT STACK: CHAT POPUP WINDOW & TRIGGER (ABOVE TELEMETRY)
          ==================================================================== */}
      <div className="tj-cmd-bottom-right-stack">
        {/* CHAT POPUP WINDOW (ABOVE TELEMETRY WITH FULL CONVERSATION SYSTEM) */}
        {showChatPopup && (
          <div className="tj-cmd-chat-popup-window">
            <div className="tj-cmd-chat-popup-header">
              <div className="tj-cmd-chat-popup-title">
                <Sparkles size={13} color="var(--tj-theme-primary)" />
                <span>AI COMMAND CHAT · CONVERSATION SYSTEM</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  className="tj-floating-win-btn"
                  onClick={() => {
                    setShowChatPopup(false);
                    openFloating('chat');
                  }}
                  title="Maximize to Full Window"
                >
                  <Maximize2 size={12} />
                </button>
                <button
                  type="button"
                  className="tj-floating-win-btn close"
                  onClick={() => setShowChatPopup(false)}
                  title="Close Chat Popup"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            <div className="tj-cmd-chat-popup-body">
              <Suspense fallback={<div style={{ padding: 16, color: 'var(--tj-theme-primary)', fontFamily: 'JetBrains Mono', fontSize: 11 }}>Loading Conversation System...</div>}>
                <ChatView personaName={persona.name} onNavigate={openFloating} />
              </Suspense>
            </div>
          </div>
        )}

        {/* VOICE CONTROL (OUTSIDE CHAT BOX) & CHAT POPUP TRIGGER */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end', width: '100%' }}>
          {onOpenLiveVoice && (
            <button
              type="button"
              className="tj-cmd-live-voice-btn"
              onClick={onOpenLiveVoice}
              title="Start Real-time Live Voice Conversation"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '6px 14px',
                borderRadius: 20,
                background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.28), rgba(56, 189, 248, 0.14))',
                border: '1px solid rgba(56, 189, 248, 0.55)',
                color: '#7dd3fc',
                fontWeight: 700,
                fontSize: 11,
                letterSpacing: '0.04em',
                cursor: 'pointer',
                boxShadow: '0 0 15px rgba(56, 189, 248, 0.25)',
              }}
            >
              <Mic size={13} />
              <span>🎙️ LIVE VOICE</span>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 6px #38bdf8' }} />
            </button>
          )}
          <button
            type="button"
            className={`tj-cmd-chat-trigger-btn ${showChatPopup ? 'is-active' : ''}`}
            onClick={() => setShowChatPopup(!showChatPopup)}
            title="Toggle AI Command Chat Popup"
          >
            <Sparkles size={13} />
            <span>💬 AI COMMAND CHAT</span>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} />
          </button>
        </div>

        {/* TELEMETRY GRAPHS & METRICS (CLOSABLE) */}
        <div className="tj-cmd-bottom-right">
          {showBottomRight ? (
            <>
              <div className="tj-cmd-telemetry-header">
                <button
                  type="button"
                  className={`tj-cmd-telemetry-tab ${telemetryTab === 'agents' ? 'active' : ''}`}
                  onClick={() => setTelemetryTab('agents')}
                >
                  AGENT NETWORK
                </button>
                <button
                  type="button"
                  className={`tj-cmd-telemetry-tab ${telemetryTab === 'components' ? 'active' : ''}`}
                  onClick={() => setTelemetryTab('components')}
                >
                  COMPONENTS
                </button>
                <button
                  type="button"
                  className={`tj-cmd-telemetry-tab ${telemetryTab === 'compute' ? 'active' : ''}`}
                  onClick={() => setTelemetryTab('compute')}
                >
                  COMPUTE LOAD
                </button>
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
                {telemetryTab === 'agents' && (
                  <>
                    <div className="tj-cmd-metric-row">
                      <span className="tj-cmd-metric-name">Active Human Agents</span>
                      <span className="tj-cmd-metric-val">{agentSouls.length} Deployed</span>
                    </div>

                    <svg className="tj-cmd-sparkline" viewBox="0 0 280 28" fill="none">
                      <path
                        d="M0 16 Q20 4, 40 16 T80 16 T120 16 T160 8 T200 22 T240 14 T280 16"
                        stroke="var(--tj-theme-primary)"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>

                    <div className="tj-cmd-metric-row">
                      <span className="tj-cmd-metric-name">Neural Mesh Latency</span>
                      <span className="tj-cmd-metric-val">1.2ms · 100% Operational</span>
                    </div>
                  </>
                )}

                {telemetryTab === 'components' && (
                  <>
                    <div className="tj-cmd-metric-row">
                      <span className="tj-cmd-metric-name">Ground Departments</span>
                      <span className="tj-cmd-metric-val">15 Operational</span>
                    </div>
                    <div className="tj-cmd-metric-row">
                      <span className="tj-cmd-metric-name">Custom Expansions</span>
                      <span className="tj-cmd-metric-val">{customRooms.length} Built</span>
                    </div>
                    <div className="tj-cmd-metric-row">
                      <span className="tj-cmd-metric-name">Fortress Perimeter</span>
                      <span className="tj-cmd-metric-val" style={{ color: '#10b981' }}>Secured (4 Walls)</span>
                    </div>
                  </>
                )}

                {telemetryTab === 'compute' && (
                  <>
                    <div className="tj-cmd-metric-row">
                      <span className="tj-cmd-metric-name">Neural Core Load</span>
                      <span className="tj-cmd-metric-val" style={{ color: '#10b981' }}>14% Nominal</span>
                    </div>
                    <div className="tj-cmd-metric-row">
                      <span className="tj-cmd-metric-name">Active Threads</span>
                      <span className="tj-cmd-metric-val">24 Concurrent</span>
                    </div>
                    <div className="tj-cmd-metric-row">
                      <span className="tj-cmd-metric-name">Subsystem Sync</span>
                      <span className="tj-cmd-metric-val">99.9% Uptime</span>
                    </div>
                  </>
                )}
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
      </div>

      {/* ====================================================================
          NEURAL AGENT SOUL DOSSIER FLOATING WINDOW (CLICK ON ANY AGENT)
          ==================================================================== */}
      {inspectingSoul && (
        <div
          className="tj-floating-window-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setInspectingSoul(null);
          }}
        >
          <div className="tj-floating-window" style={{ maxWidth: 720, height: 'auto', maxHeight: '88vh' }}>
            {/* Window Header */}
            <div className="tj-floating-window-header">
              <div className="tj-floating-window-title">
                <Brain size={16} />
                <span>NEURAL AGENT SOUL DOSSIER · {inspectingSoul.name}</span>
                <span className="tj-floating-window-badge" style={{ textTransform: 'uppercase' }}>
                  {inspectingSoul.status}
                </span>
              </div>
              <div className="tj-floating-window-actions">
                <button
                  type="button"
                  className="tj-floating-win-btn close"
                  onClick={() => setInspectingSoul(null)}
                  title="Close Dossier"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="tj-hud-subsystem-bar">
              <span>FACTION: <b>TJ INTELLIGENCE CORE</b></span>
              <span>ROOM: <b>{inspectingSoul.assignedRoom}</b></span>
              <span>STATE: <b>{inspectingSoul.status.toUpperCase()}</b></span>
            </div>

            <div className="tj-floating-window-body">
              <div className="tj-soul-dossier">
                {/* Header Card */}
                <div className="tj-soul-header-card">
                  <div className="tj-soul-name-block">
                    <h3>{inspectingSoul.name}</h3>
                    <p>{inspectingSoul.role}</p>
                  </div>

                  <div className="tj-soul-energy-meter">
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 10, fontFamily: 'JetBrains Mono' }}>
                      <span style={{ color: '#8da6bd' }}>SOUL ENERGY</span>
                      <b style={{ color: '#00f2fe' }}>{Math.round(inspectingSoul.energy)}%</b>
                    </div>
                    <div className="tj-soul-energy-bar">
                      <div className="tj-soul-energy-fill" style={{ width: `${inspectingSoul.energy}%` }} />
                    </div>
                  </div>
                </div>

                <div className="tj-soul-grid">
                  {/* Inner Thought Monologue */}
                  <div className="tj-soul-panel">
                    <span className="tj-soul-panel-title">💭 LIVE INNER THOUGHT STREAM</span>
                    <p style={{ margin: 0, fontSize: 11, color: '#d8e5ed', fontStyle: 'italic', lineHeight: 1.45 }}>
                      "{inspectingSoul.currentThought}"
                    </p>
                  </div>

                  {/* Soul Personality & Behavior */}
                  <div className="tj-soul-panel">
                    <span className="tj-soul-panel-title">🧬 BEHAVIORAL PROFILE</span>
                    <p style={{ margin: 0, fontSize: 11, color: '#8da6bd', lineHeight: 1.45 }}>
                      {inspectingSoul.personality}
                    </p>
                  </div>
                </div>

                {/* Direct Directive Assignment */}
                <form
                  onSubmit={handleAssignDirectiveToSoul}
                  style={{
                    background: 'rgba(8, 18, 32, 0.85)',
                    border: '1px solid rgba(0, 242, 254, 0.3)',
                    borderRadius: 10,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Terminal size={14} color="#00f2fe" />
                    <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: '#ffffff', fontWeight: 800 }}>
                      DISPATCH REAL-TIME DIRECTIVE TO {inspectingSoul.name}
                    </span>
                  </div>

                  <input
                    value={assignedDirective}
                    onChange={(e) => setAssignedDirective(e.target.value)}
                    placeholder={`e.g. Analyze AST parse tree, calibrate zero-g flux, execute task...`}
                    style={{
                      background: 'rgba(5, 12, 20, 0.85)',
                      border: '1px solid rgba(0, 242, 254, 0.25)',
                      borderRadius: 6,
                      color: '#ffffff',
                      fontFamily: 'JetBrains Mono',
                      fontSize: 11,
                      padding: '8px 12px',
                      outline: 'none',
                    }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button
                      type="submit"
                      disabled={!assignedDirective.trim()}
                      style={{
                        background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
                        border: 0,
                        borderRadius: 6,
                        color: '#050b14',
                        fontFamily: 'JetBrains Mono',
                        fontWeight: 900,
                        fontSize: 11,
                        padding: '6px 16px',
                        cursor: 'pointer',
                      }}
                    >
                      Assign Task
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          STANDARD FLOATING WINDOWS (CAN BE CLOSED ANYTIME!)
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
                      <span className="tj-floating-window-badge">FUTURISTIC SUBSYSTEM</span>
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

            {/* Subsystem Telemetry Bar */}
            <div className="tj-hud-subsystem-bar">
              <span>TJ CORE: <b>ONLINE</b></span>
              <span>ENCRYPTION: <b>QUANTUM LOCAL</b></span>
              <span>MESH LATENCY: <b>1.2ms</b></span>
            </div>

            {/* Window Content */}
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
