import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { Database } from '../src/db/database.js';
import { Audit } from '../src/security/audit.js';
import { PaperTradingService, parseOhlcCsv, simulate } from '../src/trading/paper-service.js';
import { registerPaperTradingRoutes } from '../src/server/routes/paper-trading.js';

const closes = [10, 10, 10, 10, 10, 9, 9, 9, 12, 13, 14, 14, 7, 6];
const csv = ['date,open,high,low,close,volume', ...closes.map((close, index) => {
  const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
  const open = index === 12 ? 14 : close;
  return `${date},${open},${Math.max(open, close)},${Math.min(open, close)},${close},1000`;
})].join('\n');

describe('historical paper trading only', () => {
  let dir: string;
  let db: Database;
  let audit: Audit;
  let paper: PaperTradingService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-paper-'));
    db = new Database(path.join(dir, 'paper.sqlite'));
    db.migrate();
    audit = new Audit(db);
    paper = new PaperTradingService(db, audit, () => 'default');
  });
  afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('validates user OHLC CSV with ascending dates and coherent prices', () => {
    expect(parseOhlcCsv(csv)).toHaveLength(closes.length);
    expect(() => parseOhlcCsv(csv.replace('2026-01-02', '2026-01-01'))).toThrow('ascending');
    expect(() => parseOhlcCsv(csv.replace('2026-01-02', '2026-99-99'))).toThrow('valid');
    expect(() => parseOhlcCsv(csv.replace('2026-01-03,10,10,10,10', '2026-01-03,10,9,10,10'))).toThrow('Invalid OHLC');
  });

  it('requires explicit paper enable, caps position and halts on the daily-loss limit', () => {
    const dataset = paper.addDataset({ symbol: 'TEST', csv });
    expect(paper.settings().enabled).toBe(false);
    expect(() => paper.run({ dataset_id: dataset.id, initial_cash: 10000, fast_window: 2, slow_window: 4 })).toThrow('kill switch');
    paper.updateSettings({ enabled: true, max_position_pct: 20, max_exposure_pct: 50, max_daily_loss_pct: 5 });
    const result = paper.run({ dataset_id: dataset.id, initial_cash: 10000, fast_window: 2, slow_window: 4 });
    expect(result.trades.some((trade) => trade.action === 'buy')).toBe(true);
    expect(result.trades.some((trade) => trade.action === 'risk_exit')).toBe(true);
    expect(result.metrics.halted_by_risk).toBe(true);
    const buy = result.trades.find((trade) => trade.action === 'buy')!;
    expect(buy.quantity * buy.price).toBeLessThanOrEqual(2000);
    expect(paper.getRun(result.id)?.trades).toHaveLength(result.trades.length);
    expect(audit.list().some((item) => item.action === 'paper.backtest.run' && item.decision === 'risk_halted')).toBe(true);
    expect(audit.list().some((item) => item.action === 'paper.trade.risk_exit' && item.decision === 'simulated')).toBe(true);
    paper.kill();
    expect(() => paper.run({ dataset_id: dataset.id, initial_cash: 10000, fast_window: 2, slow_window: 4 })).toThrow('kill switch');
  });

  it('is deterministic and rejects look-ahead window mistakes', () => {
    const bars = parseOhlcCsv(csv);
    const limits = { enabled: true, max_position_pct: 20, max_exposure_pct: 50, max_daily_loss_pct: 5 };
    expect(simulate(bars, { initial_cash: 10000, fast_window: 2, slow_window: 4 }, limits)).toEqual(simulate(bars, { initial_cash: 10000, fast_window: 2, slow_window: 4 }, limits));
    expect(() => simulate(bars, { initial_cash: 10000, fast_window: 4, slow_window: 4 }, limits)).toThrow('shorter');
  });

  it('halts at the opening gap before another signal can trade', () => {
    const bars = parseOhlcCsv(csv);
    bars[10] = { ...bars[10], open: 1, low: 1 };
    const result = simulate(bars, { initial_cash: 10000, fast_window: 2, slow_window: 4 }, { enabled: true, max_position_pct: 20, max_exposure_pct: 50, max_daily_loss_pct: 5 });
    expect(result.trades.map((trade) => trade.action)).toEqual(['buy', 'risk_exit']);
    expect(result.trades[1]).toMatchObject({ date: bars[10].date, price: 1 });
    expect(result.metrics.halted_by_risk).toBe(true);
    expect(result.metrics.open_quantity).toBe(0);
    expect(result.metrics.final_equity).toBe(result.trades[1].cash_after);
  });

  it('serves only historical simulation endpoints with explicit status', async () => {
    const app = Fastify();
    registerPaperTradingRoutes(app, { paper });
    try {
      const status = await app.inject({ method: 'GET', url: '/api/v1/paper/status' });
      expect(status.json()).toMatchObject({ mode: 'historical_paper_only', live_orders_available: false, broker_connected: false, settings: { enabled: false } });
      const imported = await app.inject({ method: 'POST', url: '/api/v1/paper/datasets', payload: { symbol: 'TEST', csv } });
      expect(imported.statusCode).toBe(201);
      const blocked = await app.inject({ method: 'POST', url: '/api/v1/paper/runs', payload: { dataset_id: imported.json().dataset.id, initial_cash: 10000, fast_window: 2, slow_window: 4 } });
      expect(blocked.statusCode).toBe(403);
      const settings = await app.inject({ method: 'PUT', url: '/api/v1/paper/settings', payload: { enabled: true, max_position_pct: 20, max_exposure_pct: 50, max_daily_loss_pct: 5 } });
      expect(settings.statusCode).toBe(200);
      const run = await app.inject({ method: 'POST', url: '/api/v1/paper/runs', payload: { dataset_id: imported.json().dataset.id, initial_cash: 10000, fast_window: 2, slow_window: 4 } });
      expect(run.statusCode).toBe(201);
      expect(run.json().run.assumptions).toContain('zero fees and slippage');
    } finally { await app.close(); }
  });
});
