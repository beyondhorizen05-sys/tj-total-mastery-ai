import React, { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentStatus, TownAgent } from '@tj/schemas';
import { canRenderWebGL, WebGLBoundary } from './WebGLBoundary';

type RoomId = 'research_lab' | 'dev_studio' | 'meeting_hall' | 'creative_studio' | 'operations';
type AgentCommunication = { id: string; ts: string; from_agent_id: string | null; to_agent_id: string | null; kind: string; task_id?: string | null };
type Room = {
  id: RoomId;
  title: string;
  destination: string;
  position: readonly [number, number, number];
  size: readonly [number, number];
  accent: string;
};

const ROOMS: readonly Room[] = [
  { id: 'research_lab', title: 'RESEARCH LAB', destination: 'vision', position: [-4.45, 2.6, -2.15], size: [4.6, 3.8], accent: '#65b9fa' },
  { id: 'dev_studio', title: 'AGENT WORKSPACE', destination: 'agents', position: [4.45, 2.6, -2.15], size: [4.6, 3.8], accent: '#46ded0' },
  { id: 'meeting_hall', title: 'COLLABORATION HALL', destination: 'collaboration_hall', position: [0, 2.6, -4.2], size: [3.9, 2.55], accent: '#d2a6ff' },
  { id: 'creative_studio', title: 'CREATION STUDIO', destination: 'media', position: [-4.45, 0, 2.4], size: [4.6, 4.2], accent: '#a58cff' },
  { id: 'operations', title: 'MISSION CONTROL', destination: 'tasks', position: [4.45, 0, 2.4], size: [4.6, 4.2], accent: '#6cbdff' },
];

const ACTIVE = new Set<AgentStatus>(['thinking', 'working', 'meeting', 'waiting_approval']);
const statusColor = (status: AgentStatus) => status === 'blocked' || status === 'failed' ? '#ff718a' : ACTIVE.has(status) ? '#75eddf' : '#8094ab';
const ROOM_LINKS = [{ label: 'CENTRAL NEXUS', destination: 'main' }, ...ROOMS.map(room => ({ label: room.title, destination: room.destination }))];

export interface LivingHQSceneProps {
  agents: TownAgent[];
  messages?: AgentCommunication[];
  onSelectAgent: (id: string) => void;
  onOpenRoom: (destination: string) => void;
  selectedAgentId?: string | null;
  height?: number | string;
}

function Box({ at, size, color, emissive, intensity = 0, opacity = 1, metalness = 0.25 }: {
  at: [number, number, number]; size: [number, number, number]; color: string;
  emissive?: string; intensity?: number; opacity?: number; metalness?: number;
}) {
  return <mesh position={at} castShadow receiveShadow>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} emissive={emissive ?? color} emissiveIntensity={intensity} transparent={opacity < 1} opacity={opacity} metalness={metalness} roughness={0.37} depthWrite={opacity === 1} />
  </mesh>;
}

function SceneLabel({ text, color, position, width, height, outline = '#0c182a' }: {
  text: string; color: string; position: [number, number, number]; width: number; height: number; outline?: string;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 160;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = '600 64px Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = 8;
    context.strokeStyle = outline;
    context.shadowColor = color;
    context.shadowBlur = 12;
    context.strokeText(text, canvas.width / 2, canvas.height / 2, canvas.width - 24);
    context.fillStyle = color;
    context.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 24);
    const next = new THREE.CanvasTexture(canvas);
    next.colorSpace = THREE.SRGBColorSpace;
    next.minFilter = THREE.LinearFilter;
    next.magFilter = THREE.LinearFilter;
    next.needsUpdate = true;
    return next;
  }, [text, color, outline]);
  React.useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;
  return <mesh position={position}>
    <planeGeometry args={[width, height]} />
    <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
  </mesh>;
}

function Trim({ width, depth, y, accent }: { width: number; depth: number; y: number; accent: string }) {
  return <>
    <Box at={[0, y, depth / 2]} size={[width, 0.035, 0.045]} color={accent} emissive={accent} intensity={1.5} />
    <Box at={[0, y, -depth / 2]} size={[width, 0.035, 0.045]} color={accent} emissive={accent} intensity={0.9} />
    {([-1, 1] as const).map(side => <Box key={side} at={[side * width / 2, y, 0]} size={[0.045, 0.035, depth]} color={accent} emissive={accent} intensity={0.9} />)}
  </>;
}

function Workstation({ x, z, accent, facing = 0 }: { x: number; z: number; accent: string; facing?: number }) {
  return <group position={[x, 0, z]} rotation={[0, facing, 0]}>
    <Box at={[0, 0.31, 0]} size={[0.84, 0.07, 0.46]} color="#4d6177" metalness={0.65} />
    <Box at={[-0.32, 0.17, 0]} size={[0.045, 0.28, 0.36]} color="#24384f" />
    <Box at={[0.32, 0.17, 0]} size={[0.045, 0.28, 0.36]} color="#24384f" />
    <Box at={[0, 0.63, -0.18]} size={[0.57, 0.43, 0.035]} color="#14263d" emissive={accent} intensity={0.27} />
    <Box at={[0, 0.63, -0.155]} size={[0.46, 0.29, 0.007]} color={accent} emissive={accent} intensity={0.75} opacity={0.72} />
    <Box at={[0, 0.42, -0.18]} size={[0.035, 0.15, 0.035]} color="#61798d" />
    <Box at={[0, 0.12, 0.52]} size={[0.43, 0.18, 0.42]} color="#344d68" />
  </group>;
}

function RoomFurniture({ room }: { room: Room }) {
  const isMeeting = room.id === 'meeting_hall';
  const isOperations = room.id === 'operations';
  return <>
    {isMeeting ? <>
      <Box at={[0, 0.3, 0]} size={[2.35, 0.1, 0.92]} color="#596780" metalness={0.66} />
      <Box at={[0, 0.57, 0]} size={[1.7, 0.04, 0.52]} color={room.accent} emissive={room.accent} intensity={0.8} opacity={0.62} />
      {[-1.3, 1.3].map(x => [-0.43, 0.43].map(z => <Box key={`${x}-${z}`} at={[x, 0.16, z]} size={[0.28, 0.3, 0.3]} color="#344a64" />))}
    </> : <>
      {[-1.08, 1.08].map(x => [-0.73, 0.78].map(z => <Workstation key={`${x}-${z}`} x={x} z={z} accent={room.accent} facing={z > 0 ? Math.PI : 0} />))}
      {isOperations && <Box at={[0, 1.18, -room.size[1] / 2 + 0.2]} size={[2.65, 0.66, 0.04]} color="#13283f" emissive={room.accent} intensity={0.5} />}
      {room.id === 'research_lab' && <mesh position={[0, 0.77, 0]}><icosahedronGeometry args={[0.34, 1]} /><meshStandardMaterial color="#4dbbfc" emissive="#4dbbfc" emissiveIntensity={1.3} wireframe /></mesh>}
      {room.id === 'creative_studio' && <mesh position={[0, 0.92, 0]} rotation={[0.4, 0.3, 0.5]}><torusKnotGeometry args={[0.25, 0.045, 56, 8]} /><meshStandardMaterial color="#a58cff" emissive="#a58cff" emissiveIntensity={1.2} /></mesh>}
    </>}
  </>;
}

function AgentAvatar({ agent, at, selected, onSelect }: {
  agent: TownAgent; at: [number, number, number]; selected: boolean; onSelect: (id: string) => void;
}) {
  const working = ACTIVE.has(agent.status);
  const glow = statusColor(agent.status);
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const [reducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const seed = agent.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) * 0.13;
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed;
    if (root.current) {
      const activeMotion = agent.status === 'working' || agent.status === 'thinking' || agent.status === 'meeting';
      root.current.position.y = at[1] + (activeMotion ? 0.018 : 0.006) * Math.sin(t * (activeMotion ? 2.8 : 1.25));
      const walking = agent.status === 'working' && Boolean(agent.task_id);
      const travel = walking && !reducedMotion;
      root.current.position.x = at[0] + (travel ? Math.sin(t * 0.58) * 0.3 : 0);
      root.current.position.z = at[2] + (travel ? Math.sin(t * 0.39 + seed) * 0.22 : 0);
      root.current.rotation.y = travel ? Math.atan2(Math.cos(t * 0.58), Math.cos(t * 0.39 + seed)) : 0;
      root.current.rotation.z = agent.status === 'blocked' || agent.status === 'failed' ? -0.1 : 0.012 * Math.sin(t * 1.2);
    }
    if (head.current) {
      head.current.rotation.y = agent.status === 'thinking' ? Math.sin(t * 0.72) * 0.3 : agent.status === 'meeting' ? Math.sin(t * 0.55) * 0.18 : Math.sin(t * 0.8) * 0.035;
      head.current.rotation.x = agent.status === 'thinking' ? -0.1 : 0;
    }
    if (leftArm.current && rightArm.current) {
      const cycle = Math.sin(t * (agent.status === 'working' ? 3.5 : 1.1));
      leftArm.current.rotation.x = agent.status === 'working' ? cycle * 0.34 : agent.status === 'meeting' ? -0.08 : 0.025 * cycle;
      rightArm.current.rotation.x = agent.status === 'working' ? -cycle * 0.34 : agent.status === 'meeting' ? 0.08 : 0.025 * cycle;
      rightArm.current.rotation.z = agent.status === 'thinking' ? -0.82 : 0;
    }
    if (leftLeg.current && rightLeg.current) {
      const stride = agent.status === 'working' && Boolean(agent.task_id) && !reducedMotion ? Math.sin(t * 2.1) * 0.32 : 0.018 * Math.sin(t);
      leftLeg.current.rotation.x = stride;
      rightLeg.current.rotation.x = -stride;
    }
  });
  return <group ref={root} position={at} onClick={event => { event.stopPropagation(); onSelect(agent.id); }} onPointerOver={() => { document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
    <mesh position={[0, 0.08, 0]}><cylinderGeometry args={[0.19, 0.24, 0.03, 16]} /><meshBasicMaterial color={glow} transparent opacity={selected ? 0.9 : 0.42} /></mesh>
    <mesh position={[0, 0.16, 0]}><capsuleGeometry args={[0.075, 0.2, 4, 8]} /><meshStandardMaterial color="#465a70" metalness={0.54} roughness={0.42} /></mesh>
    <mesh position={[0, 0.4, 0]}><capsuleGeometry args={[0.13, 0.3, 5, 12]} /><meshStandardMaterial color={selected ? '#d6faff' : '#7f9fba'} emissive={glow} emissiveIntensity={working ? 0.42 : 0.12} metalness={0.56} roughness={0.34} /></mesh>
    <group ref={leftArm} position={[-0.16, 0.5, 0]}><mesh position={[0, -0.13, 0]}><capsuleGeometry args={[0.052, 0.19, 3, 8]} /><meshStandardMaterial color="#829bb0" metalness={0.4} roughness={0.4} /></mesh></group>
    <group ref={rightArm} position={[0.16, 0.5, 0]}><mesh position={[0, -0.13, 0]}><capsuleGeometry args={[0.052, 0.19, 3, 8]} /><meshStandardMaterial color="#829bb0" metalness={0.4} roughness={0.4} /></mesh></group>
    <group ref={leftLeg} position={[-0.07, 0.27, 0]}><mesh position={[0, -0.1, 0]}><capsuleGeometry args={[0.043, 0.16, 3, 7]} /><meshStandardMaterial color="#71869e" metalness={0.45} /></mesh></group>
    <group ref={rightLeg} position={[0.07, 0.27, 0]}><mesh position={[0, -0.1, 0]}><capsuleGeometry args={[0.043, 0.16, 3, 7]} /><meshStandardMaterial color="#71869e" metalness={0.45} /></mesh></group>
    <group ref={head} position={[0, 0.72, 0]}>
      <mesh><sphereGeometry args={[0.12, 16, 12]} /><meshStandardMaterial color="#b2c7d9" metalness={0.45} /></mesh>
      <mesh position={[0, 0.12, 0]}><sphereGeometry args={[0.055, 12, 8]} /><meshBasicMaterial color={glow} /></mesh>
    </group>
    {selected && <mesh position={[0, 0.065, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.23, 0.32, 24]} /><meshBasicMaterial color="#e3fbff" side={THREE.DoubleSide} /></mesh>}
  </group>;
}

function RoomModule({ room, agents, selectedAgentId, onSelectAgent, onOpenRoom }: {
  room: Room; agents: TownAgent[]; selectedAgentId?: string | null;
  onSelectAgent: (id: string) => void; onOpenRoom: (destination: string) => void;
}) {
  const [width, depth] = room.size;
  const [x, y, z] = room.position;
  const visibleAgents = agents.slice(0, 12);
  return <group position={[x, y, z]}>
    <group onClick={event => { event.stopPropagation(); onOpenRoom(room.destination); }} onPointerOver={() => { document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
      <Box at={[0, -0.16, 0]} size={[width + 0.12, 0.32, depth + 0.12]} color="#1b2941" metalness={0.72} />
      <Box at={[0, 0.015, 0]} size={[width, 0.045, depth]} color="#30435b" metalness={0.6} />
      <Trim width={width + 0.14} depth={depth + 0.14} y={-0.28} accent={room.accent} />
      <Box at={[0, 0.92, -depth / 2]} size={[width, 1.84, 0.075]} color="#324762" opacity={0.68} />
      <Box at={[-width / 2, 0.89, 0]} size={[0.07, 1.78, depth]} color="#253750" opacity={0.5} />
      <Box at={[width / 2, 0.89, 0]} size={[0.07, 1.78, depth]} color="#253750" opacity={0.44} />
      <Box at={[0, 0.42, depth / 2]} size={[width, 0.78, 0.035]} color="#76b2d9" opacity={0.13} />
      <Box at={[0, 1.77, -depth / 2 + 0.04]} size={[width, 0.035, 0.055]} color={room.accent} emissive={room.accent} intensity={1.3} />
      {[-1, 1].map(side => <Box key={side} at={[side * (width / 2 - 0.1), 0.9, -depth / 2 + 0.06]} size={[0.04, 1.8, 0.06]} color="#8aa1ba" metalness={0.8} />)}
      <RoomFurniture room={room} />
      <SceneLabel position={[0, 2.03, -depth / 2]} width={width * 0.9} height={0.29} text={room.title} color="#e6f5ff" />
      <SceneLabel position={[0, 1.76, -depth / 2 + 0.075]} width={1.8} height={0.19} text={`${agents.length} DEPLOYED`} color={room.accent} />
    </group>
    {visibleAgents.map((agent, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      const ax = (column - 1.5) * 0.88;
      const az = 0.12 + row * 0.47;
      return <AgentAvatar key={agent.id} agent={agent} at={[ax, 0, az]} selected={selectedAgentId === agent.id} onSelect={onSelectAgent} />;
    })}
    {agents.length > visibleAgents.length && <SceneLabel position={[0, 0.15, depth / 2 - 0.16]} width={1.6} height={0.22} text={`+${agents.length - visibleAgents.length} AGENTS`} color="#d4eaff" />}
  </group>;
}

function Nexus({ agents, selectedAgentId, onSelectAgent, onOpenRoom, reducedMotion }: {
  agents: TownAgent[]; selectedAgentId?: string | null; onSelectAgent: (id: string) => void;
  onOpenRoom: (destination: string) => void; reducedMotion: boolean;
}) {
  const core = useRef<THREE.Group>(null);
  useFrame((_, delta) => { if (core.current && !reducedMotion) core.current.rotation.y += delta * 0.14; });
  return <group>
    <group onClick={event => { event.stopPropagation(); onOpenRoom('main'); }} onPointerOver={() => { document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
      <mesh position={[0, 0.05, 0]}><cylinderGeometry args={[1.62, 1.72, 0.16, 40]} /><meshStandardMaterial color="#374b66" metalness={0.82} roughness={0.23} /></mesh>
      <mesh position={[0, 0.17, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[1.2, 1.53, 48]} /><meshBasicMaterial color="#b06eff" side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 2.58, 0]}><cylinderGeometry args={[1.48, 1.48, 0.12, 40]} /><meshStandardMaterial color="#273a56" metalness={0.7} transparent opacity={0.7} /></mesh>
      <mesh position={[0, 2.68, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[1.11, 1.43, 48]} /><meshBasicMaterial color="#56e3ef" side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 3, 0]}><cylinderGeometry args={[0.66, 0.84, 5.86, 24, 1, true]} /><meshStandardMaterial color="#4daee8" emissive="#3d8af5" emissiveIntensity={0.65} metalness={0.55} roughness={0.2} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <group ref={core}>
        {Array.from({ length: 10 }, (_, i) => <mesh key={i} position={[0, 0.62 + i * 0.49, 0]} rotation={[0, i * 0.31, 0]}><torusGeometry args={[0.77 + (i % 3) * 0.08, 0.025, 6, 32]} /><meshBasicMaterial color={i % 2 ? '#72dfff' : '#ad71fb'} transparent opacity={0.78} /></mesh>)}
        {Array.from({ length: 6 }, (_, i) => <Box key={i} at={[0, 0.8 + i * 0.77, 0]} size={[1.24, 0.05, 1.24]} color="#386788" emissive="#49bbf9" intensity={0.65} opacity={0.34} />)}
      </group>
      <mesh position={[0, 5.97, 0]}><boxGeometry args={[2.18, 0.14, 2.18]} /><meshStandardMaterial color="#5c83a5" emissive="#63c7f9" emissiveIntensity={0.6} metalness={0.8} /></mesh>
      <mesh position={[0, 6.05, 0]}><boxGeometry args={[1.85, 0.05, 1.85]} /><meshBasicMaterial color="#67d9ff" transparent opacity={0.52} /></mesh>
      <SceneLabel position={[0, 6.4, 0]} width={3.1} height={0.36} text="CENTRAL NEXUS" color="#e9fbff" outline="#102239" />
    </group>
    {agents.slice(0, 8).map((agent, index) => {
      const angle = index * Math.PI * 0.25;
      return <AgentAvatar key={agent.id} agent={agent} at={[Math.sin(angle) * 1.94, 0, Math.cos(angle) * 1.94]} selected={selectedAgentId === agent.id} onSelect={onSelectAgent} />;
    })}
    {agents.length > 8 && <SceneLabel position={[0, 0.25, 2.25]} width={1.6} height={0.22} text={`+${agents.length - 8} AGENTS`} color="#e4f6ff" />}
  </group>;
}

function visualPosition(agent: TownAgent, agents: TownAgent[]): THREE.Vector3 {
  if (agent.area === 'command_center') {
    const peers = agents.filter((item) => item.area === 'command_center').sort((a, b) => a.id.localeCompare(b.id));
    const index = peers.findIndex((item) => item.id === agent.id);
    const angle = index * Math.PI * 0.25;
    return new THREE.Vector3(Math.sin(angle) * 1.94, 1.05, Math.cos(angle) * 1.94);
  }
  const room = ROOMS.find((item) => item.id === agent.area);
  const peers = agents.filter((item) => item.area === agent.area).sort((a, b) => a.id.localeCompare(b.id));
  const index = peers.findIndex((item) => item.id === agent.id);
  const base = room?.position ?? [0, 0, 0];
  return new THREE.Vector3(base[0] + ((index % 4) - 1.5) * 0.88, base[1] + 1.05, base[2] + 0.12 + Math.floor(index / 4) * 0.47);
}

function CommunicationPulse({ start, end, reducedMotion }: { start: THREE.Vector3; end: THREE.Vector3; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const vector = useMemo(() => end.clone().sub(start), [start, end]);
  const length = vector.length();
  const midpoint = useMemo(() => start.clone().add(end).multiplyScalar(0.5), [start, end]);
  const rotation = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.clone().normalize()), [vector]);
  useFrame(({ clock }) => {
    if (group.current) { group.current.position.copy(midpoint); group.current.quaternion.copy(rotation); }
    if (pulse.current && length > 0) {
      const travel = reducedMotion ? 0.5 : (clock.elapsedTime * 0.65) % 1;
      pulse.current.position.set(0, (travel - 0.5) * length, 0);
    }
  });
  if (length < 0.5) return null;
  return <group ref={group}>
    <mesh><cylinderGeometry args={[0.012, 0.012, length, 5]} /><meshBasicMaterial color="#68ddff" transparent opacity={reducedMotion ? 0.35 : 0.18} depthWrite={false} /></mesh>
    <mesh ref={pulse}><sphereGeometry args={[0.055, 8, 8]} /><meshBasicMaterial color="#dffaff" toneMapped={false} /></mesh>
  </group>;
}

function HQWorld({ agents, messages = [], selectedAgentId, onSelectAgent, onOpenRoom, reducedMotion }: Omit<LivingHQSceneProps, 'height'> & { reducedMotion: boolean }) {
  const byArea = useMemo(() => {
    const groups = new Map<string, TownAgent[]>();
    for (const agent of [...agents].sort((a, b) => a.id.localeCompare(b.id))) {
      const area = ROOMS.some(room => room.id === agent.area) ? agent.area : 'command_center';
      const group = groups.get(area) ?? [];
      group.push(agent);
      groups.set(area, group);
    }
    return groups;
  }, [agents]);
  const communications = useMemo(() => {
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    const cutoff = Date.now() - 30_000;
    return messages.filter((message) => message.from_agent_id && message.to_agent_id && Date.parse(message.ts) >= cutoff)
      .slice(0, 20).map((message) => {
        const from = agentsById.get(message.from_agent_id!);
        const to = agentsById.get(message.to_agent_id!);
        return from && to ? { id: message.id, start: visualPosition(from, agents), end: visualPosition(to, agents) } : null;
      }).filter((message): message is { id: string; start: THREE.Vector3; end: THREE.Vector3 } => Boolean(message));
  }, [agents, messages]);
  return <>
    <color attach="background" args={['#060b17']} />
    <fog attach="fog" args={['#060b17', 20, 38]} />
    <ambientLight intensity={1.45} color="#aab9d6" />
    <directionalLight position={[7, 12, 8]} intensity={2.5} color="#c5e5ff" />
    <pointLight position={[0, 4.3, 0]} intensity={13} color="#7b9fff" distance={11} />
    <pointLight position={[0, 0.4, 0]} intensity={8} color="#bc67fb" distance={7} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.61, 0]}><planeGeometry args={[90, 90]} /><meshStandardMaterial color="#080e1c" roughness={0.85} /></mesh>
    <Box at={[0, -0.39, 0]} size={[15.2, 0.52, 11.4]} color="#14233a" metalness={0.78} />
    <Trim width={15.24} depth={11.44} y={-0.63} accent="#487ddb" />
    <Box at={[0, -0.095, 0]} size={[14.85, 0.07, 11]} color="#25344d" metalness={0.72} />
    {([-1, 1] as const).map(side => <group key={side}>
      <Box at={[side * 7.36, 1.18, 0]} size={[0.035, 2.35, 10.95]} color="#527297" opacity={0.19} />
      <Box at={[side * 7.4, 0.1, 0]} size={[0.05, 0.04, 10.95]} color="#5b9dff" emissive="#5b9dff" intensity={1.2} />
      <Box at={[side * 7.35, 2.35, 0]} size={[0.05, 0.04, 10.95]} color="#5b9dff" emissive="#5b9dff" intensity={0.55} />
    </group>)}
    {[-1, 1].map(side => <Box key={side} at={[0, 1.17, side * 5.5]} size={[14.8, 2.34, 0.03]} color="#617caa" opacity={side > 0 ? 0.075 : 0.2} />)}
    {([-1, 1] as const).flatMap(x => ([-1, 1] as const).map(z => <group key={`support-${x}-${z}`} position={[x * 7.05, 0, z * 5.17]}>
      <Box at={[0, 1.16, 0]} size={[0.22, 2.32, 0.22]} color="#273b54" metalness={0.82} />
      <Box at={[0, 0.23, 0]} size={[0.3, 0.06, 0.3]} color="#67b8f4" emissive="#4d9ef1" intensity={0.55} />
      <Box at={[0, 2.22, 0]} size={[0.3, 0.06, 0.3]} color="#74d8e8" emissive="#55c8ed" intensity={0.65} />
    </group>))}
    <group name="Stairway connecting the ground and upper levels">
      {Array.from({ length: 12 }, (_, index) => <group key={`step-${index}`} position={[2.22, 0.12 + index * 0.19, 1.55 - index * 0.2]}>
        <Box at={[0, 0, 0]} size={[0.9, 0.11, 0.3]} color="#405775" metalness={0.68} />
        <Box at={[0, 0.065, 0.105]} size={[0.82, 0.018, 0.025]} color="#6bdaf2" emissive="#51c9ef" intensity={0.8} />
      </group>)}
      <Box at={[1.72, 1.22, 0.42]} size={[0.045, 2.28, 0.05]} color="#6184a4" metalness={0.82} />
      <Box at={[2.72, 1.22, 0.42]} size={[0.045, 2.28, 0.05]} color="#6184a4" metalness={0.82} />
    </group>
    {ROOMS.map(room => <RoomModule key={room.id} room={room} agents={byArea.get(room.id) ?? []} selectedAgentId={selectedAgentId} onSelectAgent={onSelectAgent} onOpenRoom={onOpenRoom} />)}
    {[-1, 1].map(side => <group key={side}>
      <Box at={[side * 2.15, 2.43, -0.88]} size={[0.88, 0.12, 2.45]} color="#344a66" metalness={0.7} />
      <Box at={[side * 2.15, 2.5, -0.88]} size={[0.75, 0.025, 2.32]} color="#83b4e3" emissive="#5293e5" intensity={0.26} opacity={0.52} />
      <Box at={[side * 2.15, 2.38, 0.4]} size={[0.88, 0.035, 0.04]} color="#63d1f2" emissive="#63d1f2" intensity={1.2} />
    </group>)}
    <Nexus agents={byArea.get('command_center') ?? []} selectedAgentId={selectedAgentId} onSelectAgent={onSelectAgent} onOpenRoom={onOpenRoom} reducedMotion={reducedMotion} />
    {communications.map((message) => <CommunicationPulse key={message.id} start={message.start} end={message.end} reducedMotion={reducedMotion} />)}
    <OrbitControls makeDefault enablePan={false} enableDamping dampingFactor={0.08} minDistance={10} maxDistance={27} minPolarAngle={0.42} maxPolarAngle={1.28} target={[0, 2.1, 0]} />
  </>;
}

function HQFallback({ agents, onSelectAgent, onOpenRoom }: Pick<LivingHQSceneProps, 'agents' | 'onSelectAgent' | 'onOpenRoom'>) {
  return <div style={{ height: '100%', minHeight: 320, overflow: 'auto', padding: 22, color: '#d5ebff', background: 'radial-gradient(circle at 50% 28%, #183054, #070d1a 75%)' }}>
    <p style={{ fontSize: 11, letterSpacing: '.16em', color: '#75dce8' }}>HEADQUARTERS · OPERATIONS</p>
    <h3 style={{ margin: '8px 0 18px' }}>Living HQ</h3>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
      {[{ title: 'CENTRAL NEXUS', destination: 'main', id: 'command_center' }, ...ROOMS].map(room => <div key={room.id} style={{ padding: 13, border: '1px solid #335278', borderRadius: 10, background: '#102035' }}>
        <button type="button" onClick={() => onOpenRoom(room.destination)} style={{ color: '#d7f4ff', background: 'none', border: 0, padding: 0, cursor: 'pointer', fontWeight: 700 }}>{room.title} ↗</button>
        <p style={{ fontSize: 11, color: '#87a8c2' }}>{agents.filter(agent => agent.area === room.id).length} deployed</p>
        {agents.filter(agent => agent.area === room.id).map(agent => <button key={agent.id} type="button" onClick={() => onSelectAgent(agent.id)} style={{ display: 'block', marginTop: 6, color: statusColor(agent.status), background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }}>{agent.name} · {agent.status.replaceAll('_', ' ')}</button>)}
      </div>)}
    </div>
  </div>;
}

export function LivingHQScene({ agents, messages = [], onSelectAgent, onOpenRoom, selectedAgentId, height = '100%' }: LivingHQSceneProps) {
  const [webgl] = useState(canRenderWebGL);
  const [reducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const fallback = <HQFallback agents={agents} onSelectAgent={onSelectAgent} onOpenRoom={onOpenRoom} />;
  return <div style={{ height, width: '100%', minHeight: 320, position: 'relative', overflow: 'hidden', background: '#060b17' }} aria-label="Interactive 3D headquarters">
    {webgl ? <WebGLBoundary fallback={fallback}><Canvas camera={{ position: [13, 10.2, 15], fov: 43, near: 0.1, far: 70 }} dpr={[1, 1.6]} gl={{ antialias: true, powerPreference: 'high-performance' }} shadows={false} frameloop={reducedMotion ? 'demand' : 'always'}>
      <HQWorld agents={agents} messages={messages} selectedAgentId={selectedAgentId} onSelectAgent={onSelectAgent} onOpenRoom={onOpenRoom} reducedMotion={reducedMotion} />
    </Canvas></WebGLBoundary> : fallback}
    {webgl && <nav className="tj-hq-room-rail" aria-label="Open a headquarters area">{ROOM_LINKS.map(room => <button key={room.destination} type="button" onClick={() => onOpenRoom(room.destination)}>{room.label}</button>)}</nav>}
  </div>;
}
