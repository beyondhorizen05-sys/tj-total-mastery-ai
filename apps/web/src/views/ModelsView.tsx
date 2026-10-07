import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Cpu, RefreshCw, Key } from 'lucide-react';

export const ModelsView: React.FC = () => {
  const [providers, setProviders] = useState<any[]>([]);
  const [presets, setPresets] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [testing, setTesting] = useState<string | null>(null);

  const load = () => {
    apiFetch<{ providers: any[] }>('/api/v1/models/providers').then((r) => setProviders(r.providers));
    apiFetch<{ presets: any[] }>('/api/v1/models/presets').then((r) => setPresets(r.presets));
    apiFetch<{ models: any[] }>('/api/v1/models').then((r) => setModels(r.models));
  };

  useEffect(() => { load(); }, []);

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      await apiFetch(`/api/v1/models/providers/${id}/test`, { method: 'POST' });
      load();
    } catch (e) {
      console.error(e);
    } finally {
      setTesting(null);
    }
  };

  const handleRefresh = async (id: string) => {
    try {
      await apiFetch(`/api/v1/models/providers/${id}/refresh`, { method: 'POST' });
      load();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <h2 style={{ marginBottom: 8 }}>Model Routing & Intelligence Providers</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9rem' }}>
        Multi-provider routing, dynamic failover, latency tracking, and local/cloud privacy bounds.
      </p>

      <h3 style={{ marginBottom: 12 }}>Configured Providers ({providers.length})</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16, marginBottom: 32 }}>
        {providers.map((p) => (
          <div key={p.id} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontWeight: 700 }}>{p.name}</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: p.health === 'healthy' ? '#34d399' : '#fbbf24', textTransform: 'uppercase' }}>
                {p.health}
              </span>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>Kind: {p.kind} | Privacy: {p.privacy_class}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => handleTest(p.id)} disabled={testing === p.id}
                style={{ padding: '6px 12px', background: 'var(--border-strong)', border: 'none', borderRadius: 4, color: '#fff', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
              >
                {testing === p.id ? 'Testing...' : 'Test Health'}
              </button>
              <button
                onClick={() => handleRefresh(p.id)}
                style={{ padding: '6px 12px', background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: 4, color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                Discover Models
              </button>
            </div>
          </div>
        ))}
      </div>

      <h3 style={{ marginBottom: 12 }}>Available Discovered Models ({models.length})</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {models.map((m) => (
          <div key={m.id} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '12px 16px', fontSize: '0.85rem' }}>
            <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: 4 }}>{m.display_name || m.model}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Provider: {m.provider_id} | Context: {m.context_length ?? 'Unknown'}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
