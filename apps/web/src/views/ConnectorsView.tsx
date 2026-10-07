import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { StatusBadge } from '../components/Badges';

export const ConnectorsView: React.FC = () => {
  const [connectors, setConnectors] = useState<any[]>([]);
  const [planned, setPlanned] = useState<any[]>([]);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, any>>({});

  const load = () => {
    apiFetch<{ connectors: any[]; planned: any[] }>('/api/v1/connectors')
      .then((res) => {
        setConnectors(res.connectors);
        setPlanned(res.planned);
      })
      .catch(console.error);
  };

  useEffect(() => {
    load();
  }, []);

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      const res = await apiFetch<any>(`/api/v1/connectors/${id}/test`, { method: 'POST' });
      setTestResult((prev) => ({ ...prev, [id]: res }));
      load();
    } catch (e: any) {
      setTestResult((prev) => ({ ...prev, [id]: { ok: false, detail: e.message } }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <h2 style={{ marginBottom: 8 }}>Connectors & Integrations</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9rem' }}>
        External systems, tools, and services with secret vault integration and real health checking.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16, marginBottom: 32 }}>
        {connectors.map((c) => (
          <div
            key={c.id}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '1.2rem' }}>{c.icon}</span>
                <span style={{ fontWeight: 700 }}>{c.name}</span>
              </div>
              <StatusBadge status={c.status} />
            </div>

            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{c.description}</div>

            {c.missing && (
              <div style={{ fontSize: '0.75rem', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.1)', padding: 6, borderRadius: 4 }}>
                Requires: {c.missing}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 8 }}>
              <button
                onClick={() => handleTest(c.id)}
                disabled={testing === c.id}
                style={{
                  padding: '6px 12px',
                  background: 'var(--border-strong)',
                  border: 'none',
                  borderRadius: 4,
                  color: '#fff',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {testing === c.id ? 'Testing...' : 'Test Connection'}
              </button>
            </div>

            {testResult[c.id] && (
              <div
                style={{
                  fontSize: '0.75rem',
                  padding: 6,
                  borderRadius: 4,
                  background: testResult[c.id].ok ? 'rgba(16, 185, 129, 0.1)' : 'rgba(244, 63, 94, 0.1)',
                  color: testResult[c.id].ok ? '#34d399' : '#fb7185',
                }}
              >
                {testResult[c.id].detail}
              </div>
            )}
          </div>
        ))}
      </div>

      <h3 style={{ marginBottom: 12 }}>Planned Integrations</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {planned.map((p) => (
          <div
            key={p.id}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: 16,
              opacity: 0.75,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontWeight: 700 }}>{p.name}</span>
              <StatusBadge status="PLANNED" />
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{p.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
