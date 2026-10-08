import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { StatusBadge } from '../components/Badges';

export const ConnectorsView: React.FC = () => {
  const [connectors, setConnectors] = useState<any[]>([]);
  const [planned, setPlanned] = useState<any[]>([]);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, any>>({});
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [configResult, setConfigResult] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    apiFetch<{ connectors: any[]; planned: any[] }>('/api/v1/connectors')
      .then((res) => {
        setConnectors(res.connectors);
        setPlanned(res.planned);
        setLoadError(null);
      })
      .catch((reason) => setLoadError(reason instanceof Error ? reason.message : 'Could not load connectors'))
      .finally(() => setLoading(false));
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

  const saveConfig = async (id: string, values: Record<string, string>) => {
    setSaving(id);
    try {
      await apiFetch(`/api/v1/connectors/${encodeURIComponent(id)}/config`, { method: 'PUT', body: JSON.stringify(values) });
      setDraft((current) => ({ ...current, [id]: {} }));
      setConfigResult((current) => ({ ...current, [id]: 'Configuration saved. Test the connection to verify it.' }));
      setTestResult((current) => { const next = { ...current }; delete next[id]; return next; });
      load();
    } catch (error: any) {
      setConfigResult((current) => ({ ...current, [id]: error.message ?? 'Could not save configuration' }));
    } finally { setSaving(null); }
  };

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <h2 style={{ marginBottom: 8 }}>Connectors & Integrations</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9rem' }}>
        External systems, tools, and services with secret vault integration and real health checking.
      </p>
      <button type="button" onClick={load} disabled={loading} style={{ marginBottom: 16, padding: '7px 12px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)', borderRadius: 5, cursor: loading ? 'default' : 'pointer' }}>{loading ? 'Loading…' : 'Refresh connectors'}</button>
      {loadError && <p role="alert" style={{ color: '#fb7185', marginBottom: 16 }}>{loadError}</p>}
      {!loading && !loadError && connectors.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No working connectors are registered by the local API.</p>}

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

            {c.config_fields?.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {c.config_fields.map((field: any) => <label key={field.key} style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {field.label}{field.required ? ' *' : ''}{c.configured_keys?.includes(field.key) ? ' · saved' : ''}
                <input type={field.secret ? 'password' : 'text'} autoComplete="off" value={draft[c.id]?.[field.key] ?? ''} placeholder={c.configured_keys?.includes(field.key) ? 'Leave blank to keep saved value' : field.placeholder ?? ''} onChange={(event) => setDraft((current) => ({ ...current, [c.id]: { ...current[c.id], [field.key]: event.target.value } }))} style={{ display: 'block', width: '100%', marginTop: 3, padding: '7px 9px', background: 'var(--bg-primary)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)', borderRadius: 4 }} />
                {field.help && <small style={{ display: 'block' }}>{field.help}</small>}
                {c.configured_keys?.includes(field.key) && <button type="button" onClick={() => saveConfig(c.id, { [field.key]: '' })} disabled={saving === c.id} style={{ border: 0, background: 'none', color: '#fb7185', cursor: 'pointer', fontSize: 11, padding: '4px 0' }}>Remove saved value</button>}
              </label>)}
              <button type="button" disabled={saving === c.id || !Object.values(draft[c.id] ?? {}).some(Boolean)} onClick={() => saveConfig(c.id, draft[c.id] ?? {})} style={{ alignSelf: 'start', padding: '6px 12px', background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', border: '1px solid var(--accent-cyan)', borderRadius: 4, cursor: 'pointer' }}>{saving === c.id ? 'Saving…' : 'Save configuration'}</button>
              {configResult[c.id] && <span role="status" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{configResult[c.id]}</span>}
            </div>}

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
