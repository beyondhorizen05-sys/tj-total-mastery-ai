import crypto from 'node:crypto';
import type { Database } from '../db/database.js';
import type { Vault } from '../security/vault.js';

export type WellnessKind = 'sleep' | 'activity' | 'heart_rate' | 'nutrition';
export type WellnessSource = 'manual' | 'csv_import';
export interface WellnessEntry {
  id: string; date: string; kind: WellnessKind; value: number; unit: string;
  source: WellnessSource; source_label: string; notes: string; created_at: string;
}
export interface DailyTrend { date: string; value: number; count: number }
export interface WellnessTrend {
  kind: WellnessKind; unit: string; from: string; to: string; count: number;
  daily: DailyTrend[]; average: number | null; change: number | null;
  sources: Record<WellnessSource, number>;
}

const metric: Record<WellnessKind, { unit: string; min: number; max: number; mode: 'sum' | 'average' }> = {
  sleep: { unit: 'hours', min: 0, max: 24, mode: 'sum' },
  activity: { unit: 'steps', min: 0, max: 200_000, mode: 'sum' },
  heart_rate: { unit: 'bpm', min: 20, max: 250, mode: 'average' },
  nutrition: { unit: 'kcal', min: 0, max: 10_000, mode: 'sum' },
};
const maxRecords = 5_000;
const maxImportRows = 500;
const maxCsvBytes = 256 * 1024;

function dateOnly(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Date must use YYYY-MM-DD');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date');
  return value;
}
function boundedText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} must be text up to ${max} characters`);
  return value.trim();
}
function validEntry(input: Partial<WellnessEntry>, source: WellnessSource): Omit<WellnessEntry, 'id' | 'created_at'> {
  const date = dateOnly(input.date);
  const kind = input.kind;
  if (!kind || !Object.hasOwn(metric, kind)) throw new Error('Metric must be sleep, activity, heart_rate or nutrition');
  const value = input.value;
  const range = metric[kind];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < range.min || value > range.max) throw new Error(`${kind} value must be between ${range.min} and ${range.max} ${range.unit}`);
  if (kind === 'activity' && !Number.isInteger(value)) throw new Error('Steps must be a whole number');
  const sourceLabel = boundedText(input.source_label ?? (source === 'manual' ? 'User entered' : ''), 'Source label', 120);
  if (source === 'csv_import' && !sourceLabel) throw new Error('CSV import requires a source label');
  const notes = boundedText(input.notes ?? '', 'Notes', 1000);
  return { date, kind, value, unit: range.unit, source, source_label: sourceLabel, notes };
}

/** Limited RFC 4180 reader: quoted commas/newlines, no formulas or external references are evaluated. */
function parseCsv(text: string): string[][] {
  if (Buffer.byteLength(text, 'utf8') > maxCsvBytes) throw new Error('CSV exceeds 256 KB');
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false; let closedQuote = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index++; }
      else if (quoted) { quoted = false; closedQuote = true; }
      else if (!value && !closedQuote) quoted = true;
      else throw new Error('CSV has an invalid quoted field');
    } else if (char === ',' && !quoted) { row.push(value); value = ''; closedQuote = false; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(value); value = ''; closedQuote = false;
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      if (rows.length > maxImportRows + 1) throw new Error(`CSV import is limited to ${maxImportRows} records`);
    } else if (closedQuote) throw new Error('CSV has an invalid quoted field');
    else value += char;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field');
  row.push(value); if (row.some((cell) => cell.trim())) rows.push(row);
  if (rows.length > maxImportRows + 1) throw new Error(`CSV import is limited to ${maxImportRows} records`);
  return rows;
}

export class WellnessService {
  constructor(private db: Database, private vault: Vault) {
    db.exec(`CREATE TABLE IF NOT EXISTS wellness_entries (
      id TEXT PRIMARY KEY, date TEXT NOT NULL, kind TEXT NOT NULL,
      secret_ref TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS wellness_entries_date_kind ON wellness_entries(date, kind);`);
  }

  add(input: Partial<WellnessEntry>): WellnessEntry {
    const entry = validEntry(input, 'manual');
    if ((this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM wellness_entries')?.count ?? 0) >= maxRecords) throw new Error('Wellness storage is limited to 5000 records');
    return this.store(entry);
  }

  importCsv(csv: string, sourceLabel: string): { imported: number; entries: WellnessEntry[] } {
    if (typeof csv !== 'string') throw new Error('CSV text is required');
    const rows = parseCsv(csv);
    const header = rows.shift()?.map((cell) => cell.trim().replace(/^\uFEFF/, '').toLowerCase());
    if (!header || header.join(',') !== 'date,kind,value,notes') throw new Error('CSV header must be date,kind,value,notes');
    if (!rows.length) throw new Error('CSV has no data rows');
    const label = boundedText(sourceLabel, 'Source label', 120);
    if (!label) throw new Error('CSV import requires a source label');
    const validated = rows.map((row, index) => {
      if (row.length !== 4) throw new Error(`CSV row ${index + 2} must contain four columns`);
      if (!row[2].trim()) throw new Error(`CSV row ${index + 2}: value is required`);
      try { return validEntry({ date: row[0].trim(), kind: row[1].trim() as WellnessKind, value: Number(row[2]), source_label: label, notes: row[3] }, 'csv_import'); }
      catch (error) { throw new Error(`CSV row ${index + 2}: ${(error as Error).message}`); }
    });
    const count = this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM wellness_entries')?.count ?? 0;
    if (count + validated.length > maxRecords) throw new Error('Wellness storage is limited to 5000 records');
    const entries = this.db.transaction(() => validated.map((entry) => this.store(entry)));
    return { imported: entries.length, entries };
  }

  private store(entry: Omit<WellnessEntry, 'id' | 'created_at'>): WellnessEntry {
    const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
    const ref = this.vault.put({ label: 'Private wellness entry', scope: 'wellness', value: JSON.stringify(entry) });
    this.db.run('INSERT INTO wellness_entries (id,date,kind,secret_ref,created_at) VALUES (?,?,?,?,?)', [id, entry.date, entry.kind, ref, createdAt]);
    return { id, ...entry, created_at: createdAt };
  }

  list(options: { from?: string; to?: string; kind?: WellnessKind; limit?: number } = {}): WellnessEntry[] {
    const from = options.from ? dateOnly(options.from) : undefined;
    const to = options.to ? dateOnly(options.to) : undefined;
    if (from && to && from > to) throw new Error('from must be before to');
    if (options.kind && !Object.hasOwn(metric, options.kind)) throw new Error('Unsupported metric');
    const limit = Math.min(Math.max(Number(options.limit ?? 500) || 500, 1), maxRecords);
    const where: string[] = []; const args: unknown[] = [];
    if (from) { where.push('date>=?'); args.push(from); }
    if (to) { where.push('date<=?'); args.push(to); }
    if (options.kind) { where.push('kind=?'); args.push(options.kind); }
    args.push(limit);
    const rows = this.db.all<{ id: string; date: string; kind: WellnessKind; secret_ref: string; created_at: string }>(
      `SELECT * FROM wellness_entries ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date DESC, created_at DESC LIMIT ?`, args);
    return rows.map((row) => {
      const decrypted = this.vault.get(row.secret_ref, 'wellness_service', 'read_entry');
      if (!decrypted) throw new Error('Wellness entry could not be decrypted');
      return { id: row.id, ...JSON.parse(decrypted), created_at: row.created_at } as WellnessEntry;
    });
  }

  delete(id: string): boolean {
    const row = this.db.get<{ secret_ref: string }>('SELECT secret_ref FROM wellness_entries WHERE id=?', [id]);
    if (!row) return false;
    this.db.transaction(() => {
      this.db.run('DELETE FROM wellness_entries WHERE id=?', [id]);
      this.vault.delete(row.secret_ref);
    });
    return true;
  }

  trend(kind: WellnessKind, from: string, to: string): WellnessTrend {
    if (!Object.hasOwn(metric, kind)) throw new Error('Unsupported metric');
    dateOnly(from); dateOnly(to);
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    if (days < 0 || days > 365) throw new Error('Trend range must be 0–365 days');
    const entries = this.list({ kind, from, to, limit: maxRecords });
    const grouped = new Map<string, number[]>();
    for (const entry of entries) grouped.set(entry.date, [...(grouped.get(entry.date) ?? []), entry.value]);
    const daily = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({
      date, count: values.length, value: Number((values.reduce((sum, value) => sum + value, 0) / (metric[kind].mode === 'average' ? values.length : 1)).toFixed(2)),
    }));
    const average = daily.length ? Number((daily.reduce((sum, day) => sum + day.value, 0) / daily.length).toFixed(2)) : null;
    const change = daily.length >= 2 ? Number((daily[daily.length - 1].value - daily[0].value).toFixed(2)) : null;
    return { kind, unit: metric[kind].unit, from, to, count: entries.length, daily, average, change,
      sources: { manual: entries.filter((entry) => entry.source === 'manual').length, csv_import: entries.filter((entry) => entry.source === 'csv_import').length } };
  }

  clinicianQuestions(kind: WellnessKind, from: string, to: string): { context: WellnessTrend; questions: string[] } {
    const context = this.trend(kind, from, to);
    const questions = [
      `How should I interpret my ${kind.replace('_', ' ')} records from ${from} to ${to} in the context of my health history?`,
      `Are these ${context.unit} measurements collected consistently enough to discuss a trend?`,
      'What other symptoms, timing or context should I record before our appointment?',
      'When should I seek follow-up based on my full history and your clinical assessment?',
    ];
    return { context, questions };
  }
}
