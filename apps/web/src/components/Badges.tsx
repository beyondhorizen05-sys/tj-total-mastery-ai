import React from 'react';
import type { CapabilityStatus, HealthState } from '@tj/schemas';

export const StatusBadge: React.FC<{ status: CapabilityStatus }> = ({ status }) => {
  const getStyle = () => {
    switch (status) {
      case 'AVAILABLE':
      case 'CONNECTED':
        return { bg: 'rgba(16, 185, 129, 0.15)', text: '#34d399', border: 'rgba(16, 185, 129, 0.3)' };
      case 'NEEDS_API_KEY':
      case 'NEEDS_SETUP':
      case 'NEEDS_DEVICE':
        return { bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.3)' };
      case 'PLANNED':
      case 'EXPERIMENTAL':
        return { bg: 'rgba(139, 92, 246, 0.15)', text: '#a78bfa', border: 'rgba(139, 92, 246, 0.3)' };
      case 'LOCAL_ONLY':
        return { bg: 'rgba(6, 182, 212, 0.15)', text: '#22d3ee', border: 'rgba(6, 182, 212, 0.3)' };
      case 'UNAVAILABLE':
      default:
        return { bg: 'rgba(244, 63, 94, 0.15)', text: '#fb7185', border: 'rgba(244, 63, 94, 0.3)' };
    }
  };

  const style = getStyle();

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: '0.75rem',
        fontWeight: 600,
        backgroundColor: style.bg,
        color: style.text,
        border: `1px solid ${style.border}`,
        letterSpacing: '0.05em',
      }}
    >
      {status}
    </span>
  );
};

export const HealthBadge: React.FC<{ health: HealthState }> = ({ health }) => {
  const isHealthy = health === 'healthy';
  const color = isHealthy ? '#34d399' : health === 'unknown' ? '#94a3b8' : '#fb7185';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: '0.8rem',
        color: '#94a3b8',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: color,
        }}
      />
      {health}
    </span>
  );
};
export const Badge: React.FC<{ variant?: 'success' | 'warning' | 'danger' | 'accent' | 'neutral'; children: React.ReactNode }> = ({ variant = 'neutral', children }) => {
  const getStyle = () => {
    switch (variant) {
      case 'success':
        return { bg: 'rgba(16, 185, 129, 0.15)', text: '#34d399', border: 'rgba(16, 185, 129, 0.3)' };
      case 'warning':
        return { bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.3)' };
      case 'danger':
        return { bg: 'rgba(244, 63, 94, 0.15)', text: '#fb7185', border: 'rgba(244, 63, 94, 0.3)' };
      case 'accent':
        return { bg: 'rgba(6, 182, 212, 0.15)', text: '#22d3ee', border: 'rgba(6, 182, 212, 0.3)' };
      case 'neutral':
      default:
        return { bg: 'rgba(148, 163, 184, 0.15)', text: '#94a3b8', border: 'rgba(148, 163, 184, 0.3)' };
    }
  };
  const s = getStyle();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600, backgroundColor: s.bg, color: s.text, border: `1px solid ${s.border}` }}>
      {children}
    </span>
  );
};

