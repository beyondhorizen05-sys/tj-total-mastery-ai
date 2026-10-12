import React, { useState, useEffect, lazy, Suspense } from 'react';
import {
  Activity, ArrowUpRight, CheckSquare, Clapperboard, Compass, Cpu,
  Headphones, MessageSquare, Power, Radio,
  Send, ShieldAlert, Sliders, Sparkles, UserCheck, Users, Workflow,
  Edit3, X, Maximize2, Minimize2, Minus, Eye, BarChart3, GraduationCap,
  Briefcase, HeartPulse, Wallet, LineChart, Wrench, HardDrive, Network,
  Plus, Trash2, Zap, Brain, Terminal, Sun, Moon
} from 'lucide-react';
import type { SystemStatus, TJPersona, TownAgent } from '@tj/schemas';
import { apiFetch } from '../api';
import {
  LivingHQScene,
  type AgentSoul,
  type CustomRoom,
} from '../components/LivingHQScene';
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
    workstationPos: [-6.8, 0.44, -2.1],
    restPos: [-7.8, 0, -1.8],
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
    workstationPos: [-6.4, 0.44, 4.8],
    restPos: [-7.2, 0, 5.2],
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
    workstationPos: [-7.6, 0.44, 4.8],
    restPos: [-8.2, 0, 5.2],
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
    workstationPos: [-5.5, 2.24, 4.8],
    restPos: [-6.2, 1.8, 5.2],
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
    currentThought: 'Patrolling central bulkhead vault; access policies verified.',
    workstationPos: [-1.8, 0.44, -6.2],
    restPos: [-2.5, 0, -5.8],
    assignedRoom: 'SECURITY VAULT & CITADEL',
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
    workstationPos: [5.5, 2.24, -4.6],
    restPos: [4.8, 1.8, -4.2],
    assignedRoom: 'AI MODELS & NEURAL ENGINE',
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
    workstationPos: [7.5, 2.24, 0.6],
    restPos: [8.2, 1.8, 1.0],
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
    workstationPos: [6.5, 2.24, 5.0],
    restPos: [7.2, 1.8, 5.5],
    assignedRoom: 'DATA INTELLIGENCE & ANALYTICS',
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
    workstationPos: [0.0, 2.24, -5.3],
    restPos: [-0.8, 1.8, -4.8],
    assignedRoom: 'MISSION CONTROL',
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
    workstationPos: [-3.5, 4.04, -4.8],
    restPos: [-4.2, 3.6, -4.4],
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
    workstationPos: [6.5, 2.24, -4.6],
    restPos: [7.2, 1.8, -4.2],
    assignedRoom: 'AI MODELS & NEURAL ENGINE',
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
    workstationPos: [1.2, 2.24, -5.3],
    restPos: [1.8, 1.8, -4.8],
    assignedRoom: 'MISSION CONTROL',
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
    workstationPos: [-1.2, 2.24, -5.3],
    restPos: [-1.8, 1.8, -4.8],
    assignedRoom: 'MISSION CONTROL',
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
    workstationPos: [-7.0, 2.24, 0.6],
    restPos: [-7.8, 1.8, 1.0],
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
    workstationPos: [8.0, 0.44, -3.2],
    restPos: [8.8, 0, -2.8],
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
    workstationPos: [7.8, 0.44, 4.2],
    restPos: [8.5, 0, 4.6],
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
    workstationPos: [8.5, 2.24, 0.6],
    restPos: [9.0, 1.8, 1.0],
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
    workstationPos: [2.2, 0.44, 4.6],
    restPos: [2.8, 0, 5.0],
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
    workstationPos: [1.4, 0.44, 4.6],
    restPos: [0.8, 0, 5.0],
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
    workstationPos: [-6.2, 2.24, 0.6],
    restPos: [-5.6, 1.8, 1.0],
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
    workstationPos: [0.0, 4.04, 0.8],
    restPos: [-0.8, 3.6, 0.8],
    assignedRoom: 'COMMUNICATIONS & LIVING PULSE',
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
    workstationPos: [-6.0, 4.04, -3.3],
    restPos: [-6.8, 3.6, -3.0],
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
    workstationPos: [7.0, 0.44, 4.2],
    restPos: [6.4, 0, 4.6],
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
    workstationPos: [-0.8, 0.44, -6.2],
    restPos: [-0.2, 0, -5.8],
    assignedRoom: 'SECURITY VAULT & CITADEL',
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

  // Department 3D Room Coordinates for Smooth Camera Focus
  const ROOM_COORDINATES: Record<string, [number, number, number]> = {
    vision: [-7.5, 0.8, -2.5],
    wellness: [-7.0, 0.8, 4.5],
    approvals: [-1.5, 0.8, -6.5],
    business: [2.0, 0.8, 4.5],
    graph: [7.5, 0.8, 4.0],
    memory: [8.0, 0.8, -3.5],
    tasks: [0.0, 2.4, -5.5],
    models: [6.0, 2.4, -4.8],
    workflows: [8.0, 2.4, 0.5],
    data: [6.5, 2.4, 5.0],
    finance: [-5.5, 2.4, 4.8],
    paper: [-5.5, 2.4, 4.8],
    media: [-7.0, 2.4, 0.5],
    connectors: [-2.5, 2.4, 0.0],
    workbench: [-2.5, 2.4, 0.0],
    skills: [-6.0, 4.2, -3.5],
    education: [-6.0, 4.2, -3.5],
    agents: [-3.5, 4.2, -5.0],
    chat: [0.0, 5.2, 0.8],
    command: [0.0, 2.4, -5.5],
  };

  const handleOpenRoom = (roomId: string) => {
    if (ROOM_COORDINATES[roomId]) {
      setFocusTarget(ROOM_COORDINATES[roomId]);
    }
    if (roomId !== 'command') {
      openFloating(roomId);
    }
  };

  // Overlay Panels Visibility (Allow closing/minimizing everything)
  const [showBottomLeft, setShowBottomLeft] = useState(true);
  const [showBottomRight, setShowBottomRight] = useState(true);
  const [showBottomPulse, setShowBottomPulse] = useState(true);

  // Live Agent Souls (Realistic human behavior & state machine)
  const [agentSouls, setAgentSouls] = useState<AgentSoul[]>(() => {
    try {
      const saved = localStorage.getItem('tj_agent_souls');
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

  // Category switch toggles
  const [switches, setSwitches] = useState({
    aiSystems: true,
    studios: true,
    finance: false,
    system: false,
  });
  const [activeCategoryDrawer, setActiveCategoryDrawer] = useState<string | null>(null);

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
      ground_right: [3.4, 0, 2.6],
      mezzanine_right: [3.8, 2.8, 1.8],
      observation_high: [0, 4.2, 0],
      extended_left: [-7.2, 0, 0],
    };

    const newRoom: CustomRoom = {
      id: `custom-room-${Date.now()}`,
      name: newRoomName.trim().toUpperCase(),
      theme: newRoomTheme,
      bay: newRoomBay,
      position: bayPositions[newRoomBay] || [0, 0, 0],
      accentColor: newRoomColor,
      assignedAgentIds: [],
    };

    const updated = [...customRooms, newRoom];
    setCustomRooms(updated);
    try {
      localStorage.setItem('tj_custom_rooms', JSON.stringify(updated));
    } catch (err) {
      console.error(err);
    }

    setNewRoomName('');
    closeFloating();
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

  // PRIMARY TOP NAVIGATION TABS (WITHOUT DUMMY "MAIN INTERFACE")
  const topTabs = [
    { id: 'command', label: 'LIVING WORLD', icon: Compass, isActive: !activeFloatingWindow && !inspectingSoul },
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

          <button
            type="button"
            className="tj-cmd-tab"
            onClick={() => openFloating('add_room')}
            style={{ marginLeft: 'auto', borderColor: 'rgba(0, 242, 254, 0.4)', color: '#00f2fe' }}
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
          onSelectAgent={handleSelect3DAgent}
          onOpenAgentSoul={handleInspectSoul}
          onOpenRoom={handleOpenRoom}
          selectedAgentId={selectedSlotId}
          focusTarget={focusTarget}
          dayNightMode={dayNightMode}
          timeOfDay={timeOfDay}
          onToggleDayNight={cycleDayNight}
          onTimeOfDayChange={setTimeOfDay}
          height="100%"
        />
      </div>

      {/* ====================================================================
          BOTTOM-LEFT OVERLAYS: HYBRID CARD & SWITCHES (CLOSABLE)
          ==================================================================== */}
      <div className="tj-cmd-bottom-left">
        {showBottomLeft ? (
          <>
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

            <div className="tj-cmd-switches-group">
              <div
                className={`tj-cmd-switch-item ${switches.aiSystems ? 'is-on' : ''}`}
                onClick={() => toggleSwitch('aiSystems')}
              >
                <span className="tj-cmd-switch-label">AI SYSTEMS</span>
                <div className="tj-cmd-switch-track"><div className="tj-cmd-switch-thumb" /></div>
              </div>

              <div
                className={`tj-cmd-switch-item ${switches.studios ? 'is-on' : ''}`}
                onClick={() => toggleSwitch('studios')}
              >
                <span className="tj-cmd-switch-label">STUDIOS</span>
                <div className="tj-cmd-switch-track"><div className="tj-cmd-switch-thumb" /></div>
              </div>

              <div
                className={`tj-cmd-switch-item ${switches.finance ? 'is-on' : ''}`}
                onClick={() => toggleSwitch('finance')}
              >
                <span className="tj-cmd-switch-label">FINANCE</span>
                <div className="tj-cmd-switch-track"><div className="tj-cmd-switch-thumb" /></div>
              </div>

              <div
                className={`tj-cmd-switch-item ${switches.system ? 'is-on' : ''}`}
                onClick={() => toggleSwitch('system')}
              >
                <span className="tj-cmd-switch-label">SYSTEM</span>
                <div className="tj-cmd-switch-track"><div className="tj-cmd-switch-thumb" /></div>
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
          BOTTOM-RIGHT: TELEMETRY GRAPHS & METRICS (CLOSABLE)
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
                <span className="tj-cmd-metric-name">Active Human Agents</span>
                <span className="tj-cmd-metric-val">{agentSouls.length} Deployed</span>
              </div>

              <svg className="tj-cmd-sparkline" viewBox="0 0 280 28" fill="none">
                <path
                  d="M0 16 Q20 4, 40 16 T80 16 T120 16 T160 8 T200 22 T240 14 T280 16"
                  stroke="#00f2fe"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>

              <div className="tj-cmd-metric-row">
                <span className="tj-cmd-metric-name">Neural Mesh Latency</span>
                <span className="tj-cmd-metric-val">1.2ms · 100% Operational</span>
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
