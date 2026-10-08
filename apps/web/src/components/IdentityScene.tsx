import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TJPersona, TJState } from '@tj/schemas';
import { WebGLBoundary, canRenderWebGL } from './WebGLBoundary';

type Form = TJPersona['embodiment'];
const COUNT = 4800;
const noise = (n: number) => {
  const v = Math.sin(n * 127.1 + 33.7) * 43758.5453;
  return v - Math.floor(v);
};

function particlePositions(form: Form): Float32Array {
  const p = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const a = noise(i * 3 + 1) * Math.PI * 2;
    const u = noise(i * 3 + 2) * 2 - 1;
    const shell = 0.75 + noise(i * 3 + 3) * 0.25;
    let x: number, y: number, z: number;
    if (form === 'core') {
      const radius = i % 11 === 0 ? noise(i + 94) * 0.45 : shell * 1.06;
      const r = Math.sqrt(1 - u * u) * radius;
      x = Math.cos(a) * r; y = u * radius; z = Math.sin(a) * r;
    } else if (i < 120) {
      // A small mouth band can respond to actual speech synthesis word boundaries.
      x = (noise(i * 23) * 2 - 1) * 0.22;
      y = 0.24 + noise(i * 29) * 0.08;
      z = 0.41 + noise(i * 31) * 0.025;
    } else if (i < COUNT * 0.3) {
      // Head surface; facial front receives more light through the scene lights.
      const r = Math.sqrt(1 - u * u) * shell;
      x = Math.cos(a) * r * 0.43; y = 0.62 + u * shell * 0.55; z = Math.sin(a) * r * 0.36;
    } else if (form === 'female' && i < COUNT * 0.48) {
      const strand = noise(i * 5) * 2 - 1;
      y = -0.48 + noise(i * 7) * 1.62;
      x = Math.sign(strand) * (0.38 + noise(i * 11) * 0.16);
      z = (noise(i * 13) * 2 - 1) * 0.32;
    } else {
      y = -1.1 + noise(i * 17) * 0.95;
      const shoulder = form === 'male' ? 0.9 : 0.76;
      const width = shoulder * (0.78 + (y + 1.1) * 0.28);
      x = (noise(i * 19) * 2 - 1) * width;
      z = Math.sin(a) * 0.35 * shell;
      if (Math.abs(x) > width * 0.83) y += 0.08;
    }
    p.set([x, y, z], i * 3);
  }
  return p;
}

function ParticleForm({ form, state, speechPulse = 0 }: { form: Form; state: TJState; speechPulse?: number }) {
  const group = useRef<THREE.Group>(null);
  const points = useRef<THREE.Points>(null);
  const current = useMemo(() => particlePositions('core'), []);
  const target = useMemo(() => particlePositions(form), [form]);
  const color = state === 'error' || state === 'stopped' ? '#ff7892' : state === 'awaiting_approval' ? '#ffcf83' : '#9adfff';
  useFrame(({ clock }, delta) => {
    if (group.current) {
      group.current.rotation.y += delta * (state === 'thinking' || state === 'planning' ? 0.2 : 0.075);
      group.current.position.y = Math.sin(clock.elapsedTime * 0.68) * 0.05;
    }
    const attribute = points.current?.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (attribute) {
      const values = attribute.array as Float32Array;
      const blend = Math.min(1, delta * 3.3);
      const mouth = state === 'speaking' && form !== 'core' ? Math.max(0, 1 - (performance.now() - speechPulse) / 280) : 0;
      for (let i = 0; i < values.length; i++) {
        const mouthOffset = i < 120 * 3 && i % 3 === 1 ? (Math.floor(i / 3) % 2 ? -0.13 : 0.04) * mouth : 0;
        values[i] += (target[i] + mouthOffset - values[i]) * blend;
      }
      attribute.needsUpdate = true;
      const material = points.current!.material as THREE.PointsMaterial;
      material.size = 0.024 * (state === 'speaking' ? 1.09 + mouth * 0.25 : state === 'thinking' || state === 'planning' ? 1.08 : 1);
    }
  });
  return <group ref={group} scale={1.23}>
    <points ref={points}><bufferGeometry><bufferAttribute attach="attributes-position" args={[current, 3]} /></bufferGeometry><pointsMaterial color={color} size={0.024} transparent opacity={0.87} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} /></points>
    {form === 'core' && <mesh><sphereGeometry args={[0.13, 20, 20]} /><meshBasicMaterial color="#dffaff" transparent opacity={0.85} /></mesh>}
  </group>;
}

export const IdentityScene: React.FC<{ embodiment: Form; state?: TJState; speechPulse?: number; className?: string }> = ({ embodiment, state = 'idle', speechPulse, className }) => {
  const fallback = <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#a9e9ff', fontWeight: 800, letterSpacing: '.3em' }}>{embodiment === 'core' ? '✦' : embodiment.toUpperCase()}</div>;
  return <div className={`tj-identity-scene ${className ?? ''}`} role="img" aria-label={`${embodiment} visual embodiment`}>
    <div className={`tj-identity-aura tj-identity-aura-${embodiment}`} aria-hidden="true"><span>✦</span></div>
    <WebGLBoundary fallback={fallback}>
      {canRenderWebGL() ? <Canvas camera={{ position: [0, 0, 4.2], fov: 43 }} dpr={[1, 1.5]} gl={{ antialias: false, alpha: true, powerPreference: 'low-power' }}>
        <ambientLight intensity={0.8} /><pointLight color="#c5f3ff" intensity={15} position={[2, 3, 4]} /><pointLight color="#477bdf" intensity={8} position={[-3, -2, -2]} />
        <ParticleForm form={embodiment} state={state} speechPulse={speechPulse} />
      </Canvas> : fallback}
    </WebGLBoundary>
  </div>;
};
