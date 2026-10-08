import React, { useState } from 'react';
import { BarChart3, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { apiFetch } from '../api';

type NumericStats = { count: number; sum: number; min: number; max: number; mean: number; median: number; standard_deviation: number };
type Column = { name: string; kind: string; nonempty_count: number; missing_count: number; unique_count: number; numeric?: NumericStats; top_values?: { value: string; count: number }[] };
type Chart = { kind: 'bar' | 'histogram'; title: string; x_label: string; y_label: string; points: { label: string; value: number }[] }
  | { kind: 'scatter'; title: string; x_label: string; y_label: string; points: { x: number; y: number }[] };
type Analysis = { filename: string; row_count: number; column_count: number; columns: Column[]; preview: Record<string, string>[]; charts: Chart[]; warnings: string[] };
const MAX_BYTES = 1024 * 1024;
const number = (value: number) => Number.isInteger(value) ? value.toLocaleString() : Number(value.toPrecision(6)).toLocaleString();

function DataChart({ chart }: { chart: Chart }) {
  if (chart.kind === 'scatter') {
    const xs = chart.points.map((p) => p.x), ys = chart.points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scaleX = (x: number) => 30 + (maxX === minX ? 0.5 : (x - minX) / (maxX - minX)) * 330;
    const scaleY = (y: number) => 195 - (maxY === minY ? 0.5 : (y - minY) / (maxY - minY)) * 165;
    return <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>{chart.title}</h3>
      <svg viewBox="0 0 400 225" role="img" aria-label={`${chart.title}, ${chart.points.length} sampled points`} style={{ width: '100%', maxWidth: 600, height: 260 }}>
        <line x1="30" y1="195" x2="365" y2="195" stroke="currentColor" opacity="0.5" />
        <line x1="30" y1="20" x2="30" y2="195" stroke="currentColor" opacity="0.5" />
        {chart.points.map((point, index) => <circle key={index} cx={scaleX(point.x)} cy={scaleY(point.y)} r="3" fill="var(--accent-cyan)"><title>{`${chart.x_label}: ${point.x}, ${chart.y_label}: ${point.y}`}</title></circle>)}
        <text x="200" y="220" textAnchor="middle" fill="currentColor" fontSize="11">{chart.x_label}</text>
        <text x="15" y="15" fill="currentColor" fontSize="11">{chart.y_label}</text>
      </svg>
      <small style={{ color: 'var(--text-muted)' }}>Up to 200 evenly sampled complete pairs.</small>
    </div>;
  }
  const max = Math.max(1, ...chart.points.map((point) => point.value));
  return <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 16 }}>
    <h3 style={{ marginTop: 0 }}>{chart.title}</h3>
    <div style={{ display: 'grid', gap: 7 }}>
      {chart.points.map((point, index) => <div key={index} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 130px) minmax(100px, 1fr) 45px', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <span title={point.label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{point.label}</span>
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 4, height: 14 }}><div style={{ width: `${point.value / max * 100}%`, height: '100%', background: 'var(--accent-cyan)', borderRadius: 4 }} /></div>
        <strong>{point.value}</strong>
      </div>)}
    </div>
    <small style={{ display: 'block', marginTop: 12, color: 'var(--text-muted)' }}>{chart.x_label} · {chart.y_label}</small>
  </div>;
}

export const DataIntelligenceView: React.FC = () => {
  const [filename, setFilename] = useState('');
  const [csv, setCsv] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const chooseFile = async (file?: File) => {
    setCsv(null); setFilename(''); setAnalysis(null); setError(null);
    if (!file) return;
    if (!/\.csv$/i.test(file.name) || file.size > MAX_BYTES) { setError('Choose a .csv file up to 1 MB.'); return; }
    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      setCsv(content); setFilename(file.name);
    } catch { setError('CSV must be a readable UTF-8 text file.'); }
  };

  const analyze = async (event: React.FormEvent) => {
    event.preventDefault();
    if (csv === null || loading) return;
    setLoading(true); setAnalysis(null); setError(null);
    try {
      const result = await apiFetch<{ analysis: Analysis }>('/api/v1/data/analyze/csv', { method: 'POST', body: JSON.stringify({ csv, filename }) });
      setAnalysis(result.analysis);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  return <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24, color: 'var(--text-main)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><BarChart3 size={27} color="var(--accent-cyan)" /><h1 style={{ margin: 0 }}>Data Intelligence</h1></div>
    <p style={{ color: 'var(--text-muted)' }}>Analyze a CSV locally for missing values, distributions, statistics, and chart data. Files are processed in memory and are not sent to an AI provider.</p>
    <form onSubmit={analyze} style={{ display: 'grid', gap: 14, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20 }}>
      <label style={{ display: 'grid', gap: 8 }}><strong>CSV file</strong><span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}><FileSpreadsheet size={20} />{filename || 'UTF-8 .csv, up to 1 MB, 10,000 rows, 100 columns'}</span><input type="file" accept=".csv,text/csv" onChange={(event) => chooseFile(event.target.files?.[0])} /></label>
      <button type="submit" disabled={csv === null || loading} style={{ justifySelf: 'start', background: 'var(--accent-cyan)', color: '#000', border: 0, borderRadius: 8, padding: '10px 18px', fontWeight: 700, opacity: csv === null || loading ? 0.5 : 1, cursor: 'pointer' }}>{loading ? 'Analyzing…' : 'Analyze data'}</button>
    </form>
    {error && <p role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fb7185', background: 'rgba(244,63,94,.1)', padding: 14, borderRadius: 8 }}><AlertCircle size={18} />{error}</p>}
    {analysis && <div style={{ display: 'grid', gap: 20, marginTop: 20 }}>
      <section style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>{analysis.filename}</h2>
        <p>{number(analysis.row_count)} rows · {analysis.column_count} columns · {analysis.columns.filter((column) => column.kind === 'number').length} numeric columns</p>
        {analysis.warnings.map((warning, index) => <p key={index} style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{warning}</p>)}
      </section>
      <section><h2>Columns and statistics</h2><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--bg-secondary)' }}><thead><tr>{['Column', 'Type', 'Filled', 'Missing', 'Unique', 'Mean', 'Median', 'Range / most common'].map((heading) => <th key={heading} style={{ textAlign: 'left', padding: 10, borderBottom: '1px solid var(--border-subtle)' }}>{heading}</th>)}</tr></thead><tbody>{analysis.columns.map((column) => <tr key={column.name}>{[
        column.name, column.kind, number(column.nonempty_count), number(column.missing_count), number(column.unique_count),
        column.numeric ? number(column.numeric.mean) : '—', column.numeric ? number(column.numeric.median) : '—',
        column.numeric ? `${number(column.numeric.min)} to ${number(column.numeric.max)}` : column.top_values?.[0] ? `${column.top_values[0].value} (${column.top_values[0].count})` : '—',
      ].map((value, index) => <td key={index} style={{ padding: 10, borderBottom: '1px solid var(--border-subtle)', maxWidth: 260, overflowWrap: 'anywhere' }}>{value}</td>)}</tr>)}</tbody></table></div></section>
      {analysis.charts.length > 0 && <section><h2>Charts</h2><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: 14 }}>{analysis.charts.map((chart, index) => <DataChart key={index} chart={chart} />)}</div></section>}
      <section><h2>First {analysis.preview.length} rows</h2><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--bg-secondary)' }}><thead><tr>{analysis.columns.map((column) => <th key={column.name} style={{ textAlign: 'left', padding: 9, borderBottom: '1px solid var(--border-subtle)' }}>{column.name}</th>)}</tr></thead><tbody>{analysis.preview.map((row, index) => <tr key={index}>{analysis.columns.map((column) => <td key={column.name} style={{ padding: 9, borderBottom: '1px solid var(--border-subtle)', maxWidth: 300, overflowWrap: 'anywhere' }}>{row[column.name]}</td>)}</tr>)}</tbody></table></div></section>
    </div>}
  </div>;
};
