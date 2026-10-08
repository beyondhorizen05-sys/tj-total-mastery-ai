import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';

type Source = { type: 'workflow_run' | 'event'; id: string; label: string };
type Feedback = { id: string; source_type: string; source_id: string; rating: string; note: string; created_at: string };
type Evidence = { type: string; id: string };
type Proposal = { id: string; category: string; title: string; summary: string; recommendation: string; evidence: Evidence[]; status: 'pending' | 'accepted' | 'rejected'; created_at: string; decision_note: string | null };

const card: React.CSSProperties = { padding: 18, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 10 };
const field: React.CSSProperties = { width: '100%', padding: '9px 11px', borderRadius: 7, border: '1px solid var(--border-subtle)', background: 'var(--bg-main)', color: 'var(--text-main)' };
const button: React.CSSProperties = { padding: '9px 13px', borderRadius: 7, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated, #202638)', color: 'var(--text-main)', cursor: 'pointer' };

export const LearningView: React.FC = () => {
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState('');
  const [rating, setRating] = useState<'helpful' | 'needs_improvement'>('needs_improvement');
  const [note, setNote] = useState('');
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [evidence, setEvidence] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    const [runs, events, f, p] = await Promise.all([
      apiFetch<{ runs: Array<{ id: string; workflow_id: string; status: string }> }>('/api/v1/workflow-runs?limit=30'),
      apiFetch<{ events: Array<{ id: string; name: string; summary: string }> }>('/api/v1/system/activity?limit=30'),
      apiFetch<{ feedback: Feedback[] }>('/api/v1/learning/feedback'),
      apiFetch<{ proposals: Proposal[] }>('/api/v1/learning/proposals'),
    ]);
    const next: Source[] = [
      ...runs.runs.map((run) => ({ type: 'workflow_run' as const, id: run.id, label: `Workflow ${run.status} · ${run.id.slice(0, 8)}` })),
      ...events.events.map((event) => ({ type: 'event' as const, id: event.id, label: `${event.name} · ${event.summary.slice(0, 70)}` })),
    ];
    setSources(next);
    setSelected((current) => current || (next[0] ? `${next[0].type}:${next[0].id}` : ''));
    setFeedback(f.feedback);
    setProposals(p.proposals);
  };

  useEffect(() => { refresh().catch((reason) => setError(reason.message)); }, []);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true); setError(''); setMessage('');
    try { setMessage(await fn()); await refresh(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const submit = () => act(async () => {
    const source = sources.find((item) => `${item.type}:${item.id}` === selected);
    if (!source) throw new Error('Choose a recorded run or event first.');
    await apiFetch('/api/v1/learning/feedback', { method: 'POST', body: JSON.stringify({ source_type: source.type, source_id: source.id, rating, note }) });
    setNote('');
    return 'Feedback saved. Analyze outcomes to create proposals.';
  });

  const analyze = () => act(async () => {
    const result = await apiFetch<{ created: number }>('/api/v1/learning/analyze', { method: 'POST' });
    return `${result.created} new proposal${result.created === 1 ? '' : 's'} created from recorded outcomes.`;
  });

  const review = (id: string, decision: 'accept' | 'reject') => act(async () => {
    await apiFetch(`/api/v1/learning/proposals/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify({ decision }) });
    return `Proposal ${decision === 'accept' ? 'accepted for planning' : 'rejected'}. No code or policy changed.`;
  });

  const inspect = async (item: Evidence) => {
    const key = `${item.type}:${item.id}`;
    try {
      const result = await apiFetch<{ evidence: Record<string, unknown> }>(`/api/v1/learning/evidence/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}`);
      setEvidence((current) => ({ ...current, [key]: result.evidence }));
    } catch (reason) { setError((reason as Error).message); }
  };

  return <div style={{ padding: 24, height: '100%', overflowY: 'auto', display: 'grid', gap: 18, alignContent: 'start' }}>
    <header>
      <h2 style={{ margin: 0 }}>Feedback & Improvements</h2>
      <p style={{ color: 'var(--text-muted)' }}>Record outcomes, inspect evidence, and review proposed changes. Acceptance records a decision; it does not deploy changes.</p>
    </header>
    {error && <div role="alert" style={{ color: '#fb7185' }}>{error}</div>}
    {message && <div role="status" style={{ color: 'var(--accent-cyan)' }}>{message}</div>}
    <section style={card} aria-label="Give feedback">
      <h3 style={{ marginTop: 0 }}>Give feedback on a recorded outcome</h3>
      <div style={{ display: 'grid', gap: 10 }}>
        <select aria-label="Recorded outcome" style={field} value={selected} onChange={(event) => setSelected(event.target.value)}>
          {sources.length === 0 && <option value="">No recorded outcomes yet</option>}
          {sources.map((source) => <option key={`${source.type}:${source.id}`} value={`${source.type}:${source.id}`}>{source.label}</option>)}
        </select>
        <select aria-label="Feedback rating" style={field} value={rating} onChange={(event) => setRating(event.target.value as typeof rating)}>
          <option value="needs_improvement">Needs improvement</option><option value="helpful">Helpful</option>
        </select>
        <textarea aria-label="Feedback note" style={{ ...field, minHeight: 75 }} maxLength={2000} placeholder="What should TJ improve?" value={note} onChange={(event) => setNote(event.target.value)} />
        <div><button style={button} disabled={busy || !selected} onClick={submit}>Save feedback</button></div>
      </div>
    </section>
    <section style={card} aria-label="Improvement proposals">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Improvement proposals</h3>
        <button style={button} disabled={busy} onClick={analyze}>Analyze recorded outcomes</button>
      </div>
      {proposals.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No proposals yet. TJ needs recorded failures, denials, or explicit feedback as evidence.</p>}
      <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
        {proposals.map((proposal) => <article key={proposal.id} style={{ ...card, background: 'var(--bg-main)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><strong>{proposal.title}</strong><span>{proposal.status}</span></div>
          <p>{proposal.summary}</p>
          <p style={{ color: 'var(--text-muted)' }}>{proposal.recommendation}</p>
          <details><summary>Inspect {proposal.evidence.length} evidence item{proposal.evidence.length === 1 ? '' : 's'}</summary>
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              {proposal.evidence.map((item) => {
                const key = `${item.type}:${item.id}`;
                return <div key={key}><button style={button} onClick={() => inspect(item)}>{item.type} · {item.id.slice(0, 8)}</button>
                  {evidence[key] !== undefined && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{JSON.stringify(evidence[key], null, 2)}</pre>}
                </div>;
              })}
            </div>
          </details>
          {proposal.status === 'pending' && <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={button} disabled={busy} onClick={() => review(proposal.id, 'accept')}>Accept for planning</button>
            <button style={button} disabled={busy} onClick={() => review(proposal.id, 'reject')}>Reject</button>
          </div>}
        </article>)}
      </div>
    </section>
    <section style={card} aria-label="Recent feedback"><h3 style={{ marginTop: 0 }}>Recent feedback</h3>
      {feedback.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No feedback saved yet.</p> : feedback.slice(0, 20).map((item) =>
        <div key={item.id} style={{ padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}><strong>{item.rating}</strong> · {item.source_type} {item.source_id.slice(0, 8)}<div>{item.note || 'No note'}</div></div>)}
    </section>
  </div>;
};
