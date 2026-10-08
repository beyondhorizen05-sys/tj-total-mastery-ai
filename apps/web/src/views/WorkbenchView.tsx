import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import './accessible-forms.css';

type Saved = { id: string; name: string; method: string; url: string; headers: Record<string, string>; body: string; bearer_secret_ref: string | null; timeout_ms: number };
type Credential = { ref: string; host: string; label: string };
type History = { id: string; request_id: string; method: string; host: string; status: number | null; ok: boolean; error: string | null; duration_ms: number; executed_at: string };
type Result = { ok: boolean; status: number; content_type: string; body: string; truncated: boolean; duration_ms: number; executed_at: string };

const fieldStyle: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--border-subtle)', borderRadius: 6, background: 'var(--bg-primary)', color: 'var(--text-main)', font: 'inherit' };
const buttonStyle: React.CSSProperties = { padding: '8px 13px', border: '1px solid var(--border-subtle)', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-main)', cursor: 'pointer' };
const initial = { name: '', method: 'GET', url: '', headers: '{}', body: '', bearer_secret_ref: '', timeout_ms: '10000' };

export const WorkbenchView: React.FC = () => {
  const [requests, setRequests] = useState<Saved[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState(initial);
  const [token, setToken] = useState('');
  const [tokenLabel, setTokenLabel] = useState('');
  const [response, setResponse] = useState<Result | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [requestsResult, credentialsResult, historyResult] = await Promise.all([
        apiFetch<{ requests: Saved[] }>('/api/v1/workbench/requests'),
        apiFetch<{ credentials: Credential[] }>('/api/v1/workbench/credentials'),
        apiFetch<{ history: History[] }>('/api/v1/workbench/history'),
      ]);
      setRequests(requestsResult.requests); setCredentials(credentialsResult.credentials); setHistory(historyResult.history);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Workbench could not load'); }
  };
  useEffect(() => { void load(); }, []);

  const choose = (request: Saved) => {
    setSelected(request.id); setResponse(null); setMessage('');
    setDraft({ name: request.name, method: request.method, url: request.url, headers: JSON.stringify(request.headers, null, 2),
      body: request.body, bearer_secret_ref: request.bearer_secret_ref ?? '', timeout_ms: String(request.timeout_ms) });
  };
  const host = (() => { try { return new URL(draft.url).hostname; } catch { return ''; } })();
  const matchingCredentials = credentials.filter((item) => item.host === host);

  const save = async () => {
    setBusy(true); setMessage('');
    try {
      const headers = JSON.parse(draft.headers);
      const payload = { name: draft.name, method: draft.method, url: draft.url, headers, body: draft.body,
        bearer_secret_ref: draft.bearer_secret_ref || null, timeout_ms: Number(draft.timeout_ms) };
      const saved = await apiFetch<Saved>(selected ? `/api/v1/workbench/requests/${selected}` : '/api/v1/workbench/requests',
        { method: selected ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      setMessage('Request saved.'); await load(); choose(saved);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save request'); }
    finally { setBusy(false); }
  };
  const addCredential = async () => {
    setBusy(true); setMessage('');
    try {
      const created = await apiFetch<Credential>('/api/v1/workbench/credentials', {
        method: 'POST', body: JSON.stringify({ host, label: tokenLabel, token }),
      });
      setToken(''); setTokenLabel(''); setDraft((current) => ({ ...current, bearer_secret_ref: created.ref }));
      setMessage(`Credential saved for ${created.host}.`); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save credential'); }
    finally { setBusy(false); }
  };
  const run = async () => {
    if (!selected) return;
    setBusy(true); setMessage(''); setResponse(null);
    try {
      const result = await apiFetch<Result>(`/api/v1/workbench/requests/${selected}/run`, { method: 'POST' });
      setResponse(result); setMessage(result.ok ? 'Request completed.' : `Server returned HTTP ${result.status}.`); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Request failed'); await load(); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/workbench/requests/${selected}`, { method: 'DELETE' });
      setSelected(null); setDraft(initial); setResponse(null); setMessage('Request deleted.'); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not delete request'); }
    finally { setBusy(false); }
  };

  return <div className="tj-a11y-view" style={{ height: '100%', overflowY: 'auto', padding: 20, color: 'var(--text-main)' }}>
    <h2 style={{ margin: 0 }}>API Workbench</h2>
    <p style={{ color: 'var(--text-muted)', maxWidth: 820 }}>Save and inspect public HTTPS requests. Local and private network targets are blocked. External write requests require approval before sending.</p>
    <div className="tj-responsive-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(190px, 260px) minmax(400px, 1fr)', gap: 20, alignItems: 'start' }}>
      <aside style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 9, padding: 12 }}>
        <button style={{ ...buttonStyle, width: '100%', marginBottom: 10 }} onClick={() => { setSelected(null); setDraft(initial); setResponse(null); setMessage(''); }}>+ New request</button>
        {requests.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No saved requests yet.</p>}
        {requests.map((request) => <button key={request.id} aria-pressed={selected === request.id} onClick={() => choose(request)} style={{ ...buttonStyle, display: 'block', width: '100%', textAlign: 'left', marginBottom: 6, borderColor: selected === request.id ? 'var(--accent-cyan)' : 'var(--border-subtle)' }}>
          <strong>{request.method}</strong> {request.name}<br/><small style={{ color: 'var(--text-muted)' }}>{new URL(request.url).hostname}</small>
        </button>)}
      </aside>
      <main style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 9, padding: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 10 }}>
          <label>Method<select style={fieldStyle} value={draft.method} onChange={(event) => setDraft({ ...draft, method: event.target.value })}>{['GET','HEAD','POST','PUT','PATCH','DELETE'].map((method) => <option key={method}>{method}</option>)}</select></label>
          <label>Request name<input style={fieldStyle} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="My API request" /></label>
        </div>
        <label style={{ display: 'block', marginTop: 12 }}>Public HTTPS URL<input style={fieldStyle} value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value, bearer_secret_ref: '' })} placeholder="https://api.example.com/v1/items" /></label>
        <label style={{ display: 'block', marginTop: 12 }}>Headers (JSON object)<textarea style={{ ...fieldStyle, minHeight: 72, fontFamily: 'monospace' }} value={draft.headers} onChange={(event) => setDraft({ ...draft, headers: event.target.value })} /></label>
        {!['GET','HEAD'].includes(draft.method) && <label style={{ display: 'block', marginTop: 12 }}>Body (up to 64 KB)<textarea style={{ ...fieldStyle, minHeight: 120, fontFamily: 'monospace' }} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10, marginTop: 12 }}>
          <label>Bearer credential<select style={fieldStyle} value={draft.bearer_secret_ref} onChange={(event) => setDraft({ ...draft, bearer_secret_ref: event.target.value })}><option value="">None</option>{matchingCredentials.map((credential) => <option key={credential.ref} value={credential.ref}>{credential.label}</option>)}</select></label>
          <label>Timeout (ms)<input style={fieldStyle} type="number" min="1000" max="15000" value={draft.timeout_ms} onChange={(event) => setDraft({ ...draft, timeout_ms: event.target.value })} /></label>
        </div>
        {host && <details style={{ marginTop: 12 }}><summary>Add bearer credential for {host}</summary><div className="tj-compact-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginTop: 8 }}>
          <input aria-label="Credential label" style={fieldStyle} value={tokenLabel} onChange={(event) => setTokenLabel(event.target.value)} placeholder="Credential label" />
          <input aria-label="Bearer token" style={fieldStyle} type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Bearer token" />
          <button style={buttonStyle} disabled={busy || !token || !tokenLabel} onClick={addCredential}>Save secret</button>
        </div></details>}
        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button style={buttonStyle} disabled={busy} onClick={save}>{busy ? 'Working…' : 'Save request'}</button>
          {selected && <button style={{ ...buttonStyle, borderColor: 'var(--accent-cyan)' }} disabled={busy} onClick={run}>Send request</button>}
          {selected && <button aria-label={`Delete saved request ${draft.name}`} style={buttonStyle} disabled={busy} onClick={remove}>Delete</button>}
        </div>
        {message && <p role="status" style={{ color: 'var(--accent-cyan)', marginTop: 10 }}>{message}</p>}
        {response && <section style={{ marginTop: 22 }}><h3>Response · HTTP {response.status} · {response.duration_ms} ms</h3>
          <small style={{ color: 'var(--text-muted)' }}>{response.content_type || 'unknown content type'}{response.truncated ? ' · truncated at 1 MB' : ''}</small>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 420, overflowY: 'auto', padding: 12, borderRadius: 6, background: 'var(--bg-primary)' }}>{response.body || '(empty body)'}</pre>
        </section>}
      </main>
    </div>
    <section style={{ marginTop: 22 }}><h3>Request history</h3><p style={{ color: 'var(--text-muted)', fontSize: 13 }}>History stores status and timing only; response bodies stay in this view.</p>
      {history.filter((item) => !selected || item.request_id === selected).slice(0, 30).map((item) => <div key={item.id} style={{ borderBottom: '1px solid var(--border-subtle)', padding: '7px 0', fontSize: 13 }}>
        {item.executed_at} · {item.method} {item.host} · {item.status ?? item.error ?? 'failed'} · {item.duration_ms} ms
      </div>)}
    </section>
  </div>;
};
