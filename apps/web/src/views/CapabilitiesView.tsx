import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { StatusBadge } from '../components/Badges';
import type { Capability } from '@tj/schemas';

export const CapabilitiesView: React.FC = () => {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    apiFetch<{ capabilities: Capability[] }>('/api/v1/system/capabilities')
      .then((res) => { setCapabilities(res.capabilities); setError(null); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load capabilities'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <h2 style={{ marginBottom: 16 }}>TJ Capability Matrix</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9rem' }}>
        Implementation and setup states from the local API. Health is shown only when checked.
      </p>
      <button type="button" onClick={load} disabled={loading} style={{ marginBottom: 16, padding: '7px 12px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)', borderRadius: 5, cursor: loading ? 'default' : 'pointer' }}>{loading ? 'Checking…' : 'Refresh status'}</button>
      {error && <p role="alert" style={{ color: '#fb7185', marginBottom: 16 }}>{error}</p>}

      {loading ? (
        <div>Loading capabilities...</div>
      ) : error && capabilities.length === 0 ? null : capabilities.length === 0 ? (
        <div style={{ color: 'var(--text-muted)' }}>No capabilities were returned by the local API.</div>
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
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Health: {c.health}{c.latency_ms != null ? ` · ${c.latency_ms} ms measured` : ' · latency not measured'}</div>
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
