import type { Database } from '../db/database.js';
import type { AuditLog } from '@tj/schemas';
import { uuid, now } from '../core/ids.js';
import { J } from '../db/repo.js';

export class Audit {
  constructor(private db: Database) {}

  log(entry: { actor: string; agent_id?: string | null; action: string; permission?: string | null; resource?: string | null; decision: string; details?: Record<string, unknown> }): AuditLog {
    const rec: AuditLog = {
      id: uuid(),
      ts: now(),
      actor: entry.actor,
      agent_id: entry.agent_id ?? null,
      action: entry.action,
      permission: entry.permission ?? null,
      resource: entry.resource ?? null,
      decision: entry.decision,
      details: entry.details ?? {},
    };
    this.db.run('INSERT INTO audit_log (id, ts, actor, agent_id, action, permission, resource, decision, details) VALUES (?,?,?,?,?,?,?,?,?)', [rec.id, rec.ts, rec.actor, rec.agent_id, rec.action, rec.permission, rec.resource, rec.decision, J.str(rec.details)]);
    return rec;
  }

  list(opts: { limit?: number; offset?: number; agent_id?: string; decision?: string; q?: string } = {}): AuditLog[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.agent_id) { where.push('agent_id = ?'); params.push(opts.agent_id); }
    if (opts.decision) { where.push('decision = ?'); params.push(opts.decision); }
    if (opts.q) { where.push('(action LIKE ? OR resource LIKE ?)'); params.push(`%${opts.q}%`, `%${opts.q}%`); }
    params.push(Math.min(opts.limit ?? 100, 1000), opts.offset ?? 0);
    return this.db
      .all<any>(`SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC LIMIT ? OFFSET ?`, params)
      .map((r) => ({ ...r, details: J.parse(r.details, {}) }));
  }
}
