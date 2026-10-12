import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { TownAgent } from '@tj/schemas';
import { canRenderWebGL } from './WebGLBoundary';

export interface AgentSoul {
  id: string;
  name: string;
  role: string;
  gender: 'male' | 'female';
  personality: string;
  energy: number; // 0 - 100
  status: 'idle' | 'working' | 'resting' | 'collaborating' | 'transit';
  currentTask?: string | null;
  taskId?: string | null;
  currentThought: string;
  workstationPos: [number, number, number];
  restPos: [number, number, number];
  assignedRoom: string;
  jacketColor: string;
  hairColor: string;
  skinColor: string;
}

export interface CustomRoom {
  id: string;
  name: string;
  theme: 'research' | 'command' | 'quantum' | 'data' | 'cybernetics' | 'lounge';
  bay: 'ground_right' | 'mezzanine_right' | 'observation_high' | 'extended_left';
  position: [number, number, number];
  accentColor: string;
  assignedAgentIds: string[];
}

export interface LivingHQSceneProps {
  agents?: TownAgent[];
  messages?: any[];
  agentSouls?: AgentSoul[];
  customRooms?: CustomRoom[];
  onSelectAgent: (id: string, name: string) => void;
  onOpenRoom: (destination: string) => void;
  onOpenAgentSoul?: (soul: AgentSoul) => void;
  selectedAgentId?: string | null;
  height?: number | string;
  focusTarget?: [number, number, number] | null;
  dayNightMode?: 'day' | 'night' | 'auto';
  timeOfDay?: number; // 0 to 24
  onToggleDayNight?: () => void;
  onTimeOfDayChange?: (hour: number) => void;
}

// --------------------------------------------------------------------------
// REUSABLE 3D BOX & SCENE HELPERS
// --------------------------------------------------------------------------
function Box({
  at,
  size,
  color,
  emissive,
  emissiveIntensity = 0,
  opacity = 1,
  metalness = 0.5,
  roughness = 0.4,
}: {
  at: [number, number, number];
  size: [number, number, number];
  color: string;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  metalness?: number;
  roughness?: number;
}) {
  return (
    <mesh position={at} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        emissive={emissive ?? color}
        emissiveIntensity={emissiveIntensity}
        transparent={opacity < 1}
        opacity={opacity}
        metalness={metalness}
        roughness={roughness}
        depthWrite={opacity === 1}
      />
    </mesh>
  );
}

// --------------------------------------------------------------------------
// CAMERA CONTROLLER WITH SMOOTH INTERPOLATION
// --------------------------------------------------------------------------
function CameraRig({
  focusPosition,
  controlsRef,
}: {
  focusPosition: [number, number, number] | null;
  controlsRef: React.RefObject<any>;
}) {
  const { camera } = useThree();

  useFrame(() => {
    if (controlsRef.current && focusPosition) {
      const targetCam = new THREE.Vector3(
        focusPosition[0] + 2.5,
        focusPosition[1] + 2.2,
        focusPosition[2] + 3.8
      );
      const targetLook = new THREE.Vector3(
        focusPosition[0],
        focusPosition[1] + 0.9,
        focusPosition[2]
      );

      camera.position.lerp(targetCam, 0.055);
      controlsRef.current.target.lerp(targetLook, 0.055);
      controlsRef.current.update();
    }
  });

  return null;
}

// --------------------------------------------------------------------------
// DAY / NIGHT LIGHTING & SKY ENVIRONMENT
// --------------------------------------------------------------------------
function DayNightEnvironment({
  dayNightMode = 'night',
  timeOfDay = 23,
  onTimeOfDayChange,
}: {
  dayNightMode: 'day' | 'night' | 'auto';
  timeOfDay: number;
  onTimeOfDayChange?: (h: number) => void;
}) {
  const [internalTime, setInternalTime] = useState(timeOfDay);
  const sunLight = useRef<THREE.DirectionalLight>(null);
  const starsGroup = useRef<THREE.Group>(null);

  // Auto Day/Night Cycle (Smooth progression: full 24h day in ~90s)
  useFrame((_, delta) => {
    if (dayNightMode === 'auto') {
      const nextTime = (internalTime + delta * 0.28) % 24;
      setInternalTime(nextTime);
      onTimeOfDayChange?.(nextTime);
    } else {
      const target = dayNightMode === 'day' ? 12 : 23;
      if (Math.abs(internalTime - target) > 0.05) {
        setInternalTime((prev) => THREE.MathUtils.lerp(prev, target, 0.06));
      }
    }

    if (starsGroup.current) {
      starsGroup.current.rotation.y += delta * 0.005;
    }
  });

  const h = internalTime;
  // Calculate lighting parameters based on hour
  // 6 - 8 Dawn, 8 - 17 Day, 17 - 19 Sunset, 19 - 6 Night
  const isNight = h < 5.5 || h > 19.5;
  const isSunset = h >= 17 && h <= 19.5;
  const isDawn = h >= 5.5 && h < 8;

  // Sun orbit coordinates
  const sunAngle = (h / 24) * Math.PI * 2 - Math.PI / 2;
  const sunX = Math.cos(sunAngle) * 32;
  const sunY = Math.sin(sunAngle) * 24;
  const sunZ = Math.cos(sunAngle * 0.6) * 18;

  // Sun Color & Intensity
  let sunColor = '#fff6e2';
  let sunIntensity = 2.6;
  let ambientColor = '#adcdeb';
  let ambientIntensity = 1.4;
  let bgColor = '#18314f';
  let fogColor = '#152b45';

  if (isNight) {
    sunColor = '#4e75a3';
    sunIntensity = 0.45;
    ambientColor = '#132135';
    ambientIntensity = 0.65;
    bgColor = '#030712';
    fogColor = '#030712';
  } else if (isSunset) {
    sunColor = '#ff7b42';
    sunIntensity = 2.0;
    ambientColor = '#d97b6a';
    ambientIntensity = 1.2;
    bgColor = '#381628';
    fogColor = '#301323';
  } else if (isDawn) {
    sunColor = '#ffad7a';
    sunIntensity = 1.8;
    ambientColor = '#9e7bbd';
    ambientIntensity = 1.1;
    bgColor = '#231d3d';
    fogColor = '#1e1834';
  }

  // Precomputed 3D stars for night sky
  const stars = useMemo(() => {
    return Array.from({ length: 120 }).map((_, i) => ({
      pos: [
        (Math.sin(i * 9.1) * 38) + (Math.cos(i * 3.3) * 10),
        16 + Math.abs(Math.sin(i * 4.7)) * 22,
        (Math.cos(i * 7.7) * 38) + (Math.sin(i * 2.1) * 10),
      ] as [number, number, number],
      size: 0.08 + (i % 3) * 0.04,
      color: i % 4 === 0 ? '#00f2fe' : i % 5 === 0 ? '#ffea79' : '#ffffff',
    }));
  }, []);

  return (
    <>
      <color attach="background" args={[bgColor]} />
      <fog attach="fog" args={[fogColor, 22, 60]} />

      <ambientLight intensity={ambientIntensity} color={ambientColor} />

      {/* Primary Directional Sunlight / Moonlight */}
      <directionalLight
        ref={sunLight}
        position={[sunX, Math.max(sunY, -4), sunZ]}
        intensity={sunIntensity}
        color={sunColor}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />

      {/* Cyber Blue Fill Rim Light */}
      <directionalLight
        position={[-18, 14, -14]}
        intensity={isNight ? 0.9 : 0.6}
        color={isNight ? '#00f2fe' : '#73abff'}
      />

      {/* Twinkling Stars in Night Sky */}
      {isNight && (
        <group ref={starsGroup}>
          {stars.map((s, idx) => (
            <mesh key={`star-${idx}`} position={s.pos}>
              <sphereGeometry args={[s.size, 6, 6]} />
              <meshBasicMaterial color={s.color} />
            </mesh>
          ))}
        </group>
      )}

      {/* Distant Cyber City Skyline Surrounding Building */}
      <group position={[0, -2, 0]}>
        {Array.from({ length: 14 }).map((_, bi) => {
          const angle = (bi / 14) * Math.PI * 2;
          const dist = 28 + (bi % 3) * 4;
          const bx = Math.sin(angle) * dist;
          const bz = Math.cos(angle) * dist;
          const bHeight = 16 + (bi % 5) * 6;
          const buildingColor = isNight ? '#07101d' : '#1e334a';

          return (
            <group key={`bldg-${bi}`} position={[bx, bHeight / 2 - 2, bz]}>
              <mesh>
                <boxGeometry args={[6.5, bHeight, 6.5]} />
                <meshStandardMaterial
                  color={buildingColor}
                  metalness={0.8}
                  roughness={0.35}
                />
              </mesh>
              {/* Illuminated Windows & Beacon on Roof */}
              {isNight && (
                <>
                  <mesh position={[0, bHeight / 2 + 0.3, 0]}>
                    <cylinderGeometry args={[0.08, 0.08, 1.8, 8]} />
                    <meshBasicMaterial color={bi % 2 === 0 ? '#ff3b56' : '#00f2fe'} />
                  </mesh>
                  {/* Glowing Window Strips */}
                  {Array.from({ length: 4 }).map((_, wi) => (
                    <mesh key={wi} position={[0, wi * 3.5 - bHeight / 4, 3.28]}>
                      <planeGeometry args={[4.8, 0.4]} />
                      <meshBasicMaterial color={bi % 3 === 0 ? '#00f2fe' : '#ffd166'} />
                    </mesh>
                  ))}
                </>
              )}
            </group>
          );
        })}
      </group>
    </>
  );
}

// --------------------------------------------------------------------------
// REALISTIC 3D ANATOMICAL HUMAN AGENT (MALE & FEMALE PROPORTIONS + KINEMATICS)
// --------------------------------------------------------------------------
function RealisticHumanAgent({
  soul,
  selected,
  onSelect,
  onInspectSoul,
  speechText,
}: {
  soul: AgentSoul;
  selected: boolean;
  onSelect: (id: string, name: string) => void;
  onInspectSoul: (soul: AgentSoul) => void;
  speechText?: string;
}) {
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const leftUpperArm = useRef<THREE.Group>(null);
  const rightUpperArm = useRef<THREE.Group>(null);
  const leftForearm = useRef<THREE.Group>(null);
  const rightForearm = useRef<THREE.Group>(null);
  const leftThigh = useRef<THREE.Group>(null);
  const rightThigh = useRef<THREE.Group>(null);
  const leftCalf = useRef<THREE.Group>(null);
  const rightCalf = useRef<THREE.Group>(null);

  const seed = useMemo(
    () => soul.id.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0) * 0.17,
    [soul.id]
  );

  // Human Kinematics Animation Frame Loop
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed;
    if (!root.current) return;

    if (soul.status === 'working') {
      // PROPER SEATED HUMAN WORKING AT DESK
      root.current.position.set(
        soul.workstationPos[0],
        soul.workstationPos[1] - 0.22,
        soul.workstationPos[2]
      );
      root.current.rotation.y = 0;

      // Thighs horizontal forward
      if (leftThigh.current && rightThigh.current) {
        leftThigh.current.rotation.x = -Math.PI / 2 + 0.08;
        rightThigh.current.rotation.x = -Math.PI / 2 + 0.08;
      }
      // Knees bent downward 90 degrees
      if (leftCalf.current && rightCalf.current) {
        leftCalf.current.rotation.x = Math.PI / 2 - 0.12;
        rightCalf.current.rotation.x = Math.PI / 2 - 0.12;
      }

      // Natural typing on keyboard & terminal
      if (leftUpperArm.current && rightUpperArm.current) {
        leftUpperArm.current.rotation.x = -1.15 + Math.sin(t * 3.8) * 0.08;
        leftUpperArm.current.rotation.y = 0.2 + Math.cos(t * 2.2) * 0.05;
        rightUpperArm.current.rotation.x = -1.2 + Math.cos(t * 4.2) * 0.09;
        rightUpperArm.current.rotation.y = -0.22 + Math.sin(t * 2.4) * 0.06;
      }
      if (leftForearm.current && rightForearm.current) {
        leftForearm.current.rotation.x = -0.3 + Math.sin(t * 5.5) * 0.1;
        rightForearm.current.rotation.x = -0.3 + Math.cos(t * 5.8) * 0.1;
      }

      // Head scanning screens
      if (head.current) {
        head.current.rotation.y = Math.sin(t * 0.75) * 0.25;
        head.current.rotation.x = -0.12 + Math.sin(t * 1.4) * 0.06;
      }
    } else if (soul.status === 'transit') {
      // NATURAL HUMAN WALKING GAIT
      const walkCycle = Math.sin(t * 3.6);
      const walkProgress = (Math.sin(t * 0.5) + 1) / 2;

      const targetX = THREE.MathUtils.lerp(soul.restPos[0], soul.workstationPos[0], walkProgress);
      const targetZ = THREE.MathUtils.lerp(soul.restPos[2], soul.workstationPos[2], walkProgress);

      root.current.position.set(targetX, soul.restPos[1], targetZ);
      root.current.rotation.y = Math.cos(t * 0.5) >= 0 ? 0 : Math.PI;

      if (leftThigh.current && rightThigh.current) {
        leftThigh.current.rotation.x = walkCycle * 0.52;
        rightThigh.current.rotation.x = -walkCycle * 0.52;
      }
      if (leftCalf.current && rightCalf.current) {
        leftCalf.current.rotation.x = Math.max(0, -walkCycle * 0.65);
        rightCalf.current.rotation.x = Math.max(0, walkCycle * 0.65);
      }
      if (leftUpperArm.current && rightUpperArm.current) {
        leftUpperArm.current.rotation.x = -walkCycle * 0.45;
        rightUpperArm.current.rotation.x = walkCycle * 0.45;
      }
      if (head.current) {
        head.current.rotation.y = Math.sin(t * 1.8) * 0.06;
      }
    } else if (soul.status === 'collaborating') {
      // NATURAL COLLABORATIVE DIALOGUE GESTURES
      root.current.position.set(...soul.restPos);
      root.current.rotation.y = soul.gender === 'female' ? -1.3 : 1.7;

      if (leftThigh.current && rightThigh.current) {
        leftThigh.current.rotation.x = 0.04;
        rightThigh.current.rotation.x = -0.04;
      }
      if (leftCalf.current && rightCalf.current) {
        leftCalf.current.rotation.x = 0;
        rightCalf.current.rotation.x = 0;
      }

      const gesture = Math.sin(t * 2.2);
      if (rightUpperArm.current) {
        rightUpperArm.current.rotation.x = -0.7 + gesture * 0.28;
        rightUpperArm.current.rotation.z = -0.3 + Math.cos(t * 1.8) * 0.18;
      }
      if (leftUpperArm.current) {
        leftUpperArm.current.rotation.x = -0.35 + Math.sin(t * 1.4) * 0.12;
      }
      if (head.current) {
        head.current.rotation.y = Math.sin(t * 1.1) * 0.14;
        head.current.rotation.x = Math.sin(t * 2.2) * 0.08;
      }
    } else {
      // NATURAL HUMAN REST / IDLE RELAXATION
      root.current.position.set(...soul.restPos);
      root.current.rotation.y = Math.sin(seed) * 0.5;

      const breathe = Math.sin(t * 1.3) * 0.015;
      root.current.position.y = soul.restPos[1] + breathe;

      // Relaxed contrapposto standing posture
      if (leftThigh.current && rightThigh.current) {
        leftThigh.current.rotation.x = 0.06;
        leftThigh.current.rotation.z = -0.03;
        rightThigh.current.rotation.x = -0.02;
        rightThigh.current.rotation.z = 0.02;
      }
      if (leftCalf.current && rightCalf.current) {
        leftCalf.current.rotation.x = 0.03;
        rightCalf.current.rotation.x = 0.01;
      }
      if (leftUpperArm.current && rightUpperArm.current) {
        leftUpperArm.current.rotation.x = 0.05 + Math.sin(t * 1.1) * 0.03;
        leftUpperArm.current.rotation.z = -0.08;
        rightUpperArm.current.rotation.x = 0.05 + Math.cos(t * 1.2) * 0.03;
        rightUpperArm.current.rotation.z = 0.08;
      }
      if (leftForearm.current && rightForearm.current) {
        leftForearm.current.rotation.x = 0;
        rightForearm.current.rotation.x = 0;
      }
      if (head.current) {
        head.current.rotation.y = Math.sin(t * 0.6) * 0.12;
        head.current.rotation.x = 0.02;
      }
    }
  });

  const skin = soul.skinColor;
  const pants = '#162332';
  const boots = '#0d1520';

  const statusColor =
    soul.status === 'working'
      ? '#00f2fe'
      : soul.status === 'collaborating'
      ? '#c084fc'
      : soul.status === 'transit'
      ? '#f5a623'
      : '#4cd997';

  return (
    <group
      ref={root}
      position={soul.workstationPos}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(soul.id, soul.name);
        onInspectSoul(soul);
      }}
    >
      {/* 3D FLOATING HUD NAME & LIVE STATUS TAG */}
      <Html position={[0, 1.95, 0]} center distanceFactor={14}>
        <div
          onClick={(e) => {
            e.stopPropagation();
            onInspectSoul(soul);
          }}
          style={{
            cursor: 'pointer',
            background: 'rgba(5, 12, 22, 0.94)',
            border: `1px solid ${selected ? '#00f2fe' : statusColor}`,
            boxShadow: `0 0 10px ${statusColor}44`,
            borderRadius: 6,
            padding: '2px 8px',
            fontFamily: 'JetBrains Mono',
            fontSize: 9,
            fontWeight: 800,
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            whiteSpace: 'nowrap',
            transform: selected ? 'scale(1.1)' : 'scale(1)',
            transition: 'all 0.2s ease',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: statusColor,
              boxShadow: `0 0 6px ${statusColor}`,
            }}
          />
          <span style={{ letterSpacing: '0.06em' }}>{soul.name}</span>
          <span style={{ color: '#8da6bd', fontSize: 8 }}>|</span>
          <span style={{ color: statusColor, fontSize: 8 }}>{soul.status.toUpperCase()}</span>
        </div>
      </Html>

      {/* SPEECH BUBBLE (FOR COLLABORATION / DIALOGUE) */}
      {speechText && soul.status === 'collaborating' && (
        <Html position={[0, 2.3, 0]} center distanceFactor={13}>
          <div
            style={{
              background: 'rgba(8, 22, 38, 0.96)',
              border: '1px solid #00f2fe',
              boxShadow: '0 0 14px rgba(0, 242, 254, 0.4)',
              borderRadius: 8,
              padding: '4px 10px',
              fontFamily: 'Plus Jakarta Sans',
              fontSize: 10,
              color: '#dcf4ff',
              maxWidth: 180,
              textAlign: 'center',
            }}
          >
            "{speechText}"
          </div>
        </Html>
      )}

      {/* ANATOMICAL TORSO & TACTICAL CYBER SUIT */}
      <group position={[0, 1.05, 0]}>
        <mesh castShadow>
          <boxGeometry
            args={[
              soul.gender === 'male' ? 0.38 : 0.32,
              0.48,
              soul.gender === 'male' ? 0.22 : 0.18,
            ]}
          />
          <meshStandardMaterial color={soul.jacketColor} roughness={0.4} metalness={0.2} />
        </mesh>
        {/* Chest Tactical Harness */}
        <mesh position={[0, 0.06, 0.11]}>
          <boxGeometry args={[0.26, 0.28, 0.03]} />
          <meshStandardMaterial color="#1a2736" metalness={0.8} roughness={0.3} />
        </mesh>
        {/* Energy Core Beacon */}
        <mesh position={[0, 0.06, 0.13]}>
          <circleGeometry args={[0.04, 16]} />
          <meshBasicMaterial color={statusColor} />
        </mesh>
      </group>

      {/* PELVIS & UTILITY BELT */}
      <group position={[0, 0.8, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.32, 0.15, 0.2]} />
          <meshStandardMaterial color={pants} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.06, 0.11]}>
          <boxGeometry args={[0.34, 0.05, 0.04]} />
          <meshStandardMaterial color="#2d3f52" metalness={0.7} />
        </mesh>
      </group>

      {/* ANATOMICAL HEAD & HAIR */}
      <group ref={head} position={[0, 1.48, 0]}>
        {/* Neck */}
        <mesh position={[0, -0.1, 0]}>
          <cylinderGeometry args={[0.055, 0.065, 0.12, 12]} />
          <meshStandardMaterial color={skin} roughness={0.6} />
        </mesh>
        {/* Cranium & Face */}
        <mesh castShadow position={[0, 0.02, 0]}>
          <sphereGeometry args={[0.118, 18, 18]} />
          <meshStandardMaterial color={skin} roughness={0.55} />
        </mesh>
        {/* Jawline & Chin */}
        <mesh position={[0, -0.04, 0.05]}>
          <boxGeometry args={[0.09, 0.06, 0.08]} />
          <meshStandardMaterial color={skin} roughness={0.55} />
        </mesh>
        {/* Cyber Visor */}
        <mesh position={[0, 0.04, 0.11]}>
          <boxGeometry args={[0.13, 0.035, 0.03]} />
          <meshBasicMaterial color="#00f2fe" transparent opacity={0.65} />
        </mesh>

        {/* Realistic Styled 3D Hair */}
        {soul.gender === 'female' ? (
          <group position={[0, 0.06, -0.04]}>
            <mesh>
              <sphereGeometry args={[0.125, 16, 16]} />
              <meshStandardMaterial color={soul.hairColor} roughness={0.8} />
            </mesh>
            <mesh position={[0, -0.12, -0.12]} rotation={[0.4, 0, 0]}>
              <cylinderGeometry args={[0.035, 0.02, 0.28, 10]} />
              <meshStandardMaterial color={soul.hairColor} roughness={0.8} />
            </mesh>
          </group>
        ) : (
          <group position={[0, 0.08, -0.01]}>
            <mesh>
              <sphereGeometry args={[0.128, 16, 14]} />
              <meshStandardMaterial color={soul.hairColor} roughness={0.85} />
            </mesh>
            <mesh position={[0, 0.05, 0.03]}>
              <boxGeometry args={[0.12, 0.04, 0.12]} />
              <meshStandardMaterial color={soul.hairColor} roughness={0.85} />
            </mesh>
          </group>
        )}
      </group>

      {/* ARMS */}
      <group ref={leftUpperArm} position={[-0.23, 1.28, 0]}>
        <mesh position={[0, -0.14, 0]}>
          <cylinderGeometry args={[0.048, 0.042, 0.24, 10]} />
          <meshStandardMaterial color={soul.jacketColor} roughness={0.4} />
        </mesh>
        <group ref={leftForearm} position={[0, -0.28, 0]}>
          <mesh position={[0, -0.12, 0]}>
            <cylinderGeometry args={[0.042, 0.036, 0.22, 10]} />
            <meshStandardMaterial color="#162331" roughness={0.5} />
          </mesh>
          <mesh position={[0, -0.25, 0]}>
            <boxGeometry args={[0.048, 0.07, 0.06]} />
            <meshStandardMaterial color={skin} roughness={0.6} />
          </mesh>
        </group>
      </group>

      <group ref={rightUpperArm} position={[0.23, 1.28, 0]}>
        <mesh position={[0, -0.14, 0]}>
          <cylinderGeometry args={[0.048, 0.042, 0.24, 10]} />
          <meshStandardMaterial color={soul.jacketColor} roughness={0.4} />
        </mesh>
        <group ref={rightForearm} position={[0, -0.28, 0]}>
          <mesh position={[0, -0.12, 0]}>
            <cylinderGeometry args={[0.042, 0.036, 0.22, 10]} />
            <meshStandardMaterial color="#162331" roughness={0.5} />
          </mesh>
          <mesh position={[0, -0.25, 0]}>
            <boxGeometry args={[0.048, 0.07, 0.06]} />
            <meshStandardMaterial color={skin} roughness={0.6} />
          </mesh>
        </group>
      </group>

      {/* LEGS */}
      <group ref={leftThigh} position={[-0.1, 0.76, 0]}>
        <mesh position={[0, -0.18, 0]}>
          <cylinderGeometry args={[0.068, 0.058, 0.36, 10]} />
          <meshStandardMaterial color={pants} roughness={0.5} />
        </mesh>
        <group ref={leftCalf} position={[0, -0.38, 0]}>
          <mesh position={[0, -0.16, 0]}>
            <cylinderGeometry args={[0.055, 0.046, 0.34, 10]} />
            <meshStandardMaterial color={pants} roughness={0.5} />
          </mesh>
          <mesh position={[0, -0.35, 0.04]}>
            <boxGeometry args={[0.095, 0.11, 0.18]} />
            <meshStandardMaterial color={boots} roughness={0.4} />
          </mesh>
        </group>
      </group>

      <group ref={rightThigh} position={[0.1, 0.76, 0]}>
        <mesh position={[0, -0.18, 0]}>
          <cylinderGeometry args={[0.068, 0.058, 0.36, 10]} />
          <meshStandardMaterial color={pants} roughness={0.5} />
        </mesh>
        <group ref={rightCalf} position={[0, -0.38, 0]}>
          <mesh position={[0, -0.16, 0]}>
            <cylinderGeometry args={[0.055, 0.046, 0.34, 10]} />
            <meshStandardMaterial color={pants} roughness={0.5} />
          </mesh>
          <mesh position={[0, -0.35, 0.04]}>
            <boxGeometry args={[0.095, 0.11, 0.18]} />
            <meshStandardMaterial color={boots} roughness={0.4} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// --------------------------------------------------------------------------
// REUSABLE DEPARTMENT ROOM PLATFORM & HEADER TAG
// --------------------------------------------------------------------------
function DepartmentRoomFrame({
  name,
  code,
  accentColor,
  size,
  position,
  onClick,
  children,
}: {
  name: string;
  code: string;
  accentColor: string;
  size: [number, number, number];
  position: [number, number, number];
  onClick: () => void;
  children?: React.ReactNode;
}) {
  const [w, , d] = size;
  return (
    <group
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {/* Floor Platform Slab */}
      <Box at={[0, -0.06, 0]} size={[w, 0.12, d]} color="#0c1726" metalness={0.85} roughness={0.3} />

      {/* Neon Edge Boundaries */}
      <Box at={[0, 0, d / 2]} size={[w, 0.035, 0.035]} color={accentColor} emissive={accentColor} emissiveIntensity={0.9} />
      <Box at={[0, 0, -d / 2]} size={[w, 0.035, 0.035]} color={accentColor} emissive={accentColor} emissiveIntensity={0.9} />
      <Box at={[w / 2, 0, 0]} size={[0.035, 0.035, d]} color={accentColor} emissive={accentColor} emissiveIntensity={0.9} />
      <Box at={[-w / 2, 0, 0]} size={[0.035, 0.035, d]} color={accentColor} emissive={accentColor} emissiveIntensity={0.9} />

      {/* 3D Holographic Department Header Tag */}
      <Html position={[0, 2.7, -d / 2 + 0.2]} center distanceFactor={14}>
        <div
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          style={{
            cursor: 'pointer',
            background: 'rgba(6, 14, 25, 0.94)',
            border: `1px solid ${accentColor}`,
            boxShadow: `0 0 12px ${accentColor}44`,
            borderRadius: 6,
            padding: '3px 10px',
            fontFamily: 'JetBrains Mono',
            fontSize: 9,
            fontWeight: 800,
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: accentColor }}>[{code}]</span>
          <span>{name.toUpperCase()}</span>
        </div>
      </Html>

      {children}
    </group>
  );
}

// --------------------------------------------------------------------------
// 1. ANTIGRAVITY RESEARCH LAB (vision / research)
// --------------------------------------------------------------------------
function AntigravityLab({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const spheresGroup = useRef<THREE.Group>(null);
  const drone1 = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (spheresGroup.current) spheresGroup.current.rotation.y = t * 0.25;
    if (drone1.current) {
      drone1.current.position.y = 1.35 + Math.sin(t * 1.4) * 0.18;
      drone1.current.rotation.y = t * 0.6;
    }
  });

  return (
    <DepartmentRoomFrame
      name="Antigravity Research Lab"
      code="RES"
      accentColor="#00f2fe"
      size={[4.2, 0.12, 3.8]}
      position={[-7.5, 0, -2.5]}
      onClick={() => onOpenRoom('vision')}
    >
      {/* Zero-G Circular Emitter */}
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[1.6, 1.7, 0.08, 36]} />
        <meshStandardMaterial color="#122033" metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.085, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.3, 1.55, 36]} />
        <meshBasicMaterial color="#00f2fe" side={THREE.DoubleSide} />
      </mesh>

      {/* Floating Metallic Spheres */}
      <group ref={spheresGroup} position={[0, 1.1, 0]}>
        <mesh position={[0, 0.35, 0]}>
          <sphereGeometry args={[0.28, 24, 24]} />
          <meshStandardMaterial color="#c2dbee" metalness={0.96} roughness={0.06} />
        </mesh>
        <mesh position={[0.7, 0.1, 0.35]}>
          <sphereGeometry args={[0.18, 20, 20]} />
          <meshStandardMaterial color="#a7cbfa" metalness={0.95} roughness={0.08} />
        </mesh>
      </group>

      {/* Surveillance Drone */}
      <group ref={drone1} position={[-0.8, 1.35, 0.6]}>
        <mesh>
          <boxGeometry args={[0.2, 0.05, 0.2]} />
          <meshStandardMaterial color="#1a2b3d" metalness={0.8} />
        </mesh>
      </group>

      {/* Workstation Desk */}
      <Box at={[1.3, 0.42, 0.9]} size={[1.2, 0.08, 0.6]} color="#17283c" metalness={0.7} />
      <Box at={[1.3, 0.22, 1.3]} size={[0.38, 0.38, 0.38]} color="#1e3247" metalness={0.6} />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 2. BIOMETRICS & CYBERNETICS LAB (wellness)
// --------------------------------------------------------------------------
function BiometricsLab({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const robotArm = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (robotArm.current) robotArm.current.rotation.y = Math.sin(clock.elapsedTime * 1.5) * 0.35;
  });

  return (
    <DepartmentRoomFrame
      name="Biometrics & Cybernetics Lab"
      code="BIO"
      accentColor="#06b6d4"
      size={[4.2, 0.12, 3.8]}
      position={[-7.0, 0, 4.5]}
      onClick={() => onOpenRoom('wellness')}
    >
      {/* Robotic Arm Scanning Rig */}
      <Box at={[-0.9, 0.25, 0]} size={[0.8, 0.5, 0.8]} color="#162537" metalness={0.8} />
      <mesh position={[-0.9, 0.52, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.05, 24]} />
        <meshStandardMaterial color="#06b6d4" emissive="#06b6d4" emissiveIntensity={0.8} />
      </mesh>
      <group ref={robotArm} position={[-0.9, 0.55, -0.2]}>
        <mesh><sphereGeometry args={[0.08, 12, 12]} /><meshStandardMaterial color="#364e66" metalness={0.85} /></mesh>
        <mesh position={[0, 0.18, 0]}><cylinderGeometry args={[0.035, 0.035, 0.35, 10]} /><meshStandardMaterial color="#7f9db8" metalness={0.8} /></mesh>
      </group>

      {/* Dual Workstations */}
      <Box at={[0.8, 0.42, 0.5]} size={[1.4, 0.08, 0.6]} color="#17283c" metalness={0.7} />
      <Box at={[0.8, 0.22, 1.0]} size={[0.36, 0.38, 0.36]} color="#1e3247" metalness={0.6} />
      <Box at={[0.8, 0.72, 0.3]} size={[0.5, 0.28, 0.01]} color="#06b6d4" emissive="#06b6d4" emissiveIntensity={0.6} />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 3. SECURITY VAULT & CITADEL (approvals / security)
// --------------------------------------------------------------------------
function SecurityCitadel({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const lockGear = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (lockGear.current) lockGear.current.rotation.z = clock.elapsedTime * 0.3;
  });

  return (
    <DepartmentRoomFrame
      name="Security Vault & Approvals Citadel"
      code="SEC"
      accentColor="#ef4444"
      size={[3.8, 0.12, 3.6]}
      position={[-1.5, 0, -6.5]}
      onClick={() => onOpenRoom('approvals')}
    >
      {/* Reinforced Titanium Blast Door */}
      <Box at={[0, 1.2, -1.6]} size={[2.4, 2.2, 0.2]} color="#182333" metalness={0.9} roughness={0.2} />
      {/* Rotating Locking Gear */}
      <group ref={lockGear} position={[0, 1.2, -1.48]}>
        <mesh>
          <torusGeometry args={[0.42, 0.06, 12, 24]} />
          <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.8} />
        </mesh>
      </group>
      {/* Laser Barrier Threshold */}
      {[-0.8, -0.3, 0.2, 0.7].map((lx, li) => (
        <Box key={li} at={[lx, 0.4, 0.2]} size={[0.02, 0.8, 0.02]} color="#ef4444" emissive="#ef4444" emissiveIntensity={1.5} />
      ))}
      <Box at={[0, 0.42, 0.8]} size={[1.4, 0.08, 0.6]} color="#152436" metalness={0.7} />
      <Box at={[0, 0.22, 1.25]} size={[0.38, 0.38, 0.38]} color="#1c2d3f" metalness={0.6} />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 4. BUSINESS CRM & WAR ROOM (business)
// --------------------------------------------------------------------------
function BusinessWarRoom({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const funnel = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (funnel.current) funnel.current.rotation.y = clock.elapsedTime * 0.4;
  });

  return (
    <DepartmentRoomFrame
      name="Business CRM & War Room"
      code="CRM"
      accentColor="#3b82f6"
      size={[4.0, 0.12, 3.8]}
      position={[2.0, 0, 4.5]}
      onClick={() => onOpenRoom('business')}
    >
      {/* Hexagonal Conference Table */}
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[1.1, 1.1, 0.08, 6]} />
        <meshStandardMaterial color="#1a2b3e" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* 3D Holographic Deals Funnel */}
      <group ref={funnel} position={[0, 0.9, 0]}>
        <mesh rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.35, 0.5, 16, 1, true]} />
          <meshBasicMaterial color="#3b82f6" wireframe transparent opacity={0.7} />
        </mesh>
      </group>
      {/* Executive Seating */}
      {[-0.8, 0.8].map((sx, si) => (
        <Box key={si} at={[sx, 0.22, 0.9]} size={[0.38, 0.38, 0.38]} color="#172738" metalness={0.6} />
      ))}
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 5. KNOWLEDGE GRAPH & NEURAL NETWORK LAB (graph)
// --------------------------------------------------------------------------
function KnowledgeGraphLab({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const cluster = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (cluster.current) cluster.current.rotation.y = clock.elapsedTime * 0.3;
  });

  return (
    <DepartmentRoomFrame
      name="Knowledge Graph Lab"
      code="GRAPH"
      accentColor="#818cf8"
      size={[4.2, 0.12, 3.8]}
      position={[7.5, 0, 4.0]}
      onClick={() => onOpenRoom('graph')}
    >
      {/* 3D Floating Graph Constellation */}
      <group ref={cluster} position={[0, 1.2, -0.4]}>
        {[-0.6, 0.6, 0].map((gx, i) => (
          <mesh key={i} position={[gx, (i % 2) * 0.4 - 0.2, (i === 2 ? 0.5 : -0.2)]}>
            <sphereGeometry args={[0.12, 14, 14]} />
            <meshStandardMaterial color="#818cf8" emissive="#818cf8" emissiveIntensity={1.2} />
          </mesh>
        ))}
      </group>
      <Box at={[0, 0.42, 0.8]} size={[1.5, 0.08, 0.6]} color="#17283c" metalness={0.7} />
      <Box at={[0, 0.22, 1.25]} size={[0.38, 0.38, 0.38]} color="#1f344a" metalness={0.6} />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 6. PERSISTENT MEMORY & VECTOR VAULT (memory)
// --------------------------------------------------------------------------
function PersistentMemoryVault({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const beam = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (beam.current) beam.current.scale.y = 1 + Math.sin(clock.elapsedTime * 2.5) * 0.1;
  });

  return (
    <DepartmentRoomFrame
      name="Persistent Memory Vault"
      code="MEM"
      accentColor="#a855f7"
      size={[4.2, 0.12, 3.8]}
      position={[8.0, 0, -3.5]}
      onClick={() => onOpenRoom('memory')}
    >
      {/* Memory Crystal Towers */}
      {[-0.9, 0.9].map((mx, mi) => (
        <group key={mi} position={[mx, 0.9, -0.8]}>
          <Box at={[0, 0, 0]} size={[0.6, 1.8, 0.6]} color="#132030" metalness={0.85} />
          <mesh position={[0, 0.95, 0]}>
            <octahedronGeometry args={[0.22, 0]} />
            <meshStandardMaterial color="#a855f7" emissive="#a855f7" emissiveIntensity={1.5} />
          </mesh>
        </group>
      ))}
      <mesh ref={beam} position={[0, 1.0, -0.8]}>
        <cylinderGeometry args={[0.04, 0.04, 1.8, 12]} />
        <meshBasicMaterial color="#a855f7" transparent opacity={0.75} />
      </mesh>
      <Box at={[0, 0.42, 0.8]} size={[1.4, 0.08, 0.6]} color="#17283c" metalness={0.7} />
      <Box at={[0, 0.22, 1.25]} size={[0.38, 0.38, 0.38]} color="#1f344a" metalness={0.6} />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 7. MISSION CONTROL & COMMAND BRIDGE (tasks / command)
// --------------------------------------------------------------------------
function MissionControl({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const mapTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#05111f';
    ctx.fillRect(0, 0, 1024, 512);
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.18)';
    ctx.lineWidth = 1;
    for (let x = 0; x < 1024; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke(); }
    for (let y = 0; y < 512; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0, 242, 254, 0.35)';
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(280, 180, 110, 75, -0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(540, 170, 75, 55, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(740, 180, 130, 85, 0.1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  return (
    <DepartmentRoomFrame
      name="Mission Control Bridge"
      code="CMD"
      accentColor="#00f2fe"
      size={[5.2, 0.12, 4.0]}
      position={[0.0, 1.8, -5.5]}
      onClick={() => onOpenRoom('tasks')}
    >
      {/* Holographic Global World Map */}
      <mesh position={[0, 1.5, -1.8]}>
        <planeGeometry args={[4.4, 2.0]} />
        {mapTexture ? <meshBasicMaterial map={mapTexture} transparent opacity={0.9} /> : <meshBasicMaterial color="#00f2fe" transparent opacity={0.3} />}
      </mesh>
      <Box at={[0, 2.52, -1.79]} size={[4.46, 0.04, 0.04]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1} />

      {/* 3 Operator Battlestations */}
      {[-1.2, 0, 1.2].map((ox, oi) => (
        <group key={oi} position={[ox, 0, 0.5]}>
          <Box at={[0, 0.42, 0]} size={[1.0, 0.08, 0.6]} color="#17283c" metalness={0.7} />
          <Box at={[0, 0.22, 0.45]} size={[0.34, 0.38, 0.34]} color="#1e3247" metalness={0.6} />
          <Box at={[0, 0.72, -0.15]} size={[0.48, 0.26, 0.01]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={0.6} />
        </group>
      ))}
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 8. AI MODELS & NEURAL ENGINE BAY (models)
// --------------------------------------------------------------------------
function NeuralEngineBay({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const lattice = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (lattice.current) {
      lattice.current.rotation.y = clock.elapsedTime * 0.35;
      lattice.current.rotation.x = Math.sin(clock.elapsedTime * 0.5) * 0.15;
    }
  });

  return (
    <DepartmentRoomFrame
      name="AI Models & Neural Engine Bay"
      code="MODELS"
      accentColor="#c084fc"
      size={[4.4, 0.12, 3.8]}
      position={[6.0, 1.8, -4.8]}
      onClick={() => onOpenRoom('models')}
    >
      {/* 3D Floating Tensor Lattice */}
      <group ref={lattice} position={[0, 1.2, -0.5]}>
        <mesh>
          <octahedronGeometry args={[0.55, 1]} />
          <meshBasicMaterial color="#c084fc" wireframe transparent opacity={0.8} />
        </mesh>
      </group>
      {/* Model Provider Pedestals (Claude, GPT, Gemini) */}
      {[-1.0, 0, 1.0].map((px, pi) => (
        <Box key={pi} at={[px, 0.3, -1.2]} size={[0.4, 0.6, 0.4]} color="#162334" metalness={0.85} />
      ))}
      <Box at={[0, 0.42, 0.7]} size={[1.6, 0.08, 0.6]} color="#17283c" metalness={0.7} />
      <Box at={[0, 0.22, 1.15]} size={[0.38, 0.38, 0.38]} color="#1f344a" metalness={0.6} />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 9. WORKFLOWS & AUTOMATION ASSEMBLY FACTORY (workflows)
// --------------------------------------------------------------------------
function WorkflowsAssemblyFactory({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const conveyor = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (conveyor.current) conveyor.current.position.x = -0.5 + (clock.elapsedTime * 0.5) % 1.0;
  });

  return (
    <DepartmentRoomFrame
      name="Workflows & Automation Factory"
      code="FLOW"
      accentColor="#10b981"
      size={[4.4, 0.12, 3.8]}
      position={[8.0, 1.8, 0.5]}
      onClick={() => onOpenRoom('workflows')}
    >
      {/* Pipeline Stage Gates */}
      {[-1.1, -0.3, 0.5, 1.3].map((gx, gi) => (
        <group key={gi} position={[gx, 0.7, -0.8]}>
          <Box at={[0, 0, 0]} size={[0.1, 1.2, 0.6]} color="#132333" metalness={0.8} />
          <mesh position={[0, 0.4, 0]}>
            <torusGeometry args={[0.2, 0.02, 8, 16]} />
            <meshBasicMaterial color="#10b981" />
          </mesh>
        </group>
      ))}
      <Box at={[0, 0.42, 0.7]} size={[1.6, 0.08, 0.6]} color="#17283c" metalness={0.7} />
      <Box at={[0, 0.22, 1.15]} size={[0.38, 0.38, 0.38]} color="#1f344a" metalness={0.6} />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 10. DATA INTELLIGENCE & ANALYTICS BAY (data)
// --------------------------------------------------------------------------
function DataIntelligenceBay({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const globe = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (globe.current) globe.current.rotation.y = clock.elapsedTime * 0.4;
  });

  return (
    <DepartmentRoomFrame
      name="Data Intelligence & Analytics"
      code="DATA"
      accentColor="#f59e0b"
      size={[4.2, 0.12, 3.8]}
      position={[6.5, 1.8, 5.0]}
      onClick={() => onOpenRoom('data')}
    >
      {/* Holographic Rotating Data Globe */}
      <group ref={globe} position={[-0.8, 1.1, -0.6]}>
        <mesh>
          <sphereGeometry args={[0.45, 18, 18]} />
          <meshBasicMaterial color="#f59e0b" wireframe transparent opacity={0.75} />
        </mesh>
      </group>
      {/* 3D Vertical Bar Chart Pillars */}
      {[0.4, 0.8, 1.2].map((bx, bi) => (
        <Box key={bi} at={[bx, 0.3 + bi * 0.25, -0.6]} size={[0.25, 0.6 + bi * 0.5, 0.25]} color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.6} />
      ))}
      <Box at={[0, 0.42, 0.7]} size={[1.5, 0.08, 0.6]} color="#17283c" metalness={0.7} />
      <Box at={[0, 0.22, 1.15]} size={[0.38, 0.38, 0.38]} color="#1f344a" metalness={0.6} />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 11. FINANCE & ALGORITHMIC TRADING FLOOR (finance / paper)
// --------------------------------------------------------------------------
function TradingFloor({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const ticker = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ticker.current) ticker.current.position.x = -0.4 + Math.sin(clock.elapsedTime * 1.5) * 0.1;
  });

  return (
    <DepartmentRoomFrame
      name="Finance & Algorithmic Trading Floor"
      code="FIN"
      accentColor="#22c55e"
      size={[4.2, 0.12, 3.8]}
      position={[-5.5, 1.8, 4.8]}
      onClick={() => onOpenRoom('finance')}
    >
      {/* Holographic Candlestick Chart Display */}
      <group ref={ticker} position={[0, 1.2, -1.0]}>
        {[-0.8, -0.4, 0, 0.4, 0.8].map((cx, ci) => {
          const isGreen = ci % 2 === 0;
          return (
            <group key={ci} position={[cx, 0, 0]}>
              <Box at={[0, (ci % 3) * 0.15, 0]} size={[0.15, 0.3 + (ci % 2) * 0.2, 0.02]} color={isGreen ? '#22c55e' : '#ef4444'} emissive={isGreen ? '#22c55e' : '#ef4444'} emissiveIntensity={0.8} />
              <Box at={[0, (ci % 3) * 0.15, 0]} size={[0.02, 0.7, 0.01]} color={isGreen ? '#22c55e' : '#ef4444'} />
            </group>
          );
        })}
      </group>
      <Box at={[0, 0.42, 0.7]} size={[1.5, 0.08, 0.6]} color="#17283c" metalness={0.7} />
      <Box at={[0, 0.22, 1.15]} size={[0.38, 0.38, 0.38]} color="#1f344a" metalness={0.6} />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 12. MEDIA & CREATIVE PRODUCTION STUDIO (media)
// --------------------------------------------------------------------------
function MediaStudio({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  return (
    <DepartmentRoomFrame
      name="Media & Creative Production Studio"
      code="MEDIA"
      accentColor="#f43f5e"
      size={[4.2, 0.12, 3.8]}
      position={[-7.0, 1.8, 0.5]}
      onClick={() => onOpenRoom('media')}
    >
      {/* Floating Holographic Viewport Screen */}
      <Box at={[0, 1.25, -1.1]} size={[2.2, 1.2, 0.03]} color="#f43f5e" emissive="#f43f5e" emissiveIntensity={0.6} opacity={0.8} />
      {/* Audio Visualizer Spectrum Bars */}
      {[-0.8, -0.4, 0, 0.4, 0.8].map((vx, vi) => (
        <Box key={vi} at={[vx, 0.6 + (vi % 3) * 0.15, -0.8]} size={[0.08, 0.3 + (vi % 4) * 0.15, 0.02]} color="#f43f5e" emissive="#f43f5e" emissiveIntensity={1} />
      ))}
      <Box at={[0, 0.42, 0.7]} size={[1.5, 0.08, 0.6]} color="#17283c" metalness={0.7} />
      <Box at={[0, 0.22, 1.15]} size={[0.38, 0.38, 0.38]} color="#1f344a" metalness={0.6} />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 13. CONNECTORS & API WORKBENCH (connectors / workbench)
// --------------------------------------------------------------------------
function ConnectorsWorkbench({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  return (
    <DepartmentRoomFrame
      name="Connectors & API Workbench"
      code="API"
      accentColor="#f97316"
      size={[3.8, 0.12, 3.6]}
      position={[-2.5, 1.8, 0.0]}
      onClick={() => onOpenRoom('connectors')}
    >
      {/* Server Patch Rack & Fiber Trunks */}
      <Box at={[0, 1.1, -1.0]} size={[1.6, 1.8, 0.5]} color="#122030" metalness={0.85} />
      {[-0.5, 0, 0.5].map((px, pi) => (
        <Box key={pi} at={[px, 1.2, -0.73]} size={[0.25, 0.08, 0.02]} color="#f97316" emissive="#f97316" emissiveIntensity={1.2} />
      ))}
      <Box at={[0, 0.42, 0.7]} size={[1.4, 0.08, 0.6]} color="#17283c" metalness={0.7} />
      <Box at={[0, 0.22, 1.15]} size={[0.38, 0.38, 0.38]} color="#1f344a" metalness={0.6} />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 14. EDUCATION & SKILL ACADEMY (education / skills)
// --------------------------------------------------------------------------
function SkillAcademy({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const holoBook = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (holoBook.current) {
      holoBook.current.rotation.y = clock.elapsedTime * 0.4;
      holoBook.current.position.y = 1.1 + Math.sin(clock.elapsedTime * 1.5) * 0.08;
    }
  });

  return (
    <DepartmentRoomFrame
      name="Education & Skill Academy"
      code="SKILL"
      accentColor="#14b8a6"
      size={[4.2, 0.12, 3.8]}
      position={[-6.0, 3.6, -3.5]}
      onClick={() => onOpenRoom('skills')}
    >
      {/* Floating Holographic Knowledge Pyramid */}
      <group ref={holoBook} position={[0, 1.1, -0.6]}>
        <mesh>
          <tetrahedronGeometry args={[0.45, 0]} />
          <meshBasicMaterial color="#14b8a6" wireframe transparent opacity={0.8} />
        </mesh>
      </group>
      <Box at={[0, 0.42, 0.7]} size={[1.5, 0.08, 0.6]} color="#17283c" metalness={0.7} />
      <Box at={[0, 0.22, 1.15]} size={[0.38, 0.38, 0.38]} color="#1f344a" metalness={0.6} />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 15. QUANTUM COMPUTE HUB (agents)
// --------------------------------------------------------------------------
function QuantumComputeHub({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const rgbColors = ['#ff3b56', '#f5a623', '#2bd47d', '#2c7be5', '#00f2fe'];
  return (
    <DepartmentRoomFrame
      name="Quantum Compute Hub"
      code="QUANTUM"
      accentColor="#3b82f6"
      size={[4.4, 0.12, 3.8]}
      position={[-3.5, 3.6, -5.0]}
      onClick={() => onOpenRoom('agents')}
    >
      {/* 5 Glowing RGB Cryogenic Cooling Conduits */}
      {rgbColors.map((pipeColor, pi) => (
        <group key={pi} position={[-1.4 + pi * 0.35, 1.6, -1.0]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.05, 0.05, 0.7, 16]} />
            <meshStandardMaterial color={pipeColor} emissive={pipeColor} emissiveIntensity={1.8} />
          </mesh>
        </group>
      ))}
      <Box at={[0, 0.42, 0.7]} size={[1.6, 0.08, 0.6]} color="#17283c" metalness={0.7} />
      <Box at={[0, 0.22, 1.15]} size={[0.38, 0.38, 0.38]} color="#1f344a" metalness={0.6} />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 16. COMMUNICATIONS & LIVING PULSE TOWER (chat / conversations)
// --------------------------------------------------------------------------
function LivingPulseTower({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const wave = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (wave.current) {
      const scale = 1 + (clock.elapsedTime * 1.2) % 1.5;
      wave.current.scale.set(scale, 1, scale);
    }
  });

  return (
    <group
      position={[0.0, 4.6, 0.8]}
      onClick={(e) => {
        e.stopPropagation();
        onOpenRoom('chat');
      }}
    >
      <Box at={[0, 0.8, 0]} size={[0.2, 2.0, 0.2]} color="#1e344e" metalness={0.9} />
      {/* Pulsing Radio Wave Ring */}
      <group ref={wave} position={[0, 1.8, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.3, 0.4, 24]} />
        <meshBasicMaterial color="#38bdf8" side={THREE.DoubleSide} transparent opacity={0.65} />
      </group>
    </group>
  );
}

// --------------------------------------------------------------------------
// 17. INTELLIGENCE CORE QUANTUM REACTOR (Giant Wall Reactor)
// --------------------------------------------------------------------------
function QuantumReactor({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const ring1 = useRef<THREE.Group>(null);
  const ring2 = useRef<THREE.Group>(null);
  const corePlasma = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ring1.current) ring1.current.rotation.x = t * 0.8;
    if (ring2.current) ring2.current.rotation.y = t * 1.1;
    if (corePlasma.current) {
      const pulse = 1 + Math.sin(t * 3.5) * 0.12;
      corePlasma.current.scale.set(pulse, pulse, pulse);
    }
  });

  return (
    <group position={[11.5, 2.5, 0]} onClick={(e) => { e.stopPropagation(); onOpenRoom('command'); }}>
      <mesh position={[0, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[2.0, 0.26, 18, 48]} />
        <meshStandardMaterial color="#21354c" metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh position={[-0.05, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[1.7, 0.08, 16, 48]} />
        <meshBasicMaterial color="#00f2fe" />
      </mesh>
      <group ref={ring1} position={[-0.08, 0, 0]}>
        <mesh>
          <torusGeometry args={[1.25, 0.045, 12, 40]} />
          <meshStandardMaterial color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.4} />
        </mesh>
      </group>
      <group ref={ring2} position={[-0.08, 0, 0]}>
        <mesh>
          <torusGeometry args={[0.95, 0.04, 12, 40]} />
          <meshStandardMaterial color="#7f5af0" emissive="#7f5af0" emissiveIntensity={1.2} />
        </mesh>
      </group>
      <mesh ref={corePlasma} position={[-0.08, 0, 0]}>
        <sphereGeometry args={[0.35, 24, 24]} />
        <meshStandardMaterial color="#e0f8ff" emissive="#00f2fe" emissiveIntensity={3.0} />
      </mesh>
    </group>
  );
}

// --------------------------------------------------------------------------
// MULTI-TIER INDUSTRIAL ATRIUM ARCHITECTURE (CATWALKS & GLASS SKYLIGHT)
// --------------------------------------------------------------------------
function IndustrialAtrium() {
  return (
    <group>
      {/* Foundation Ground Slab */}
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <boxGeometry args={[26.0, 0.12, 20.0]} />
        <meshStandardMaterial color="#070e17" metalness={0.88} roughness={0.3} />
      </mesh>

      {/* Mezzanine Catwalk Deck (Tier 2, y=1.8) */}
      <group position={[0, 1.8, 0]}>
        {/* Longitudinal Walkways */}
        <Box at={[0, -0.06, 0.8]} size={[18.0, 0.12, 1.8]} color="#132336" metalness={0.8} />
        <Box at={[0, 0.45, 1.7]} size={[18.0, 0.04, 0.04]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={0.8} />
        <Box at={[0, 0.45, -0.1]} size={[18.0, 0.04, 0.04]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={0.8} />
      </group>

      {/* Upper Catwalk Deck (Tier 3, y=3.6) */}
      <group position={[-4.5, 3.6, -4.0]}>
        <Box at={[0, -0.06, 0]} size={[9.0, 0.12, 2.0]} color="#112032" metalness={0.8} />
        <Box at={[0, 0.45, 1.0]} size={[9.0, 0.04, 0.04]} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.8} />
      </group>

      {/* Industrial Access Stairs */}
      <group position={[-7.5, 0, 0.8]}>
        {Array.from({ length: 14 }).map((_, stepIdx) => (
          <group key={`st-${stepIdx}`} position={[0, 0.13 + stepIdx * 0.13, 1.8 - stepIdx * 0.2]}>
            <Box at={[0, 0, 0]} size={[1.2, 0.08, 0.28]} color="#182c40" metalness={0.7} />
            <Box at={[0, 0.045, 0.12]} size={[1.15, 0.015, 0.03]} color="#f5a623" emissive="#f5a623" emissiveIntensity={0.7} />
          </group>
        ))}
      </group>

      {/* Structural Glass Skylight Trusses Across Atrium Ceiling */}
      <group position={[0, 6.2, 0]}>
        {[-8, -4, 0, 4, 8].map((tx, ti) => (
          <group key={ti} position={[tx, 0, 0]}>
            <Box at={[0, 0, 0]} size={[0.3, 0.35, 19.5]} color="#1e344e" metalness={0.85} />
            {/* Semi-transparent Glass Roof Panels */}
            <Box at={[0, 0.18, 0]} size={[3.8, 0.04, 19.4]} color="#a0d2eb" opacity={0.25} metalness={0.2} roughness={0.1} />
          </group>
        ))}
      </group>
    </group>
  );
}

// --------------------------------------------------------------------------
// DYNAMIC CUSTOM USER EXPANSION ROOM
// --------------------------------------------------------------------------
function CustomRoomNode({
  room,
  onOpenRoom,
}: {
  room: CustomRoom;
  onOpenRoom: (dest: string) => void;
}) {
  return (
    <group
      position={room.position}
      onClick={(e) => {
        e.stopPropagation();
        onOpenRoom(room.id);
      }}
    >
      <Box at={[0, -0.06, 0]} size={[4.2, 0.12, 3.4]} color="#132337" metalness={0.8} />
      <Box at={[0, 0, 1.7]} size={[4.2, 0.04, 0.04]} color={room.accentColor} emissive={room.accentColor} emissiveIntensity={1} />
      <Box at={[0, 0, -1.7]} size={[4.2, 0.04, 0.04]} color={room.accentColor} emissive={room.accentColor} emissiveIntensity={1} />
      <Box at={[2.1, 0, 0]} size={[0.04, 0.04, 3.4]} color={room.accentColor} emissive={room.accentColor} emissiveIntensity={1} />
      <Box at={[-2.1, 0, 0]} size={[0.04, 0.04, 3.4]} color={room.accentColor} emissive={room.accentColor} emissiveIntensity={1} />

      <Html position={[0, 2.6, -1.58]} center distanceFactor={14}>
        <div style={{
          background: 'rgba(5, 12, 22, 0.92)',
          border: `1px solid ${room.accentColor}`,
          padding: '3px 10px',
          borderRadius: 6,
          fontFamily: 'JetBrains Mono',
          fontSize: 9,
          fontWeight: 800,
          color: '#ffffff',
          whiteSpace: 'nowrap',
          boxShadow: `0 0 12px ${room.accentColor}44`,
        }}>
          {room.name.toUpperCase()}
        </div>
      </Html>

      <Box at={[0, 0.42, 0.4]} size={[1.6, 0.08, 0.8]} color="#17283c" metalness={0.7} />
      <Box at={[0, 0.24, 0.95]} size={[0.4, 0.38, 0.4]} color="#1f344a" metalness={0.6} />
    </group>
  );
}

// --------------------------------------------------------------------------
// HQ WORLD SCENE COMPONENT
// --------------------------------------------------------------------------
function HQWorld({
  agentSouls = [],
  customRooms = [],
  selectedAgentId,
  onSelectAgent,
  onOpenRoom,
  onOpenAgentSoul,
  focusTarget,
  controlsRef,
  dayNightMode = 'night',
  timeOfDay = 23,
  onTimeOfDayChange,
}: {
  agentSouls: AgentSoul[];
  customRooms: CustomRoom[];
  selectedAgentId?: string | null;
  onSelectAgent: (id: string, name: string) => void;
  onOpenRoom: (dest: string) => void;
  onOpenAgentSoul: (soul: AgentSoul) => void;
  focusTarget: [number, number, number] | null;
  controlsRef: React.RefObject<any>;
  dayNightMode?: 'day' | 'night' | 'auto';
  timeOfDay?: number;
  onTimeOfDayChange?: (h: number) => void;
}) {
  const [speechIndex, setSpeechIndex] = useState(0);

  const dialoguePhrases = [
    'Neural state synchronized across 24 deployed agent nodes.',
    'Mission Control telemetry uplink operational.',
    'Anti-gravity field stable within 0.02G tolerance.',
    'Executing real-time task handoff from Orchestrator.',
    'Cryptographic security vault perimeter secured.',
    'Algorithmic trading engine latency measured at 0.4ms.',
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setSpeechIndex((prev) => (prev + 1) % dialoguePhrases.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [dialoguePhrases.length]);

  return (
    <>
      <DayNightEnvironment
        dayNightMode={dayNightMode}
        timeOfDay={timeOfDay}
        onTimeOfDayChange={onTimeOfDayChange}
      />

      <CameraRig focusPosition={focusTarget} controlsRef={controlsRef} />

      <IndustrialAtrium />

      {/* ALL 14 DEPARTMENT ROOMS */}
      <AntigravityLab onOpenRoom={onOpenRoom} />
      <BiometricsLab onOpenRoom={onOpenRoom} />
      <SecurityCitadel onOpenRoom={onOpenRoom} />
      <BusinessWarRoom onOpenRoom={onOpenRoom} />
      <KnowledgeGraphLab onOpenRoom={onOpenRoom} />
      <PersistentMemoryVault onOpenRoom={onOpenRoom} />
      <MissionControl onOpenRoom={onOpenRoom} />
      <NeuralEngineBay onOpenRoom={onOpenRoom} />
      <WorkflowsAssemblyFactory onOpenRoom={onOpenRoom} />
      <DataIntelligenceBay onOpenRoom={onOpenRoom} />
      <TradingFloor onOpenRoom={onOpenRoom} />
      <MediaStudio onOpenRoom={onOpenRoom} />
      <ConnectorsWorkbench onOpenRoom={onOpenRoom} />
      <SkillAcademy onOpenRoom={onOpenRoom} />
      <QuantumComputeHub onOpenRoom={onOpenRoom} />
      <LivingPulseTower onOpenRoom={onOpenRoom} />
      <QuantumReactor onOpenRoom={onOpenRoom} />

      {/* Render Dynamic Custom User Rooms */}
      {customRooms.map((room) => (
        <CustomRoomNode key={room.id} room={room} onOpenRoom={onOpenRoom} />
      ))}

      {/* Deploy All 24 Realistic Articulated Human Agents */}
      {agentSouls.map((soul, idx) => {
        const isSelected = selectedAgentId === soul.id;
        const speech = idx === 6 ? dialoguePhrases[speechIndex] : undefined;

        return (
          <RealisticHumanAgent
            key={soul.id}
            soul={soul}
            selected={isSelected}
            onSelect={onSelectAgent}
            onInspectSoul={onOpenAgentSoul}
            speechText={speech}
          />
        );
      })}

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan
        enableDamping
        dampingFactor={0.08}
        minDistance={5}
        maxDistance={38}
        minPolarAngle={0.2}
        maxPolarAngle={1.42}
        target={[0, 1.8, 0]}
      />
    </>
  );
}

// --------------------------------------------------------------------------
// EXPORTED LIVING HQ SCENE
// --------------------------------------------------------------------------
export function LivingHQScene({
  agentSouls = [],
  customRooms = [],
  onSelectAgent,
  onOpenRoom,
  onOpenAgentSoul = () => {},
  selectedAgentId,
  height = '100%',
  focusTarget = null,
  dayNightMode = 'night',
  timeOfDay = 23,
  onToggleDayNight,
  onTimeOfDayChange,
}: LivingHQSceneProps) {
  const [webgl] = useState(canRenderWebGL);
  const controlsRef = useRef<any>(null);

  if (!webgl) {
    return (
      <div style={{ height: '100%', padding: 24, color: '#00f2fe' }}>
        WebGL is not available on this browser session.
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height, position: 'relative', overflow: 'hidden' }}>
      <Canvas
        camera={{ position: [14.5, 13.0, 16.5], fov: 42, near: 0.1, far: 100 }}
        dpr={[1, 1.6]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <HQWorld
          agentSouls={agentSouls}
          customRooms={customRooms}
          selectedAgentId={selectedAgentId}
          onSelectAgent={onSelectAgent}
          onOpenRoom={onOpenRoom}
          onOpenAgentSoul={onOpenAgentSoul}
          focusTarget={focusTarget}
          controlsRef={controlsRef}
          dayNightMode={dayNightMode}
          timeOfDay={timeOfDay}
          onTimeOfDayChange={onTimeOfDayChange}
        />
      </Canvas>
    </div>
  );
}
