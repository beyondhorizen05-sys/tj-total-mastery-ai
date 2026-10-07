import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from './migrations.js';

/**
 * Thin wrapper over Node's built-in SQLite (WAL mode) with a versioned migration runner.
 * Chosen because it requires no native compilation on Windows and ships FTS5 + JSON1.
 */
export class Database {
  readonly db: DatabaseSync;
  readonly path: string;
  readonly ftsAvailable: boolean;

  constructor(dbPath: string) {
    this.path = dbPath;
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.ftsAvailable = this.probeFts();
  }

  private probeFts(): boolean {
    try {
      this.db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS __fts_probe USING fts5(x)');
      this.db.exec('DROP TABLE IF EXISTS __fts_probe');
      return true;
    } catch {
      return false;
    }
  }

  run(sql: string, params: unknown[] = []) {
    return this.db.prepare(sql).run(...(params as any[]));
  }
  get<T = any>(sql: string, params: unknown[] = []): T | undefined {
    return this.db.prepare(sql).get(...(params as any[])) as T | undefined;
  }
  all<T = any>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...(params as any[])) as T[];
  }
  exec(sql: string) {
    this.db.exec(sql);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  migrate(): { applied: string[]; current: number } {
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
    const appliedRows = this.all<{ version: number }>('SELECT version FROM schema_migrations');
    const applied = new Set(appliedRows.map((r) => r.version));
    const done: string[] = [];
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      this.transaction(() => {
        for (const stmt of m.up) {
          if (stmt.includes('USING fts5') && !this.ftsAvailable) continue;
          this.db.exec(stmt);
        }
        this.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?,?,?)', [m.version, m.name, new Date().toISOString()]);
      });
      done.push(`${m.version}_${m.name}`);
    }
    const current = this.get<{ v: number }>('SELECT MAX(version) v FROM schema_migrations')?.v ?? 0;
    return { applied: done, current };
  }

  health(): { ok: boolean; latency_ms: number; detail: string } {
    const t = performance.now();
    try {
      this.get('SELECT 1');
      const pageCount = this.get<{ page_count: number }>('PRAGMA page_count')?.page_count ?? 0;
      const pageSize = this.get<{ page_size: number }>('PRAGMA page_size')?.page_size ?? 0;
      return { ok: true, latency_ms: performance.now() - t, detail: `sqlite ${this.get<any>('select sqlite_version() v')?.v}, ${Math.round((pageCount * pageSize) / 1024)} KB, FTS5 ${this.ftsAvailable ? 'on' : 'off'}` };
    } catch (e: any) {
      return { ok: false, latency_ms: performance.now() - t, detail: e.message };
    }
  }

  backup(dest: string) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    this.db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    return dest;
  }

  close() {
    try { this.db.close(); } catch {}
  }
}
