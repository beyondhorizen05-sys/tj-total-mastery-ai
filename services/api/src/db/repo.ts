import type { Database } from './database.js';

/** Helpers for the JSON-column convention used across tables. */
export const J = {
  parse<T>(v: unknown, fallback: T): T {
    if (v == null) return fallback;
    if (typeof v !== 'string') return v as T;
    try { return JSON.parse(v) as T; } catch { return fallback; }
  },
  str(v: unknown): string {
    return JSON.stringify(v ?? null);
  },
  bool(v: unknown): boolean {
    return v === 1 || v === true || v === '1';
  },
};

/** Generic row mapper: parses JSON columns + converts integer booleans. */
export function mapRow<T>(row: any, jsonCols: string[] = [], boolCols: string[] = []): T {
  if (!row) return row;
  const out: any = { ...row };
  for (const c of jsonCols) out[c] = J.parse(row[c], Array.isArray(out[c]) ? [] : null);
  for (const c of boolCols) out[c] = J.bool(row[c]);
  return out as T;
}

export class SettingsRepo {
  constructor(private db: Database) {}
  get<T>(key: string, fallback: T): T {
    const r = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return r ? J.parse<T>(r.value, fallback) : fallback;
  }
  set(key: string, value: unknown) {
    this.db.run('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', [key, J.str(value), new Date().toISOString()]);
  }
  all(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const r of this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings')) out[r.key] = J.parse(r.value, null);
    return out;
  }
}
