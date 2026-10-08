import React, { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { apiFetch } from '../api';
import { AgentTown } from './AgentTown';
import type { TownAgent, AgentStatus } from '@tj/schemas';
import { planTownPath } from './town-navigation';
import { WebGLBoundary, canRenderWebGL } from './WebGLBoundary';

const BUILDINGS = [
  { id: 'command_center', name: 'COMMAND', x: 0, z: 0, color: '#3197bf' },
  { id: 'research_lab', name: 'RESEARCH', x: -4.5, z: -2.5, color: '#5f7bd9' },
  { id: 'dev_studio', name: 'DEV STUDIO', x: 4.5, z: -2.5, color: '#3cbbac' },
  { id: 'meeting_hall', name: 'COUNCIL', x: 0, z: -4.5, color: '#bd8b50' },
  { id: 'creative_studio', name: 'CREATIVE', x: -4.5, z: 2.5, color: '#a76bd4' },
  { id: 'operations', name: 'OPERATIONS', x: 4.5, z: 2.5, color: '#bb6d72' },
];
const active = (status: AgentStatus) => ['thinking', 'working', 'waiting_approval', 'meeting'].includes(status);
const statusColor = (status: AgentStatus) => status === 'failed' || status === 'blocked' ? '#ff6f85' : active(status) ? '#7de6d2' : '#7c9cb2';

function Structure({ x, z, color, name }: { x: number; z: number; color: string; name: string }) {
  return <group position={[x, 0, z]}>
    <mesh position={[0, 0.37, 0]}><boxGeometry args={[2.9, 0.72, 1.8]} /><meshStandardMaterial color="#162e45" metalness={0.5} roughness={0.5} /></mesh>
    <mesh position={[0, 0.77, 0]}><boxGeometry args={[3, 0.09, 1.9]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} metalness={0.8} /></mesh>
    <mesh position={[0, 0.42, 0.93]}><boxGeometry args={[2.45, 0.35, 0.025]} /><meshBasicMaterial color={color} transparent opacity={0.28} /></mesh>
    <mesh position={[0, 0.03, 1.6]}><boxGeometry args={[2.5, 0.05, 1.25]} /><meshStandardMaterial color="#11253a" metalness={0.45} roughness={0.6} /></mesh>
    {[-0.78, 0, 0.78].map((offset) => <mesh key={offset} position={[offset, 0.09, 1.44]}><boxGeometry args={[0.57, 0.09, 0.42]} /><meshStandardMaterial color="#5798b6" emissive={color} emissiveIntensity={0.16} /></mesh>)}
    <Html position={[0, 1.08, 0]} center distanceFactor={12} style={{ pointerEvents: 'none', whiteSpace: 'nowrap', color: '#bde6f5', font: '700 8px JetBrains Mono', letterSpacing: '.12em', textShadow: '0 0 8px #071321' }}>{name}</Html>
  </group>;
}

function AgentFigure({ agent, select }: { agent: TownAgent; select: (id: string) => void }) {
  const ref = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const initial = useRef<[number, number, number]>([agent.x, 0, agent.z]);
  const route = useRef<Array<[number, number]>>([]);
  const stride = useRef(0);
  useEffect(() => {
    if (!ref.current) return;
    route.current = planTownPath([ref.current.position.x, ref.current.position.z], [agent.x, agent.z]);
  }, [agent.x, agent.z]);
  useFrame((_, delta) => {
    if (!ref.current || !body.current) return;
    if (route.current.length) {
      const [x, z] = route.current[0];
      const waypoint = new THREE.Vector3(x, 0, z);
      const distance = ref.current.position.distanceTo(waypoint);
      if (distance < 0.035) route.current.shift();
      else {
        const heading = waypoint.sub(ref.current.position).normalize();
        ref.current.rotation.y = Math.atan2(heading.x, heading.z);
        ref.current.position.addScaledVector(heading, Math.min(distance, delta * 2.2));
      }
    }
    const walking = route.current.length > 0;
    const seated = !walking && Boolean(agent.workstation_id) && active(agent.status) && agent.status !== 'meeting';
    stride.current += walking ? delta * 11 : 0;
    body.current.position.y = THREE.MathUtils.damp(body.current.position.y, seated ? -0.12 : walking ? Math.abs(Math.sin(stride.current)) * 0.035 : 0, 12, delta);
    if (leftLeg.current && rightLeg.current) {
      const swing = walking ? Math.sin(stride.current) * 0.5 : seated ? -1.1 : 0;
      leftLeg.current.rotation.x = THREE.MathUtils.damp(leftLeg.current.rotation.x, swing, 12, delta);
      rightLeg.current.rotation.x = THREE.MathUtils.damp(rightLeg.current.rotation.x, walking ? -swing : seated ? -1.1 : 0, 12, delta);
    }
  });
  return <group ref={ref} position={initial.current} scale={1.45} onClick={(e) => { e.stopPropagation(); select(agent.id); }}>
    <group ref={body}>
      <mesh position={[0, 0.25, 0]}><cylinderGeometry args={[0.12, 0.16, 0.26, 12]} /><meshStandardMaterial color="#6d91a6" metalness={0.65} /></mesh>
      <mesh position={[0, 0.48, 0]}><sphereGeometry args={[0.16, 16, 12]} /><meshStandardMaterial color="#b9d7e4" metalness={0.48} /></mesh>
      <mesh position={[0, 0.69, 0]}><sphereGeometry args={[0.055, 12, 8]} /><meshBasicMaterial color={statusColor(agent.status)} /></mesh>
      {([-1, 1] as const).map((side) => <group key={side} ref={side === -1 ? leftLeg : rightLeg} position={[side * 0.07, 0.13, 0]}><mesh position={[0, -0.07, 0]}><capsuleGeometry args={[0.035, 0.13, 4, 8]} /><meshStandardMaterial color="#5a8197" /></mesh></group>)}
    </group>
  </group>;
}

function TownWorld({ agents, select }: { agents: TownAgent[]; select: (id: string) => void }) {
  return <>
    <color attach="background" args={['#071321']} />
    <ambientLight intensity={1.3} /><directionalLight position={[3, 9, 5]} intensity={2.2} color="#b9eaff" /><pointLight position={[0, 4, 0]} intensity={30} color="#1979ac" distance={15} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]}><planeGeometry args={[18, 15]} /><meshStandardMaterial color="#0b1e31" roughness={0.9} /></mesh>
    <gridHelper args={[18, 18, '#36637c', '#1a3448']} position={[0, -0.04, 0]} />
    {BUILDINGS.map((building) => <Structure key={building.id} {...building} />)}
    {agents.map((agent) => <AgentFigure key={agent.id} agent={agent} select={select} />)}
    <OrbitControls enablePan={false} minDistance={7} maxDistance={20} maxPolarAngle={1.3} minPolarAngle={0.45} target={[0, 0, -0.3]} />
  </>;
}

export const AgentTown3D: React.FC<{ onSelectAgent: (id: string) => void }> = ({ onSelectAgent }) => {
  const [webgl] = useState(canRenderWebGL);
  const [mode, setMode] = useState<'town' | 'operations' | 'list'>(webgl ? 'town' : 'list');
  const [agents, setAgents] = useState<TownAgent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => apiFetch<{ agents: TownAgent[] }>('/api/v1/town/state').then((r) => { if (alive) setAgents(r.agents ?? []); }).catch(() => {});
    load();
    const timer = setInterval(load, 15000);
    const stream = new EventSource('/api/v1/system/events');
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    for (const name of ['agent.created', 'agent.updated', 'agent.deleted', 'agent.started', 'agent.completed', 'agent.failed', 'task.started', 'task.completed', 'system.stop_all']) stream.addEventListener(name, load);
    return () => { alive = false; clearInterval(timer); stream.close(); };
  }, []);
  const chosen = agents.find((a) => a.id === selected);
  return <section className="glass-panel" style={{ overflow: 'hidden', minHeight: 344 }}>
    <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><div><b style={{ fontSize: 12, letterSpacing: '.11em' }}>AGENT TOWN</b><span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 9 }}>{agents.length} deployed · {agents.filter((a) => active(a.status)).length} active · {connected ? 'live' : 'refreshing'}</span></div><div style={{ display: 'flex', gap: 4 }}>{(['town', 'operations', 'list'] as const).map((view) => <button key={view} disabled={view === 'town' && !webgl} title={view === 'town' && !webgl ? 'WebGL unavailable' : undefined} onClick={() => setMode(view)} style={{ fontSize: 10, padding: '5px 9px', cursor: 'pointer', border: '1px solid var(--border-subtle)', borderRadius: 4, color: mode === view ? 'var(--accent-cyan)' : 'var(--text-muted)', background: mode === view ? 'var(--accent-cyan-dim)' : 'transparent' }}>{view === 'town' ? '3D TOWN' : view === 'operations' ? 'OPERATIONS' : 'AGENT LIST'}</button>)}</div></div>
    {mode === 'town' ? <><div style={{ height: 280, position: 'relative' }}><WebGLBoundary fallback={<AgentTown onSelectAgent={onSelectAgent} onBrowseAgents={() => onSelectAgent('')} />}><Canvas camera={{ position: [7, 8, 9], fov: 45 }} dpr={[1, 1.5]} gl={{ powerPreference: 'low-power' }}><TownWorld agents={agents} select={setSelected} /></Canvas></WebGLBoundary>{agents.length === 0 && <div style={{ position: 'absolute', left: 14, bottom: 12, color: '#a1bed0', fontSize: 11, background: 'rgba(5,16,27,.8)', padding: '7px 10px' }}>No agents deployed yet. Create an agent to see it here.</div>}</div><div style={{ minHeight: 36, padding: '8px 14px', borderTop: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: 11 }}>{chosen ? <><b style={{ color: '#eaf9ff' }}>{chosen.name}</b> · {chosen.status} · {chosen.area.replaceAll('_', ' ')}{chosen.task_id && <> · task {chosen.task_id.slice(0, 8)}</>}{chosen.workstation_id && <> · {chosen.workstation_id.split(':').at(-1)} reserved</>} <button onClick={() => onSelectAgent(chosen.id)} style={{ border: 0, color: 'var(--accent-cyan)', background: 'none', cursor: 'pointer' }}>Details →</button></> : 'Drag to explore · select a deployed agent for real status'}</div></> : mode === 'operations' ? <div style={{ minHeight: 305, maxHeight: 340, overflowY: 'auto', padding: 14 }}><div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 11, color: 'var(--text-muted)' }}><span>{agents.filter((a) => a.workstation_id).length} desks reserved</span><span>{agents.filter((a) => a.task_id).length} linked tasks</span></div>{agents.length === 0 ? <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No agents deployed.</p> : agents.map((agent) => <button key={agent.id} onClick={() => { setSelected(agent.id); onSelectAgent(agent.id); }} style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', gap: 9, alignItems: 'center', color: 'var(--text-main)', background: 'rgba(13,35,55,.55)', border: '1px solid var(--border-subtle)', borderRadius: 5, padding: 9, marginBottom: 6, cursor: 'pointer', fontSize: 11 }}><span><b>{agent.name}</b><small style={{ display: 'block', color: 'var(--text-muted)', marginTop: 3 }}>{agent.area.replaceAll('_', ' ')}{agent.task_id ? ` · ${agent.task_id.slice(0, 8)}` : ''}</small></span><span style={{ color: statusColor(agent.status), whiteSpace: 'nowrap' }}>{agent.status.replaceAll('_', ' ')}</span></button>)}</div> : <AgentTown onSelectAgent={onSelectAgent} onBrowseAgents={() => onSelectAgent('')} />}
  </section>;
};
