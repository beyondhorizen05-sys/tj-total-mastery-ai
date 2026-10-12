import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { TownAgent } from '@tj/schemas';
import { canRenderWebGL, WebGLBoundary } from './WebGLBoundary';

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
        focusPosition[0] + 2.4,
        focusPosition[1] + 1.8,
        focusPosition[2] + 3.0
      );
      const targetLook = new THREE.Vector3(
        focusPosition[0],
        focusPosition[1] + 0.85,
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
// REALISTIC 3D ANATOMICAL HUMAN AGENT (NOT CARTOONISH / MEANINGFUL SOUL)
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
    () => soul.id.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0) * 0.13,
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
        soul.workstationPos[1],
        soul.workstationPos[2]
      );
      root.current.rotation.y = 0;

      // Pelvis seated at chair level
      root.current.position.y = soul.workstationPos[1] - 0.22;

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

      // Head scanning multiple screens
      if (head.current) {
        head.current.rotation.y = Math.sin(t * 0.75) * 0.25;
        head.current.rotation.x = -0.12 + Math.sin(t * 1.4) * 0.06;
      }
    } else if (soul.status === 'transit') {
      // NATURAL HUMAN WALKING GAIT
      const walkCycle = Math.sin(t * 3.6);
      const walkProgress = (Math.sin(t * 0.5) + 1) / 2;

      // Interpolate along path from rest to desk
      const targetX = THREE.MathUtils.lerp(soul.restPos[0], soul.workstationPos[0], walkProgress);
      const targetZ = THREE.MathUtils.lerp(soul.restPos[1], soul.workstationPos[2], walkProgress);

      root.current.position.set(targetX, soul.restPos[1], targetZ);

      // Facing movement direction
      root.current.rotation.y = Math.cos(t * 0.5) >= 0 ? 0 : Math.PI;

      // Human walking kinematics
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
        head.current.rotation.x = 0;
      }
    } else if (soul.status === 'collaborating') {
      // NATURAL COLLABORATIVE DIALOGUE GESTURES
      root.current.position.set(...soul.restPos);
      root.current.rotation.y = soul.gender === 'female' ? -1.3 : 1.7;

      // Relaxed standing stance
      if (leftThigh.current && rightThigh.current) {
        leftThigh.current.rotation.x = 0.04;
        rightThigh.current.rotation.x = -0.04;
      }
      if (leftCalf.current && rightCalf.current) {
        leftCalf.current.rotation.x = 0;
        rightCalf.current.rotation.x = 0;
      }

      // Expressive human arm gestures
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
      root.current.rotation.y = seed % (Math.PI * 2);

      // Natural contrapposto weight shift
      if (leftThigh.current && rightThigh.current) {
        leftThigh.current.rotation.z = 0.06;
        rightThigh.current.rotation.z = -0.03;
        leftThigh.current.rotation.x = 0.05;
        rightThigh.current.rotation.x = -0.05;
      }
      if (leftCalf.current && rightCalf.current) {
        leftCalf.current.rotation.x = 0.04;
        rightCalf.current.rotation.x = 0;
      }

      // Natural breathing & relaxed arms
      root.current.position.y = soul.restPos[1] + Math.sin(t * 1.5) * 0.008;

      if (leftUpperArm.current && rightUpperArm.current) {
        leftUpperArm.current.rotation.x = 0.08 + Math.sin(t * 1.2) * 0.03;
        leftUpperArm.current.rotation.z = 0.09;
        rightUpperArm.current.rotation.x = 0.08 + Math.cos(t * 1.2) * 0.03;
        rightUpperArm.current.rotation.z = -0.09;
      }
      if (head.current) {
        head.current.rotation.y = Math.sin(t * 0.6) * 0.2;
        head.current.rotation.x = -0.04 + Math.sin(t * 0.9) * 0.04;
      }
    }
  });

  const skin = soul.skinColor || '#d59e80';
  const pants = '#131d2a';
  const boots = '#0a121c';

  return (
    <group
      ref={root}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(soul.id, soul.name);
        onInspectSoul(soul);
      }}
      onPointerOver={() => {
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
      }}
    >
      {/* 3D BILLBOARD TAG: NAME | ROLE | STATUS */}
      <Html position={[0, 2.05, 0]} center distanceFactor={14}>
        <div
          className={`tj-agent-3d-tag ${selected ? 'is-selected' : ''}`}
          onClick={() => onInspectSoul(soul)}
          title="Click to inspect Agent Soul Dossier"
        >
          <span
            className="tj-agent-3d-dot"
            style={{
              background: soul.status === 'working' ? '#00f2fe' : '#4cd997',
              boxShadow: soul.status === 'working' ? '0 0 8px #00f2fe' : '0 0 8px #4cd997',
            }}
          />
          <span className="tj-agent-3d-name">{soul.name}</span>
          <span className="tj-agent-3d-sep">|</span>
          <span className="tj-agent-3d-status" style={{ textTransform: 'uppercase' }}>
            {soul.status === 'working' ? 'WORKING' : soul.status === 'resting' ? 'RESTING' : soul.status}
          </span>
          <span style={{ fontSize: 8, color: '#8da6bd', marginLeft: 4 }}>
            ⚡{Math.round(soul.energy)}%
          </span>
        </div>
      </Html>

      {/* SPEECH BUBBLE FOR DIALOGUE & MONOLOGUE */}
      {(speechText || (selected && soul.currentThought)) && (
        <Html position={[0, 2.45, 0]} center distanceFactor={13}>
          <div className="tj-agent-speech-bubble">
            <span style={{ color: '#00f2fe', fontWeight: 800, display: 'block', fontSize: 8, marginBottom: 2 }}>
              {selected ? '💭 INNER MONOLOGUE' : '💬 DIALOGUE'}
            </span>
            {selected ? `"${soul.currentThought}"` : speechText}
          </div>
        </Html>
      )}

      {/* SELECTION AURA RING ON FLOOR */}
      {selected && (
        <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.36, 0.52, 32]} />
          <meshBasicMaterial color="#00f2fe" transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* ==================================================================
          REALISTIC HUMAN ANATOMY (HEAD, JAW, HAIR, TORSO, ARMS, LEGS, BOOTS)
          ================================================================== */}
      {/* Pelvis / Hips */}
      <mesh position={[0, 0.85, 0]} castShadow>
        <boxGeometry args={[0.3, 0.16, 0.2]} />
        <meshStandardMaterial color={pants} roughness={0.5} />
      </mesh>

      {/* Tactical Belt with Chrome Buckle */}
      <mesh position={[0, 0.94, 0]}>
        <boxGeometry args={[0.32, 0.045, 0.22]} />
        <meshStandardMaterial color="#090f16" metalness={0.7} />
      </mesh>
      <mesh position={[0, 0.94, 0.115]}>
        <boxGeometry args={[0.07, 0.035, 0.015]} />
        <meshStandardMaterial color="#00f2fe" metalness={0.9} />
      </mesh>

      {/* Torso: Natural Athletic V-Taper Cyber Jacket */}
      <group position={[0, 1.15, 0]}>
        <mesh castShadow>
          <boxGeometry args={[soul.gender === 'female' ? 0.32 : 0.36, 0.38, 0.22]} />
          <meshStandardMaterial color={soul.jacketColor} roughness={0.35} metalness={0.25} />
        </mesh>
        {/* Armored Cybernetic Chest Crest */}
        <mesh position={[0.08, 0.06, 0.115]}>
          <planeGeometry args={[0.07, 0.04]} />
          <meshBasicMaterial color="#00f2fe" />
        </mesh>
        {/* Tactical High Collar */}
        <mesh position={[0, 0.21, 0]}>
          <boxGeometry args={[0.22, 0.06, 0.17]} />
          <meshStandardMaterial color="#1a2736" metalness={0.4} />
        </mesh>
      </group>

      {/* Anatomical Head with Sculpted Jaw & Realistic Hair */}
      <group ref={head} position={[0, 1.48, 0]}>
        {/* Neck with Cybernetic Neural Port */}
        <mesh position={[0, -0.06, 0]}>
          <cylinderGeometry args={[0.05, 0.06, 0.09, 14]} />
          <meshStandardMaterial color={skin} roughness={0.6} />
        </mesh>
        <mesh position={[-0.05, -0.04, -0.02]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.015, 0.015, 0.02, 8]} />
          <meshBasicMaterial color="#00f2fe" />
        </mesh>

        {/* Sculpted Cranium & Face */}
        <mesh castShadow position={[0, 0.02, 0]}>
          <sphereGeometry args={[0.118, 20, 20]} />
          <meshStandardMaterial color={skin} roughness={0.55} />
        </mesh>
        {/* Sculpted Jawline & Chin */}
        <mesh position={[0, -0.04, 0.05]}>
          <boxGeometry args={[0.09, 0.06, 0.08]} />
          <meshStandardMaterial color={skin} roughness={0.55} />
        </mesh>
        {/* Nose Bridge */}
        <mesh position={[0, 0.01, 0.12]}>
          <coneGeometry args={[0.02, 0.04, 6]} />
          <meshStandardMaterial color={skin} roughness={0.55} />
        </mesh>
        {/* Cyber Visor / Ocular Display */}
        <mesh position={[0, 0.04, 0.11]}>
          <boxGeometry args={[0.13, 0.035, 0.03]} />
          <meshBasicMaterial color="#00f2fe" transparent opacity={0.65} />
        </mesh>

        {/* Realistic Styled 3D Hair */}
        {soul.gender === 'female' ? (
          <group position={[0, 0.06, -0.04]}>
            {/* Flowing Layered Hair Mesh */}
            <mesh>
              <sphereGeometry args={[0.125, 18, 18]} />
              <meshStandardMaterial color={soul.hairColor} roughness={0.8} />
            </mesh>
            {/* Ponytail Strand falling naturally */}
            <mesh position={[0, -0.12, -0.12]} rotation={[0.4, 0, 0]}>
              <cylinderGeometry args={[0.035, 0.02, 0.28, 10]} />
              <meshStandardMaterial color={soul.hairColor} roughness={0.8} />
            </mesh>
          </group>
        ) : (
          /* Male Textured Fade Cut with Volume */
          <group position={[0, 0.08, -0.01]}>
            <mesh>
              <sphereGeometry args={[0.128, 18, 14]} />
              <meshStandardMaterial color={soul.hairColor} roughness={0.85} />
            </mesh>
            <mesh position={[0, 0.05, 0.03]}>
              <boxGeometry args={[0.12, 0.04, 0.12]} />
              <meshStandardMaterial color={soul.hairColor} roughness={0.85} />
            </mesh>
          </group>
        )}
      </group>

      {/* Left Arm: Deltoid -> Bicep -> Forearm -> Hand */}
      <group ref={leftUpperArm} position={[-0.23, 1.28, 0]}>
        <mesh>
          <sphereGeometry args={[0.065, 12, 12]} />
          <meshStandardMaterial color="#1a2736" metalness={0.6} />
        </mesh>
        <mesh position={[0, -0.14, 0]}>
          <cylinderGeometry args={[0.048, 0.042, 0.24, 12]} />
          <meshStandardMaterial color={soul.jacketColor} roughness={0.4} />
        </mesh>

        <group ref={leftForearm} position={[0, -0.28, 0]}>
          <mesh position={[0, -0.12, 0]}>
            <cylinderGeometry args={[0.042, 0.036, 0.22, 12]} />
            <meshStandardMaterial color="#162331" roughness={0.5} />
          </mesh>
          {/* Cybernetic Wrist Bracer HUD */}
          <mesh position={[0, -0.14, 0.03]}>
            <boxGeometry args={[0.05, 0.03, 0.01]} />
            <meshBasicMaterial color="#00f2fe" />
          </mesh>
          {/* Anatomical Hand with Fingers */}
          <mesh position={[0, -0.25, 0]}>
            <boxGeometry args={[0.048, 0.07, 0.06]} />
            <meshStandardMaterial color={skin} roughness={0.6} />
          </mesh>
        </group>
      </group>

      {/* Right Arm: Deltoid -> Bicep -> Forearm -> Hand */}
      <group ref={rightUpperArm} position={[0.23, 1.28, 0]}>
        <mesh>
          <sphereGeometry args={[0.065, 12, 12]} />
          <meshStandardMaterial color="#1a2736" metalness={0.6} />
        </mesh>
        <mesh position={[0, -0.14, 0]}>
          <cylinderGeometry args={[0.048, 0.042, 0.24, 12]} />
          <meshStandardMaterial color={soul.jacketColor} roughness={0.4} />
        </mesh>

        <group ref={rightForearm} position={[0, -0.28, 0]}>
          <mesh position={[0, -0.12, 0]}>
            <cylinderGeometry args={[0.042, 0.036, 0.22, 12]} />
            <meshStandardMaterial color="#162331" roughness={0.5} />
          </mesh>
          {/* Cybernetic Wrist Bracer HUD */}
          <mesh position={[0, -0.14, 0.03]}>
            <boxGeometry args={[0.05, 0.03, 0.01]} />
            <meshBasicMaterial color="#00f2fe" />
          </mesh>
          {/* Anatomical Hand with Fingers */}
          <mesh position={[0, -0.25, 0]}>
            <boxGeometry args={[0.048, 0.07, 0.06]} />
            <meshStandardMaterial color={skin} roughness={0.6} />
          </mesh>
        </group>
      </group>

      {/* Left Leg: Thigh -> Knee -> Calf -> Combat Boot */}
      <group ref={leftThigh} position={[-0.1, 0.76, 0]}>
        <mesh position={[0, -0.18, 0]}>
          <cylinderGeometry args={[0.068, 0.058, 0.36, 12]} />
          <meshStandardMaterial color={pants} roughness={0.5} />
        </mesh>

        <group ref={leftCalf} position={[0, -0.38, 0]}>
          {/* Knee Armor Pad */}
          <mesh position={[0, 0, 0.05]}>
            <boxGeometry args={[0.07, 0.06, 0.03]} />
            <meshStandardMaterial color="#1f3246" metalness={0.7} />
          </mesh>
          <mesh position={[0, -0.16, 0]}>
            <cylinderGeometry args={[0.055, 0.046, 0.34, 12]} />
            <meshStandardMaterial color={pants} roughness={0.5} />
          </mesh>
          {/* Tactical Combat Boot */}
          <mesh position={[0, -0.35, 0.04]}>
            <boxGeometry args={[0.095, 0.11, 0.18]} />
            <meshStandardMaterial color={boots} roughness={0.4} />
          </mesh>
        </group>
      </group>

      {/* Right Leg: Thigh -> Knee -> Calf -> Combat Boot */}
      <group ref={rightThigh} position={[0.1, 0.76, 0]}>
        <mesh position={[0, -0.18, 0]}>
          <cylinderGeometry args={[0.068, 0.058, 0.36, 12]} />
          <meshStandardMaterial color={pants} roughness={0.5} />
        </mesh>

        <group ref={rightCalf} position={[0, -0.38, 0]}>
          {/* Knee Armor Pad */}
          <mesh position={[0, 0, 0.05]}>
            <boxGeometry args={[0.07, 0.06, 0.03]} />
            <meshStandardMaterial color="#1f3246" metalness={0.7} />
          </mesh>
          <mesh position={[0, -0.16, 0]}>
            <cylinderGeometry args={[0.055, 0.046, 0.34, 12]} />
            <meshStandardMaterial color={pants} roughness={0.5} />
          </mesh>
          {/* Tactical Combat Boot */}
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
// DYNAMIC CUSTOM USER ROOM RENDERER
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
      {/* Floor Platform Slab */}
      <Box at={[0, -0.06, 0]} size={[4.2, 0.12, 3.4]} color="#132337" metalness={0.8} />

      {/* Neon Edge Trim in User's Accent Color */}
      <Box at={[0, 0, 1.7]} size={[4.2, 0.04, 0.04]} color={room.accentColor} emissive={room.accentColor} emissiveIntensity={1} />
      <Box at={[0, 0, -1.7]} size={[4.2, 0.04, 0.04]} color={room.accentColor} emissive={room.accentColor} emissiveIntensity={1} />
      <Box at={[2.1, 0, 0]} size={[0.04, 0.04, 3.4]} color={room.accentColor} emissive={room.accentColor} emissiveIntensity={1} />
      <Box at={[-2.1, 0, 0]} size={[0.04, 0.04, 3.4]} color={room.accentColor} emissive={room.accentColor} emissiveIntensity={1} />

      {/* 3D Holographic Room Name Sign */}
      <Box at={[0, 2.6, -1.65]} size={[3.4, 0.28, 0.08]} color="#0c1828" metalness={0.8} />
      <Box at={[0, 2.6, -1.61]} size={[3.2, 0.18, 0.02]} color={room.accentColor} emissive={room.accentColor} emissiveIntensity={0.6} opacity={0.7} />
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

      {/* Themed Furniture & Hardware based on room.theme */}
      {room.theme === 'quantum' && (
        <group position={[0, 0.8, -0.8]}>
          <Box at={[-0.8, 0, 0]} size={[1.0, 1.6, 0.6]} color="#111f30" metalness={0.85} />
          <Box at={[0.8, 0, 0]} size={[1.0, 1.6, 0.6]} color="#111f30" metalness={0.85} />
          <mesh position={[0, 0.2, 0]}>
            <torusGeometry args={[0.45, 0.025, 8, 24]} />
            <meshBasicMaterial color={room.accentColor} />
          </mesh>
        </group>
      )}

      {room.theme === 'lounge' && (
        <group position={[0, 0.25, 0]}>
          {/* Cyber Lounge Couches */}
          <Box at={[0, 0.1, -0.6]} size={[2.2, 0.35, 0.7]} color="#1a2d42" metalness={0.5} />
          <Box at={[0, 0.45, -0.9]} size={[2.2, 0.4, 0.15]} color="#132336" metalness={0.5} />
          <Box at={[0, 0.1, 0.4]} size={[1.2, 0.2, 0.6]} color="#0f1a26" metalness={0.8} />
        </group>
      )}

      {room.theme !== 'lounge' && (
        /* Standard Workstation Desk & Curved Monitor */
        <group position={[0, 0, 0.4]}>
          <Box at={[0, 0.42, 0]} size={[1.6, 0.08, 0.8]} color="#17283c" metalness={0.7} />
          <Box at={[0, 0.2, 0]} size={[1.4, 0.4, 0.6]} color="#0c1825" metalness={0.85} />
          {/* Seated Desk Chair */}
          <Box at={[0, 0.24, 0.55]} size={[0.4, 0.38, 0.4]} color="#1f344a" metalness={0.6} />
          {/* Dual Monitor Setup */}
          <Box at={[-0.32, 0.72, -0.15]} size={[0.55, 0.32, 0.03]} color="#091420" />
          <Box at={[-0.32, 0.72, -0.13]} size={[0.5, 0.28, 0.005]} color={room.accentColor} emissive={room.accentColor} emissiveIntensity={0.6} opacity={0.75} />
          <Box at={[0.32, 0.72, -0.15]} size={[0.55, 0.32, 0.03]} color="#091420" />
          <Box at={[0.32, 0.72, -0.13]} size={[0.5, 0.28, 0.005]} color={room.accentColor} emissive={room.accentColor} emissiveIntensity={0.6} opacity={0.75} />
        </group>
      )}
    </group>
  );
}

// --------------------------------------------------------------------------
// 1. ANTIGRAVITY RESEARCH LAB (Zero-G Levitation Emitter, Chrome Spheres & Drones)
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
    <group position={[-3.8, 0, -0.2]} onClick={(e) => { e.stopPropagation(); onOpenRoom('vision'); }}>
      <Box at={[-0.2, 2.9, -1.8]} size={[3.4, 0.25, 0.06]} color="#0c1828" metalness={0.8} />
      <Box at={[-0.2, 2.9, -1.76]} size={[3.2, 0.18, 0.02]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={0.5} opacity={0.6} />
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[2.0, 2.15, 0.07, 48]} />
        <meshStandardMaterial color="#122033" metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.075, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.65, 1.95, 48]} />
        <meshBasicMaterial color="#00f2fe" side={THREE.DoubleSide} />
      </mesh>
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
      </group>
      <group ref={drone1} position={[-0.9, 1.35, 0.7]}>
        <mesh>
          <boxGeometry args={[0.22, 0.06, 0.22]} />
          <meshStandardMaterial color="#1a2b3d" metalness={0.8} />
        </mesh>
        {[-0.12, 0.12].map((dx) =>
          [-0.12, 0.12].map((dz) => (
            <mesh key={`p-${dx}-${dz}`} position={[dx, 0.03, dz]}>
              <torusGeometry args={[0.05, 0.012, 8, 16]} />
              <meshBasicMaterial color="#00f2fe" />
            </mesh>
          ))
        )}
      </group>
    </group>
  );
}

// --------------------------------------------------------------------------
// 2. MISSION CONTROL / COMMAND OFFICE (Holographic Global Grid)
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
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.16)';
    ctx.lineWidth = 1;
    for (let x = 0; x < 1024; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke(); }
    for (let y = 0; y < 512; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0, 242, 254, 0.32)';
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
    <group position={[0.5, 1.4, -3.2]} onClick={(e) => { e.stopPropagation(); onOpenRoom('tasks'); }}>
      <mesh position={[0, 1.6, -0.85]}>
        <planeGeometry args={[4.4, 2.2]} />
        {mapTexture ? <meshBasicMaterial map={mapTexture} transparent opacity={0.88} /> : <meshBasicMaterial color="#00f2fe" transparent opacity={0.3} />}
      </mesh>
      <Box at={[0, 2.72, -0.84]} size={[4.46, 0.05, 0.04]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1} />
      <Box at={[0, 0.45, 0]} size={[3.4, 0.08, 0.9]} color="#17283c" metalness={0.7} />
      <Box at={[0, 0.22, 0]} size={[3.2, 0.42, 0.7]} color="#0d1825" metalness={0.85} />
    </group>
  );
}

// --------------------------------------------------------------------------
// 3. TECH SUITE & DATA BAY (Holographic Data Globe)
// --------------------------------------------------------------------------
function TechSuite({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const globe = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (globe.current) globe.current.rotation.y = clock.elapsedTime * 0.4;
  });

  return (
    <group position={[4.2, 1.4, -2.2]} onClick={(e) => { e.stopPropagation(); onOpenRoom('data'); }}>
      {[-1.2, -0.3, 0.6].map((sx, idx) => (
        <group key={idx} position={[sx, 1.1, -1.0]}>
          <Box at={[0, 0, 0]} size={[0.72, 2.2, 0.65]} color="#111d2b" metalness={0.85} roughness={0.3} />
        </group>
      ))}
      <group ref={globe} position={[0.4, 1.25, 0.5]}>
        <mesh>
          <sphereGeometry args={[0.55, 20, 20]} />
          <meshBasicMaterial color="#00f2fe" wireframe transparent opacity={0.65} />
        </mesh>
      </group>
      <Box at={[0.4, 0.45, 0.5]} size={[1.4, 0.08, 0.8]} color="#17283c" metalness={0.7} />
    </group>
  );
}

// --------------------------------------------------------------------------
// 4. INTELLIGENCE CORE BAY (Giant Quantum Reactor with 3D Atomic Rings)
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
    <group position={[7.1, 2.2, 0]} onClick={(e) => { e.stopPropagation(); onOpenRoom('main'); }}>
      <mesh position={[0, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[1.75, 0.24, 18, 48]} />
        <meshStandardMaterial color="#21354c" metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh position={[-0.05, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[1.5, 0.08, 16, 48]} />
        <meshBasicMaterial color="#00f2fe" />
      </mesh>
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
      <mesh ref={corePlasma} position={[-0.08, 0, 0]}>
        <sphereGeometry args={[0.3, 24, 24]} />
        <meshStandardMaterial color="#e0f8ff" emissive="#00f2fe" emissiveIntensity={2.8} />
      </mesh>
    </group>
  );
}

// --------------------------------------------------------------------------
// 5. QUANTUM COMPUTE HUB (Mezzanine & 5 Glowing RGB Cooling Pipes)
// --------------------------------------------------------------------------
function QuantumComputeHub({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const rgbColors = ['#ff3b56', '#f5a623', '#2bd47d', '#2c7be5', '#00f2fe'];
  return (
    <group position={[-3.8, 2.8, -2.4]} onClick={(e) => { e.stopPropagation(); onOpenRoom('agents'); }}>
      <Box at={[0, -0.06, 0]} size={[4.4, 0.12, 3.2]} color="#142337" metalness={0.8} />
      <Box at={[0, 0.45, 1.55]} size={[4.4, 0.04, 0.04]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={0.8} />
      {rgbColors.map((pipeColor, pi) => (
        <group key={pi} position={[-1.6 + pi * 0.35, 1.9, -1.2]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.055, 0.055, 0.8, 16]} />
            <meshStandardMaterial color={pipeColor} emissive={pipeColor} emissiveIntensity={1.8} />
          </mesh>
        </group>
      ))}
      <Box at={[-0.2, 0.45, 0.6]} size={[1.8, 0.08, 0.7]} color="#1a2d42" metalness={0.7} />
    </group>
  );
}

// --------------------------------------------------------------------------
// 6. BIOMETRICS & CYBERNETICS LAB (Robotic Rig & Workstation)
// --------------------------------------------------------------------------
function BiometricsLab({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const robotArm = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (robotArm.current) robotArm.current.rotation.y = Math.sin(clock.elapsedTime * 1.5) * 0.35;
  });

  return (
    <group position={[-2.6, 0, 2.6]} onClick={(e) => { e.stopPropagation(); onOpenRoom('wellness'); }}>
      <Box at={[0.6, 0.38, 0]} size={[1.6, 0.08, 0.8]} color="#182c40" metalness={0.7} />
      <Box at={[0.6, 0.22, 0.6]} size={[0.42, 0.38, 0.42]} color="#21374d" metalness={0.6} />
      <group position={[-1.1, 0, 0]}>
        <Box at={[0, 0.25, 0]} size={[0.9, 0.5, 0.9]} color="#162537" metalness={0.8} />
        <mesh position={[0, 0.52, 0]}>
          <cylinderGeometry args={[0.35, 0.35, 0.06, 24]} />
          <meshStandardMaterial color="#00f2fe" emissive="#00f2fe" emissiveIntensity={0.8} />
        </mesh>
        <group ref={robotArm} position={[0, 0.55, -0.25]}>
          <mesh><sphereGeometry args={[0.09, 14, 14]} /><meshStandardMaterial color="#364e66" metalness={0.85} /></mesh>
          <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.04, 0.04, 0.4, 12]} /><meshStandardMaterial color="#7f9db8" metalness={0.8} /></mesh>
        </group>
      </group>
    </group>
  );
}

// --------------------------------------------------------------------------
// INDUSTRIAL ATRIUM ARCHITECTURE
// --------------------------------------------------------------------------
function IndustrialAtrium() {
  return (
    <group>
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <boxGeometry args={[18.5, 0.12, 14.5]} />
        <meshStandardMaterial color="#08101a" metalness={0.85} roughness={0.3} />
      </mesh>
      {/* Elevated Catwalk Bridge */}
      <group position={[0, 1.4, 0.8]}>
        <Box at={[1.2, -0.06, 0]} size={[10.5, 0.12, 1.6]} color="#132336" metalness={0.8} />
        <Box at={[1.2, 0, 0.8]} size={[10.5, 0.03, 0.05]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1} />
        <Box at={[1.2, 0, -0.8]} size={[10.5, 0.03, 0.05]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1} />
      </group>
      {/* Industrial Stairs */}
      <group position={[-5.8, 0, 0.8]}>
        {Array.from({ length: 12 }).map((_, stepIdx) => (
          <group key={`st-${stepIdx}`} position={[0, 0.12 + stepIdx * 0.12, 1.6 - stepIdx * 0.22]}>
            <Box at={[0, 0, 0]} size={[1.1, 0.08, 0.28]} color="#182c40" metalness={0.7} />
            <Box at={[0, 0.042, 0.12]} size={[1.05, 0.015, 0.03]} color="#f5a623" emissive="#f5a623" emissiveIntensity={0.7} />
          </group>
        ))}
      </group>
      {/* Overhead Gantry Steel Truss */}
      <group position={[0, 5.4, 0]}>
        <Box at={[0, 0, 0]} size={[17.2, 0.35, 0.4]} color="#1a2d42" metalness={0.85} />
      </group>
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
}: {
  agentSouls: AgentSoul[];
  customRooms: CustomRoom[];
  selectedAgentId?: string | null;
  onSelectAgent: (id: string, name: string) => void;
  onOpenRoom: (dest: string) => void;
  onOpenAgentSoul: (soul: AgentSoul) => void;
  focusTarget: [number, number, number] | null;
  controlsRef: React.RefObject<any>;
}) {
  const [speechIndex, setSpeechIndex] = useState(0);

  const dialoguePhrases = [
    'Neural state synchronized across 11 agent nodes.',
    'Anti-gravity field stable within 0.02G tolerance.',
    'Executing real-time task handoff from Orchestrator.',
    'Mission Control telemetry uplink operational.',
    'Calibrating cybernetic feedback loop.',
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

      <ambientLight intensity={1.3} color="#8cb0d4" />
      <directionalLight position={[9, 14, 10]} intensity={2.4} color="#cde5ff" castShadow />
      <pointLight position={[-3.8, 2.2, 0]} intensity={12} color="#00f2fe" distance={10} />
      <pointLight position={[6.8, 2.5, 0]} intensity={18} color="#00f2fe" distance={12} />

      <CameraRig focusPosition={focusTarget} controlsRef={controlsRef} />

      <IndustrialAtrium />

      {/* 6 Core Cyber Rooms */}
      <AntigravityLab onOpenRoom={onOpenRoom} />
      <MissionControl onOpenRoom={onOpenRoom} />
      <TechSuite onOpenRoom={onOpenRoom} />
      <QuantumReactor onOpenRoom={onOpenRoom} />
      <QuantumComputeHub onOpenRoom={onOpenRoom} />
      <BiometricsLab onOpenRoom={onOpenRoom} />

      {/* Render Dynamic Custom User Rooms */}
      {customRooms.map((room) => (
        <CustomRoomNode key={room.id} room={room} onOpenRoom={onOpenRoom} />
      ))}

      {/* Deploy Realistic Articulated Human Agents */}
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
        maxDistance={28}
        minPolarAngle={0.25}
        maxPolarAngle={1.4}
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
          agentSouls={agentSouls}
          customRooms={customRooms}
          selectedAgentId={selectedAgentId}
          onSelectAgent={onSelectAgent}
          onOpenRoom={onOpenRoom}
          onOpenAgentSoul={onOpenAgentSoul}
          focusTarget={focusTarget}
          controlsRef={controlsRef}
        />
      </Canvas>
    </div>
  );
}
