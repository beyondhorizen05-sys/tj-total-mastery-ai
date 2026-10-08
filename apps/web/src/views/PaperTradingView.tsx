import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';

type Settings = { enabled: boolean; max_position_pct: number; max_exposure_pct: number; max_daily_loss_pct: number };
type Dataset = { id: string; symbol: string; row_count: number; first_date: string; last_date: string; created_at: string };
type Trade = { date: string; action: string; price: number; quantity: number; cash_after: number; reason: string };
type Metrics = { initial_cash: number; final_equity: number; return_pct: number; max_drawdown_pct: number; trades: number; completed_round_trips: number; win_rate_pct: number | null; halted_by_risk: boolean; open_quantity: number };
type Run = { id: string; dataset_id: string; params: { fast_window: number; slow_window: number; initial_cash: number }; limits: Settings; metrics: Metrics; assumptions: string; trades?: Trade[]; created_at: string };
const panel: React.CSSProperties = { padding: 16, borderRadius: 9, border: '1px solid var(--border-subtle)', background: 'var(--bg-card)' };
const field: React.CSSProperties = { width: '100%', padding: '9px 10px', border: '1px solid var(--border-subtle)', borderRadius: 6, background: 'var(--bg-main)', color: 'var(--text-main)' };
const button: React.CSSProperties = { padding: '9px 13px', border: '1px solid var(--border-subtle)', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-main)', cursor: 'pointer' };

export const PaperTradingView: React.FC = () => {
  const [settings, setSettings] = useState<Settings>({ enabled: false, max_position_pct: 20, max_exposure_pct: 50, max_daily_loss_pct: 5 });
  const [appliedEnabled, setAppliedEnabled] = useState(false);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedDataset, setSelectedDataset] = useState('');
  const [symbol, setSymbol] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [initialCash, setInitialCash] = useState(10000);
  const [fastWindow, setFastWindow] = useState(5);
  const [slowWindow, setSlowWindow] = useState(20);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [status, datasetList, runList] = await Promise.all([
      apiFetch<{ settings: Settings }>('/api/v1/paper/status'),
      apiFetch<{ datasets: Dataset[] }>('/api/v1/paper/datasets'),
      apiFetch<{ runs: Run[] }>('/api/v1/paper/runs'),
    ]);
    setSettings(status.settings); setAppliedEnabled(status.settings.enabled); setDatasets(datasetList.datasets); setRuns(runList.runs);
    setSelectedDataset((current) => current || datasetList.datasets[0]?.id || '');
  };
  useEffect(() => { refresh().catch((reason) => setError((reason as Error).message)); }, []);

  const act = async (operation: () => Promise<string>) => {
    setBusy(true); setError(''); setMessage('');
    try { setMessage(await operation()); await refresh(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const saveSettings = () => act(async () => {
    const result = await apiFetch<{ settings: Settings }>('/api/v1/paper/settings', { method: 'PUT', body: JSON.stringify(settings) });
    return result.settings.enabled ? 'Paper simulations enabled with these limits.' : 'Paper simulations paused.';
  });
  const kill = () => act(async () => {
    await apiFetch('/api/v1/paper/kill', { method: 'POST' });
    return 'Kill switch active: new paper simulations are paused.';
  });
  const importCsv = () => act(async () => {
    if (!file) throw new Error('Choose a CSV file.');
    if (file.size > 2_000_000) throw new Error('CSV must be under 2 MB.');
    const result = await apiFetch<{ dataset: Dataset }>('/api/v1/paper/datasets', { method: 'POST', body: JSON.stringify({ symbol, csv: await file.text() }) });
    setFile(null); setSelectedDataset(result.dataset.id);
    return `Imported ${result.dataset.row_count} historical rows for ${result.dataset.symbol}.`;
  });
  const run = () => act(async () => {
    const result = await apiFetch<{ run: Run }>('/api/v1/paper/runs', { method: 'POST', body: JSON.stringify({ dataset_id: selectedDataset, initial_cash: initialCash, fast_window: fastWindow, slow_window: slowWindow }) });
    setSelectedRun(result.run);
    return result.run.metrics.halted_by_risk ? 'Simulation halted by the daily-loss limit.' : 'Historical paper backtest completed.';
  });
  const inspect = async (id: string) => {
    try { const result = await apiFetch<{ run: Run }>(`/api/v1/paper/runs/${encodeURIComponent(id)}`); setSelectedRun(result.run); setError(''); }
    catch (reason) { setError((reason as Error).message); }
  };

  const numberField = (label: string, value: number, set: (value: number) => void, min: number, max: number) =>
    <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>{label}<input style={field} type="number" min={min} max={max} step="any" value={value} onChange={(event) => set(Number(event.target.value))} /></label>;

  return <div style={{ padding: 24, height: '100%', overflowY: 'auto', display: 'grid', gap: 16, alignContent: 'start' }}>
    <header><h2 style={{ margin: 0 }}>Trading Lab · Historical Paper Only</h2><p style={{ color: 'var(--text-muted)' }}>Upload your own historical OHLC CSV and test a deterministic moving-average strategy. No broker connection or live orders. Past performance does not predict future results.</p></header>
    {error && <p role="alert" style={{ color: '#fb7185' }}>{error}</p>}
    {message && <p role="status" style={{ color: 'var(--accent-cyan)' }}>{message}</p>}
    <section style={panel} aria-label="Paper risk controls"><h3 style={{ marginTop: 0 }}>Risk controls</h3>
      <p style={{ color: appliedEnabled ? '#34d399' : '#fbbf24' }}>{appliedEnabled ? 'Paper simulations enabled' : 'Kill switch active · new simulations paused'}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        {numberField('Max position %', settings.max_position_pct, (value) => setSettings((current) => ({ ...current, max_position_pct: value })), 1, 100)}
        {numberField('Max exposure %', settings.max_exposure_pct, (value) => setSettings((current) => ({ ...current, max_exposure_pct: value })), 1, 100)}
        {numberField('Max daily loss %', settings.max_daily_loss_pct, (value) => setSettings((current) => ({ ...current, max_daily_loss_pct: value })), 0.1, 100)}
      </div>
      <label style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 12 }}><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))} /> Enable new paper simulations</label>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><button style={button} disabled={busy} onClick={saveSettings}>Save limits</button><button style={{ ...button, color: '#fb7185' }} disabled={busy} onClick={kill}>Activate kill switch</button></div>
    </section>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
      <section style={panel} aria-label="Import historical data"><h3 style={{ marginTop: 0 }}>Historical OHLC data</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>CSV columns: date,open,high,low,close; optional volume. Dates YYYY-MM-DD in ascending order. Up to 10,000 rows and 2 MB.</p>
        <label style={{ display: 'grid', gap: 5 }}>Symbol<input style={field} value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="TEST" /></label>
        <label style={{ display: 'grid', gap: 5, marginTop: 10 }}>CSV file<input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <button style={{ ...button, marginTop: 12 }} disabled={busy || !file || !symbol.trim()} onClick={importCsv}>Import locally</button>
        <h4>Imported datasets</h4>{datasets.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No historical data imported yet.</p> : datasets.map((item) => <div key={item.id} style={{ padding: '7px 0', borderTop: '1px solid var(--border-subtle)' }}>{item.symbol} · {item.row_count} bars · {item.first_date} to {item.last_date}</div>)}
      </section>
      <section style={panel} aria-label="Backtest strategy"><h3 style={{ marginTop: 0 }}>Moving-average backtest</h3>
        <label style={{ display: 'grid', gap: 5 }}>Dataset<select style={field} value={selectedDataset} onChange={(event) => setSelectedDataset(event.target.value)}><option value="">Choose dataset</option>{datasets.map((item) => <option key={item.id} value={item.id}>{item.symbol} · {item.row_count} bars</option>)}</select></label>
        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          {numberField('Starting paper cash', initialCash, setInitialCash, 100, 1_000_000_000)}
          {numberField('Fast window (bars)', fastWindow, setFastWindow, 2, 100)}
          {numberField('Slow window (bars)', slowWindow, setSlowWindow, 3, 250)}
        </div>
        <button style={{ ...button, marginTop: 12 }} disabled={busy || !appliedEnabled || !selectedDataset} onClick={run}>Run historical simulation</button>
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Signal uses prior closes and executes at the next open. Assumes whole shares, zero fees/slippage, no dividends, tax, spread, or liquidity limits.</p>
      </section>
    </div>
    <section style={panel} aria-label="Backtest runs"><h3 style={{ marginTop: 0 }}>Saved simulation runs</h3>
      {runs.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No simulations run yet.</p> : runs.map((item) => <button key={item.id} style={{ ...button, display: 'block', width: '100%', textAlign: 'left', marginBottom: 7 }} onClick={() => inspect(item.id)}>
        {new Date(item.created_at).toLocaleString()} · return {item.metrics.return_pct}% · max drawdown {item.metrics.max_drawdown_pct}% {item.metrics.halted_by_risk ? '· RISK HALT' : ''}
      </button>)}
    </section>
    {selectedRun && <section style={panel} aria-label="Selected simulation"><h3 style={{ marginTop: 0 }}>Run {selectedRun.id.slice(0, 8)}</h3>
      <p style={{ color: 'var(--text-muted)' }}>{selectedRun.assumptions}</p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>{Object.entries(selectedRun.metrics).map(([name, value]) => <span key={name}><strong>{name.replace(/_/g, ' ')}</strong>: {String(value ?? 'n/a')}</span>)}</div>
      <h4>Simulated actions</h4>{selectedRun.trades?.length ? <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', textAlign: 'left' }}><thead><tr><th>Date</th><th>Action</th><th>Price</th><th>Quantity</th><th>Reason</th></tr></thead><tbody>{selectedRun.trades.map((trade, index) => <tr key={`${trade.date}:${index}`}><td>{trade.date}</td><td>{trade.action}</td><td>{trade.price}</td><td>{trade.quantity}</td><td>{trade.reason}</td></tr>)}</tbody></table></div> : <p style={{ color: 'var(--text-muted)' }}>No simulated trades met the strategy and limits.</p>}
    </section>}
  </div>;
};
