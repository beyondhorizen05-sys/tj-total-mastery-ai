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
  workstationsCount?: number;
}

export interface LivingHQSceneProps {
  agents?: TownAgent[];
  messages?: any[];
  agentSouls?: AgentSoul[];
  customRooms?: CustomRoom[];
  departmentPositions?: Record<string, [number, number, number]>;
  selectedRoomId?: string | null;
  isArchitectMode?: boolean;
  onSelectRoomForMove?: (roomId: string) => void;
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
  isAutoOrbit?: boolean;
}

// --------------------------------------------------------------------------
// REUSABLE 3D BOX WITH CLEAN SPECULAR HIGHLIGHTS
// --------------------------------------------------------------------------
function Box({
  at,
  size,
  color,
  emissive,
  emissiveIntensity = 0,
  opacity = 1,
  metalness = 0.4,
  roughness = 0.35,
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
// CAMERA CONTROLLER WITH SMOOTH FLIGHT INTERPOLATION
// --------------------------------------------------------------------------
// CAMERA CONTROLLER WITH SMOOTH FLIGHT INTERPOLATION & 360 FREE ORBIT RELEASE
// --------------------------------------------------------------------------
function CameraRig({
  focusPosition,
  controlsRef,
}: {
  focusPosition: [number, number, number] | null;
  controlsRef: React.RefObject<any>;
}) {
  const { camera } = useThree();
  const lastTargetRef = useRef<[number, number, number] | null>(null);
  const isTransitioningRef = useRef(false);
  const transitionFramesRef = useRef(0);

  // When focusPosition changes, trigger a smooth transition
  useEffect(() => {
    if (focusPosition) {
      const isDifferent =
        !lastTargetRef.current ||
        Math.abs(lastTargetRef.current[0] - focusPosition[0]) > 0.1 ||
        Math.abs(lastTargetRef.current[2] - focusPosition[2]) > 0.1;

      if (isDifferent) {
        lastTargetRef.current = [...focusPosition];
        isTransitioningRef.current = true;
        transitionFramesRef.current = 0;
      }
    } else {
      lastTargetRef.current = null;
      isTransitioningRef.current = false;
    }
  }, [focusPosition]);

  // When the user starts rotating or dragging with mouse/touch, immediately release camera
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const onStart = () => {
      isTransitioningRef.current = false;
    };

    controls.addEventListener('start', onStart);
    return () => {
      controls.removeEventListener('start', onStart);
    };
  }, [controlsRef]);

  useFrame(() => {
    if (!isTransitioningRef.current || !focusPosition || !controlsRef.current) return;

    const targetLook = new THREE.Vector3(
      focusPosition[0],
      focusPosition[1] + 1.0,
      focusPosition[2]
    );

    // Keep camera angle smoothly aligned rather than pinning to a single corner
    const offset = camera.position.clone().sub(controlsRef.current.target);
    let dist = offset.length();
    if (dist < 4 || dist > 14) dist = 7.0;

    const dir = offset.normalize();
    if (dir.lengthSq() < 0.01) dir.set(0.65, 0.45, 0.65).normalize();

    const targetCam = targetLook.clone().add(dir.multiplyScalar(dist));

    camera.position.lerp(targetCam, 0.08);
    controlsRef.current.target.lerp(targetLook, 0.08);
    controlsRef.current.update();

    transitionFramesRef.current += 1;
    // Release control after ~40 frames (~0.65s) or once target is reached, giving user 100% 360 free orbit!
    if (
      transitionFramesRef.current > 42 ||
      controlsRef.current.target.distanceTo(targetLook) < 0.08
    ) {
      isTransitioningRef.current = false;
    }
  });

  return null;
}

/** Stop spending GPU time while the browser tab is in the background. */
function PauseSceneWhenHidden() {
  const setFrameloop = useThree((state) => state.setFrameloop);

  useEffect(() => {
    const updateFrameloop = () => {
      setFrameloop(document.visibilityState === 'hidden' ? 'never' : 'always');
    };

    updateFrameloop();
    document.addEventListener('visibilitychange', updateFrameloop);
    return () => document.removeEventListener('visibilitychange', updateFrameloop);
  }, [setFrameloop]);

  return null;
}

// --------------------------------------------------------------------------
// POWERFUL MULTI-SOURCE ARCHITECTURAL LIGHTING (NOT PITCH BLACK!)
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
  });

  const h = internalTime;
  const isNight = h < 5.5 || h > 19.5;
  const isSunset = h >= 17 && h <= 19.5;

  const sunAngle = (h / 24) * Math.PI * 2 - Math.PI / 2;
  const sunX = Math.cos(sunAngle) * 36;
  const sunY = Math.sin(sunAngle) * 26;
  const sunZ = Math.cos(sunAngle * 0.6) * 20;

  // Rich, vibrant, bright colors — NO pitch-black void
  let sunColor = '#fffbf0';
  let sunIntensity = 3.6;
  let hemiSky = '#e2e8f0';
  let hemiGround = '#475569';
  let bgColor = '#1e3859';
  let fogColor = '#18314e';

  if (isNight) {
    sunColor = '#7cb3e8';
    sunIntensity = 1.8; // Bright moonlight
    hemiSky = '#94b8e2';
    hemiGround = '#334155';
    bgColor = '#0f172a'; // Tailwind slate-900: Clean cyber navy, NOT pitch black
    fogColor = '#0f172a';
  } else if (isSunset) {
    sunColor = '#ff925c';
    sunIntensity = 2.8;
    hemiSky = '#fed7aa';
    hemiGround = '#475569';
    bgColor = '#431407';
    fogColor = '#3b1206';
  }

  return (
    <>
      <color attach="background" args={[bgColor]} />
      <fog attach="fog" args={[fogColor, 35, 95]} />

      {/* 1. Hemisphere Light: Soft ambient gradient ensuring all surfaces have base visibility */}
      <hemisphereLight args={[hemiSky, hemiGround, 2.4]} />

      {/* 2. Strong Ambient Fill */}
      <ambientLight intensity={1.8} color="#cbd5e1" />

      {/* 3. Primary Directional Sunlight / Moonlight */}
      <directionalLight
        ref={sunLight}
        position={[sunX, Math.max(sunY, 8), sunZ]}
        intensity={sunIntensity}
        color={sunColor}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />

      {/* 4. Opposing Fill Lights to eliminate harsh shadows */}
      <directionalLight position={[-24, 22, -18]} intensity={2.2} color="#38bdf8" />
      <directionalLight position={[20, 18, 20]} intensity={1.8} color="#f8fafc" />

      {/* 5. Overhead High-Bay Floodlights over the Atrium & Corridors */}
      <pointLight position={[0, 9.0, 0]} intensity={60} distance={50} color="#e0f2fe" />
      <pointLight position={[-9.0, 8.0, 0]} intensity={45} distance={40} color="#e0f2fe" />
      <pointLight position={[9.0, 8.0, 0]} intensity={45} distance={40} color="#e0f2fe" />
      <pointLight position={[0, 7.0, -8.0]} intensity={45} distance={35} color="#38bdf8" />
    </>
  );
}

function getAgentWaypoints(soul: AgentSoul, seed: number): Array<[number, number, number]> {
  const [rx, , rz] = soul.restPos;
  const p1: [number, number, number] = [rx, 0, rz];
  const bX = rx > 0 ? 13.0 : -13.0;
  const p2: [number, number, number] = Math.abs(rx) < 5 ? [0, 0, rz > 0 ? 12.0 : -12.0] : [bX, 0, rz];
  const angle = (seed * 1.57) % (Math.PI * 2);
  const coreRadius = 3.6 + (seed % 2.4);
  const p3: [number, number, number] = [
    Math.cos(angle) * coreRadius,
    0,
    Math.sin(angle) * coreRadius,
  ];
  const p4: [number, number, number] = [
    Math.sin(seed * 2.1) * 7.0,
    0,
    Math.cos(seed * 1.7) * 8.5,
  ];
  const p5: [number, number, number] = [
    (seed % 2 === 0 ? 1 : -1) * (6.0 + (seed % 6)),
    0,
    (seed % 3 === 0 ? 1 : -1) * (4.0 + (seed % 7)),
  ];
  return [p1, p2, p3, p4, p5];
}

// --------------------------------------------------------------------------
// REALISTIC 3D ANATOMICAL HUMAN AGENT (SEATED WORK, WALK & REST)
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

  const [hovered, setHovered] = useState(false);

  const seed = useMemo(
    () => soul.id.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0) * 0.17,
    [soul.id]
  );

  const waypoints = useMemo(() => getAgentWaypoints(soul, seed), [soul, seed]);

  // Precalculate realistic distance-based segments:
  // Human calm walking speed = 1.15 m/s, realistic stride = 1.35m per 2 steps
  const segmentData = useMemo(() => {
    const WALK_SPEED = 1.15; // calm realistic human walking pace (m/s)
    const segs: Array<{
      pA: [number, number, number];
      pB: [number, number, number];
      dist: number;
      walkTime: number;
      pauseTime: number;
      segDuration: number;
      startTime: number;
    }> = [];
    let totalTime = 0;

    for (let i = 0; i < waypoints.length; i++) {
      const pA = waypoints[i];
      const pB = waypoints[(i + 1) % waypoints.length];
      const dist = Math.hypot(pB[0] - pA[0], pB[2] - pA[2]);
      const walkTime = Math.max(3.5, dist / WALK_SPEED);
      const pauseTime = 6.0 + ((seed * (i + 1)) % 4.0); // 6 to 10 seconds calm dwell at each waypoint
      const segDuration = walkTime + pauseTime;
      segs.push({ pA, pB, dist, walkTime, pauseTime, segDuration, startTime: totalTime });
      totalTime += segDuration;
    }
    return { segs, totalDuration: totalTime };
  }, [waypoints, seed]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed * 8;
    if (!root.current) return;

    if (soul.status === 'working') {
      // PROPER SEATED HUMAN WORKING AT DESK
      root.current.position.set(
        soul.workstationPos[0],
        soul.workstationPos[1] - 0.22,
        soul.workstationPos[2]
      );
      root.current.rotation.y = 0;

      if (leftThigh.current && rightThigh.current) {
        leftThigh.current.rotation.x = -Math.PI / 2 + 0.08;
        rightThigh.current.rotation.x = -Math.PI / 2 + 0.08;
      }
      if (leftCalf.current && rightCalf.current) {
        leftCalf.current.rotation.x = Math.PI / 2 - 0.12;
        rightCalf.current.rotation.x = Math.PI / 2 - 0.12;
      }

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

      if (head.current) {
        head.current.rotation.y = Math.sin(t * 0.75) * 0.25;
        head.current.rotation.x = -0.12 + Math.sin(t * 1.4) * 0.06;
      }
    } else {
      // FREE AUTONOMOUS CALM HUMAN WALKING & DWELLING AROUND CAMPUS
      const loopTime = t % segmentData.totalDuration;
      const seg =
        segmentData.segs.find(
          (s) => loopTime >= s.startTime && loopTime < s.startTime + s.segDuration
        ) || segmentData.segs[0];
      const elapsedInSeg = loopTime - seg.startTime;

      if (elapsedInSeg < seg.walkTime) {
        // --- 1. NATURAL HUMAN WALKING GAIT ---
        const rawProgress = elapsedInSeg / seg.walkTime; // 0 to 1
        // Smooth human acceleration and deceleration (ease in-out)
        const progress = 0.5 - 0.5 * Math.cos(rawProgress * Math.PI);

        // Ground coordinates
        const curX = THREE.MathUtils.lerp(seg.pA[0], seg.pB[0], progress);
        const curZ = THREE.MathUtils.lerp(seg.pA[2], seg.pB[2], progress);

        // Stride phase strictly synchronized to physical ground distance (1.35m = 2 steps)
        const distCovered = rawProgress * seg.dist;
        const stridePhase = (distCovered / 1.35) * Math.PI * 2;

        // Subtle vertical bounce of pelvis during stepping
        const bounce = Math.abs(Math.sin(stridePhase)) * 0.022;
        root.current.position.set(curX, bounce, curZ);

        // Smooth heading rotation towards target
        const dx = seg.pB[0] - seg.pA[0];
        const dz = seg.pB[2] - seg.pA[2];
        if (Math.hypot(dx, dz) > 0.01) {
          const targetHeading = Math.atan2(dx, dz);
          let diff = targetHeading - root.current.rotation.y;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          root.current.rotation.y += diff * 0.06;
        }

        // Leg stride kinematics: natural human swing (~24 degrees max)
        const legSwing = Math.sin(stridePhase) * 0.42;
        if (leftThigh.current && rightThigh.current) {
          leftThigh.current.rotation.x = legSwing;
          rightThigh.current.rotation.x = -legSwing;
        }
        if (leftCalf.current && rightCalf.current) {
          // Knee flexes backwards on backswing to clear the ground naturally
          leftCalf.current.rotation.x = Math.max(0, -legSwing * 1.15);
          rightCalf.current.rotation.x = Math.max(0, legSwing * 1.15);
        }

        // Arm counter-swing (opposite to legs)
        if (leftUpperArm.current && rightUpperArm.current) {
          leftUpperArm.current.rotation.x = -legSwing * 0.65;
          rightUpperArm.current.rotation.x = legSwing * 0.65;
        }
        if (leftForearm.current && rightForearm.current) {
          leftForearm.current.rotation.x = -0.22;
          rightForearm.current.rotation.x = -0.22;
        }

        // Head looking calmly forward with subtle glance
        if (head.current) {
          head.current.rotation.y = Math.sin(stridePhase * 0.5) * 0.06;
          head.current.rotation.x = 0.02;
        }
      } else {
        // --- 2. CALM HUMAN DWELL / PAUSE AT WAYPOINT ---
        root.current.position.set(seg.pB[0], 0, seg.pB[2]);

        // Gentle natural human breathing
        const breathe = Math.sin(t * 1.4) * 0.012;
        root.current.position.y = breathe;

        // Legs return smoothly to comfortable standing stance
        if (leftThigh.current && rightThigh.current) {
          leftThigh.current.rotation.x = THREE.MathUtils.lerp(leftThigh.current.rotation.x, 0.03, 0.08);
          rightThigh.current.rotation.x = THREE.MathUtils.lerp(rightThigh.current.rotation.x, -0.03, 0.08);
        }
        if (leftCalf.current && rightCalf.current) {
          leftCalf.current.rotation.x = THREE.MathUtils.lerp(leftCalf.current.rotation.x, 0, 0.08);
          rightCalf.current.rotation.x = THREE.MathUtils.lerp(rightCalf.current.rotation.x, 0, 0.08);
        }
        if (leftUpperArm.current && rightUpperArm.current) {
          leftUpperArm.current.rotation.x = THREE.MathUtils.lerp(leftUpperArm.current.rotation.x, 0.08, 0.08);
          rightUpperArm.current.rotation.x = THREE.MathUtils.lerp(rightUpperArm.current.rotation.x, 0.08, 0.08);
        }
        if (leftForearm.current && rightForearm.current) {
          leftForearm.current.rotation.x = THREE.MathUtils.lerp(leftForearm.current.rotation.x, -0.15, 0.08);
          rightForearm.current.rotation.x = THREE.MathUtils.lerp(rightForearm.current.rotation.x, -0.15, 0.08);
        }

        // Lifelike human head observation: looking calmly around the campus
        if (head.current) {
          const lookCycle = Math.sin(t * 0.45);
          head.current.rotation.y = THREE.MathUtils.lerp(head.current.rotation.y, lookCycle * 0.35, 0.04);
          head.current.rotation.x = THREE.MathUtils.lerp(head.current.rotation.x, -0.03 + Math.sin(t * 0.9) * 0.03, 0.04);
        }
      }
    }
  });

  const skin = soul.skinColor;
  const pants = '#1e2d3f';
  const boots = '#0f172a';

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
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(soul.id, soul.name);
        onInspectSoul(soul);
      }}
    >
      {/* 3D FLOATING NAME BADGE (SHORT, MINIMALIST & CLEAN) */}
      <Html position={[0, 2.05, 0]} center distanceFactor={24} style={{ pointerEvents: 'none' }}>
        <div
          style={{
            cursor: 'pointer',
            background: hovered || selected ? 'rgba(8, 18, 34, 0.98)' : 'rgba(10, 20, 36, 0.88)',
            border: `1px solid ${selected ? '#00f2fe' : hovered ? '#00f2fe' : 'rgba(0, 242, 254, 0.4)'}`,
            boxShadow: selected || hovered ? '0 0 14px rgba(0, 242, 254, 0.65)' : `0 0 8px ${statusColor}55`,
            borderRadius: 12,
            padding: '2px 7px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 9,
            fontWeight: 800,
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            whiteSpace: 'nowrap',
            transform: selected ? 'scale(1.15)' : hovered ? 'scale(1.1)' : 'scale(1.0)',
            transition: 'all 0.18s ease',
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: statusColor,
              boxShadow: `0 0 6px ${statusColor}`,
            }}
          />
          <span style={{ letterSpacing: '0.05em', color: selected ? '#00f2fe' : '#ffffff' }}>{soul.name}</span>
        </div>
      </Html>

      {/* SPEECH BUBBLE WHEN ACTIVE */}
      {speechText && soul.status === 'collaborating' && (
        <Html position={[0, 2.35, 0]} center distanceFactor={16}>
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.96)',
              border: '1px solid #00f2fe',
              boxShadow: '0 0 14px rgba(0, 242, 254, 0.4)',
              borderRadius: 8,
              padding: '4px 10px',
              fontFamily: 'Plus Jakarta Sans',
              fontSize: 10,
              color: '#f8fafc',
              maxWidth: 180,
              textAlign: 'center',
            }}
          >
            "{speechText}"
          </div>
        </Html>
      )}

      {/* ANATOMICAL TORSO & TACTICAL JACKET */}
      <group position={[0, 1.05, 0]}>
        <mesh castShadow>
          <boxGeometry
            args={[
              soul.gender === 'male' ? 0.38 : 0.32,
              0.48,
              soul.gender === 'male' ? 0.22 : 0.18,
            ]}
          />
          <meshStandardMaterial color={soul.jacketColor} roughness={0.35} metalness={0.25} />
        </mesh>
        <mesh position={[0, 0.06, 0.11]}>
          <boxGeometry args={[0.26, 0.28, 0.03]} />
          <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>

      {/* PELVIS */}
      <group position={[0, 0.8, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.32, 0.15, 0.2]} />
          <meshStandardMaterial color={pants} roughness={0.55} />
        </mesh>
      </group>

      {/* HEAD & STYLED 3D HAIR */}
      <group ref={head} position={[0, 1.48, 0]}>
        <mesh position={[0, -0.1, 0]}>
          <cylinderGeometry args={[0.055, 0.065, 0.12, 12]} />
          <meshStandardMaterial color={skin} roughness={0.6} />
        </mesh>
        <mesh castShadow position={[0, 0.02, 0]}>
          <sphereGeometry args={[0.118, 18, 18]} />
          <meshStandardMaterial color={skin} roughness={0.55} />
        </mesh>
        <mesh position={[0, -0.04, 0.05]}>
          <boxGeometry args={[0.09, 0.06, 0.08]} />
          <meshStandardMaterial color={skin} roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.04, 0.11]}>
          <boxGeometry args={[0.13, 0.035, 0.03]} />
          <meshBasicMaterial color="#00f2fe" transparent opacity={0.75} />
        </mesh>

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
            <meshStandardMaterial color="#1e293b" roughness={0.5} />
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
            <meshStandardMaterial color="#1e293b" roughness={0.5} />
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
// BIOPHILIC CYBER PLANTER (LUSH FOLIAGE + BIOLUMINESCENT FLORA NODES)
// --------------------------------------------------------------------------
function CyberPlanter({
  position,
  accentColor = '#10b981',
  scale = 1.0,
}: {
  position: [number, number, number];
  accentColor?: string;
  scale?: number;
}) {
  return (
    <group position={position} scale={[scale, scale, scale]}>
      {/* Octagonal Gunmetal Planter Basin */}
      <mesh position={[0, 0.26, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.34, 0.28, 0.52, 8]} />
        <meshStandardMaterial color="#1e293b" metalness={0.75} roughness={0.3} />
      </mesh>
      {/* Glowing Rim Ring */}
      <mesh position={[0, 0.525, 0]}>
        <cylinderGeometry args={[0.35, 0.35, 0.03, 16]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={1.8} />
      </mesh>
      {/* Dark Soil Bed */}
      <mesh position={[0, 0.51, 0]}>
        <cylinderGeometry args={[0.32, 0.32, 0.04, 16]} />
        <meshStandardMaterial color="#0f172a" roughness={0.9} />
      </mesh>

      {/* Layered Tropical Cyber Foliage (Deep Emerald + Bioluminescent Tips) */}
      {[0, (Math.PI * 2) / 5, (Math.PI * 4) / 5, (Math.PI * 6) / 5, (Math.PI * 8) / 5].map(
        (rot, i) => (
          <group key={i} rotation={[0, rot, 0]}>
            <mesh position={[0.18, 0.72, 0]} rotation={[0, 0, -0.45]}>
              <boxGeometry args={[0.28, 0.02, 0.14]} />
              <meshStandardMaterial color="#047857" roughness={0.4} metalness={0.2} />
            </mesh>
            <mesh position={[0.32, 0.65, 0]}>
              <sphereGeometry args={[0.025, 8, 8]} />
              <meshStandardMaterial color="#34d399" emissive="#34d399" emissiveIntensity={2.5} />
            </mesh>
          </group>
        )
      )}

      {/* Tall Central Exotic Stalk & Glowing Spire Node */}
      <mesh position={[0, 0.78, 0]}>
        <cylinderGeometry args={[0.02, 0.03, 0.55, 8]} />
        <meshStandardMaterial color="#065f46" roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.08, 0]}>
        <sphereGeometry args={[0.055, 12, 12]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={3.0} />
      </mesh>
    </group>
  );
}

// --------------------------------------------------------------------------
// STREET LIGHT BOLLARD (AVENUE PATHWAY ILLUMINATION)
// --------------------------------------------------------------------------
function StreetLightBollard({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Dark Titanium Base Post */}
      <mesh position={[0, 0.42, 0]}>
        <cylinderGeometry args={[0.07, 0.08, 0.84, 16]} />
        <meshStandardMaterial color="#1e293b" metalness={0.85} roughness={0.25} />
      </mesh>
      {/* 360-degree Glowing Acrylic Slit */}
      <mesh position={[0, 0.72, 0]}>
        <cylinderGeometry args={[0.065, 0.065, 0.08, 16]} />
        <meshStandardMaterial color="#00f2fe" emissive="#00f2fe" emissiveIntensity={3.2} />
      </mesh>
      {/* Cap */}
      <mesh position={[0, 0.82, 0]}>
        <cylinderGeometry args={[0.075, 0.075, 0.04, 16]} />
        <meshStandardMaterial color="#0f172a" metalness={0.9} />
      </mesh>
      {/* Soft Downlight Pool */}
      <pointLight position={[0, 0.75, 0]} intensity={3.5} distance={4.2} color="#00f2fe" />
    </group>
  );
}

// --------------------------------------------------------------------------
// CYBER BENCH (AVENUE ERGONOMIC SEATING)
// --------------------------------------------------------------------------
function CyberBench({
  position,
  rotationY = 0,
}: {
  position: [number, number, number];
  rotationY?: number;
}) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Floating Titanium Bench Slab */}
      <Box at={[0, 0.42, 0]} size={[1.6, 0.08, 0.52]} color="#1e293b" metalness={0.8} roughness={0.3} />
      {/* Under-seat Cyan Neon Strip */}
      <Box at={[0, 0.37, 0]} size={[1.56, 0.02, 0.48]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.8} />
      {/* Dual Ground Supports */}
      <Box at={[-0.65, 0.19, 0]} size={[0.08, 0.38, 0.46]} color="#334155" metalness={0.9} />
      <Box at={[0.65, 0.19, 0]} size={[0.08, 0.38, 0.46]} color="#334155" metalness={0.9} />
      {/* Ergonomic Low Backrest */}
      <Box at={[0, 0.64, -0.23]} size={[1.6, 0.32, 0.05]} color="#0f172a" metalness={0.85} />
      <Box at={[0, 0.78, -0.23]} size={[1.56, 0.02, 0.06]} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1.2} />
    </group>
  );
}

// --------------------------------------------------------------------------
// HOLOGRAPHIC INFORMATION KIOSK / DATA TOTEM
// --------------------------------------------------------------------------
function HoloKiosk({
  position,
  rotationY = 0,
}: {
  position: [number, number, number];
  rotationY?: number;
}) {
  const panelRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (panelRef.current) {
      panelRef.current.position.y = 1.35 + Math.sin(clock.elapsedTime * 1.8) * 0.03;
    }
  });

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Base Pedestal */}
      <Box at={[0, 0.55, 0]} size={[0.38, 1.1, 0.22]} color="#1e293b" metalness={0.85} roughness={0.25} />
      <Box at={[0, 1.08, 0]} size={[0.42, 0.04, 0.26]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2.0} />

      {/* Floating Holographic Telemetry Screen */}
      <group ref={panelRef} position={[0, 1.35, 0.08]} rotation={[-0.2, 0, 0]}>
        <mesh>
          <planeGeometry args={[0.62, 0.44]} />
          <meshStandardMaterial
            color="#082f49"
            emissive="#00f2fe"
            emissiveIntensity={1.2}
            transparent
            opacity={0.85}
            side={THREE.DoubleSide}
          />
        </mesh>
        <Box at={[0, 0.22, 0]} size={[0.64, 0.015, 0.02]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2.5} />
      </group>
    </group>
  );
}

// --------------------------------------------------------------------------
// PHYSICAL ARCHITECTURAL SIGNBOARD MOUNTED ON BUILDING ENTRANCE FASCIA
// (NOT A LOOSE FLOATING SCREEN POPUP!)
// --------------------------------------------------------------------------
function BuildingSignboard({
  name,
  code,
  accentColor,
  doorSide,
  roomW,
  roomD,
  wallH,
}: {
  name: string;
  code: string;
  accentColor: string;
  doorSide: 'north' | 'south' | 'east' | 'west';
  roomW: number;
  roomD: number;
  wallH: number;
}) {
  let signPos: [number, number, number] = [0, wallH + 0.2, 0];
  let rotY = 0;
  if (doorSide === 'south') {
    signPos = [0, wallH + 0.2, roomD / 2 + 0.05];
    rotY = 0;
  } else if (doorSide === 'north') {
    signPos = [0, wallH + 0.2, -roomD / 2 - 0.05];
    rotY = Math.PI;
  } else if (doorSide === 'west') {
    signPos = [-roomW / 2 - 0.05, wallH + 0.2, 0];
    rotY = -Math.PI / 2;
  } else if (doorSide === 'east') {
    signPos = [roomW / 2 + 0.05, wallH + 0.2, 0];
    rotY = Math.PI / 2;
  }

  // Dynamically calculate board dimensions and font size to perfectly fit any room name!
  const maxBoardW = Math.min(roomW - 0.4, 4.8);
  const boardW = Math.max(2.6, Math.min(maxBoardW, name.length * 0.135));
  const boardH = 0.52;
  const titleFontSize = name.length > 25 ? '8.5px' : name.length > 18 ? '9.5px' : '11px';
  const titleLetterSpacing = name.length > 25 ? '0.02em' : '0.05em';

  return (
    <group position={signPos} rotation={[0, rotY, 0]}>
      {/* Dual Cantilever Heavy Metal Mounting Struts */}
      <Box at={[-boardW / 2 + 0.35, -0.06, -0.05]} size={[0.04, 0.16, 0.12]} color="#334155" metalness={0.9} />
      <Box at={[boardW / 2 - 0.35, -0.06, -0.05]} size={[0.04, 0.16, 0.12]} color="#334155" metalness={0.9} />

      {/* Titanium Slate Architectural Signboard Backplate */}
      <Box at={[0, 0, 0]} size={[boardW, boardH, 0.06]} color="#0f172a" metalness={0.88} roughness={0.2} />

      {/* Luminous Neon Perimeter Frame */}
      <Box at={[0, boardH / 2, 0.01]} size={[boardW + 0.02, 0.02, 0.07]} color={accentColor} emissive={accentColor} emissiveIntensity={2.2} />
      <Box at={[0, -boardH / 2, 0.01]} size={[boardW + 0.02, 0.02, 0.07]} color={accentColor} emissive={accentColor} emissiveIntensity={2.2} />
      <Box at={[-boardW / 2, 0, 0.01]} size={[0.02, boardH, 0.07]} color={accentColor} emissive={accentColor} emissiveIntensity={2.2} />
      <Box at={[boardW / 2, 0, 0.01]} size={[0.02, boardH, 0.07]} color={accentColor} emissive={accentColor} emissiveIntensity={2.2} />

      {/* Status LED Diode Pill on Left Side */}
      <mesh position={[-boardW / 2 + 0.18, 0, 0.035]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.032, 0.032, 0.02, 16]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={3} />
      </mesh>

      {/* Signboard Face Typography Center-Mounted in 3D Perspective */}
      <Html
        transform
        center
        position={[0.08, 0, 0.035]}
        distanceFactor={13}
        style={{ pointerEvents: 'none' }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '2px 10px',
            userSelect: 'none',
            maxWidth: `${Math.round(boardW * 100)}px`,
          }}
        >
          <div
            style={{
              fontSize: '7.5px',
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 800,
              color: accentColor,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              marginBottom: '1px',
            }}
          >
            ● [{code}] · SECTOR
          </div>
          <div
            style={{
              fontSize: titleFontSize,
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 900,
              letterSpacing: titleLetterSpacing,
              color: '#ffffff',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              textShadow: `0 0 10px ${accentColor}`,
            }}
          >
            {name}
          </div>
        </div>
      </Html>
    </group>
  );
}

// --------------------------------------------------------------------------
// SLIDING DOUBLE GLASS DOORS WITH BIOMETRIC SCANNER (ROOM ENTRANCE)
// --------------------------------------------------------------------------
function RoomDoorEntrance({
  doorSide,
  roomW,
  roomD,
  wallH,
  accentColor,
}: {
  doorSide: 'north' | 'south' | 'east' | 'west';
  roomW: number;
  roomD: number;
  wallH: number;
  accentColor: string;
}) {
  const doorW = 1.6;
  const doorH = 2.1;
  const isEW = doorSide === 'east' || doorSide === 'west';
  const wallDim = isEW ? roomD : roomW;
  const sidePanelW = Math.max(0.1, (wallDim - doorW) / 2);

  let doorPos: [number, number, number] = [0, 0, 0];
  let rotY = 0;
  if (doorSide === 'north') {
    doorPos = [0, 0, -roomD / 2];
    rotY = Math.PI;
  } else if (doorSide === 'south') {
    doorPos = [0, 0, roomD / 2];
    rotY = 0;
  } else if (doorSide === 'west') {
    doorPos = [-roomW / 2, 0, 0];
    rotY = -Math.PI / 2;
  } else if (doorSide === 'east') {
    doorPos = [roomW / 2, 0, 0];
    rotY = Math.PI / 2;
  }

  return (
    <group position={doorPos} rotation={[0, rotY, 0]}>
      {/* Left Glass Side-Lite Partition Wall */}
      {sidePanelW > 0.2 && (
        <mesh position={[-doorW / 2 - sidePanelW / 2, wallH / 2, 0]}>
          <boxGeometry args={[sidePanelW, wallH, 0.03]} />
          <meshStandardMaterial color="#bfdbfe" transparent opacity={0.22} roughness={0.1} depthWrite={false} />
        </mesh>
      )}

      {/* Right Glass Side-Lite Partition Wall */}
      {sidePanelW > 0.2 && (
        <mesh position={[doorW / 2 + sidePanelW / 2, wallH / 2, 0]}>
          <boxGeometry args={[sidePanelW, wallH, 0.03]} />
          <meshStandardMaterial color="#bfdbfe" transparent opacity={0.22} roughness={0.1} depthWrite={false} />
        </mesh>
      )}

      {/* Door Frame Left Jamb */}
      <Box at={[-doorW / 2, doorH / 2, 0]} size={[0.06, doorH, 0.08]} color="#1e293b" metalness={0.9} />
      {/* Door Frame Right Jamb */}
      <Box at={[doorW / 2, doorH / 2, 0]} size={[0.06, doorH, 0.08]} color="#1e293b" metalness={0.9} />
      {/* Top Door Track & Lintel Enclosure Box */}
      <Box at={[0, doorH + 0.06, 0]} size={[doorW + 0.12, 0.12, 0.1]} color="#1e293b" metalness={0.85} />
      {/* Cyan Access Status Light Bar across Lintel */}
      <Box at={[0, doorH + 0.06, 0.052]} size={[doorW - 0.2, 0.02, 0.01]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2.5} />
      {/* Floor Threshold Guide Track */}
      <Box at={[0, 0.01, 0]} size={[doorW, 0.02, 0.08]} color="#334155" metalness={0.85} />

      {/* Left Sliding Glass Leaf */}
      <mesh position={[-0.38, doorH / 2, -0.015]}>
        <boxGeometry args={[0.72, doorH - 0.06, 0.02]} />
        <meshStandardMaterial color="#bfdbfe" transparent opacity={0.38} roughness={0.1} depthWrite={false} />
      </mesh>
      {/* Left Door Cyber Handle */}
      <Box at={[-0.08, doorH / 2, 0.01]} size={[0.025, 0.45, 0.03]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.2} />

      {/* Right Sliding Glass Leaf */}
      <mesh position={[0.38, doorH / 2, 0.015]}>
        <boxGeometry args={[0.72, doorH - 0.06, 0.02]} />
        <meshStandardMaterial color="#bfdbfe" transparent opacity={0.38} roughness={0.1} depthWrite={false} />
      </mesh>
      {/* Right Door Cyber Handle */}
      <Box at={[0.08, doorH / 2, -0.01]} size={[0.025, 0.45, 0.03]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.2} />

      {/* Biometric Holographic Keycard Scanner Column */}
      <group position={[doorW / 2 + 0.15, 0, 0.08]}>
        <Box at={[0, 0.5, 0]} size={[0.08, 1.0, 0.08]} color="#1e293b" metalness={0.9} />
        <Box at={[0, 0.98, 0.042]} size={[0.06, 0.09, 0.02]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2.5} />
      </group>

      {/* Decorative Biophilic Cyber Planter Flanking Entrance */}
      <CyberPlanter position={[-doorW / 2 - 0.45, 0, 0.25]} accentColor={accentColor} scale={0.85} />
    </group>
  );
}

// --------------------------------------------------------------------------
// REUSABLE DEPARTMENT ROOM: 3-SIDED TRANSPARENT GLASS WALLS + DOORS + SIGNBOARD
// --------------------------------------------------------------------------
function DepartmentRoomFrame({
  name,
  code,
  accentColor,
  size,
  position,
  onClick,
  doorSide = 'east', // 'east' (+X), 'west' (-X), 'south' (+Z), 'north' (-Z)
  selected = false,
  isArchitectMode = false,
  children,
}: {
  name: string;
  code: string;
  accentColor: string;
  size: [number, number, number];
  position: [number, number, number];
  onClick: () => void;
  doorSide?: 'east' | 'west' | 'south' | 'north';
  selected?: boolean;
  isArchitectMode?: boolean;
  children?: React.ReactNode;
}) {
  const [w, , d] = size;
  const wallH = 2.4;
  const glassOpacity = 0.22;
  const glassColor = '#bfdbfe';

  return (
    <group
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {/* 1. Solid High-Tech Titanium Slate Floor Slab */}
      <Box at={[0, -0.06, 0]} size={[w, 0.12, d]} color="#334155" metalness={0.7} roughness={0.3} />
      {/* Polished Interior Floor Tile */}
      <Box at={[0, 0.005, 0]} size={[w - 0.25, 0.01, d - 0.25]} color="#1e293b" metalness={0.8} roughness={0.2} />

      {/* Luminous Neon Edge Borders */}
      <Box at={[0, 0.015, d / 2]} size={[w, 0.03, 0.03]} color={accentColor} emissive={accentColor} emissiveIntensity={1} />
      <Box at={[0, 0.015, -d / 2]} size={[w, 0.03, 0.03]} color={accentColor} emissive={accentColor} emissiveIntensity={1} />
      <Box at={[w / 2, 0.015, 0]} size={[0.03, 0.03, d]} color={accentColor} emissive={accentColor} emissiveIntensity={1} />
      <Box at={[-w / 2, 0.015, 0]} size={[0.03, 0.03, d]} color={accentColor} emissive={accentColor} emissiveIntensity={1} />

      {/* ARCHITECT MODE SELECTION BOUNDING HIGHLIGHT */}
      {isArchitectMode && selected && (
        <group position={[0, wallH / 2, 0]}>
          <Box at={[0, -wallH / 2 + 0.02, 0]} size={[w + 0.4, 0.02, d + 0.4]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2.5} opacity={0.6} />
          <Box at={[0, wallH / 2 + 0.1, 0]} size={[w + 0.2, 0.04, d + 0.2]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2.0} />
        </group>
      )}

      {/* 2. TRANSPARENT GLASS WALLS ON 3 SIDES */}
      {/* Wall: North (-Z) */}
      {doorSide !== 'north' && (
        <mesh position={[0, wallH / 2, -d / 2]}>
          <boxGeometry args={[w, wallH, 0.03]} />
          <meshStandardMaterial color={glassColor} transparent opacity={glassOpacity} roughness={0.08} depthWrite={false} />
        </mesh>
      )}

      {/* Wall: South (+Z) */}
      {doorSide !== 'south' && (
        <mesh position={[0, wallH / 2, d / 2]}>
          <boxGeometry args={[w, wallH, 0.03]} />
          <meshStandardMaterial color={glassColor} transparent opacity={glassOpacity} roughness={0.08} depthWrite={false} />
        </mesh>
      )}

      {/* Wall: West (-X) */}
      {doorSide !== 'west' && (
        <mesh position={[-w / 2, wallH / 2, 0]}>
          <boxGeometry args={[0.03, wallH, d]} />
          <meshStandardMaterial color={glassColor} transparent opacity={glassOpacity} roughness={0.08} depthWrite={false} />
        </mesh>
      )}

      {/* Wall: East (+X) */}
      {doorSide !== 'east' && (
        <mesh position={[w / 2, wallH / 2, 0]}>
          <boxGeometry args={[0.03, wallH, d]} />
          <meshStandardMaterial color={glassColor} transparent opacity={glassOpacity} roughness={0.08} depthWrite={false} />
        </mesh>
      )}

      {/* 3. HIGH-TECH DOUBLE SLIDING GLASS ENTRANCE DOORS ON ENTRANCE SIDE */}
      <RoomDoorEntrance
        doorSide={doorSide}
        roomW={w}
        roomD={d}
        wallH={wallH}
        accentColor={accentColor}
      />

      {/* 4. PHYSICAL ARCHITECTURAL SIGNBOARD MOUNTED ON BUILDING FASICIA */}
      <BuildingSignboard
        name={name}
        code={code}
        accentColor={accentColor}
        doorSide={doorSide}
        roomW={w}
        roomD={d}
        wallH={wallH}
      />

      {/* 4 Corner Architectural Mullion Columns */}
      {[[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].map(([cx, cz], ci) => (
        <group key={ci} position={[cx, wallH / 2, cz]}>
          <Box at={[0, 0, 0]} size={[0.08, wallH, 0.08]} color="#1e293b" metalness={0.85} />
          <Box at={[0, wallH / 2, 0]} size={[0.09, 0.05, 0.09]} color={accentColor} emissive={accentColor} emissiveIntensity={1.5} />
        </group>
      ))}

      {/* 5. Dedicated Interior Ceiling Luminaire (Crisp downlight for the room) */}
      <pointLight position={[0, wallH - 0.25, 0]} intensity={8.5} distance={7.5} color="#f8fafc" />
      <Box at={[0, wallH - 0.04, 0]} size={[1.5, 0.03, 1.0]} color="#ffffff" emissive="#e0f2fe" emissiveIntensity={1.5} />

      {children}
    </group>
  );
}

// --------------------------------------------------------------------------
// MODULAR WORKSTATION: ERGONOMIC CHAIR + DESK + CURVED ULTRAWIDE MONITOR
// --------------------------------------------------------------------------
function WorkstationDesk({
  at,
  rotationY = 0,
  accentColor = '#00f2fe',
  workerName,
  workerRole,
}: {
  at: [number, number, number];
  rotationY?: number;
  accentColor?: string;
  workerName?: string;
  workerRole?: string;
}) {
  return (
    <group position={at} rotation={[0, rotationY, 0]}>
      {/* 1. DESK TABLE */}
      {/* Desktop slab */}
      <Box at={[0, 0.58, 0.25]} size={[1.3, 0.05, 0.65]} color="#1e293b" metalness={0.75} roughness={0.25} />
      {/* Glowing accent edge strip on front of desk */}
      <Box at={[0, 0.58, -0.07]} size={[1.28, 0.02, 0.02]} color={accentColor} emissive={accentColor} emissiveIntensity={1.2} />
      {/* Dual metallic angled legs */}
      <Box at={[-0.58, 0.29, 0.25]} size={[0.05, 0.58, 0.55]} color="#475569" metalness={0.8} />
      <Box at={[0.58, 0.29, 0.25]} size={[0.05, 0.58, 0.55]} color="#475569" metalness={0.8} />
      {/* Cable modesty panel */}
      <Box at={[0, 0.38, 0.52]} size={[1.1, 0.35, 0.02]} color="#0f172a" metalness={0.85} />

      {/* Cyber keyboard */}
      <Box at={[-0.05, 0.61, 0.12]} size={[0.44, 0.015, 0.16]} color="#0f172a" metalness={0.9} />
      {/* Touchpad / mouse mat */}
      <Box at={[0.32, 0.61, 0.12]} size={[0.18, 0.012, 0.18]} color="#334155" metalness={0.5} />
      {/* Energy mug */}
      <mesh position={[-0.45, 0.65, 0.3]}>
        <cylinderGeometry args={[0.035, 0.035, 0.08, 12]} />
        <meshStandardMaterial color="#64748b" metalness={0.7} />
      </mesh>

      {/* 2. CURVED ULTRAWIDE HOLOGRAPHIC MONITOR */}
      <Box at={[0, 0.68, 0.46]} size={[0.04, 0.22, 0.04]} color="#64748b" metalness={0.85} />
      <Box at={[0, 0.88, 0.44]} size={[0.72, 0.34, 0.02]} color="#0f172a" metalness={0.9} />
      <mesh position={[0, 0.88, 0.428]}>
        <planeGeometry args={[0.68, 0.31]} />
        <meshStandardMaterial
          color="#0f172a"
          emissive={accentColor}
          emissiveIntensity={0.65}
          roughness={0.2}
        />
      </mesh>
      <Box at={[0, 1.055, 0.43]} size={[0.6, 0.015, 0.03]} color="#ffffff" emissive="#e0f2fe" emissiveIntensity={1.5} />

      {/* 3. ERGONOMIC SWIVEL OFFICE CHAIR */}
      <mesh position={[0, 0.04, -0.32]}>
        <cylinderGeometry args={[0.26, 0.26, 0.03, 5]} />
        <meshStandardMaterial color="#1e293b" metalness={0.9} />
      </mesh>
      <mesh position={[0, 0.2, -0.32]}>
        <cylinderGeometry args={[0.03, 0.03, 0.3, 12]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.95} roughness={0.1} />
      </mesh>
      <Box at={[0, 0.38, -0.32]} size={[0.44, 0.07, 0.44]} color="#334155" metalness={0.4} roughness={0.6} />
      <Box at={[0, 0.66, -0.52]} size={[0.42, 0.46, 0.05]} color="#1e293b" metalness={0.5} roughness={0.5} />
      <Box at={[0, 0.56, -0.54]} size={[0.38, 0.04, 0.02]} color={accentColor} emissive={accentColor} emissiveIntensity={0.9} />
      <Box at={[-0.24, 0.48, -0.32]} size={[0.05, 0.03, 0.3]} color="#1e293b" metalness={0.7} />
      <Box at={[0.24, 0.48, -0.32]} size={[0.05, 0.03, 0.3]} color="#1e293b" metalness={0.7} />

    </group>
  );
}

// --------------------------------------------------------------------------
// BASELINE DEFAULT DEPARTMENT COORDINATES (GROUND FLOOR y = 0)
// --------------------------------------------------------------------------
export const DEFAULT_DEPARTMENT_POSITIONS: Record<string, [number, number, number]> = {
  RES: [-17.5, 0, -11.0],
  BIO: [-8.5, 0, 5.5],
  SEC: [-8.5, 0, 14.5],
  MEM: [8.5, 0, -14.5],
  GRAPH: [17.5, 0, 14.5],
  CRM: [8.5, 0, 5.5],
  CMD: [0, 0, -14.5],
  MEDIA: [-17.5, 0, -2.5],
  FIN: [-17.5, 0, 6.0],
  SKILL: [-17.5, 0, 14.5],
  MODELS: [17.5, 0, -11.0],
  FLOW: [17.5, 0, -2.5],
  DATA: [17.5, 0, 6.0],
  QUANTUM: [-8.5, 0, -14.5],
  API: [0, 0, 14.5],
};

export interface DepartmentRoomProps {
  onOpenRoom: (dest: string) => void;
  position?: [number, number, number];
  selected?: boolean;
  isArchitectMode?: boolean;
  onSelectRoom?: () => void;
}

// --------------------------------------------------------------------------
// 1. ANTIGRAVITY RESEARCH LAB (vision / research) - GROUND WEST
// --------------------------------------------------------------------------
function AntigravityLab({
  onOpenRoom,
  position = DEFAULT_DEPARTMENT_POSITIONS.RES,
  selected = false,
  isArchitectMode = false,
  onSelectRoom,
}: DepartmentRoomProps) {
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
      size={[5.6, 0.12, 4.6]}
      position={position}
      doorSide="east"
      selected={selected}
      isArchitectMode={isArchitectMode}
      onClick={() => {
        if (isArchitectMode && onSelectRoom) onSelectRoom();
        else onOpenRoom('vision');
      }}
    >
      <mesh position={[0, 0.04, -1.2]}>
        <cylinderGeometry args={[1.2, 1.3, 0.08, 36]} />
        <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.085, -1.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 1.15, 36]} />
        <meshBasicMaterial color="#00f2fe" side={THREE.DoubleSide} />
      </mesh>

      <group ref={spheresGroup} position={[0, 1.1, -1.2]}>
        <mesh position={[0, 0.25, 0]}>
          <sphereGeometry args={[0.24, 24, 24]} />
          <meshStandardMaterial color="#dbeafe" metalness={0.96} roughness={0.06} />
        </mesh>
        <mesh position={[0.55, 0.1, 0.25]}>
          <sphereGeometry args={[0.15, 20, 20]} />
          <meshStandardMaterial color="#bfdbfe" metalness={0.95} roughness={0.08} />
        </mesh>
      </group>

      <group ref={drone1} position={[-0.8, 1.35, -0.6]}>
        <mesh>
          <boxGeometry args={[0.2, 0.05, 0.2]} />
          <meshStandardMaterial color="#334155" metalness={0.8} />
        </mesh>
      </group>

      {/* DEPARTMENT WORKERS' TABLES AND CHAIRS */}
      <WorkstationDesk
        at={[-0.9, 0, 0.2]}
        accentColor="#00f2fe"
        workerName="LEO"
        workerRole="Researcher"
      />
      <WorkstationDesk
        at={[0.9, 0, 0.2]}
        accentColor="#00f2fe"
        workerName="OPTICS-LAB"
        workerRole="Spectrometry"
      />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 2. BIOMETRICS & CYBERNETICS LAB (wellness) - GROUND SOUTH-WEST
// --------------------------------------------------------------------------
function BiometricsLab({
  onOpenRoom,
  position = DEFAULT_DEPARTMENT_POSITIONS.BIO,
  selected = false,
  isArchitectMode = false,
  onSelectRoom,
}: DepartmentRoomProps) {
  const robotArm = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (robotArm.current) robotArm.current.rotation.y = Math.sin(clock.elapsedTime * 1.5) * 0.35;
  });

  return (
    <DepartmentRoomFrame
      name="Biometrics & Cybernetics Lab"
      code="BIO"
      accentColor="#06b6d4"
      size={[5.6, 0.12, 4.6]}
      position={position}
      doorSide="east"
      selected={selected}
      isArchitectMode={isArchitectMode}
      onClick={() => {
        if (isArchitectMode && onSelectRoom) onSelectRoom();
        else onOpenRoom('wellness');
      }}
    >
      <Box at={[-1.2, 0.25, -1.2]} size={[0.7, 0.5, 0.7]} color="#1e293b" metalness={0.8} />
      <mesh position={[-1.2, 0.52, -1.2]}>
        <cylinderGeometry args={[0.26, 0.26, 0.05, 24]} />
        <meshStandardMaterial color="#06b6d4" emissive="#06b6d4" emissiveIntensity={0.8} />
      </mesh>
      <group ref={robotArm} position={[-1.2, 0.55, -1.4]}>
        <mesh><sphereGeometry args={[0.07, 12, 12]} /><meshStandardMaterial color="#64748b" metalness={0.85} /></mesh>
        <mesh position={[0, 0.16, 0]}><cylinderGeometry args={[0.03, 0.03, 0.32, 10]} /><meshStandardMaterial color="#94a3b8" metalness={0.8} /></mesh>
      </group>

      {/* DEPARTMENT WORKERS' TABLES AND CHAIRS */}
      <WorkstationDesk
        at={[-1.0, 0, 0.2]}
        accentColor="#06b6d4"
        workerName="BEN"
        workerRole="Health Info"
      />
      <WorkstationDesk
        at={[1.0, 0, 0.2]}
        accentColor="#06b6d4"
        workerName="MIA"
        workerRole="Debugger"
      />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 3. SECURITY CITADEL & APPROVALS VAULT (approvals) - GROUND SOUTH-WEST OUTER
// --------------------------------------------------------------------------
function SecurityCitadel({
  onOpenRoom,
  position = DEFAULT_DEPARTMENT_POSITIONS.SEC,
  selected = false,
  isArchitectMode = false,
  onSelectRoom,
}: DepartmentRoomProps) {
  const lockGear = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (lockGear.current) lockGear.current.rotation.z = clock.elapsedTime * 0.3;
  });

  return (
    <DepartmentRoomFrame
      name="Security Citadel"
      code="SEC"
      accentColor="#ef4444"
      size={[5.6, 0.12, 4.6]}
      position={position}
      doorSide="east"
      selected={selected}
      isArchitectMode={isArchitectMode}
      onClick={() => {
        if (isArchitectMode && onSelectRoom) onSelectRoom();
        else onOpenRoom('approvals');
      }}
    >
      <Box at={[-1.6, 1.2, -1.2]} size={[0.2, 2.0, 2.0]} color="#1e293b" metalness={0.9} roughness={0.2} />
      <group ref={lockGear} position={[-1.48, 1.2, -1.2]} rotation={[0, Math.PI / 2, 0]}>
        <mesh>
          <torusGeometry args={[0.38, 0.05, 12, 24]} />
          <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={1.2} />
        </mesh>
      </group>

      {/* DEPARTMENT WORKERS' TABLES AND CHAIRS */}
      <WorkstationDesk
        at={[-1.0, 0, 0.2]}
        accentColor="#ef4444"
        workerName="JACS"
        workerRole="Security Reviewer"
      />
      <WorkstationDesk
        at={[1.0, 0, 0.2]}
        accentColor="#ef4444"
        workerName="AURA"
        workerRole="Verifier"
      />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 4. PERSISTENT MEMORY VAULT (memory) - GROUND NORTH-EAST
// --------------------------------------------------------------------------
function PersistentMemoryVault({
  onOpenRoom,
  position = DEFAULT_DEPARTMENT_POSITIONS.MEM,
  selected = false,
  isArchitectMode = false,
  onSelectRoom,
}: DepartmentRoomProps) {
  const beam = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (beam.current) beam.current.scale.y = 1 + Math.sin(clock.elapsedTime * 2.5) * 0.1;
  });

  return (
    <DepartmentRoomFrame
      name="Persistent Memory Vault"
      code="MEM"
      accentColor="#a855f7"
      size={[5.6, 0.12, 4.6]}
      position={position}
      doorSide="south"
      selected={selected}
      isArchitectMode={isArchitectMode}
      onClick={() => {
        if (isArchitectMode && onSelectRoom) onSelectRoom();
        else onOpenRoom('memory');
      }}
    >
      {[-0.9, 0.9].map((mx, mi) => (
        <group key={mi} position={[mx, 0.9, -1.4]}>
          <Box at={[0, 0, 0]} size={[0.5, 1.7, 0.5]} color="#1e293b" metalness={0.85} />
          <mesh position={[0, 0.92, 0]}>
            <octahedronGeometry args={[0.2, 0]} />
            <meshStandardMaterial color="#a855f7" emissive="#a855f7" emissiveIntensity={1.5} />
          </mesh>
        </group>
      ))}
      <mesh ref={beam} position={[0, 0.95, -1.4]}>
        <cylinderGeometry args={[0.035, 0.035, 1.7, 12]} />
        <meshBasicMaterial color="#a855f7" transparent opacity={0.75} />
      </mesh>

      {/* DEPARTMENT WORKERS' TABLES AND CHAIRS */}
      <WorkstationDesk
        at={[-0.9, 0, 0.2]}
        accentColor="#a855f7"
        workerName="VANCE"
        workerRole="Writer"
      />
      <WorkstationDesk
        at={[0.9, 0, 0.2]}
        accentColor="#a855f7"
        workerName="MEMORY-HUB"
        workerRole="Vector Archive"
      />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 5. KNOWLEDGE GRAPH LAB (graph) - GROUND EAST OUTER
// --------------------------------------------------------------------------
function KnowledgeGraphLab({
  onOpenRoom,
  position = DEFAULT_DEPARTMENT_POSITIONS.GRAPH,
  selected = false,
  isArchitectMode = false,
  onSelectRoom,
}: DepartmentRoomProps) {
  const cluster = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (cluster.current) cluster.current.rotation.y = clock.elapsedTime * 0.3;
  });

  return (
    <DepartmentRoomFrame
      name="Knowledge Graph Lab"
      code="GRAPH"
      accentColor="#818cf8"
      size={[5.6, 0.12, 4.6]}
      position={position}
      doorSide="west"
      selected={selected}
      isArchitectMode={isArchitectMode}
      onClick={() => {
        if (isArchitectMode && onSelectRoom) onSelectRoom();
        else onOpenRoom('graph');
      }}
    >
      <group ref={cluster} position={[0, 1.2, -1.3]}>
        {[-0.5, 0.5, 0].map((gx, i) => (
          <mesh key={i} position={[gx, (i % 2) * 0.35 - 0.15, i === 2 ? 0.4 : -0.2]}>
            <sphereGeometry args={[0.13, 14, 14]} />
            <meshStandardMaterial color="#818cf8" emissive="#818cf8" emissiveIntensity={1.4} />
          </mesh>
        ))}
      </group>

      {/* DEPARTMENT WORKERS' TABLES AND CHAIRS */}
      <WorkstationDesk
        at={[-1.0, 0, 0.2]}
        accentColor="#818cf8"
        workerName="CYRUS"
        workerRole="Analyst"
      />
      <WorkstationDesk
        at={[1.0, 0, 0.2]}
        accentColor="#818cf8"
        workerName="NIKOLAI"
        workerRole="Critic"
      />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 6. BUSINESS CRM & WAR ROOM (business) - GROUND SOUTH-EAST
// --------------------------------------------------------------------------
function BusinessWarRoom({
  onOpenRoom,
  position = DEFAULT_DEPARTMENT_POSITIONS.CRM,
  selected = false,
  isArchitectMode = false,
  onSelectRoom,
}: DepartmentRoomProps) {
  const funnel = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (funnel.current) funnel.current.rotation.y = clock.elapsedTime * 0.4;
  });

  return (
    <DepartmentRoomFrame
      name="Business CRM & War Room"
      code="CRM"
      accentColor="#3b82f6"
      size={[5.6, 0.12, 4.6]}
      position={position}
      doorSide="west"
      selected={selected}
      isArchitectMode={isArchitectMode}
      onClick={() => {
        if (isArchitectMode && onSelectRoom) onSelectRoom();
        else onOpenRoom('business');
      }}
    >
      <mesh position={[0, 0.38, -1.3]}>
        <cylinderGeometry args={[1.0, 1.0, 0.08, 6]} />
        <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
      </mesh>
      <group ref={funnel} position={[0, 0.85, -1.3]}>
        <mesh rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.35, 0.5, 16, 1, true]} />
          <meshBasicMaterial color="#3b82f6" wireframe transparent opacity={0.8} />
        </mesh>
      </group>

      {/* DEPARTMENT WORKERS' TABLES AND CHAIRS */}
      <WorkstationDesk
        at={[-1.0, 0, 0.2]}
        accentColor="#3b82f6"
        workerName="KAI"
        workerRole="Executive"
      />
      <WorkstationDesk
        at={[1.0, 0, 0.2]}
        accentColor="#3b82f6"
        workerName="REX"
        workerRole="Strategist"
      />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 7. MISSION CONTROL CENTRAL BRIDGE (tasks / command) - GROUND NORTH CENTER
// --------------------------------------------------------------------------
function MissionControl({
  onOpenRoom,
  position = DEFAULT_DEPARTMENT_POSITIONS.CMD,
  selected = false,
  isArchitectMode = false,
  onSelectRoom,
}: DepartmentRoomProps) {
  const mapTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 1024, 512);
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.25)';
    ctx.lineWidth = 1;
    for (let x = 0; x < 1024; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke(); }
    for (let y = 0; y < 512; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0, 242, 254, 0.55)';
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
      size={[7.2, 0.12, 5.0]}
      position={position}
      doorSide="south"
      selected={selected}
      isArchitectMode={isArchitectMode}
      onClick={() => {
        if (isArchitectMode && onSelectRoom) onSelectRoom();
        else onOpenRoom('tasks');
      }}
    >
      <mesh position={[0, 1.5, -2.1]}>
        <planeGeometry args={[5.2, 2.1]} />
        {mapTexture ? <meshBasicMaterial map={mapTexture} transparent opacity={0.94} /> : <meshBasicMaterial color="#00f2fe" transparent opacity={0.3} />}
      </mesh>
      <Box at={[0, 2.56, -2.09]} size={[5.26, 0.04, 0.04]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.2} />

      {/* DEPARTMENT WORKERS' TABLES AND CHAIRS (3 COMMAND OPERATORS) */}
      <WorkstationDesk
        at={[-1.8, 0, 0.2]}
        accentColor="#00f2fe"
        workerName="KATE"
        workerRole="TJ Orchestrator"
      />
      <WorkstationDesk
        at={[0.0, 0, 0.2]}
        accentColor="#00f2fe"
        workerName="ALEC"
        workerRole="Planner"
      />
      <WorkstationDesk
        at={[1.8, 0, 0.2]}
        accentColor="#00f2fe"
        workerName="NOVA"
        workerRole="Computer Operator"
      />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 8. MEDIA & CREATIVE PRODUCTION STUDIO (media) - GROUND WEST MID
// --------------------------------------------------------------------------
function MediaStudio({
  onOpenRoom,
  position = DEFAULT_DEPARTMENT_POSITIONS.MEDIA,
  selected = false,
  isArchitectMode = false,
  onSelectRoom,
}: DepartmentRoomProps) {
  return (
    <DepartmentRoomFrame
      name="Media & Creative Studio"
      code="MEDIA"
      accentColor="#f43f5e"
      size={[5.6, 0.12, 4.6]}
      position={position}
      doorSide="east"
      selected={selected}
      isArchitectMode={isArchitectMode}
      onClick={() => {
        if (isArchitectMode && onSelectRoom) onSelectRoom();
        else onOpenRoom('media');
      }}
    >
      <Box at={[0, 1.25, -1.6]} size={[2.2, 1.2, 0.03]} color="#f43f5e" emissive="#f43f5e" emissiveIntensity={0.7} opacity={0.85} />

      {/* DEPARTMENT WORKERS' TABLES AND CHAIRS */}
      <WorkstationDesk
        at={[-1.0, 0, 0.2]}
        accentColor="#f43f5e"
        workerName="ZEPHYR"
        workerRole="Designer"
      />
      <WorkstationDesk
        at={[1.0, 0, 0.2]}
        accentColor="#f43f5e"
        workerName="IRIS"
        workerRole="Marketing"
      />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 9. FINANCE & ALGORITHMIC TRADING FLOOR (finance) - GROUND WEST MID-SOUTH
// --------------------------------------------------------------------------
function TradingFloor({
  onOpenRoom,
  position = DEFAULT_DEPARTMENT_POSITIONS.FIN,
  selected = false,
  isArchitectMode = false,
  onSelectRoom,
}: DepartmentRoomProps) {
  return (
    <DepartmentRoomFrame
      name="Finance & Trading Floor"
      code="FIN"
      accentColor="#22c55e"
      size={[5.6, 0.12, 4.6]}
      position={position}
      doorSide="east"
      selected={selected}
      isArchitectMode={isArchitectMode}
      onClick={() => {
        if (isArchitectMode && onSelectRoom) onSelectRoom();
        else onOpenRoom('finance');
      }}
    >
      <group position={[0, 1.2, -1.4]}>
        {[-0.8, -0.4, 0, 0.4, 0.8].map((cx, ci) => (
          <Box key={ci} at={[cx, (ci % 3) * 0.15, 0]} size={[0.15, 0.35 + (ci % 2) * 0.2, 0.02]} color={ci % 2 === 0 ? '#22c55e' : '#ef4444'} emissive={ci % 2 === 0 ? '#22c55e' : '#ef4444'} emissiveIntensity={0.9} />
        ))}
      </group>

      {/* DEPARTMENT WORKERS' TABLES AND CHAIRS */}
      <WorkstationDesk
        at={[-0.9, 0, 0.2]}
        accentColor="#22c55e"
        workerName="SAM"
        workerRole="Finance Analyst"
      />
      <WorkstationDesk
        at={[0.9, 0, 0.2]}
        accentColor="#22c55e"
        workerName="HFT-ALGO"
        workerRole="Arbitrage Engine"
      />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 10. EDUCATION & SKILL ACADEMY (education / skills) - GROUND WEST SOUTH
// --------------------------------------------------------------------------
function SkillAcademy({
  onOpenRoom,
  position = DEFAULT_DEPARTMENT_POSITIONS.SKILL,
  selected = false,
  isArchitectMode = false,
  onSelectRoom,
}: DepartmentRoomProps) {
  return (
    <DepartmentRoomFrame
      name="Education & Skill Academy"
      code="SKILL"
      accentColor="#14b8a6"
      size={[5.6, 0.12, 4.6]}
      position={position}
      doorSide="east"
      selected={selected}
      isArchitectMode={isArchitectMode}
      onClick={() => {
        if (isArchitectMode && onSelectRoom) onSelectRoom();
        else onOpenRoom('skills');
      }}
    >
      <mesh position={[0, 1.1, -1.2]}>
        <tetrahedronGeometry args={[0.42, 0]} />
        <meshBasicMaterial color="#14b8a6" wireframe transparent opacity={0.85} />
      </mesh>

      {/* DEPARTMENT WORKERS' TABLES AND CHAIRS */}
      <WorkstationDesk
        at={[-0.9, 0, 0.2]}
        accentColor="#14b8a6"
        workerName="TESSA"
        workerRole="Legal Research"
      />
      <WorkstationDesk
        at={[0.9, 0, 0.2]}
        accentColor="#14b8a6"
        workerName="SKILL-FORGE"
        workerRole="Curriculum"
      />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 11. AI MODELS & NEURAL ENGINE BAY (models) - GROUND EAST NORTH
// --------------------------------------------------------------------------
function NeuralEngineBay({
  onOpenRoom,
  position = DEFAULT_DEPARTMENT_POSITIONS.MODELS,
  selected = false,
  isArchitectMode = false,
  onSelectRoom,
}: DepartmentRoomProps) {
  return (
    <DepartmentRoomFrame
      name="AI Models & Neural Engine Bay"
      code="MODELS"
      accentColor="#c084fc"
      size={[5.6, 0.12, 4.6]}
      position={position}
      doorSide="west"
      selected={selected}
      isArchitectMode={isArchitectMode}
      onClick={() => {
        if (isArchitectMode && onSelectRoom) onSelectRoom();
        else onOpenRoom('models');
      }}
    >
      <mesh position={[0, 1.2, -1.2]}>
        <octahedronGeometry args={[0.5, 1]} />
        <meshBasicMaterial color="#c084fc" wireframe transparent opacity={0.85} />
      </mesh>

      {/* DEPARTMENT WORKERS' TABLES AND CHAIRS */}
      <WorkstationDesk
        at={[-1.0, 0, 0.2]}
        accentColor="#c084fc"
        workerName="ELIAS"
        workerRole="Optimizer"
      />
      <WorkstationDesk
        at={[1.0, 0, 0.2]}
        accentColor="#c084fc"
        workerName="DAN"
        workerRole="Developer"
      />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 12. WORKFLOWS & AUTOMATION FACTORY (workflows) - GROUND EAST MID
// --------------------------------------------------------------------------
function WorkflowsAssemblyFactory({
  onOpenRoom,
  position = DEFAULT_DEPARTMENT_POSITIONS.FLOW,
  selected = false,
  isArchitectMode = false,
  onSelectRoom,
}: DepartmentRoomProps) {
  return (
    <DepartmentRoomFrame
      name="Workflows & Automation Factory"
      code="FLOW"
      accentColor="#10b981"
      size={[5.6, 0.12, 4.6]}
      position={position}
      doorSide="west"
      selected={selected}
      isArchitectMode={isArchitectMode}
      onClick={() => {
        if (isArchitectMode && onSelectRoom) onSelectRoom();
        else onOpenRoom('workflows');
      }}
    >
      {[-1.0, 0, 1.0].map((gx, gi) => (
        <group key={gi} position={[gx, 0.7, -1.4]}>
          <Box at={[0, 0, 0]} size={[0.08, 1.1, 0.5]} color="#1e293b" metalness={0.8} />
          <mesh position={[0, 0.35, 0]}>
            <torusGeometry args={[0.18, 0.02, 8, 16]} />
            <meshBasicMaterial color="#10b981" />
          </mesh>
        </group>
      ))}

      {/* DEPARTMENT WORKERS' TABLES AND CHAIRS */}
      <WorkstationDesk
        at={[-1.0, 0, 0.2]}
        accentColor="#10b981"
        workerName="SARA"
        workerRole="Automation"
      />
      <WorkstationDesk
        at={[1.0, 0, 0.2]}
        accentColor="#10b981"
        workerName="ELENA"
        workerRole="QA Engineer"
      />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 13. DATA INTELLIGENCE & ANALYTICS BAY (data) - GROUND EAST MID-SOUTH
// --------------------------------------------------------------------------
function DataIntelligenceBay({
  onOpenRoom,
  position = DEFAULT_DEPARTMENT_POSITIONS.DATA,
  selected = false,
  isArchitectMode = false,
  onSelectRoom,
}: DepartmentRoomProps) {
  return (
    <DepartmentRoomFrame
      name="Data Intelligence & Analytics"
      code="DATA"
      accentColor="#f59e0b"
      size={[5.6, 0.12, 4.6]}
      position={position}
      doorSide="west"
      selected={selected}
      isArchitectMode={isArchitectMode}
      onClick={() => {
        if (isArchitectMode && onSelectRoom) onSelectRoom();
        else onOpenRoom('data');
      }}
    >
      <mesh position={[0, 1.1, -1.2]}>
        <sphereGeometry args={[0.42, 18, 18]} />
        <meshBasicMaterial color="#f59e0b" wireframe transparent opacity={0.8} />
      </mesh>

      {/* DEPARTMENT WORKERS' TABLES AND CHAIRS */}
      <WorkstationDesk
        at={[-0.9, 0, 0.2]}
        accentColor="#f59e0b"
        workerName="TARA"
        workerRole="Data Analyst"
      />
      <WorkstationDesk
        at={[0.9, 0, 0.2]}
        accentColor="#f59e0b"
        workerName="ETL-HUB"
        workerRole="Stream Processor"
      />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 14. QUANTUM COMPUTE HUB (agents) - GROUND NORTH-WEST
// --------------------------------------------------------------------------
function QuantumComputeHub({
  onOpenRoom,
  position = DEFAULT_DEPARTMENT_POSITIONS.QUANTUM,
  selected = false,
  isArchitectMode = false,
  onSelectRoom,
}: DepartmentRoomProps) {
  const rgbColors = ['#ff3b56', '#f5a623', '#2bd47d', '#2c7be5', '#00f2fe'];
  return (
    <DepartmentRoomFrame
      name="Quantum Compute Hub"
      code="QUANTUM"
      accentColor="#3b82f6"
      size={[5.6, 0.12, 4.6]}
      position={position}
      doorSide="south"
      selected={selected}
      isArchitectMode={isArchitectMode}
      onClick={() => {
        if (isArchitectMode && onSelectRoom) onSelectRoom();
        else onOpenRoom('agents');
      }}
    >
      {rgbColors.map((pipeColor, pi) => (
        <group key={pi} position={[-1.2 + pi * 0.6, 1.5, -1.5]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.05, 0.05, 0.8, 16]} />
            <meshStandardMaterial color={pipeColor} emissive={pipeColor} emissiveIntensity={2.0} />
          </mesh>
        </group>
      ))}

      {/* DEPARTMENT WORKERS' TABLES AND CHAIRS */}
      <WorkstationDesk
        at={[-0.9, 0, 0.2]}
        accentColor="#3b82f6"
        workerName="CHLOE"
        workerRole="DevOps Engineer"
      />
      <WorkstationDesk
        at={[0.9, 0, 0.2]}
        accentColor="#3b82f6"
        workerName="CRYO-SYS"
        workerRole="Cooling Control"
      />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 15. CONNECTORS & API WORKBENCH (connectors / workbench) - GROUND SOUTH CENTER
// --------------------------------------------------------------------------
function ConnectorsWorkbench({
  onOpenRoom,
  position = DEFAULT_DEPARTMENT_POSITIONS.API,
  selected = false,
  isArchitectMode = false,
  onSelectRoom,
}: DepartmentRoomProps) {
  return (
    <DepartmentRoomFrame
      name="Connectors & API Workbench"
      code="API"
      accentColor="#f97316"
      size={[5.6, 0.12, 4.6]}
      position={position}
      doorSide="north"
      selected={selected}
      isArchitectMode={isArchitectMode}
      onClick={() => {
        if (isArchitectMode && onSelectRoom) onSelectRoom();
        else onOpenRoom('connectors');
      }}
    >
      <Box at={[0, 1.1, -1.4]} size={[1.5, 1.7, 0.45]} color="#1e293b" metalness={0.85} />

      {/* DEPARTMENT WORKERS' TABLES AND CHAIRS */}
      <WorkstationDesk
        at={[-0.9, 0, 0.2]}
        accentColor="#f97316"
        workerName="FELIX"
        workerRole="Customer Support"
      />
      <WorkstationDesk
        at={[0.9, 0, 0.2]}
        accentColor="#f97316"
        workerName="API-GATEWAY"
        workerRole="Tool Webhooks"
      />
    </DepartmentRoomFrame>
  );
}

// --------------------------------------------------------------------------
// 16. THE LIVING PULSE TOWER SPIRE (chat / conversations)
// --------------------------------------------------------------------------
function LivingPulseTower({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  return (
    <group
      position={[0, 4.6, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onOpenRoom('chat');
      }}
    >
      <Box at={[0, 0.8, 0]} size={[0.28, 2.0, 0.28]} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1.2} metalness={0.9} />
    </group>
  );
}

// --------------------------------------------------------------------------
// 17. CENTRAL INTELLIGENCE CORE (LOCATED IN THE EXACT CENTER OF THE CAMPUS [0, 0, 0])
// --------------------------------------------------------------------------
function CentralIntelligenceCore({ onOpenRoom }: { onOpenRoom: (dest: string) => void }) {
  const ring1 = useRef<THREE.Group>(null);
  const ring2 = useRef<THREE.Group>(null);
  const ring3 = useRef<THREE.Group>(null);
  const corePlasma = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ring1.current) ring1.current.rotation.x = t * 0.75;
    if (ring2.current) ring2.current.rotation.y = t * 1.05;
    if (ring3.current) ring3.current.rotation.z = -t * 0.65;
    if (corePlasma.current) {
      const pulse = 1 + Math.sin(t * 3.2) * 0.14;
      corePlasma.current.scale.set(pulse, pulse, pulse);
    }
  });

  return (
    <group
      position={[0, 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onOpenRoom('command');
      }}
    >
      {/* 1. ELEVATED OCTAGONAL CYBER PEDESTAL */}
      <mesh position={[0, -0.02, 0]} receiveShadow>
        <cylinderGeometry args={[4.4, 4.8, 0.14, 8]} />
        <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.25} />
      </mesh>
      {/* Concentric luminous neon floor rings */}
      <mesh position={[0, 0.055, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.6, 3.85, 48]} />
        <meshBasicMaterial color="#00f2fe" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.056, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.2, 2.35, 48]} />
        <meshBasicMaterial color="#38bdf8" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.057, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.0, 1.12, 36]} />
        <meshBasicMaterial color="#7f5af0" side={THREE.DoubleSide} />
      </mesh>

      {/* 2. FOUR PERIMETER MAGNETIC CONTAINMENT PYLONS */}
      {[
        [-2.8, 0, 0],
        [2.8, 0, 0],
        [0, 0, -2.8],
        [0, 0, 2.8],
      ].map(([px, py, pz], pi) => (
        <group key={pi} position={[px, 0, pz]}>
          <Box at={[0, 0.9, 0]} size={[0.32, 1.8, 0.32]} color="#334155" metalness={0.9} roughness={0.2} />
          <Box at={[0, 1.82, 0]} size={[0.36, 0.06, 0.36]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.8} />
          <mesh position={[0, 1.4, 0]}>
            <sphereGeometry args={[0.12, 16, 16]} />
            <meshStandardMaterial color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2.2} />
          </mesh>
        </group>
      ))}

      {/* 3. CENTRAL LEVITATING QUANTUM CORE SUSPENSION */}
      <group position={[0, 2.2, 0]}>
        <mesh>
          <torusGeometry args={[2.0, 0.16, 18, 48]} />
          <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.2} />
        </mesh>

        {/* Counter-rotating Gyroscopic Quantum Rings */}
        <group ref={ring1}>
          <mesh>
            <torusGeometry args={[1.5, 0.045, 14, 40]} />
            <meshStandardMaterial color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2.0} />
          </mesh>
        </group>
        <group ref={ring2}>
          <mesh>
            <torusGeometry args={[1.15, 0.04, 14, 40]} />
            <meshStandardMaterial color="#7f5af0" emissive="#7f5af0" emissiveIntensity={2.2} />
          </mesh>
        </group>
        <group ref={ring3}>
          <mesh>
            <torusGeometry args={[0.82, 0.035, 12, 36]} />
            <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={2.5} />
          </mesh>
        </group>

        {/* Pulsing Core Plasma Sphere */}
        <mesh ref={corePlasma}>
          <sphereGeometry args={[0.46, 32, 32]} />
          <meshStandardMaterial color="#ffffff" emissive="#00f2fe" emissiveIntensity={4.0} />
        </mesh>
        <pointLight intensity={18} distance={18} color="#00f2fe" />

        {/* Vertical Holographic Data Spire */}
        <mesh position={[0, 1.8, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 3.2, 16]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.65} />
        </mesh>
      </group>

      {/* 4. SLEEK 3D BANNER OVER INTELLIGENCE CORE */}
      <Html position={[0, 4.4, 0]} center distanceFactor={26} style={{ pointerEvents: 'none' }}>
        <div
          style={{
            cursor: 'pointer',
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #00f2fe',
            boxShadow: '0 0 20px rgba(0, 242, 254, 0.6)',
            borderRadius: 8,
            padding: '4px 14px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
            fontWeight: 800,
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: '#00f2fe' }}>[NUCLEUS]</span>
          <span>CENTRAL INTELLIGENCE CORE</span>
          <span style={{ color: '#4cd997' }}>● ONLINE</span>
        </div>
      </Html>
    </group>
  );
}

// --------------------------------------------------------------------------
// --------------------------------------------------------------------------
// CAMPUS PERIMETER FORTRESS WALLS (HEAVY ARCHITECTURAL THICK WALLS ON ALL 4 SIDES)
// --------------------------------------------------------------------------
function CampusPerimeterFortressWalls() {
  const wallH = 2.4;
  const wallThick = 1.0;
  const halfW = 29.0;
  const halfD = 23.0;
  const baseH = 0.35;
  const mainH = wallH - baseH;

  return (
    <group>
      {/* ====================================================================
          1. SOUTH WALL (FRONT BOUNDARY WHERE MARKED BY USER AT Z = +23)
          Spans from X = -29 to +29 with a Grand Cyber Ceremonial Gateway at center
          ==================================================================== */}
      {/* South-West Wall Segment (X: -29 to -4.0, length = 25.0) */}
      <group position={[-16.5, 0, halfD - wallThick / 2]}>
        {/* Heavy dark foundation plinth */}
        <Box at={[0, baseH / 2, 0]} size={[25.0, baseH, wallThick + 0.2]} color="#0f172a" metalness={0.85} roughness={0.3} />
        {/* Main reinforced composite wall */}
        <Box at={[0, baseH + mainH / 2, 0]} size={[25.0, mainH, wallThick]} color="#1e293b" metalness={0.7} roughness={0.35} />
        {/* Top architectural parapet coping / capstone */}
        <Box at={[0, wallH + 0.08, 0]} size={[25.2, 0.16, wallThick + 0.15]} color="#334155" metalness={0.8} />
        {/* Glowing cyber cyan runner along inner base */}
        <Box at={[0, 0.2, -wallThick / 2 - 0.02]} size={[25.0, 0.04, 0.02]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.8} />
        {/* Mid-level neon status groove */}
        <Box at={[0, 1.4, -wallThick / 2 - 0.02]} size={[25.0, 0.03, 0.02]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.4} />
        {/* Outer neon security perimeter line */}
        <Box at={[0, 1.4, wallThick / 2 + 0.02]} size={[25.0, 0.03, 0.02]} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1.0} />
        {/* Structural reinforcement pilasters / buttresses */}
        {[-9, -3, 3, 9].map((bx, bi) => (
          <group key={bi} position={[bx, 0, 0]}>
            <Box at={[0, wallH / 2 + 0.1, 0]} size={[0.8, wallH + 0.2, wallThick + 0.35]} color="#0f172a" metalness={0.9} />
            <Box at={[0, wallH + 0.22, 0]} size={[0.3, 0.06, 0.3]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2.0} />
          </group>
        ))}
        {/* Tempered glass safety balustrade on top */}
        <mesh position={[0, wallH + 0.35, -wallThick / 4]}>
          <boxGeometry args={[25.0, 0.4, 0.04]} />
          <meshStandardMaterial color="#38bdf8" transparent opacity={0.25} roughness={0.1} depthWrite={false} />
        </mesh>
      </group>

      {/* South-East Wall Segment (X: +4.0 to +29, length = 25.0) */}
      <group position={[16.5, 0, halfD - wallThick / 2]}>
        {/* Heavy dark foundation plinth */}
        <Box at={[0, baseH / 2, 0]} size={[25.0, baseH, wallThick + 0.2]} color="#0f172a" metalness={0.85} roughness={0.3} />
        {/* Main reinforced composite wall */}
        <Box at={[0, baseH + mainH / 2, 0]} size={[25.0, mainH, wallThick]} color="#1e293b" metalness={0.7} roughness={0.35} />
        {/* Top architectural parapet coping / capstone */}
        <Box at={[0, wallH + 0.08, 0]} size={[25.2, 0.16, wallThick + 0.15]} color="#334155" metalness={0.8} />
        {/* Glowing cyber cyan runner along inner base */}
        <Box at={[0, 0.2, -wallThick / 2 - 0.02]} size={[25.0, 0.04, 0.02]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.8} />
        {/* Mid-level neon status groove */}
        <Box at={[0, 1.4, -wallThick / 2 - 0.02]} size={[25.0, 0.03, 0.02]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.4} />
        {/* Outer neon security perimeter line */}
        <Box at={[0, 1.4, wallThick / 2 + 0.02]} size={[25.0, 0.03, 0.02]} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1.0} />
        {/* Structural reinforcement pilasters / buttresses */}
        {[-9, -3, 3, 9].map((bx, bi) => (
          <group key={bi} position={[bx, 0, 0]}>
            <Box at={[0, wallH / 2 + 0.1, 0]} size={[0.8, wallH + 0.2, wallThick + 0.35]} color="#0f172a" metalness={0.9} />
            <Box at={[0, wallH + 0.22, 0]} size={[0.3, 0.06, 0.3]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2.0} />
          </group>
        ))}
        {/* Tempered glass safety balustrade on top */}
        <mesh position={[0, wallH + 0.35, -wallThick / 4]}>
          <boxGeometry args={[25.0, 0.4, 0.04]} />
          <meshStandardMaterial color="#38bdf8" transparent opacity={0.25} roughness={0.1} depthWrite={false} />
        </mesh>
      </group>

      {/* GRAND CEREMONIAL CAMPUS GATEWAY AT SOUTH ENTRANCE (X: -4.0 to +4.0) */}
      <group position={[0, 0, halfD - wallThick / 2]}>
        {/* Gate West Pylon Tower */}
        <Box at={[-4.2, 1.7, 0]} size={[1.0, 3.4, 1.4]} color="#0f172a" metalness={0.88} />
        <Box at={[-4.2, 1.7, -0.71]} size={[0.06, 3.2, 0.02]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2} />
        {/* Gate East Pylon Tower */}
        <Box at={[4.2, 1.7, 0]} size={[1.0, 3.4, 1.4]} color="#0f172a" metalness={0.88} />
        <Box at={[4.2, 1.7, -0.71]} size={[0.06, 3.2, 0.02]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2} />
        {/* Overhead Gantry Arch Lintel */}
        <Box at={[0, 3.3, 0]} size={[9.4, 0.48, 1.2]} color="#1e293b" metalness={0.8} />
        <Box at={[0, 3.1, -0.61]} size={[8.8, 0.06, 0.02]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2.2} />
        {/* Campus Identity Sign on Gate Arch */}
        <Html position={[0, 3.3, -0.65]} center distanceFactor={28} style={{ pointerEvents: 'none' }}>
          <div
            style={{
              background: 'rgba(7, 16, 29, 0.95)',
              border: '1px solid #00f2fe',
              boxShadow: '0 0 16px rgba(0, 242, 254, 0.5)',
              borderRadius: 4,
              padding: '3px 12px',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 10,
              fontWeight: 800,
              color: '#ffffff',
              letterSpacing: '0.14em',
              whiteSpace: 'nowrap',
              textTransform: 'uppercase',
            }}
          >
            <span style={{ color: '#00f2fe' }}>TJ TOTAL MASTERY AI</span> · GLOBAL NEXUS CAMPUS
          </div>
        </Html>
        {/* Threshold Cyber Guide Light Rails */}
        <Box at={[-3.8, 0.02, 0]} size={[0.08, 0.04, 3.0]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2} />
        <Box at={[3.8, 0.02, 0]} size={[0.08, 0.04, 3.0]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2} />
        {/* Biometric Scanning Stanchions */}
        <Box at={[-3.4, 0.5, -0.4]} size={[0.16, 1.0, 0.16]} color="#334155" metalness={0.9} />
        <Box at={[-3.4, 1.02, -0.4]} size={[0.18, 0.04, 0.18]} color="#10b981" emissive="#10b981" emissiveIntensity={2.5} />
        <Box at={[3.4, 0.5, -0.4]} size={[0.16, 1.0, 0.16]} color="#334155" metalness={0.9} />
        <Box at={[3.4, 1.02, -0.4]} size={[0.18, 0.04, 0.18]} color="#10b981" emissive="#10b981" emissiveIntensity={2.5} />
      </group>

      {/* ====================================================================
          2. NORTH WALL (REAR BOUNDARY AT Z = -23)
          Full 58m span with heavy fortified composite panels
          ==================================================================== */}
      <group position={[0, 0, -halfD + wallThick / 2]}>
        {/* Heavy dark foundation plinth */}
        <Box at={[0, baseH / 2, 0]} size={[58.0, baseH, wallThick + 0.2]} color="#0f172a" metalness={0.85} roughness={0.3} />
        {/* Main reinforced composite wall */}
        <Box at={[0, baseH + mainH / 2, 0]} size={[58.0, mainH, wallThick]} color="#1e293b" metalness={0.7} roughness={0.35} />
        {/* Top architectural parapet coping / capstone */}
        <Box at={[0, wallH + 0.08, 0]} size={[58.2, 0.16, wallThick + 0.15]} color="#334155" metalness={0.8} />
        {/* Glowing cyber cyan runner along inner base */}
        <Box at={[0, 0.2, wallThick / 2 + 0.02]} size={[58.0, 0.04, 0.02]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.8} />
        {/* Mid-level neon status groove */}
        <Box at={[0, 1.4, wallThick / 2 + 0.02]} size={[58.0, 0.03, 0.02]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.4} />
        {/* Structural reinforcement pilasters / buttresses every 6m */}
        {[-24, -18, -12, -6, 0, 6, 12, 18, 24].map((bx, bi) => (
          <group key={bi} position={[bx, 0, 0]}>
            <Box at={[0, wallH / 2 + 0.1, 0]} size={[0.8, wallH + 0.2, wallThick + 0.35]} color="#0f172a" metalness={0.9} />
            <Box at={[0, wallH + 0.22, 0]} size={[0.3, 0.06, 0.3]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2.0} />
          </group>
        ))}
        {/* Tempered glass safety balustrade on top */}
        <mesh position={[0, wallH + 0.35, wallThick / 4]}>
          <boxGeometry args={[58.0, 0.4, 0.04]} />
          <meshStandardMaterial color="#38bdf8" transparent opacity={0.25} roughness={0.1} depthWrite={false} />
        </mesh>
      </group>

      {/* ====================================================================
          3. WEST WALL (LEFT BOUNDARY AT X = -29)
          Full 46m span with heavy fortified composite panels
          ==================================================================== */}
      <group position={[-halfW + wallThick / 2, 0, 0]}>
        {/* Heavy dark foundation plinth */}
        <Box at={[0, baseH / 2, 0]} size={[wallThick + 0.2, baseH, 46.0]} color="#0f172a" metalness={0.85} roughness={0.3} />
        {/* Main reinforced composite wall */}
        <Box at={[0, baseH + mainH / 2, 0]} size={[wallThick, mainH, 46.0]} color="#1e293b" metalness={0.7} roughness={0.35} />
        {/* Top architectural parapet coping / capstone */}
        <Box at={[0, wallH + 0.08, 0]} size={[wallThick + 0.15, 0.16, 46.2]} color="#334155" metalness={0.8} />
        {/* Glowing cyber cyan runner along inner base */}
        <Box at={[wallThick / 2 + 0.02, 0.2, 0]} size={[0.02, 0.04, 46.0]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.8} />
        {/* Mid-level neon status groove */}
        <Box at={[wallThick / 2 + 0.02, 1.4, 0]} size={[0.02, 0.03, 46.0]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.4} />
        {/* Structural reinforcement pilasters / buttresses every 6m */}
        {[-18, -12, -6, 0, 6, 12, 18].map((bz, bi) => (
          <group key={bi} position={[0, 0, bz]}>
            <Box at={[0, wallH / 2 + 0.1, 0]} size={[wallThick + 0.35, wallH + 0.2, 0.8]} color="#0f172a" metalness={0.9} />
            <Box at={[0, wallH + 0.22, 0]} size={[0.3, 0.06, 0.3]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2.0} />
          </group>
        ))}
        {/* Tempered glass safety balustrade on top */}
        <mesh position={[wallThick / 4, wallH + 0.35, 0]}>
          <boxGeometry args={[0.04, 0.4, 46.0]} />
          <meshStandardMaterial color="#38bdf8" transparent opacity={0.25} roughness={0.1} depthWrite={false} />
        </mesh>
      </group>

      {/* ====================================================================
          4. EAST WALL (RIGHT BOUNDARY AT X = +29)
          Full 46m span with heavy fortified composite panels
          ==================================================================== */}
      <group position={[halfW - wallThick / 2, 0, 0]}>
        {/* Heavy dark foundation plinth */}
        <Box at={[0, baseH / 2, 0]} size={[wallThick + 0.2, baseH, 46.0]} color="#0f172a" metalness={0.85} roughness={0.3} />
        {/* Main reinforced composite wall */}
        <Box at={[0, baseH + mainH / 2, 0]} size={[wallThick, mainH, 46.0]} color="#1e293b" metalness={0.7} roughness={0.35} />
        {/* Top architectural parapet coping / capstone */}
        <Box at={[0, wallH + 0.08, 0]} size={[wallThick + 0.15, 0.16, 46.2]} color="#334155" metalness={0.8} />
        {/* Glowing cyber cyan runner along inner base */}
        <Box at={[-wallThick / 2 - 0.02, 0.2, 0]} size={[0.02, 0.04, 46.0]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.8} />
        {/* Mid-level neon status groove */}
        <Box at={[-wallThick / 2 - 0.02, 1.4, 0]} size={[0.02, 0.03, 46.0]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1.4} />
        {/* Structural reinforcement pilasters / buttresses every 6m */}
        {[-18, -12, -6, 0, 6, 12, 18].map((bz, bi) => (
          <group key={bi} position={[0, 0, bz]}>
            <Box at={[0, wallH / 2 + 0.1, 0]} size={[wallThick + 0.35, wallH + 0.2, 0.8]} color="#0f172a" metalness={0.9} />
            <Box at={[0, wallH + 0.22, 0]} size={[0.3, 0.06, 0.3]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2.0} />
          </group>
        ))}
        {/* Tempered glass safety balustrade on top */}
        <mesh position={[-wallThick / 4, wallH + 0.35, 0]}>
          <boxGeometry args={[0.04, 0.4, 46.0]} />
          <meshStandardMaterial color="#38bdf8" transparent opacity={0.25} roughness={0.1} depthWrite={false} />
        </mesh>
      </group>

      {/* ====================================================================
          5. FOUR HEAVY CORNER BASTION TOWERS
          ==================================================================== */}
      {[
        [-halfW + wallThick / 2, halfD - wallThick / 2], // South-West
        [halfW - wallThick / 2, halfD - wallThick / 2],  // South-East
        [-halfW + wallThick / 2, -halfD + wallThick / 2], // North-West
        [halfW - wallThick / 2, -halfD + wallThick / 2],  // North-East
      ].map(([cx, cz], ci) => (
        <group key={ci} position={[cx, 0, cz]}>
          <Box at={[0, 1.6, 0]} size={[2.2, 3.2, 2.2]} color="#0f172a" metalness={0.9} />
          <Box at={[0, 3.25, 0]} size={[2.4, 0.2, 2.4]} color="#334155" metalness={0.8} />
          <Box at={[0, 3.42, 0]} size={[0.6, 0.15, 0.6]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2.5} />
          <pointLight position={[0, 3.5, 0]} intensity={4.0} distance={6} color="#00f2fe" />
        </group>
      ))}
    </group>
  );
}

// --------------------------------------------------------------------------
// OPEN WORLD GROUND-FLOOR CIRCULATION NETWORK (CONNECTING ALL BUILDINGS)
// --------------------------------------------------------------------------
function IndustrialAtrium() {
  return (
    <group>
      {/* 1. EXPANSIVE GROUND FLOOR SLAB (58m x 46m) */}
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <boxGeometry args={[58.0, 0.12, 46.0]} />
        <meshStandardMaterial color="#1e293b" metalness={0.65} roughness={0.35} />
      </mesh>

      {/* 2. CAMPUS PERIMETER FORTRESS WALLS (ALL 4 SIDES) */}
      <CampusPerimeterFortressWalls />

      {/* 3. GRAND NORTH-SOUTH BOULEVARD (AVENUE OF AUTONOMY) */}
      {/* North Segment connecting Central Core to Mission Control */}
      <Box at={[0, -0.04, -8.0]} size={[4.8, 0.08, 12.0]} color="#334155" metalness={0.7} />
      <Box at={[2.4, -0.01, -8.0]} size={[0.04, 0.015, 12.0]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1} />
      <Box at={[-2.4, -0.01, -8.0]} size={[0.04, 0.015, 12.0]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1} />

      {/* South Segment connecting Central Core to Connectors Workbench */}
      <Box at={[0, -0.04, 8.0]} size={[4.8, 0.08, 12.0]} color="#334155" metalness={0.7} />
      <Box at={[2.4, -0.01, 8.0]} size={[0.04, 0.015, 12.0]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1} />
      <Box at={[-2.4, -0.01, 8.0]} size={[0.04, 0.015, 12.0]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1} />

      {/* 4. GRAND EAST-WEST TRANSVERSE BOULEVARD */}
      {/* West Transverse connecting Central Core to West Wing */}
      <Box at={[-8.5, -0.04, 0]} size={[12.0, 0.08, 4.0]} color="#334155" metalness={0.7} />
      <Box at={[-8.5, -0.01, 2.0]} size={[12.0, 0.015, 0.04]} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1} />
      <Box at={[-8.5, -0.01, -2.0]} size={[12.0, 0.015, 0.04]} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1} />

      {/* East Transverse connecting Central Core to East Wing */}
      <Box at={[8.5, -0.04, 0]} size={[12.0, 0.08, 4.0]} color="#334155" metalness={0.7} />
      <Box at={[8.5, -0.01, 2.0]} size={[12.0, 0.015, 0.04]} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1} />
      <Box at={[8.5, -0.01, -2.0]} size={[12.0, 0.015, 0.04]} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1} />

      {/* 5. WEST ARTERIAL BOULEVARD (Connecting all 4 West Wing buildings) */}
      <Box at={[-13.0, -0.04, 1.5]} size={[3.4, 0.08, 31.0]} color="#334155" metalness={0.7} />
      <Box at={[-11.3, -0.01, 1.5]} size={[0.04, 0.015, 31.0]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1} />
      <Box at={[-14.7, -0.01, 1.5]} size={[0.04, 0.015, 31.0]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1} />

      {/* 6. EAST ARTERIAL BOULEVARD (Connecting all 4 East Wing buildings) */}
      <Box at={[13.0, -0.04, 1.5]} size={[3.4, 0.08, 31.0]} color="#334155" metalness={0.7} />
      <Box at={[11.3, -0.01, 1.5]} size={[0.04, 0.015, 31.0]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1} />
      <Box at={[14.7, -0.01, 1.5]} size={[0.04, 0.015, 31.0]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={1} />

      {/* 7. NORTH CROSS AVENUE (Connecting West Wing, Quantum Hub, Central Ave, Memory Vault, East Wing) */}
      <Box at={[0, -0.04, -11.5]} size={[27.0, 0.08, 3.2]} color="#334155" metalness={0.7} />
      <Box at={[0, -0.01, -9.9]} size={[27.0, 0.015, 0.04]} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1} />
      <Box at={[0, -0.01, -13.1]} size={[27.0, 0.015, 0.04]} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1} />

      {/* 8. SOUTH CROSS AVENUE (Connecting West Wing, Biometrics, Security, War Room, Connectors, East Wing) */}
      <Box at={[0, -0.04, 11.5]} size={[27.0, 0.08, 3.2]} color="#334155" metalness={0.7} />
      <Box at={[0, -0.01, 9.9]} size={[27.0, 0.015, 0.04]} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1} />
      <Box at={[0, -0.01, 13.1]} size={[27.0, 0.015, 0.04]} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1} />

      {/* 9. BIOPHILIC CYBER PLANTERS AROUND CENTRAL CORE & BOULEVARDS */}
      <CyberPlanter position={[3.6, 0, 3.6]} accentColor="#00f2fe" scale={1.1} />
      <CyberPlanter position={[-3.6, 0, 3.6]} accentColor="#00f2fe" scale={1.1} />
      <CyberPlanter position={[3.6, 0, -3.6]} accentColor="#7f5af0" scale={1.1} />
      <CyberPlanter position={[-3.6, 0, -3.6]} accentColor="#7f5af0" scale={1.1} />
      <CyberPlanter position={[-3.2, 0, -8.0]} accentColor="#10b981" scale={0.9} />
      <CyberPlanter position={[3.2, 0, -8.0]} accentColor="#10b981" scale={0.9} />
      <CyberPlanter position={[-3.2, 0, 8.0]} accentColor="#38bdf8" scale={0.9} />
      <CyberPlanter position={[3.2, 0, 8.0]} accentColor="#38bdf8" scale={0.9} />

      {/* 10. CAMPUS ERGONOMIC BENCHES */}
      <CyberBench position={[0, 0, 4.2]} rotationY={0} />
      <CyberBench position={[0, 0, -4.2]} rotationY={Math.PI} />
      <CyberBench position={[-4.5, 0, 2.5]} rotationY={Math.PI / 2} />
      <CyberBench position={[4.5, 0, -2.5]} rotationY={-Math.PI / 2} />

      {/* 11. HOLOGRAPHIC CAMPUS TELEMETRY KIOSKS */}
      <HoloKiosk position={[-4.5, 0, 0]} rotationY={Math.PI / 2} />
      <HoloKiosk position={[4.5, 0, 0]} rotationY={-Math.PI / 2} />

      {/* 12. AVENUE STREET LIGHT BOLLARDS */}
      {[
        [-2.6, 0, -5],
        [2.6, 0, -5],
        [-2.6, 0, 5],
        [2.6, 0, 5],
        [-11.2, 0, 1.8],
        [-14.8, 0, 1.8],
        [11.2, 0, 1.8],
        [14.8, 0, 1.8],
      ].map(([bx, by, bz], bi) => (
        <StreetLightBollard key={bi} position={[bx, by, bz]} />
      ))}
    </group>
  );
}

// --------------------------------------------------------------------------
// DYNAMIC CUSTOM USER EXPANSION ROOM (WITH 3-SIDED TRANSPARENT WALLS, DOORS & WORKSTATIONS)
// --------------------------------------------------------------------------
function CustomRoomNode({
  room,
  onOpenRoom,
  selected = false,
  isArchitectMode = false,
  onSelectRoom,
}: {
  room: CustomRoom;
  onOpenRoom: (dest: string) => void;
  selected?: boolean;
  isArchitectMode?: boolean;
  onSelectRoom?: () => void;
}) {
  const wallH = 2.4;
  const count = room.workstationsCount || 2;
  const assigned = room.assignedAgentIds || [];

  return (
    <group
      position={[room.position[0], 0, room.position[2]]}
      onClick={(e) => {
        e.stopPropagation();
        if (isArchitectMode && onSelectRoom) {
          onSelectRoom();
        } else {
          onOpenRoom(room.id);
        }
      }}
    >
      <Box at={[0, -0.06, 0]} size={[5.6, 0.12, 4.6]} color="#334155" metalness={0.8} />
      <Box at={[0, 0.005, 0]} size={[5.35, 0.01, 4.35]} color="#1e293b" metalness={0.8} roughness={0.2} />

      {/* Luminous Neon Edge Borders */}
      <Box at={[0, 0.015, 2.3]} size={[5.6, 0.03, 0.03]} color={room.accentColor} emissive={room.accentColor} emissiveIntensity={1} />
      <Box at={[0, 0.015, -2.3]} size={[5.6, 0.03, 0.03]} color={room.accentColor} emissive={room.accentColor} emissiveIntensity={1} />
      <Box at={[2.8, 0.015, 0]} size={[0.03, 0.03, 4.6]} color={room.accentColor} emissive={room.accentColor} emissiveIntensity={1} />
      <Box at={[-2.8, 0.015, 0]} size={[0.03, 0.03, 4.6]} color={room.accentColor} emissive={room.accentColor} emissiveIntensity={1} />

      {/* Architect Mode Selection Highlight */}
      {isArchitectMode && selected && (
        <group position={[0, wallH / 2, 0]}>
          <Box at={[0, -wallH / 2 + 0.02, 0]} size={[6.0, 0.02, 5.0]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2.5} opacity={0.6} />
          <Box at={[0, wallH / 2 + 0.1, 0]} size={[5.8, 0.04, 4.8]} color="#00f2fe" emissive="#00f2fe" emissiveIntensity={2.0} />
        </group>
      )}

      {/* Transparent Glass Walls on 3 Sides (North, West, East) */}
      <mesh position={[0, wallH / 2, -2.3]}>
        <boxGeometry args={[5.6, wallH, 0.03]} />
        <meshStandardMaterial color="#bfdbfe" transparent opacity={0.22} roughness={0.1} depthWrite={false} />
      </mesh>
      <mesh position={[-2.8, wallH / 2, 0]}>
        <boxGeometry args={[0.03, wallH, 4.6]} />
        <meshStandardMaterial color="#bfdbfe" transparent opacity={0.22} roughness={0.1} depthWrite={false} />
      </mesh>
      <mesh position={[2.8, wallH / 2, 0]}>
        <boxGeometry args={[0.03, wallH, 4.6]} />
        <meshStandardMaterial color="#bfdbfe" transparent opacity={0.22} roughness={0.1} depthWrite={false} />
      </mesh>

      {/* High-tech Sliding Double Doors on South Entrance Side */}
      <RoomDoorEntrance
        doorSide="south"
        roomW={5.6}
        roomD={4.6}
        wallH={wallH}
        accentColor={room.accentColor}
      />

      {/* Physical Architectural Signboard Mounted on Building Fascia */}
      <BuildingSignboard
        name={room.name}
        code={room.theme.slice(0, 4).toUpperCase()}
        accentColor={room.accentColor}
        doorSide="south"
        roomW={5.6}
        roomD={4.6}
        wallH={wallH}
      />

      {/* Dedicated Downlight */}
      <pointLight position={[0, wallH - 0.25, 0]} intensity={7.5} distance={7.5} color="#f8fafc" />
      <Box at={[0, wallH - 0.04, 0]} size={[1.4, 0.02, 0.9]} color="#ffffff" emissive="#e0f2fe" emissiveIntensity={1.4} />

      {/* DYNAMIC WORKSTATIONS (TABLES & CHAIRS ADDED ACCORDING TO USER'S SELECTION) */}
      {count === 1 && (
        <WorkstationDesk
          at={[0, 0, 0.2]}
          accentColor={room.accentColor}
        />
      )}
      {count === 2 && (
        <>
          <WorkstationDesk
            at={[-1.0, 0, 0.2]}
            accentColor={room.accentColor}
          />
          <WorkstationDesk
            at={[1.0, 0, 0.2]}
            accentColor={room.accentColor}
          />
        </>
      )}
      {count === 3 && (
        <>
          <WorkstationDesk
            at={[-1.2, 0, 0.3]}
            accentColor={room.accentColor}
          />
          <WorkstationDesk
            at={[0, 0, 0.3]}
            accentColor={room.accentColor}
          />
          <WorkstationDesk
            at={[1.2, 0, 0.3]}
            accentColor={room.accentColor}
          />
        </>
      )}
      {count >= 4 && (
        <>
          <WorkstationDesk
            at={[-1.0, 0, 0.6]}
            accentColor={room.accentColor}
          />
          <WorkstationDesk
            at={[1.0, 0, 0.6]}
            accentColor={room.accentColor}
          />
          <WorkstationDesk
            at={[-1.0, 0, -0.6]}
            accentColor={room.accentColor}
          />
          <WorkstationDesk
            at={[1.0, 0, -0.6]}
            accentColor={room.accentColor}
          />
        </>
      )}
    </group>
  );
}

// --------------------------------------------------------------------------
// HQ WORLD SCENE COMPONENT
// --------------------------------------------------------------------------
function HQWorld({
  agentSouls = [],
  customRooms = [],
  departmentPositions = DEFAULT_DEPARTMENT_POSITIONS,
  selectedRoomId = null,
  isArchitectMode = false,
  onSelectRoomForMove,
  selectedAgentId,
  onSelectAgent,
  onOpenRoom,
  onOpenAgentSoul,
  focusTarget,
  controlsRef,
  dayNightMode = 'night',
  timeOfDay = 23,
  onTimeOfDayChange,
  isAutoOrbit = false,
}: {
  agentSouls: AgentSoul[];
  customRooms: CustomRoom[];
  departmentPositions?: Record<string, [number, number, number]>;
  selectedRoomId?: string | null;
  isArchitectMode?: boolean;
  onSelectRoomForMove?: (roomId: string) => void;
  selectedAgentId?: string | null;
  onSelectAgent: (id: string, name: string) => void;
  onOpenRoom: (dest: string) => void;
  onOpenAgentSoul: (soul: AgentSoul) => void;
  focusTarget: [number, number, number] | null;
  controlsRef: React.RefObject<any>;
  dayNightMode?: 'day' | 'night' | 'auto';
  timeOfDay?: number;
  onTimeOfDayChange?: (h: number) => void;
  isAutoOrbit?: boolean;
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

  const activePositions = { ...DEFAULT_DEPARTMENT_POSITIONS, ...departmentPositions };

  return (
    <>
      <DayNightEnvironment
        dayNightMode={dayNightMode}
        timeOfDay={timeOfDay}
        onTimeOfDayChange={onTimeOfDayChange}
      />

      <CameraRig focusPosition={focusTarget} controlsRef={controlsRef} />

      <IndustrialAtrium />

      {/* THE CENTRAL INTELLIGENCE CORE AT [0, 0, 0] */}
      <CentralIntelligenceCore onOpenRoom={onOpenRoom} />
      <LivingPulseTower onOpenRoom={onOpenRoom} />

      {/* ALL 15 DEPARTMENT BUILDINGS ON THE GROUND FLOOR */}
      <AntigravityLab
        position={activePositions['RES']}
        selected={selectedRoomId === 'RES'}
        isArchitectMode={isArchitectMode}
        onSelectRoom={() => onSelectRoomForMove?.('RES')}
        onOpenRoom={onOpenRoom}
      />
      <BiometricsLab
        position={activePositions['BIO']}
        selected={selectedRoomId === 'BIO'}
        isArchitectMode={isArchitectMode}
        onSelectRoom={() => onSelectRoomForMove?.('BIO')}
        onOpenRoom={onOpenRoom}
      />
      <SecurityCitadel
        position={activePositions['SEC']}
        selected={selectedRoomId === 'SEC'}
        isArchitectMode={isArchitectMode}
        onSelectRoom={() => onSelectRoomForMove?.('SEC')}
        onOpenRoom={onOpenRoom}
      />
      <PersistentMemoryVault
        position={activePositions['MEM']}
        selected={selectedRoomId === 'MEM'}
        isArchitectMode={isArchitectMode}
        onSelectRoom={() => onSelectRoomForMove?.('MEM')}
        onOpenRoom={onOpenRoom}
      />
      <KnowledgeGraphLab
        position={activePositions['GRAPH']}
        selected={selectedRoomId === 'GRAPH'}
        isArchitectMode={isArchitectMode}
        onSelectRoom={() => onSelectRoomForMove?.('GRAPH')}
        onOpenRoom={onOpenRoom}
      />
      <BusinessWarRoom
        position={activePositions['CRM']}
        selected={selectedRoomId === 'CRM'}
        isArchitectMode={isArchitectMode}
        onSelectRoom={() => onSelectRoomForMove?.('CRM')}
        onOpenRoom={onOpenRoom}
      />
      <MissionControl
        position={activePositions['CMD']}
        selected={selectedRoomId === 'CMD'}
        isArchitectMode={isArchitectMode}
        onSelectRoom={() => onSelectRoomForMove?.('CMD')}
        onOpenRoom={onOpenRoom}
      />
      <MediaStudio
        position={activePositions['MEDIA']}
        selected={selectedRoomId === 'MEDIA'}
        isArchitectMode={isArchitectMode}
        onSelectRoom={() => onSelectRoomForMove?.('MEDIA')}
        onOpenRoom={onOpenRoom}
      />
      <TradingFloor
        position={activePositions['FIN']}
        selected={selectedRoomId === 'FIN'}
        isArchitectMode={isArchitectMode}
        onSelectRoom={() => onSelectRoomForMove?.('FIN')}
        onOpenRoom={onOpenRoom}
      />
      <SkillAcademy
        position={activePositions['SKILL']}
        selected={selectedRoomId === 'SKILL'}
        isArchitectMode={isArchitectMode}
        onSelectRoom={() => onSelectRoomForMove?.('SKILL')}
        onOpenRoom={onOpenRoom}
      />
      <NeuralEngineBay
        position={activePositions['MODELS']}
        selected={selectedRoomId === 'MODELS'}
        isArchitectMode={isArchitectMode}
        onSelectRoom={() => onSelectRoomForMove?.('MODELS')}
        onOpenRoom={onOpenRoom}
      />
      <WorkflowsAssemblyFactory
        position={activePositions['FLOW']}
        selected={selectedRoomId === 'FLOW'}
        isArchitectMode={isArchitectMode}
        onSelectRoom={() => onSelectRoomForMove?.('FLOW')}
        onOpenRoom={onOpenRoom}
      />
      <DataIntelligenceBay
        position={activePositions['DATA']}
        selected={selectedRoomId === 'DATA'}
        isArchitectMode={isArchitectMode}
        onSelectRoom={() => onSelectRoomForMove?.('DATA')}
        onOpenRoom={onOpenRoom}
      />
      <QuantumComputeHub
        position={activePositions['QUANTUM']}
        selected={selectedRoomId === 'QUANTUM'}
        isArchitectMode={isArchitectMode}
        onSelectRoom={() => onSelectRoomForMove?.('QUANTUM')}
        onOpenRoom={onOpenRoom}
      />
      <ConnectorsWorkbench
        position={activePositions['API']}
        selected={selectedRoomId === 'API'}
        isArchitectMode={isArchitectMode}
        onSelectRoom={() => onSelectRoomForMove?.('API')}
        onOpenRoom={onOpenRoom}
      />

      {/* Custom User Rooms */}
      {customRooms.map((room) => (
        <CustomRoomNode
          key={room.id}
          room={room}
          selected={selectedRoomId === room.id}
          isArchitectMode={isArchitectMode}
          onSelectRoom={() => onSelectRoomForMove?.(room.id)}
          onOpenRoom={onOpenRoom}
        />
      ))}

      {/* All 24 Deployed Agents with Clean Micro-Badges */}
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
        enableRotate
        enableZoom
        enableDamping
        dampingFactor={0.06}
        minDistance={5}
        maxDistance={65}
        minPolarAngle={0.02}
        maxPolarAngle={Math.PI / 2 - 0.02}
        minAzimuthAngle={-Infinity}
        maxAzimuthAngle={Infinity}
        autoRotate={isAutoOrbit}
        autoRotateSpeed={0.7}
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
  departmentPositions = DEFAULT_DEPARTMENT_POSITIONS,
  selectedRoomId = null,
  isArchitectMode = false,
  onSelectRoomForMove,
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
  isAutoOrbit = false,
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
        camera={{ position: [18.0, 14.0, 19.0], fov: 42, near: 0.1, far: 140 }}
        // The HQ has a large, detailed scene. Capping DPR avoids multiplying
        // its pixel workload on high-density displays while keeping it crisp.
        dpr={[0.75, 1]}
        gl={{ antialias: false, powerPreference: 'low-power' }}
      >
        <PauseSceneWhenHidden />
        <HQWorld
          agentSouls={agentSouls}
          customRooms={customRooms}
          departmentPositions={departmentPositions}
          selectedRoomId={selectedRoomId}
          isArchitectMode={isArchitectMode}
          onSelectRoomForMove={onSelectRoomForMove}
          selectedAgentId={selectedAgentId}
          onSelectAgent={onSelectAgent}
          onOpenRoom={onOpenRoom}
          onOpenAgentSoul={onOpenAgentSoul}
          focusTarget={focusTarget}
          controlsRef={controlsRef}
          dayNightMode={dayNightMode}
          timeOfDay={timeOfDay}
          onTimeOfDayChange={onTimeOfDayChange}
          isAutoOrbit={isAutoOrbit}
        />
      </Canvas>
    </div>
  );
}
