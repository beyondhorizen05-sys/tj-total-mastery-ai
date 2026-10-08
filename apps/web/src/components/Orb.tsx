import React from 'react';
import type { TJState } from '@tj/schemas';

interface OrbProps {
  state: TJState;
  size?: number;
  label?: string;
  onClick?: () => void;
}

export const Orb: React.FC<OrbProps> = ({ state, size = 180, label, onClick }) => {
  const getTheme = () => {
    switch (state) {
      case 'listening':
      case 'hearing':
        return { primary: '#10b981', glow: 'rgba(16, 185, 129, 0.7)', ring: 'rgba(16, 185, 129, 0.4)', text: 'LISTENING', speed: '2s' };
      case 'thinking':
      case 'understanding':
        return { primary: '#8b5cf6', glow: 'rgba(139, 92, 246, 0.8)', ring: 'rgba(139, 92, 246, 0.5)', text: 'THINKING', speed: '1.4s' };
      case 'executing':
        return { primary: '#00f2fe', glow: 'rgba(0, 242, 254, 0.9)', ring: 'rgba(0, 242, 254, 0.6)', text: 'EXECUTING', speed: '1.2s' };
      case 'awaiting_approval':
      case 'warning':
        return { primary: '#f59e0b', glow: 'rgba(245, 158, 11, 0.85)', ring: 'rgba(245, 158, 11, 0.5)', text: state === 'awaiting_approval' ? 'APPROVAL NEEDED' : 'WARNING', speed: '1.8s' };
      case 'error':
        return { primary: '#f43f5e', glow: 'rgba(244, 63, 94, 0.9)', ring: 'rgba(244, 63, 94, 0.6)', text: 'ERROR', speed: '1s' };
      case 'stopped':
        return { primary: '#e11d48', glow: 'rgba(225, 29, 72, 0.95)', ring: 'rgba(225, 29, 72, 0.7)', text: 'STOPPED', speed: '3s' };
      case 'speaking':
        return { primary: '#06b6d4', glow: 'rgba(6, 182, 212, 0.85)', ring: 'rgba(6, 182, 212, 0.5)', text: 'SPEAKING', speed: '1.5s' };
      case 'idle':
      default:
        return { primary: '#00f2fe', glow: 'rgba(0, 242, 254, 0.55)', ring: 'rgba(0, 242, 254, 0.3)', text: 'CORE READY', speed: '4s' };
    }
  };

  const theme = getTheme();
  const isMini = size < 80;

  if (isMini) {
    return (
      <div
        style={{ width: size, height: size, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: onClick ? 'pointer' : 'default' }}
        onClick={onClick}
      >
        <div
          style={{
            width: size * 0.7, height: size * 0.7, borderRadius: '50%',
            background: `radial-gradient(circle at 35% 35%, #ffffff, ${theme.primary} 60%, #030611 100%)`,
            boxShadow: `0 0 ${size * 0.5}px ${theme.primary}`,
            animation: 'pulseSlow 2.5s infinite ease-in-out',
          }}
        />
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      style={{ width: size, height: size, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: onClick ? 'pointer' : 'default', userSelect: 'none' }}
    >
      <div style={{ position: 'absolute', width: size, height: size, borderRadius: '50%', border: `1.5px dashed ${theme.ring}`, animation: 'rotateRing 24s linear infinite', boxShadow: `inset 0 0 15px ${theme.ring}` }} />
      <div style={{ position: 'absolute', width: size * 0.86, height: size * 0.86, borderRadius: '50%', border: `1px dotted ${theme.primary}`, opacity: 0.6, animation: 'rotateRingReverse 16s linear infinite' }} />
      <div style={{ position: 'absolute', width: size * 0.75, height: size * 0.75, borderRadius: '50%', background: `radial-gradient(circle, ${theme.glow} 0%, rgba(0,0,0,0) 70%)`, filter: 'blur(10px)', animation: `pulseSlow ${theme.speed} infinite ease-in-out` }} />
      <div style={{ position: 'absolute', width: size * 0.68, height: size * 0.68, borderRadius: '50%', borderTop: `2px solid ${theme.primary}`, borderBottom: `2px solid ${theme.primary}`, borderLeft: '2px solid transparent', borderRight: '2px solid transparent', animation: 'rotateRing 8s linear infinite' }} />
      <div
        style={{
          position: 'relative', width: size * 0.52, height: size * 0.52, borderRadius: '50%',
          background: `radial-gradient(circle at 32% 30%, #ffffff 0%, #bbf7d0 10%, ${theme.primary} 45%, #05162e 85%, #020712 100%)`,
          boxShadow: `0 0 30px ${theme.primary}, inset 0 0 20px #ffffff`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          animation: `pulseSlow ${theme.speed} infinite ease-in-out`, zIndex: 2,
        }}
      >
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: size * 0.08, fontWeight: 800, letterSpacing: '0.12em', color: '#ffffff', textShadow: '0 0 8px rgba(0,0,0,0.9), 0 0 12px #000' }}>TJ CORE</span>
        <span style={{ fontSize: size * 0.05, fontWeight: 700, letterSpacing: '0.15em', color: '#e0f2fe', textTransform: 'uppercase', marginTop: 2, textShadow: '0 0 6px #000' }}>{label ?? theme.text}</span>
      </div>
      <div style={{ position: 'absolute', top: 0, bottom: 0, width: '1px', background: `linear-gradient(to bottom, ${theme.ring}, transparent 20%, transparent 80%, ${theme.ring})`, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, height: '1px', background: `linear-gradient(to right, ${theme.ring}, transparent 20%, transparent 80%, ${theme.ring})`, pointerEvents: 'none' }} />
    </div>
  );
};
