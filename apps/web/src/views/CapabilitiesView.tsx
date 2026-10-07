import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { StatusBadge } from '../components/Badges';

export const CapabilitiesView: React.FC = () => {
  const [capabilities, setCapabilities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ capabilities: any[] }>('/api/v1/system/capabilities')
      .then((res) => setCapabilities(res.capabilities))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <h2 style={{ marginBottom: 16 }}>TJ Capability Matrix</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9rem' }}>
        Honest, live-verified capability states across all system domains.
      </p>

      {loading ? (
        <div>Loading capabilities...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {capabilities.map((c) => (
            <div
              key={c.capability_id}
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{c.name}</span>
                <StatusBadge status={c.status} />
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>{c.domain}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', flex: 1 }}>{c.description}</div>
              {c.missing && (
                <div style={{ fontSize: '0.75rem', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.1)', padding: 6, borderRadius: 4 }}>
                  ⚠️ {c.missing}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
