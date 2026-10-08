import crypto from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/database.js';
import type { Audit } from '../security/audit.js';

export class PaperError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number | null }
export interface PaperTrade { date: string; action: 'buy' | 'sell' | 'risk_exit'; price: number; quantity: number; cash_after: number; reason: string }
interface PaperSettings { enabled: boolean; max_position_pct: number; max_exposure_pct: number; max_daily_loss_pct: number }
const limitsSchema = z.strictObject({ enabled: z.boolean(), max_position_pct: z.number().min(1).max(100), max_exposure_pct: z.number().min(1).max(100), max_daily_loss_pct: z.number().min(0.1).max(100) });
const runSchema = z.strictObject({ dataset_id: z.string().uuid(), initial_cash: z.number().min(100).max(1_000_000_000), fast_window: z.number().int().min(2).max(100), slow_window: z.number().int().min(3).max(250) });

export function parseOhlcCsv(csv: string): Bar[] {
  if (typeof csv !== 'string' || Buffer.byteLength(csv, 'utf8') > 2_000_000) throw new PaperError('CSV must be text under 2 MB');
  const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 4 || lines.length > 10_001) throw new PaperError('CSV needs 3 to 10,000 OHLC rows');
  const header = lines.shift()!.split(',').map((cell) => cell.trim().toLowerCase());
  if (header.some((cell) => !/^[a-z_]+$/.test(cell)) || new Set(header).size !== header.length) throw new PaperError('Invalid CSV header');
  for (const field of ['date', 'open', 'high', 'low', 'close']) if (!header.includes(field)) throw new PaperError(`CSV header missing ${field}`);
  const index = (field: string) => header.indexOf(field);
  const bars: Bar[] = [];
  let previous = '';
  for (const [lineIndex, line] of lines.entries()) {
    if (line.includes('"')) throw new PaperError(`Quoted CSV fields are not supported (row ${lineIndex + 2})`);
    const cells = line.split(',').map((cell) => cell.trim());
    if (cells.length !== header.length) throw new PaperError(`CSV column count mismatch at row ${lineIndex + 2}`);
    const date = cells[index('date')];
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date || date <= previous) throw new PaperError(`Dates must be valid, unique, and ascending (row ${lineIndex + 2})`);
    previous = date;
    const number = (field: string) => Number(cells[index(field)]);
    const open = number('open'), high = number('high'), low = number('low'), close = number('close');
    if (![open, high, low, close].every((value) => Number.isFinite(value) && value >= 0.0001 && value <= 1_000_000_000) || high < Math.max(open, close) || low > Math.min(open, close) || high < low) throw new PaperError(`Invalid OHLC prices at row ${lineIndex + 2}`);
    const volume = index('volume') < 0 || cells[index('volume')] === '' ? null : number('volume');
    if (volume !== null && (!Number.isFinite(volume) || volume < 0)) throw new PaperError(`Invalid volume at row ${lineIndex + 2}`);
    bars.push({ date, open, high, low, close, volume });
  }
  return bars;
}

const round = (value: number) => Math.round(value * 10000) / 10000;

/** Deterministic long-only moving-average crossover; prior-close signal, next-open execution. */
export function simulate(bars: Bar[], input: { initial_cash: number; fast_window: number; slow_window: number }, limits: PaperSettings) {
  if (input.fast_window >= input.slow_window) throw new PaperError('Fast window must be shorter than slow window');
  if (bars.length < input.slow_window + 2) throw new PaperError(`Dataset needs at least ${input.slow_window + 2} rows for these windows`);
  const average = (endExclusive: number, length: number) => bars.slice(endExclusive - length, endExclusive).reduce((sum, bar) => sum + bar.close, 0) / length;
  let cash = input.initial_cash, quantity = 0, entryCost = 0, winning = 0, completed = 0, peak = input.initial_cash, maxDrawdown = 0, previousEquity = input.initial_cash, halted = false;
  const trades: PaperTrade[] = [];
  for (let i = input.slow_window + 1; i < bars.length; i++) {
    const bar = bars[i];
    const openingEquity = cash + quantity * bar.open;
    if (previousEquity > 0 && (previousEquity - openingEquity) / previousEquity * 100 >= limits.max_daily_loss_pct) {
      if (quantity) {
        const proceeds = quantity * bar.open;
        cash += proceeds; if (proceeds > entryCost) winning++; completed++;
        trades.push({ date: bar.date, action: 'risk_exit', price: bar.open, quantity, cash_after: round(cash), reason: 'Paper daily-loss limit reached at open; simulation halted' });
        quantity = 0; entryCost = 0;
      }
      maxDrawdown = Math.max(maxDrawdown, (peak - openingEquity) / peak * 100);
      halted = true;
      break;
    }
    const priorFast = average(i, input.fast_window), priorSlow = average(i, input.slow_window);
    const olderFast = average(i - 1, input.fast_window), olderSlow = average(i - 1, input.slow_window);
    const crossesUp = olderFast <= olderSlow && priorFast > priorSlow;
    const crossesDown = olderFast >= olderSlow && priorFast < priorSlow;
    if (quantity && crossesDown) {
      const proceeds = quantity * bar.open;
      cash += proceeds; if (proceeds > entryCost) winning++; completed++;
      trades.push({ date: bar.date, action: 'sell', price: bar.open, quantity, cash_after: round(cash), reason: 'Moving-average cross down' });
      quantity = 0; entryCost = 0;
    }
    if (!quantity && crossesUp) {
      const allowed = Math.min(cash, cash * limits.max_position_pct / 100, cash * limits.max_exposure_pct / 100);
      const buyQty = Math.floor(allowed / bar.open);
      if (buyQty > 0) {
        quantity = buyQty; entryCost = buyQty * bar.open; cash -= entryCost;
        trades.push({ date: bar.date, action: 'buy', price: bar.open, quantity, cash_after: round(cash), reason: 'Moving-average cross up' });
      }
    }
    let equity = cash + quantity * bar.close;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak * 100);
    if (previousEquity > 0 && (previousEquity - equity) / previousEquity * 100 >= limits.max_daily_loss_pct) {
      if (quantity) {
        const proceeds = quantity * bar.close;
        cash += proceeds; if (proceeds > entryCost) winning++; completed++;
        trades.push({ date: bar.date, action: 'risk_exit', price: bar.close, quantity, cash_after: round(cash), reason: 'Paper daily-loss limit reached; simulation halted' });
        quantity = 0; entryCost = 0; equity = cash;
      }
      halted = true;
      break;
    }
    previousEquity = equity;
  }
  const last = bars[bars.length - 1];
  const finalEquity = cash + quantity * (halted ? (bars.find((bar) => bar.date === trades.at(-1)?.date)?.close ?? last.close) : last.close);
  return {
    assumptions: 'Historical user-provided OHLC data; long-only; prior-close signal; next-open fills; daily-loss checks at open and close; whole shares; zero fees and slippage; no dividends, taxes, spread, or liquidity constraints.',
    metrics: { initial_cash: round(input.initial_cash), final_equity: round(finalEquity), return_pct: round((finalEquity / input.initial_cash - 1) * 100), max_drawdown_pct: round(maxDrawdown), trades: trades.length, completed_round_trips: completed, win_rate_pct: completed ? round(winning / completed * 100) : null, halted_by_risk: halted, open_quantity: quantity },
    trades,
  };
}

export class PaperTradingService {
  constructor(private db: Database, private audit: Audit, private workspaceId: () => string) {
    db.exec('CREATE TABLE IF NOT EXISTS paper_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, max_position_pct REAL NOT NULL DEFAULT 20, max_exposure_pct REAL NOT NULL DEFAULT 50, max_daily_loss_pct REAL NOT NULL DEFAULT 5, updated_at TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS paper_datasets (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, symbol TEXT NOT NULL, row_count INTEGER NOT NULL, first_date TEXT NOT NULL, last_date TEXT NOT NULL, bars TEXT NOT NULL, created_at TEXT NOT NULL)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_paper_datasets_workspace ON paper_datasets(workspace_id, created_at DESC)');
    db.exec('CREATE TABLE IF NOT EXISTS paper_runs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, dataset_id TEXT NOT NULL, params TEXT NOT NULL, limits TEXT NOT NULL, metrics TEXT NOT NULL, trades TEXT NOT NULL, assumptions TEXT NOT NULL, created_at TEXT NOT NULL)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_paper_runs_workspace ON paper_runs(workspace_id, created_at DESC)');
  }

  settings(): PaperSettings {
    const row = this.db.get<any>('SELECT * FROM paper_settings WHERE workspace_id = ?', [this.workspaceId()]);
    return row ? { enabled: !!row.enabled, max_position_pct: row.max_position_pct, max_exposure_pct: row.max_exposure_pct, max_daily_loss_pct: row.max_daily_loss_pct } : { enabled: false, max_position_pct: 20, max_exposure_pct: 50, max_daily_loss_pct: 5 };
  }

  updateSettings(raw: unknown) {
    const parsed = limitsSchema.safeParse(raw);
    if (!parsed.success) throw new PaperError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    const value = parsed.data;
    this.db.run('INSERT INTO paper_settings (workspace_id, enabled, max_position_pct, max_exposure_pct, max_daily_loss_pct, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET enabled=excluded.enabled, max_position_pct=excluded.max_position_pct, max_exposure_pct=excluded.max_exposure_pct, max_daily_loss_pct=excluded.max_daily_loss_pct, updated_at=excluded.updated_at', [this.workspaceId(), value.enabled ? 1 : 0, value.max_position_pct, value.max_exposure_pct, value.max_daily_loss_pct, new Date().toISOString()]);
    this.audit.log({ actor: 'user:api', action: 'paper.settings.update', decision: value.enabled ? 'enabled' : 'paused', details: { max_position_pct: value.max_position_pct, max_exposure_pct: value.max_exposure_pct, max_daily_loss_pct: value.max_daily_loss_pct } });
    return this.settings();
  }

  kill() {
    const current = this.settings();
    return this.updateSettings({ ...current, enabled: false });
  }

  addDataset(raw: unknown) {
    const parsed = z.strictObject({ symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9._-]{1,20}$/), csv: z.string() }).safeParse(raw);
    if (!parsed.success) throw new PaperError('Symbol and CSV are required');
    const bars = parseOhlcCsv(parsed.data.csv);
    const recordId = crypto.randomUUID();
    this.db.run('INSERT INTO paper_datasets (id, workspace_id, symbol, row_count, first_date, last_date, bars, created_at) VALUES (?,?,?,?,?,?,?,?)', [recordId, this.workspaceId(), parsed.data.symbol, bars.length, bars[0].date, bars.at(-1)!.date, JSON.stringify(bars), new Date().toISOString()]);
    this.audit.log({ actor: 'user:api', action: 'paper.dataset.import', resource: recordId, decision: 'imported', details: { symbol: parsed.data.symbol, rows: bars.length } });
    return this.getDataset(recordId)!;
  }

  getDataset(recordId: string) {
    const row = this.db.get<any>('SELECT id, symbol, row_count, first_date, last_date, created_at FROM paper_datasets WHERE id = ? AND workspace_id = ?', [recordId, this.workspaceId()]);
    return row;
  }
  datasets() { return this.db.all<any>('SELECT id, symbol, row_count, first_date, last_date, created_at FROM paper_datasets WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100', [this.workspaceId()]); }
  datasetPreview(recordId: string) {
    const row = this.db.get<any>('SELECT * FROM paper_datasets WHERE id = ? AND workspace_id = ?', [recordId, this.workspaceId()]);
    if (!row) throw new PaperError('Dataset not found', 404);
    const bars = JSON.parse(row.bars) as Bar[];
    return { dataset: this.getDataset(recordId), first: bars.slice(0, 3), last: bars.slice(-3) };
  }

  run(raw: unknown) {
    const settings = this.settings();
    if (!settings.enabled) throw new PaperError('Paper simulation paused by kill switch', 403);
    const parsed = runSchema.safeParse(raw);
    if (!parsed.success) throw new PaperError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    const dataset = this.db.get<any>('SELECT * FROM paper_datasets WHERE id = ? AND workspace_id = ?', [parsed.data.dataset_id, this.workspaceId()]);
    if (!dataset) throw new PaperError('Dataset not found', 404);
    const result = simulate(JSON.parse(dataset.bars), parsed.data, settings);
    const id = crypto.randomUUID(), created_at = new Date().toISOString();
    this.db.run('INSERT INTO paper_runs (id, workspace_id, dataset_id, params, limits, metrics, trades, assumptions, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [id, this.workspaceId(), dataset.id, JSON.stringify(parsed.data), JSON.stringify(settings), JSON.stringify(result.metrics), JSON.stringify(result.trades), result.assumptions, created_at]);
    this.audit.log({ actor: 'user:api', action: 'paper.backtest.run', resource: id, decision: result.metrics.halted_by_risk ? 'risk_halted' : 'completed', details: { dataset_id: dataset.id, trades: result.trades.length, limits: settings } });
    for (const trade of result.trades) this.audit.log({ actor: 'paper:simulator', action: `paper.trade.${trade.action}`, resource: id, decision: 'simulated', details: { date: trade.date, price: trade.price, quantity: trade.quantity, reason: trade.reason } });
    return { id, dataset_id: dataset.id, params: parsed.data, limits: settings, ...result, created_at };
  }

  runs() { return this.db.all<any>('SELECT id, dataset_id, params, limits, metrics, assumptions, created_at FROM paper_runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100', [this.workspaceId()]).map((row) => ({ ...row, params: JSON.parse(row.params), limits: JSON.parse(row.limits), metrics: JSON.parse(row.metrics) })); }
  getRun(id: string) {
    const row = this.db.get<any>('SELECT * FROM paper_runs WHERE id = ? AND workspace_id = ?', [id, this.workspaceId()]);
    return row ? { ...row, params: JSON.parse(row.params), limits: JSON.parse(row.limits), metrics: JSON.parse(row.metrics), trades: JSON.parse(row.trades) as PaperTrade[] } : undefined;
  }
}
