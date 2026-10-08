import { EventEmitter } from 'node:events';
import type { TJEvent, EventName, EventSeverity } from '@tj/schemas';
import { uuid, now } from './ids.js';
import type { Database } from '../db/database.js';

export type EventInput = {
  name: EventName;
  summary: string;
  severity?: EventSeverity;
  project_id?: string | null;
  agent_id?: string | null;
  task_id?: string | null;
  workflow_run_id?: string | null;
  conversation_id?: string | null;
  connector_id?: string | null;
  model_id?: string | null;
  data?: Record<string, unknown>;
};

/**
 * Universal event bus (Spec §62). Every event is persisted to the `events` table
 * (Activity Stream, §51) and fanned out to in-process subscribers + SSE clients.
 */
export class EventBus {
  private emitter = new EventEmitter();
  constructor(private db: Database) {
    this.emitter.setMaxListeners(200);
  }

  emit(input: EventInput): TJEvent {
    const ev: TJEvent = {
      id: uuid(),
      name: input.name,
      ts: now(),
      severity: input.severity ?? 'info',
      project_id: input.project_id ?? null,
      agent_id: input.agent_id ?? null,
      task_id: input.task_id ?? null,
      workflow_run_id: input.workflow_run_id ?? null,
      conversation_id: input.conversation_id ?? null,
      connector_id: input.connector_id ?? null,
      model_id: input.model_id ?? null,
      summary: input.summary,
      data: input.data ?? {},
    };
    // Raw voice transcripts and replies can contain dictated private content.
    // They reach live subscribers, but are not copied into the Activity database.
    if (!['message.delta', 'voice.transcript', 'voice.response'].includes(ev.name)) {
      this.db.run(
        `INSERT INTO events (id, name, ts, severity, project_id, agent_id, task_id, workflow_run_id, conversation_id, connector_id, model_id, summary, data)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [ev.id, ev.name, ev.ts, ev.severity, ev.project_id, ev.agent_id, ev.task_id, ev.workflow_run_id, ev.conversation_id, ev.connector_id, ev.model_id, ev.summary, JSON.stringify(ev.data)],
      );
    }
    this.emitter.emit('event', ev);
    this.emitter.emit(ev.name, ev);
    return ev;
  }

  on(name: EventName | '*', handler: (ev: TJEvent) => void): () => void {
    const key = name === '*' ? 'event' : name;
    this.emitter.on(key, handler);
    return () => this.emitter.off(key, handler);
  }

  once(name: EventName, handler: (ev: TJEvent) => void) {
    this.emitter.once(name, handler);
  }

  query(filter: {
    project_id?: string; agent_id?: string; task_id?: string; workflow_run_id?: string; connector_id?: string; model_id?: string;
    severity?: string; name?: string; since?: string; until?: string; limit?: number; offset?: number; q?: string;
  } = {}): TJEvent[] {
    const where: string[] = [];
    const params: unknown[] = [];
    for (const k of ['project_id', 'agent_id', 'task_id', 'workflow_run_id', 'connector_id', 'model_id', 'severity', 'name'] as const) {
      if (filter[k]) { where.push(`${k} = ?`); params.push(filter[k]); }
    }
    if (filter.since) { where.push('ts >= ?'); params.push(filter.since); }
    if (filter.until) { where.push('ts <= ?'); params.push(filter.until); }
    if (filter.q) { where.push('(summary LIKE ? OR name LIKE ?)'); params.push(`%${filter.q}%`, `%${filter.q}%`); }
    const sql = `SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC LIMIT ? OFFSET ?`;
    params.push(Math.min(filter.limit ?? 100, 1000), filter.offset ?? 0);
    return this.db.all<any>(sql, params).map((r) => ({ ...r, data: JSON.parse(r.data ?? '{}') }));
  }
}
