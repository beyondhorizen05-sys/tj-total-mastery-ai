import React from 'react';
import type { TJState } from '@tj/schemas';

interface OrbProps {
  state: TJState;
  size?: number;
}

export const Orb: React.FC<OrbProps> = ({ state, size = 40 }) => {
  const getColor = () => {
    switch (state) {
      case 'thinking':
      case 'understanding':
        return '#8b5cf6'; // purple
      case 'executing':
        return '#06b6d4'; // cyan
      case 'awaiting_approval':
      case 'warning':
        return '#f59e0b'; // amber
      case 'error':
      case 'stopped':
        return '#f43f5e'; // rose
      case 'listening':
      case 'speaking':
        return '#10b981'; // emerald
      case 'idle':
      default:
        return '#3b82f6'; // blue
    }
  };

  const color = getColor();
  const isPulsing = state === 'thinking' || state === 'executing';

  return (
    <div
      style={{
        width: size,
        height: size,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: size * 0.75,
          height: size * 0.75,
          borderRadius: '50%',
          background: `radial-gradient(circle at 30% 30%, #ffffff, ${color} 60%, #000000 100%)`,
          boxShadow: `0 0 ${size * 0.4}px ${color}`,
          transition: 'all 0.5s ease',
          animation: isPulsing ? 'pulse 2s infinite alternate ease-in-out' : 'none',
        }}
      />
      <style>{`
        @keyframes pulse {
          0% { transform: scale(0.9); filter: brightness(0.9); }
          100% { transform: scale(1.1); filter: brightness(1.2); }
        }
      `}</style>
    </div>
  );
};
