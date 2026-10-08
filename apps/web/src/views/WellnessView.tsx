import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import './accessible-forms.css';

type Kind = 'sleep' | 'activity' | 'heart_rate' | 'nutrition';
type Entry = { id: string; date: string; kind: Kind; value: number; unit: string; source: 'manual' | 'csv_import'; source_label: string; notes: string };
type Trend = { kind: Kind; unit: string; from: string; to: string; count: number; daily: Array<{ date: string; value: number; count: number }>; average: number | null; change: number | null; sources: { manual: number; csv_import: number } };

const kindLabels: Record<Kind, string> = { sleep: 'Sleep (hours)', activity: 'Activity (steps)', heart_rate: 'Heart rate (bpm)', nutrition: 'Nutrition estimate (kcal)' };
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', color: 'var(--text-main)', background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: 6, font: 'inherit' };
const button: React.CSSProperties = { padding: '8px 12px', color: 'var(--text-main)', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, cursor: 'pointer' };
const panel: React.CSSProperties = { padding: 16, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 9 };
const today = new Date().toISOString().slice(0, 10);
const prior = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

export const WellnessView: React.FC = () => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState({ date: today, kind: 'sleep' as Kind, value: '', notes: '' });
  const [kind, setKind] = useState<Kind>('sleep');
  const [from, setFrom] = useState(prior);
  const [to, setTo] = useState(today);
  const [trend, setTrend] = useState<Trend | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadEntries = async () => {
    try { setEntries((await apiFetch<{ entries: Entry[] }>('/api/v1/wellness/entries?limit=500')).entries); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load wellness records'); }
  };
  useEffect(() => { void loadEntries(); }, []);

  const add = async () => {
    setBusy(true); setMessage('');
    try {
      await apiFetch('/api/v1/wellness/entries', { method: 'POST', body: JSON.stringify({ ...draft, value: Number(draft.value), source_label: 'User entered' }) });
      setDraft({ ...draft, value: '', notes: '' }); setMessage('Record saved privately on this computer.'); await loadEntries();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save record'); }
    finally { setBusy(false); }
  };
  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 256 * 1024) { setMessage('CSV exceeds 256 KB.'); return; }
    setBusy(true); setMessage('');
    try {
      const csv = await file.text();
      const result = await apiFetch<{ imported: number }>('/api/v1/wellness/import', { method: 'POST', body: JSON.stringify({ csv, source_label: file.name }) });
      setMessage(`Imported ${result.imported} records from ${file.name}.`); await loadEntries();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not import CSV'); }
    finally { setBusy(false); }
  };
  const loadTrend = async () => {
    setBusy(true); setMessage(''); setQuestions([]);
    const query = `kind=${encodeURIComponent(kind)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    try {
      const [summary, prepared] = await Promise.all([
        apiFetch<Trend>(`/api/v1/wellness/trends?${query}`),
        apiFetch<{ questions: string[] }>(`/api/v1/wellness/clinician-questions?${query}`),
      ]);
      setTrend(summary); setQuestions(prepared.questions);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not calculate trend'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    try {
      await apiFetch(`/api/v1/wellness/entries/${id}`, { method: 'DELETE' });
      setMessage('Record deleted from local storage.'); setTrend(null); setQuestions([]); await loadEntries();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not delete record'); }
  };
  const maxDaily = trend?.daily.reduce((max, day) => Math.max(max, day.value), 0) ?? 0;

  return <div className="tj-a11y-view" style={{ height: '100%', overflowY: 'auto', padding: 20, color: 'var(--text-main)' }}>
    <h2 style={{ margin: 0 }}>Health & Wellness</h2>
    <p style={{ color: 'var(--text-muted)', maxWidth: 900 }}>Track your own measurements and prepare questions for a clinician. Values and notes are encrypted in TJ's local vault. Trends describe recorded numbers only; they are not medical assessments.</p>
    {message && <p role="status" style={{ color: 'var(--accent-cyan)' }}>{message}</p>}
    <div className="tj-responsive-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(310px, 390px) 1fr', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 18 }}>
        <section style={panel}><h3 style={{ marginTop: 0 }}>Add measurement</h3>
          <label>Date<input style={input} type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
          <label style={{ display: 'block', marginTop: 8 }}>Metric<select style={input} value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as Kind })}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label style={{ display: 'block', marginTop: 8 }}>Value<input style={input} type="number" min="0" step={draft.kind === 'activity' ? '1' : '0.1'} value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} /></label>
          <label style={{ display: 'block', marginTop: 8 }}>Context or note<textarea style={{ ...input, minHeight: 68 }} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Optional; stays in local vault" /></label>
          <button style={{ ...button, marginTop: 10 }} disabled={busy || !draft.value} onClick={add}>Save measurement</button>
        </section>
        <section style={panel}><h3 style={{ marginTop: 0 }}>Import your CSV</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Header: <code>date,kind,value,notes</code>. Up to 500 rows and 256 KB. File name is saved as the source label; no wearable service is contacted.</p>
          <input aria-label="Import wellness CSV" style={input} type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; void importCsv(file); event.target.value = ''; }} />
        </section>
      </div>
      <div style={{ display: 'grid', gap: 18 }}>
        <section style={panel}><h3 style={{ marginTop: 0 }}>Date trend</h3>
          <div className="tj-compact-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
            <label>Metric<select style={input} value={kind} onChange={(event) => setKind(event.target.value as Kind)}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>From<input style={input} type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label>To<input style={input} type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
            <button style={button} disabled={busy} onClick={loadTrend}>View</button>
          </div>
          {trend && <div style={{ marginTop: 18 }}>
            <p>{trend.count} records · average daily recorded value {trend.average ?? '—'} {trend.unit} · first-to-last change {trend.change ?? '—'} {trend.unit}</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Sources: {trend.sources.manual} manual, {trend.sources.csv_import} CSV import. Multiple heart-rate readings on one day are averaged; other same-day values are summed.</p>
            {trend.daily.length === 0 && <p>No entries in this date range.</p>}
            <div role="list" aria-label={`${kindLabels[kind]} daily recorded values`} style={{ display: 'grid', gap: 7 }}>
              {trend.daily.map((day) => <div role="listitem" key={day.date} style={{ display: 'grid', gridTemplateColumns: '95px 1fr 90px', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <span>{day.date}</span><div style={{ height: 12, background: 'var(--bg-primary)', borderRadius: 6 }}><div style={{ height: '100%', width: `${maxDaily > 0 ? (day.value / maxDaily) * 100 : 0}%`, borderRadius: 6, background: 'var(--accent-cyan)' }} /></div><span>{day.value} {trend.unit}</span>
              </div>)}
            </div>
          </div>}
        </section>
        {questions.length > 0 && <section style={panel}><h3 style={{ marginTop: 0 }}>Questions for your clinician</h3><ol>{questions.map((question) => <li key={question} style={{ marginBottom: 8 }}>{question}</li>)}</ol></section>}
        <section style={panel}><h3 style={{ marginTop: 0 }}>Saved records</h3>
          {entries.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No records saved.</p>}
          {entries.map((entry) => <div key={entry.id} style={{ borderBottom: '1px solid var(--border-subtle)', padding: '8px 0', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <div><strong>{entry.date}</strong> · {kindLabels[entry.kind]} · {entry.value} {entry.unit}<br/><small style={{ color: 'var(--text-muted)' }}>{entry.source === 'csv_import' ? 'CSV import' : 'Manual'}: {entry.source_label}{entry.notes ? ` · ${entry.notes}` : ''}</small></div>
            <button aria-label={`Delete ${entry.kind.replace('_', ' ')} record from ${entry.date}`} style={button} onClick={() => remove(entry.id)}>Delete</button>
          </div>)}
        </section>
      </div>
    </div>
  </div>;
};
