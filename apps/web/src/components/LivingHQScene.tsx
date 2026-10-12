import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { TownAgent } from '@tj/schemas';
import { canRenderWebGL, WebGLBoundary } from './WebGLBoundary';

export interface AgentSlotConfig {
  id: string;
  defaultName: string;
  gender: 'male' | 'female';
  hair: 'cropped' | 'ponytail' | 'bun';
  role: string;
  status: string;
  roomName: string;
  roomDestination: string;
  position: [number, number, number];
  rotationY: number;
  behavior: 'working' | 'transit' | 'collaborating';
  jacketColor: string;
  hairColor: string;
  isSitting?: boolean;
}

export const DEFAULT_AGENT_SLOTS: AgentSlotConfig[] = [
  {
    id: 'slot-1',
    defaultName: 'LEO',
    gender: 'male',
    hair: 'cropped',
    role: 'RESEARCH',
    status: 'TESTING',
    roomName: 'ANTIGRAVITY RESEARCH LAB',
    roomDestination: 'vision',
    position: [-4.6, 0, 0.4],
    rotationY: 0.8,
    behavior: 'working',
    jacketColor: '#2b3f54',
    hairColor: '#3a2e28',
  },
  {
    id: 'slot-2',
    defaultName: 'BEN',
    gender: 'male',
    hair: 'cropped',
    role: 'CYBERNETICS',
    status: 'CALIBRATION',
    roomName: 'BIOMETRICS & CYBERNETICS LAB',
    roomDestination: 'wellness',
    position: [-3.8, 0, 2.7],
    rotationY: 0.4,
    behavior: 'working',
    jacketColor: '#24374a',
    hairColor: '#2b231f',
  },
  {
    id: 'slot-3',
    defaultName: 'SAM',
    gender: 'male',
    hair: 'cropped',
    role: 'OPERATIONS',
    status: 'SYSTEM',
    roomName: 'BIOMETRICS & CYBERNETICS LAB',
    roomDestination: 'wellness',
    position: [-2.1, 0, 2.8],
    rotationY: 0,
    behavior: 'working',
    jacketColor: '#1c2e42',
    hairColor: '#1a1a1a',
    isSitting: true,
  },
  {
    id: 'slot-4',
    defaultName: 'MIA',
    gender: 'female',
    hair: 'bun',
    role: 'ANALYST',
    status: 'DATA',
    roomName: 'BIOMETRICS & CYBERNETICS LAB',
    roomDestination: 'wellness',
    position: [-1.0, 0, 2.6],
    rotationY: -0.6,
    behavior: 'working',
    jacketColor: '#384d63',
    hairColor: '#4a2e1d',
  },
  {
    id: 'slot-5',
    defaultName: 'JACS',
    gender: 'male',
    hair: 'cropped',
    role: 'SECURITY',
    status: 'RESEARCH',
    roomName: 'CATWALK BRIDGE',
    roomDestination: 'workflows',
    position: [0.3, 1.4, 0.15],
    rotationY: 0,
    behavior: 'transit',
    jacketColor: '#2b3f54',
    hairColor: '#222222',
  },
  {
    id: 'slot-6',
    defaultName: 'ELIAS',
    gender: 'male',
    hair: 'cropped',
    role: 'STRATEGY',
    status: 'DISCUSSING',
    roomName: 'CENTRAL CATWALK',
    roomDestination: 'collaboration_hall',
    position: [2.7, 1.4, 1.5],
    rotationY: 1.8,
    behavior: 'collaborating',
    jacketColor: '#22384c',
    hairColor: '#332722',
  },
  {
    id: 'slot-7',
    defaultName: 'SARA',
    gender: 'female',
    hair: 'ponytail',
    role: 'SCIENCE',
    status: 'COLLABORATING',
    roomName: 'CENTRAL CATWALK',
    roomDestination: 'collaboration_hall',
    position: [3.7, 1.4, 1.8],
    rotationY: -1.3,
    behavior: 'collaborating',
    jacketColor: '#cfdbe6', // white-silver lab coat
    hairColor: '#1c1b1a',
  },
  {
    id: 'slot-8',
    defaultName: 'TARA',
    gender: 'female',
    hair: 'ponytail',
    role: 'DATA BAY',
    status: 'COLLABORATION',
    roomName: 'TECH SUITE & DATA BAY',
    roomDestination: 'data',
    position: [4.1, 1.4, -2.1],
    rotationY: -0.5,
    behavior: 'working',
    jacketColor: '#33485c',
    hairColor: '#4f301d',
  },
  {
    id: 'slot-9',
    defaultName: 'KATE',
    gender: 'female',
    hair: 'bun',
    role: 'COMMAND',
    status: 'SURVEILLANCE',
    roomName: 'MISSION CONTROL',
    roomDestination: 'tasks',
    position: [0.5, 1.4, -3.1],
    rotationY: 0,
    behavior: 'working',
    jacketColor: '#203244',
    hairColor: '#2a2220',
  },
  {
    id: 'slot-10',
    defaultName: 'CHLOE',
    gender: 'female',
    hair: 'ponytail',
    role: 'QUANTUM',
    status: 'OPTIMIZING',
    roomName: 'QUANTUM COMPUTE HUB',
    roomDestination: 'agents',
    position: [-4.2, 2.8, -2.5],
    rotationY: 0,
    behavior: 'working',
    jacketColor: '#2c4257',
    hairColor: '#5c3a21',
  },
  {
    id: 'slot-11',
    defaultName: 'DAN',
    gender: 'male',
    hair: 'cropped',
    role: 'HARDWARE',
    status: 'COMPUTE',
    roomName: 'QUANTUM COMPUTE HUB',
    roomDestination: 'agents',
    position: [-2.7, 2.8, -2.5],
    rotationY: 0,
    behavior: 'working',
    jacketColor: '#1e3042',
    hairColor: '#1c1c1c',
  },
];

export interface LivingHQSceneProps {
  agents?: TownAgent[];
  messages?: any[];
  customNames?: Record<string, string>;
  onSelectAgent: (id: string, name: string) => void;
  onOpenRoom: (destination: string) => void;
  selectedAgentId?: string | null;
  height?: number | string;
  focusTarget?: [number, number, number] | null;
}

// --------------------------------------------------------------------------
// REUSABLE 3D BOX & GEOMETRY HELPERS
// --------------------------------------------------------------------------
function Box({
  at,
  size,
  color,
  emissive,
  intensity = 0,
  opacity = 1,
  metalness = 0.45,
  roughness = 0.4,
}: {
  at: [number, number, number];
  size: [number, number, number];
  color: string;
  emissive?: string;
  intensity?: number;
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
        emissiveIntensity={intensity}
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
// CAMERA CONTROLLER WITH SMOOTH LERP
// --------------------------------------------------------------------------
function CameraRig({
  focusPosition,
  controlsRef,
}: {
  focusPosition: [number, number, number] | null;
  controlsRef: React.RefObject<any>;
}) {
  const { camera } = useThree();
  const defaultPos = useMemo(() => new THREE.Vector3(12.5, 11, 14.5), []);
  const defaultTarget = useMemo(() => new THREE.Vector3(0, 1.8, 0), []);

  useFrame(() => {
    if (controlsRef.current) {
      if (focusPosition) {
        const targetPos = new THREE.Vector3(
          focusPosition[0] + 2.5,
          focusPosition[1] + 1.9,
          focusPosition[2] + 3.2
        );
        const targetLookAt = new THREE.Vector3(
          focusPosition[0],
          focusPosition[1] + 0.9,
          focusPosition[2]
        );

        camera.position.lerp(targetPos, 0.055);
        controlsRef.current.target.lerp(targetLookAt, 0.055);
        controlsRef.current.update();
      }
    }
  });

  return null;
}

// --------------------------------------------------------------------------
// ARTICULATED 3D HUMAN AGENT COMPONENT
// --------------------------------------------------------------------------
function ArticulatedHuman({
  config,
  displayName,
  selected,
  onSelect,
  speechText,
}: {
  config: AgentSlotConfig;
  displayName: string;
  selected: boolean;
  onSelect: (id: string, name: string) => void;
  speechText?: string;
}) {
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const leftKnee = useRef<THREE.Group>(null);
  const rightKnee = useRef<THREE.Group>(null);

  const seed = useMemo(
    () => config.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) * 0.17,
    [config.id]
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed;

    if (!root.current) return;

    if (config.behavior === 'transit') {
      // Smooth walk cycle across the bridge doorway
      const walkRange = 2.4;
      const walkCycle = Math.sin(t * 0.7);
      const walkX = config.position[0] + walkCycle * (walkRange / 2);
      root.current.position.x = walkX;
      root.current.position.y = config.position[1] + Math.abs(Math.sin(t * 3.5)) * 0.035;
      root.current.position.z = config.position[2];

      const facing = Math.cos(t * 0.7) >= 0 ? 0 : Math.PI;
      root.current.rotation.y = facing;

      if (leftLeg.current && rightLeg.current) {
        const stride = Math.sin(t * 3.5) * 0.45;
        leftLeg.current.rotation.x = stride;
        rightLeg.current.rotation.x = -stride;
      }
      if (leftArm.current && rightArm.current) {
        const armSwing = Math.sin(t * 3.5) * 0.4;
        leftArm.current.rotation.x = -armSwing;
        rightArm.current.rotation.x = armSwing;
      }
    } else if (config.behavior === 'collaborating') {
      // Natural dialogue gestures facing counterpart
      root.current.position.set(...config.position);
      root.current.rotation.y = config.rotationY;

      const gestureCycle = Math.sin(t * 1.8);
      if (rightArm.current) {
        rightArm.current.rotation.x = -0.7 + gestureCycle * 0.25;
        rightArm.current.rotation.z = -0.2 + Math.cos(t * 1.5) * 0.15;
      }
      if (leftArm.current) {
        leftArm.current.rotation.x = -0.3 + Math.sin(t * 1.2) * 0.15;
      }
      if (head.current) {
        head.current.rotation.y = Math.sin(t * 0.9) * 0.12;
        head.current.rotation.x = Math.sin(t * 1.8) * 0.08;
      }
    } else {
      // Working / operating at desk or terminal
      root.current.position.set(...config.position);
      root.current.rotation.y = config.rotationY;

      // Breathing bob
      root.current.position.y = config.position[1] + Math.sin(t * 1.6) * 0.012;

      if (config.isSitting) {
        if (leftLeg.current && rightLeg.current) {
          leftLeg.current.rotation.x = -Math.PI / 2 + 0.1;
          rightLeg.current.rotation.x = -Math.PI / 2 + 0.1;
        }
      }

      // Typing or calibrating motions
      if (rightArm.current) {
        rightArm.current.rotation.x = -1.1 + Math.sin(t * 4) * 0.12;
        rightArm.current.rotation.y = Math.sin(t * 2) * 0.08;
      }
      if (leftArm.current) {
        leftArm.current.rotation.x = -0.9 + Math.cos(t * 3.2) * 0.1;
        leftArm.current.rotation.y = -Math.sin(t * 1.8) * 0.08;
      }
      if (head.current) {
        head.current.rotation.y = Math.sin(t * 0.7) * 0.18;
        head.current.rotation.x = -0.08 + Math.sin(t * 1.1) * 0.05;
      }
    }
  });

  const skinColor = '#d9b29c';
  const pantsColor = '#182433';
  const bootColor = '#0d1520';

  return (
    <group
      ref={root}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(config.id, displayName);
      }}
      onPointerOver={() => {
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
      }}
    >
      {/* 3D BILLBOARD NAME & STATUS TAG */}
      <Html position={[0, 1.95, 0]} center distanceFactor={14}>
        <div className={`tj-agent-3d-tag ${selected ? 'is-selected' : ''}`}>
          <span className="tj-agent-3d-dot" />
          <span className="tj-agent-3d-name">{displayName}</span>
          <span className="tj-agent-3d-sep">|</span>
          <span className="tj-agent-3d-status">{config.status}</span>
        </div>
      </Html>

      {/* SPEECH BUBBLE FOR COLLABORATING AGENTS */}
      {speechText && (
        <Html position={[0, 2.35, 0]} center distanceFactor={13}>
          <div className="tj-agent-speech-bubble">{speechText}</div>
        </Html>
      )}

      {/* SELECTION AURA RING ON FLOOR */}
      {selected && (
        <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.35, 0.48, 32]} />
          <meshBasicMaterial color="#00f2fe" transparent opacity={0.85} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* CHARACTER SKELETON & BODY PARTS */}
      {/* Pelvis / Hips */}
      <mesh position={[0, 0.82, 0]} castShadow>
        <boxGeometry args={[0.3, 0.16, 0.2]} />
        <meshStandardMaterial color={pantsColor} roughness={0.5} />
      </mesh>

      {/* Tactical Belt */}
      <mesh position={[0, 0.91, 0]}>
        <boxGeometry args={[0.32, 0.04, 0.22]} />
        <meshStandardMaterial color="#0b1118" metalness={0.6} />
      </mesh>

      {/* Torso / Tactical Jacket */}
      <group position={[0, 1.12, 0]}>
        <mesh castShadow>
          <boxGeometry args={[config.gender === 'female' ? 0.32 : 0.36, 0.38, 0.22]} />
          <meshStandardMaterial color={config.jacketColor} roughness={0.35} metalness={0.2} />
        </mesh>
        {/* Glowing Cyber Chest Emblem */}
        <mesh position={[0.08, 0.06, 0.115]}>
          <planeGeometry args={[0.07, 0.04]} />
          <meshBasicMaterial color="#00f2fe" />
        </mesh>
        {/* Tactical Collar */}
        <mesh position={[0, 0.21, 0]}>
          <boxGeometry args={[0.22, 0.05, 0.16]} />
          <meshStandardMaterial color="#1a2736" />
        </mesh>
      </group>

      {/* Head & Hair */}
      <group ref={head} position={[0, 1.44, 0]}>
        {/* Neck */}
        <mesh position={[0, -0.06, 0]}>
          <cylinderGeometry args={[0.05, 0.06, 0.08, 12]} />
          <meshStandardMaterial color={skinColor} roughness={0.6} />
        </mesh>
        {/* Head */}
        <mesh castShadow>
          <sphereGeometry args={[0.115, 16, 16]} />
          <meshStandardMaterial color={skinColor} roughness={0.55} />
        </mesh>
        {/* Face Visor / Cyber Eye Lens */}
        <mesh position={[0, 0.015, 0.1]}>
          <boxGeometry args={[0.13, 0.035, 0.04]} />
          <meshBasicMaterial color="#00f2fe" transparent opacity={0.6} />
        </mesh>

        {/* Hairstyles */}
        {config.hair === 'ponytail' ? (
          <group position={[0, 0.04, -0.06]}>
            <mesh>
              <sphereGeometry args={[0.12, 14, 14]} />
              <meshStandardMaterial color={config.hairColor} roughness={0.8} />
            </mesh>
            {/* Ponytail strand */}
            <mesh position={[0, -0.1, -0.1]} rotation={[0.4, 0, 0]}>
              <cylinderGeometry args={[0.03, 0.015, 0.22, 8]} />
              <meshStandardMaterial color={config.hairColor} roughness={0.8} />
            </mesh>
          </group>
        ) : config.hair === 'bun' ? (
          <group position={[0, 0.08, -0.06]}>
            <mesh>
              <sphereGeometry args={[0.12, 14, 14]} />
              <meshStandardMaterial color={config.hairColor} roughness={0.8} />
            </mesh>
            {/* Chic Top Bun */}
            <mesh position={[0, 0.06, -0.04]}>
              <sphereGeometry args={[0.065, 12, 12]} />
              <meshStandardMaterial color={config.hairColor} roughness={0.8} />
            </mesh>
          </group>
        ) : (
          /* Cropped Tactical Cut */
          <mesh position={[0, 0.05, -0.01]}>
            <sphereGeometry args={[0.125, 16, 12]} />
            <meshStandardMaterial color={config.hairColor} roughness={0.8} />
          </mesh>
        )}
      </group>

      {/* Left Arm */}
      <group ref={leftArm} position={[-0.22, 1.25, 0]}>
        {/* Shoulder Pad */}
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[0.09, 0.08, 0.12]} />
          <meshStandardMaterial color="#1a2736" metalness={0.6} />
        </mesh>
        {/* Upper Arm */}
        <mesh position={[0, -0.14, 0]}>
          <cylinderGeometry args={[0.045, 0.04, 0.22, 10]} />
          <meshStandardMaterial color={config.jacketColor} roughness={0.4} />
        </mesh>
        {/* Forearm & Hand */}
        <mesh position={[0, -0.32, 0]}>
          <cylinderGeometry args={[0.04, 0.035, 0.2, 10]} />
          <meshStandardMaterial color="#162331" roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.44, 0]}>
          <boxGeometry args={[0.05, 0.07, 0.06]} />
          <meshStandardMaterial color={skinColor} roughness={0.6} />
        </mesh>
      </group>

      {/* Right Arm */}
      <group ref={rightArm} position={[0.22, 1.25, 0]}>
        {/* Shoulder Pad */}
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[0.09, 0.08, 0.12]} />
          <meshStandardMaterial color="#1a2736" metalness={0.6} />
        </mesh>
        {/* Upper Arm */}
        <mesh position={[0, -0.14, 0]}>
          <cylinderGeometry args={[0.045, 0.04, 0.22, 10]} />
          <meshStandardMaterial color={config.jacketColor} roughness={0.4} />
        </mesh>
        {/* Forearm & Hand */}
        <mesh position={[0, -0.32, 0]}>
          <cylinderGeometry args={[0.04, 0.035, 0.2, 10]} />
          <meshStandardMaterial color="#162331" roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.44, 0]}>
          <boxGeometry args={[0.05, 0.07, 0.06]} />
          <meshStandardMaterial color={skinColor} roughness={0.6} />
        </mesh>
      </group>

      {/* Left Leg */}
      <group ref={leftLeg} position={[-0.1, 0.74, 0]}>
        {/* Thigh */}
        <mesh position={[0, -0.18, 0]}>
          <cylinderGeometry args={[0.065, 0.055, 0.34, 10]} />
          <meshStandardMaterial color={pantsColor} roughness={0.5} />
        </mesh>
        {/* Knee & Calf */}
        <group ref={leftKnee} position={[0, -0.36, 0]}>
          <mesh position={[0, -0.16, 0]}>
            <cylinderGeometry args={[0.052, 0.045, 0.32, 10]} />
            <meshStandardMaterial color={pantsColor} roughness={0.5} />
          </mesh>
          {/* Tactical Boot */}
          <mesh position={[0, -0.34, 0.03]}>
            <boxGeometry args={[0.09, 0.1, 0.17]} />
            <meshStandardMaterial color={bootColor} roughness={0.4} />
          </mesh>
        </group>
      </group>

      {/* Right Leg */}
      <group ref={rightLeg} position={[0.1, 0.74, 0]}>
        {/* Thigh */}
        <mesh position={[0, -0.18, 0]}>
          <cylinderGeometry args={[0.065, 0.055, 0.34, 10]} />
          <meshStandardMaterial color={pantsColor} roughness={0.5} />
        </mesh>
        {/* Knee & Calf */}
        <group ref={rightKnee} position={[0, -0.36, 0]}>
          <mesh position={[0, -0.16, 0]}>
            <cylinderGeometry args={[0.052, 0.045, 0.32, 10]} />
            <meshStandardMaterial color={pantsColor} roughness={0.5} />
          </mesh>
          {/* Tactical Boot */}
          <mesh position={[0, -0.34, 0.03]}>
            <boxGeometry args={[0.09, 0.1, 0.17]} />
            <meshStandardMaterial color={bootColor} roughness={0.4} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// --------------------------------------------------------------------------
// 1. ANTIGRAVITY RESEARCH LAB (Floor Emitter, Zero-G Spheres & Drones)
// --------------------------------------------------------------------------
function AntigravityLab({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const spheresGroup = useRef<THREE.Group>(null);
  const drone1 = useRef<THREE.Group>(null);
  const drone2 = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (spheresGroup.current) {
      spheresGroup.current.rotation.y = t * 0.25;
    }
    if (drone1.current) {
      drone1.current.position.y = 1.35 + Math.sin(t * 1.4) * 0.18;
      drone1.current.rotation.y = t * 0.6;
    }
    if (drone2.current) {
      drone2.current.position.y = 1.6 + Math.cos(t * 1.2) * 0.16;
      drone2.current.rotation.y = -t * 0.5;
    }
  });

  return (
    <group
      position={[-3.8, 0, -0.2]}
      onClick={(e) => {
        e.stopPropagation();
        onOpenRoom('vision');
      }}
    >
      {/* Room Boundary Sign */}
      <Box at={[-0.2, 2.9, -1.8]} size={[3.4, 0.25, 0.06]} color="#0c1828" metalness={0.8} />
      <Box at={[-0.2, 2.9, -1.76]} size={[3.2, 0.18, 0.02]} color="#00f2fe" emissive="#00f2fe" intensity={0.5} opacity={0.6} />

      {/* Glowing Circular Floor Emitter */}
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[2.0, 2.15, 0.07, 48]} />
        <meshStandardMaterial color="#122033" metalness={0.8} roughness={0.25} />
      </mesh>
      {/* Outer Blue Glow Ring */}
      <mesh position={[0, 0.075, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.65, 1.95, 48]} />
        <meshBasicMaterial color="#00f2fe" side={THREE.DoubleSide} />
      </mesh>
      {/* Inner Pulsing Blue Core */}
      <mesh position={[0, 0.078, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 1.4, 48]} />
        <meshBasicMaterial color="#0d507d" transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.08, 0]}>
        <cylinderGeometry args={[0.42, 0.42, 0.02, 32]} />
        <meshBasicMaterial color="#00f2fe" />
      </mesh>

      {/* Floating Zero-Gravity Metallic Spheres */}
      <group ref={spheresGroup} position={[0, 1.1, 0]}>
        <mesh position={[0, 0.35, 0]}>
          <sphereGeometry args={[0.32, 32, 32]} />
          <meshStandardMaterial color="#c2dbee" metalness={0.96} roughness={0.06} />
        </mesh>
        <mesh position={[0.75, 0.1, 0.4]}>
          <sphereGeometry args={[0.2, 24, 24]} />
          <meshStandardMaterial color="#a7cbfa" metalness={0.95} roughness={0.08} />
        </mesh>
        <mesh position={[-0.8, 0.45, -0.3]}>
          <sphereGeometry args={[0.17, 24, 24]} />
          <meshStandardMaterial color="#bfe4ff" metalness={0.94} roughness={0.08} />
        </mesh>
        <mesh position={[0.2, 0.7, -0.75]}>
          <sphereGeometry args={[0.13, 20, 20]} />
          <meshStandardMaterial color="#e0f4ff" metalness={0.95} roughness={0.05} />
        </mesh>
        <mesh position={[-0.5, -0.15, 0.6]}>
          <sphereGeometry args={[0.11, 20, 20]} />
          <meshStandardMaterial color="#99bfe8" metalness={0.93} roughness={0.1} />
        </mesh>
      </group>

      {/* Autonomous Zero-G Drones */}
      <group ref={drone1} position={[-0.9, 1.35, 0.7]}>
        <mesh>
          <boxGeometry args={[0.22, 0.06, 0.22]} />
          <meshStandardMaterial color="#1a2b3d" metalness={0.8} />
        </mesh>
        {/* Drone Propeller Rings */}
        {[-0.12, 0.12].map((dx) =>
          [-0.12, 0.12].map((dz) => (
            <mesh key={`p-${dx}-${dz}`} position={[dx, 0.03, dz]}>
              <torusGeometry args={[0.05, 0.012, 8, 16]} />
              <meshBasicMaterial color="#00f2fe" />
            </mesh>
          ))
        )}
      </group>

      <group ref={drone2} position={[0.85, 1.6, -0.8]}>
        <mesh>
          <boxGeometry args={[0.24, 0.06, 0.24]} />
          <meshStandardMaterial color="#1a2b3d" metalness={0.8} />
        </mesh>
        {[-0.13, 0.13].map((dx) =>
          [-0.13, 0.13].map((dz) => (
            <mesh key={`p2-${dx}-${dz}`} position={[dx, 0.03, dz]}>
              <torusGeometry args={[0.052, 0.012, 8, 16]} />
              <meshBasicMaterial color="#00f2fe" />
            </mesh>
          ))
        )}
      </group>

      {/* Containment Canisters on Wall */}
      {[-1.4, -1.8].map((cx, i) => (
        <group key={i} position={[cx, 0.6, -1.5]}>
          <mesh>
            <cylinderGeometry args={[0.16, 0.16, 0.9, 16]} />
            <meshStandardMaterial color="#00f2fe" emissive="#00f2fe" emissiveIntensity={0.6} transparent opacity={0.4} />
          </mesh>
          <Box at={[0, 0.48, 0]} size={[0.36, 0.08, 0.36]} color="#233547" metalness={0.8} />
          <Box at={[0, -0.48, 0]} size={[0.36, 0.08, 0.36]} color="#233547" metalness={0.8} />
        </group>
      ))}
    </group>
  );
}

// --------------------------------------------------------------------------
// 2. MISSION CONTROL / COMMAND OFFICE (Curved Console & Holographic World Map)
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

    // Cyan Grid Lines
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.16)';
    ctx.lineWidth = 1;
    for (let x = 0; x < 1024; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 512);
      ctx.stroke();
    }
    for (let y = 0; y < 512; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1024, y);
      ctx.stroke();
    }

    // World Continents (Stylized vector outlines)
    ctx.fillStyle = 'rgba(0, 242, 254, 0.32)';
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 2;

    // North America
    ctx.beginPath();
    ctx.ellipse(280, 180, 110, 75, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // South America
    ctx.beginPath();
    ctx.ellipse(360, 340, 65, 95, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Europe / Africa
    ctx.beginPath();
    ctx.ellipse(540, 170, 75, 55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(550, 310, 70, 95, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Asia
    ctx.beginPath();
    ctx.ellipse(740, 180, 130, 85, 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Australia
    ctx.beginPath();
    ctx.ellipse(820, 380, 60, 45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Pulsing Global Telemetry Nodes
    const nodes = [
      [240, 170], // SF
      [310, 160], // NYC
      [520, 140], // London
      [630, 240], // Dubai
      [780, 270], // Singapore
      [830, 170], // Tokyo
    ];

    ctx.fillStyle = '#ff476f';
    nodes.forEach(([nx, ny]) => {
      ctx.beginPath();
      ctx.arc(nx, ny, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#00f2fe';
      ctx.beginPath();
      ctx.arc(nx, ny, 14, 0, Math.PI * 2);
      ctx.stroke();
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  return (
    <group
      position={[0.5, 1.4, -3.2]}
      onClick={(e) => {
        e.stopPropagation();
        onOpenRoom('tasks');
      }}
    >
      {/* Holographic Cyan World Map Screen */}
      <mesh position={[0, 1.6, -0.85]}>
        <planeGeometry args={[4.4, 2.2]} />
        {mapTexture ? (
          <meshBasicMaterial map={mapTexture} transparent opacity={0.88} />
        ) : (
          <meshBasicMaterial color="#00f2fe" transparent opacity={0.3} />
        )}
      </mesh>
      {/* Screen Neon Border Frame */}
      <Box at={[0, 2.72, -0.84]} size={[4.46, 0.05, 0.04]} color="#00f2fe" emissive="#00f2fe" intensity={1} />
      <Box at={[0, 0.48, -0.84]} size={[4.46, 0.05, 0.04]} color="#00f2fe" emissive="#00f2fe" intensity={1} />

      {/* Curved Command Desk */}
      <Box at={[0, 0.45, 0]} size={[3.4, 0.08, 0.9]} color="#17283c" metalness={0.7} />
      <Box at={[0, 0.22, 0]} size={[3.2, 0.42, 0.7]} color="#0d1825" metalness={0.85} />

      {/* Illuminated Desktop Monitors */}
      {[-1.0, 0, 1.0].map((mx) => (
        <group key={mx} position={[mx, 0.75, -0.1]}>
          <Box at={[0, 0, 0]} size={[0.7, 0.42, 0.03]} color="#0a1522" metalness={0.6} />
          <Box at={[0, 0, 0.02]} size={[0.64, 0.36, 0.005]} color="#00f2fe" emissive="#00f2fe" intensity={0.6} opacity={0.8} />
          <Box at={[0, -0.25, 0]} size={[0.05, 0.12, 0.05]} color="#42576c" />
        </group>
      ))}

      {/* Overhead Room Banner */}
      <Box at={[0, 3.1, -0.8]} size={[3.6, 0.3, 0.08]} color="#0e1d2f" metalness={0.8} />
      <Box at={[0, 3.1, -0.75]} size={[3.4, 0.2, 0.02]} color="#00f2fe" emissive="#00f2fe" intensity={0.4} opacity={0.5} />
    </group>
  );
}

// --------------------------------------------------------------------------
// 3. TECH SUITE & DATA BAY (Server Racks & Holographic Data Globe)
// --------------------------------------------------------------------------
function TechSuite({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const globe = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (globe.current) {
      globe.current.rotation.y = clock.elapsedTime * 0.4;
      globe.current.rotation.x = Math.sin(clock.elapsedTime * 0.2) * 0.15;
    }
  });

  return (
    <group
      position={[4.2, 1.4, -2.2]}
      onClick={(e) => {
        e.stopPropagation();
        onOpenRoom('data');
      }}
    >
      {/* 3 Heavy Cyber Server Racks */}
      {[-1.2, -0.3, 0.6].map((sx, idx) => (
        <group key={idx} position={[sx, 1.1, -1.0]}>
          <Box at={[0, 0, 0]} size={[0.72, 2.2, 0.65]} color="#111d2b" metalness={0.85} roughness={0.3} />
          {/* LED Status Strips */}
          {Array.from({ length: 6 }).map((_, li) => (
            <mesh key={li} position={[0.24, -0.7 + li * 0.26, 0.33]}>
              <boxGeometry args={[0.04, 0.04, 0.01]} />
              <meshBasicMaterial color={li % 2 === 0 ? '#00f2fe' : '#4cd997'} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Central Holographic Data Globe */}
      <group ref={globe} position={[0.4, 1.25, 0.5]}>
        <mesh>
          <sphereGeometry args={[0.55, 20, 20]} />
          <meshBasicMaterial color="#00f2fe" wireframe transparent opacity={0.65} />
        </mesh>
        <mesh rotation={[Math.PI / 4, 0, 0]}>
          <torusGeometry args={[0.72, 0.02, 8, 36]} />
          <meshBasicMaterial color="#00f2fe" transparent opacity={0.8} />
        </mesh>
        <mesh rotation={[-Math.PI / 4, 0, 0]}>
          <torusGeometry args={[0.82, 0.02, 8, 36]} />
          <meshBasicMaterial color="#4facfe" transparent opacity={0.6} />
        </mesh>
      </group>

      {/* Operator Console Desk */}
      <Box at={[0.4, 0.45, 0.5]} size={[1.4, 0.08, 0.8]} color="#17283c" metalness={0.7} />
      <Box at={[0.4, 0.22, 0.5]} size={[1.2, 0.42, 0.6]} color="#0c1825" metalness={0.85} />
    </group>
  );
}

// --------------------------------------------------------------------------
// 4. INTELLIGENCE CORE BAY (Right Wall Giant Quantum Reactor & Atomic Rings)
// --------------------------------------------------------------------------
function QuantumReactor({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const ring1 = useRef<THREE.Group>(null);
  const ring2 = useRef<THREE.Group>(null);
  const ring3 = useRef<THREE.Group>(null);
  const corePlasma = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ring1.current) ring1.current.rotation.x = t * 0.8;
    if (ring2.current) ring2.current.rotation.y = t * 1.1;
    if (ring3.current) ring3.current.rotation.z = -t * 0.9;
    if (corePlasma.current) {
      const pulse = 1 + Math.sin(t * 3.5) * 0.12;
      corePlasma.current.scale.set(pulse, pulse, pulse);
    }
  });

  return (
    <group
      position={[7.1, 2.2, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onOpenRoom('main');
      }}
    >
      {/* Heavy Industrial Steel Backplate & Wall Mount */}
      <Box at={[0.2, 0, 0]} size={[0.4, 4.4, 4.4]} color="#0a1524" metalness={0.9} roughness={0.2} />

      {/* Giant Outer Reactor Collar Ring */}
      <mesh position={[0, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[1.75, 0.24, 18, 48]} />
        <meshStandardMaterial color="#21354c" metalness={0.85} roughness={0.25} />
      </mesh>

      {/* Glowing Neon Cyan Aperture Ring */}
      <mesh position={[-0.05, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[1.5, 0.08, 16, 48]} />
        <meshBasicMaterial color="#00f2fe" />
      </mesh>

      {/* Inner Chamber */}
      <mesh position={[0.1, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <cylinderGeometry args={[1.4, 1.4, 0.2, 32]} />
        <meshStandardMaterial color="#040b15" metalness={0.95} />
      </mesh>

      {/* Concentric 3D Spinning Atomic Rings */}
      <group ref={ring1} position={[-0.08, 0, 0]}>
        <mesh>
          <torusGeometry args={[1.15, 0.045, 12, 40]} />
          <meshStandardMaterial color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.2} />
        </mesh>
      </group>
      <group ref={ring2} position={[-0.08, 0, 0]}>
        <mesh>
          <torusGeometry args={[0.88, 0.04, 12, 40]} />
          <meshStandardMaterial color="#7f5af0" emissive="#7f5af0" emissiveIntensity={1.1} />
        </mesh>
      </group>
      <group ref={ring3} position={[-0.08, 0, 0]}>
        <mesh>
          <torusGeometry args={[0.62, 0.035, 12, 40]} />
          <meshStandardMaterial color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.3} />
        </mesh>
      </group>

      {/* Central Pulsating Plasma Core Sphere */}
      <mesh ref={corePlasma} position={[-0.08, 0, 0]}>
        <sphereGeometry args={[0.3, 24, 24]} />
        <meshStandardMaterial color="#e0f8ff" emissive="#00f2fe" emissiveIntensity={2.8} />
      </mesh>

      {/* Heavy High-Voltage Conduits & Pipes from Reactor Base */}
      {[-0.6, 0, 0.6].map((cz, ci) => (
        <group key={ci} position={[-0.3, -1.8, cz]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.1, 0.1, 1.4, 16]} />
            <meshStandardMaterial color="#b35924" metalness={0.7} roughness={0.3} />
          </mesh>
        </group>
      ))}

      {/* Label above Reactor */}
      <Box at={[-0.1, 2.5, 0]} size={[0.08, 0.3, 2.4]} color="#0c1828" metalness={0.8} />
      <Box at={[-0.15, 2.5, 0]} size={[0.02, 0.22, 2.2]} color="#00f2fe" emissive="#00f2fe" intensity={0.4} opacity={0.6} />
    </group>
  );
}

// --------------------------------------------------------------------------
// 5. QUANTUM COMPUTE HUB (Upper-Left Mezzanine & RGB Cooling Pipes)
// --------------------------------------------------------------------------
function QuantumComputeHub({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const rgbColors = ['#ff3b56', '#f5a623', '#2bd47d', '#2c7be5', '#00f2fe'];

  return (
    <group
      position={[-3.8, 2.8, -2.4]}
      onClick={(e) => {
        e.stopPropagation();
        onOpenRoom('agents');
      }}
    >
      {/* 2nd Tier Platform Floor */}
      <Box at={[0, -0.06, 0]} size={[4.4, 0.12, 3.2]} color="#142337" metalness={0.8} />
      {/* Safety Railing with Glowing Cyan Strip */}
      <Box at={[0, 0.45, 1.55]} size={[4.4, 0.04, 0.04]} color="#00f2fe" emissive="#00f2fe" intensity={0.8} />
      <Box at={[2.15, 0.45, 0]} size={[0.04, 0.04, 3.1]} color="#00f2fe" emissive="#00f2fe" intensity={0.8} />

      {/* Overhead RGB Glowing Cooling Pipes */}
      {rgbColors.map((pipeColor, pi) => (
        <group key={pi} position={[-1.6 + pi * 0.35, 1.9, -1.2]}>
          {/* Horizontal Section */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.055, 0.055, 0.8, 16]} />
            <meshStandardMaterial color={pipeColor} emissive={pipeColor} emissiveIntensity={1.8} />
          </mesh>
          {/* Vertical Drop Section */}
          <mesh position={[-0.4, -0.65, 0]}>
            <cylinderGeometry args={[0.055, 0.055, 1.3, 16]} />
            <meshStandardMaterial color={pipeColor} emissive={pipeColor} emissiveIntensity={1.8} />
          </mesh>
        </group>
      ))}

      {/* Quantum Mainframe Server Towers */}
      {[-1.2, 0.4].map((qx, qi) => (
        <group key={qi} position={[qx, 0.9, -0.9]}>
          <Box at={[0, 0, 0]} size={[1.1, 1.8, 0.7]} color="#101c2b" metalness={0.85} />
          <Box at={[0, 0, 0.36]} size={[0.95, 1.5, 0.01]} color="#00f2fe" emissive="#00f2fe" intensity={0.5} opacity={0.65} />
        </group>
      ))}

      {/* Operator Terminal Console */}
      <Box at={[-0.2, 0.45, 0.6]} size={[1.8, 0.08, 0.7]} color="#1a2d42" metalness={0.7} />
    </group>
  );
}

// --------------------------------------------------------------------------
// 6. BIOMETRICS & CYBERNETICS LAB (Robotic Rig & Dual-Screen Workstation)
// --------------------------------------------------------------------------
function BiometricsLab({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const robotArm = useRef<THREE.Group>(null);
  const laserBeam = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (robotArm.current) {
      robotArm.current.rotation.y = Math.sin(t * 1.5) * 0.35;
      robotArm.current.rotation.z = Math.cos(t * 1.2) * 0.12;
    }
    if (laserBeam.current) {
      laserBeam.current.visible = Math.sin(t * 6) > -0.2;
    }
  });

  return (
    <group
      position={[-2.6, 0, 2.6]}
      onClick={(e) => {
        e.stopPropagation();
        onOpenRoom('wellness');
      }}
    >
      {/* Heavy Workstation Desk */}
      <Box at={[0.6, 0.38, 0]} size={[1.6, 0.08, 0.8]} color="#182c40" metalness={0.7} />
      <Box at={[0.6, 0.18, 0]} size={[1.4, 0.36, 0.6]} color="#0f1c2b" metalness={0.85} />

      {/* Operator Chair */}
      <Box at={[0.6, 0.22, 0.6]} size={[0.42, 0.38, 0.42]} color="#21374d" metalness={0.6} />
      <Box at={[0.6, 0.52, 0.8]} size={[0.42, 0.4, 0.08]} color="#182b3d" metalness={0.6} />

      {/* Dual Curved Widescreen Monitors */}
      {[-0.3, 0.3].map((cx, i) => (
        <group key={i} position={[0.6 + cx, 0.68, -0.15]} rotation={[0, -cx * 0.4, 0]}>
          <Box at={[0, 0, 0]} size={[0.55, 0.32, 0.03]} color="#0b1624" />
          <Box at={[0, 0, 0.02]} size={[0.5, 0.27, 0.005]} color="#00f2fe" emissive="#00f2fe" intensity={0.7} opacity={0.75} />
          <Box at={[0, -0.18, 0]} size={[0.04, 0.1, 0.04]} color="#3e5368" />
        </group>
      ))}

      {/* Robotic Calibration Rig */}
      <group position={[-1.1, 0, 0]}>
        {/* Base Pedestal with Hazard Stripes */}
        <Box at={[0, 0.25, 0]} size={[0.9, 0.5, 0.9]} color="#162537" metalness={0.8} />
        {/* Diagnostic Pod / Specimen Bed */}
        <mesh position={[0, 0.52, 0]}>
          <cylinderGeometry args={[0.35, 0.35, 0.06, 24]} />
          <meshStandardMaterial color="#00f2fe" emissive="#00f2fe" emissiveIntensity={0.8} />
        </mesh>

        {/* Articulated Robotic Calibration Arm */}
        <group ref={robotArm} position={[0, 0.55, -0.25]}>
          {/* Base joint */}
          <mesh>
            <sphereGeometry args={[0.09, 14, 14]} />
            <meshStandardMaterial color="#364e66" metalness={0.85} />
          </mesh>
          {/* Lower Arm */}
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.4, 12]} />
            <meshStandardMaterial color="#7f9db8" metalness={0.8} />
          </mesh>
          {/* Elbow Joint */}
          <mesh position={[0, 0.4, 0]}>
            <sphereGeometry args={[0.07, 12, 12]} />
            <meshStandardMaterial color="#364e66" metalness={0.85} />
          </mesh>
          {/* Upper Arm projecting forward */}
          <mesh position={[0, 0.4, 0.2]} rotation={[Math.PI / 3, 0, 0]}>
            <cylinderGeometry args={[0.035, 0.035, 0.35, 12]} />
            <meshStandardMaterial color="#7f9db8" metalness={0.8} />
          </mesh>
          {/* Tool head & Laser beam */}
          <mesh position={[0, 0.25, 0.35]}>
            <coneGeometry args={[0.04, 0.08, 12]} />
            <meshBasicMaterial color="#00f2fe" />
          </mesh>
          <mesh ref={laserBeam} position={[0, 0.12, 0.35]}>
            <cylinderGeometry args={[0.008, 0.008, 0.22, 6]} />
            <meshBasicMaterial color="#00f2fe" />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// --------------------------------------------------------------------------
// INDUSTRIAL ATRIUM ARCHITECTURE (Catwalks, Stairs, Gantries & Edge Trims)
// --------------------------------------------------------------------------
function IndustrialAtrium() {
  return (
    <group>
      {/* Ground Floor Base Slabs with Cyber Grid */}
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <boxGeometry args={[17.5, 0.12, 13.5]} />
        <meshStandardMaterial color="#08101a" metalness={0.85} roughness={0.3} />
      </mesh>

      {/* Cyber Grid Subfloor Lines */}
      {[-6, -4, -2, 0, 2, 4, 6].map((gx) => (
        <mesh key={`grid-x-${gx}`} position={[gx, 0.002, 0]}>
          <planeGeometry args={[0.025, 13.2]} />
          <meshBasicMaterial color="#00f2fe" transparent opacity={0.12} />
        </mesh>
      ))}

      {/* Structural Perimeter Steel Columns */}
      {[-7.8, 7.8].map((px) =>
        [-5.8, 0, 5.8].map((pz) => (
          <group key={`col-${px}-${pz}`} position={[px, 2.8, pz]}>
            <Box at={[0, 0, 0]} size={[0.35, 5.8, 0.35]} color="#172738" metalness={0.85} />
            <Box at={[0, -2.7, 0]} size={[0.5, 0.2, 0.5]} color="#0f1924" metalness={0.9} />
          </group>
        ))
      )}

      {/* Elevated Catwalk Mezzanine (Tier 2, connecting Left to Center) */}
      <group position={[0, 1.4, 0.8]}>
        {/* Catwalk Bridge Slab */}
        <Box at={[1.2, -0.06, 0]} size={[9.5, 0.12, 1.6]} color="#132336" metalness={0.8} />
        {/* Glowing Edge Runners */}
        <Box at={[1.2, 0, 0.8]} size={[9.5, 0.03, 0.05]} color="#00f2fe" emissive="#00f2fe" intensity={1} />
        <Box at={[1.2, 0, -0.8]} size={[9.5, 0.03, 0.05]} color="#00f2fe" emissive="#00f2fe" intensity={1} />
        {/* Safety Railings */}
        <Box at={[1.2, 0.42, 0.8]} size={[9.5, 0.035, 0.035]} color="#46627d" metalness={0.8} />
      </group>

      {/* Left Industrial Stairs (Leading from ground to upper tier) */}
      <group position={[-5.8, 0, 0.8]}>
        {Array.from({ length: 12 }).map((_, stepIdx) => {
          const sy = 0.12 + stepIdx * 0.12;
          const sz = 1.6 - stepIdx * 0.22;
          return (
            <group key={`st-${stepIdx}`} position={[0, sy, sz]}>
              <Box at={[0, 0, 0]} size={[1.1, 0.08, 0.28]} color="#182c40" metalness={0.7} />
              {/* Yellow Hazard Line on Step Lip */}
              <Box at={[0, 0.042, 0.12]} size={[1.05, 0.015, 0.03]} color="#f5a623" emissive="#f5a623" intensity={0.7} />
            </group>
          );
        })}
      </group>

      {/* Overhead Gantry Steel Truss */}
      <group position={[0, 5.4, 0]}>
        <Box at={[0, 0, 0]} size={[16.2, 0.35, 0.4]} color="#1a2d42" metalness={0.85} />
        {/* Hazard Yellow Warning Plates */}
        {[-4, 0, 4].map((hx) => (
          <Box key={hx} at={[hx, -0.22, 0]} size={[0.8, 0.14, 0.04]} color="#f5a623" emissive="#f5a623" intensity={0.6} />
        ))}
      </group>
    </group>
  );
}

// --------------------------------------------------------------------------
// HQ WORLD SCENE COMPONENT
// --------------------------------------------------------------------------
function HQWorld({
  agentSlots,
  customNames = {},
  selectedAgentId,
  onSelectAgent,
  onOpenRoom,
  focusTarget,
  controlsRef,
}: {
  agentSlots: AgentSlotConfig[];
  customNames: Record<string, string>;
  selectedAgentId?: string | null;
  onSelectAgent: (id: string, name: string) => void;
  onOpenRoom: (dest: string) => void;
  focusTarget: [number, number, number] | null;
  controlsRef: React.RefObject<any>;
}) {
  const [speechIndex, setSpeechIndex] = useState(0);

  const dialoguePhrases = [
    'Neural weights synchronized across active nodes.',
    'Anti-gravity field stable within 0.02G tolerance.',
    'Quantum reactor harmonic spin state verified.',
    'Mission Control telemetry uplink operational.',
    'Cybernetic calibration passing diagnostic phase.',
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setSpeechIndex((prev) => (prev + 1) % dialoguePhrases.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [dialoguePhrases.length]);

  return (
    <>
      <color attach="background" args={['#050b14']} />
      <fog attach="fog" args={['#050b14', 18, 42]} />

      {/* Cyber Lighting Atmosphere */}
      <ambientLight intensity={1.2} color="#8cb0d4" />
      <directionalLight position={[9, 14, 10]} intensity={2.2} color="#cde5ff" castShadow />
      <pointLight position={[-3.8, 2.2, 0]} intensity={12} color="#00f2fe" distance={10} />
      <pointLight position={[6.8, 2.5, 0]} intensity={18} color="#00f2fe" distance={12} />
      <pointLight position={[0, 4.5, -2]} intensity={8} color="#4facfe" distance={14} />

      {/* Camera Rig with Smooth Lerping */}
      <CameraRig focusPosition={focusTarget} controlsRef={controlsRef} />

      {/* Industrial Architecture */}
      <IndustrialAtrium />

      {/* The 6 Core Cyber Rooms */}
      <AntigravityLab onOpenRoom={onOpenRoom} />
      <MissionControl onOpenRoom={onOpenRoom} />
      <TechSuite onOpenRoom={onOpenRoom} />
      <QuantumReactor onOpenRoom={onOpenRoom} />
      <QuantumComputeHub onOpenRoom={onOpenRoom} />
      <BiometricsLab onOpenRoom={onOpenRoom} />

      {/* Deploy all 11 Articulated Human Characters */}
      {agentSlots.map((config) => {
        const name = customNames[config.id] || config.defaultName;
        const isSelected = selectedAgentId === config.id;
        const speech = config.id === 'slot-7' ? dialoguePhrases[speechIndex] : undefined;

        return (
          <ArticulatedHuman
            key={config.id}
            config={config}
            displayName={name}
            selected={isSelected}
            onSelect={onSelectAgent}
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
        minDistance={6}
        maxDistance={28}
        minPolarAngle={0.3}
        maxPolarAngle={1.38}
        target={[0, 1.8, 0]}
      />
    </>
  );
}

// --------------------------------------------------------------------------
// EXPORTED LIVING HQ SCENE
// --------------------------------------------------------------------------
export function LivingHQScene({
  customNames = {},
  onSelectAgent,
  onOpenRoom,
  selectedAgentId,
  height = '100%',
  focusTarget = null,
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
        camera={{ position: [12.5, 11, 14.5], fov: 42, near: 0.1, far: 80 }}
        dpr={[1, 1.6]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <HQWorld
          agentSlots={DEFAULT_AGENT_SLOTS}
          customNames={customNames}
          selectedAgentId={selectedAgentId}
          onSelectAgent={onSelectAgent}
          onOpenRoom={onOpenRoom}
          focusTarget={focusTarget}
          controlsRef={controlsRef}
        />
      </Canvas>
    </div>
  );
}
