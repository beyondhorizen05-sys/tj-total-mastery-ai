import type { Memory } from '@tj/schemas';
import type { Database } from '../db/database.js';
import type { EventBus } from '../core/event-bus.js';
import type { ModelRouter } from '../models/router.js';
import { uuid, now } from '../core/ids.js';
import { J, mapRow } from '../db/repo.js';

export const MEMORY_JSON_COLS = ['provenance', 'related_entities'];
export const MEMORY_BOOL_COLS = ['has_embedding', 'archived'];
export const MEMORY_SELECT = 'id, workspace_id, project_id, agent_id, type, content, source, owner, confidence, provenance, sensitivity, retention, related_entities, has_embedding, embedding_model, version, archived, created_at, updated_at, expires_at';

export interface MemoryInput {
  workspace_id: string;
  type: Memory['type'];
  content: string;
  project_id?: string | null;
  agent_id?: string | null;
  source?: string;
  owner?: string;
  confidence?: number;
  provenance?: Record<string, unknown>;
  sensitivity?: Memory['sensitivity'];
  retention?: Memory['retention'];
  related_entities?: string[];
}

/**
 * Memory Engine (Spec §12-14). Hybrid retrieval: FTS5 keyword + embedding cosine (when an
 * embedding provider is available) fused with reciprocal-rank fusion. Nothing is stored
 * unless explicitly written (no silent permanent capture).
 */
export class MemoryService {
  constructor(protected db: Database, protected bus: EventBus, protected router: ModelRouter | null = null) {}

  setRouter(r: ModelRouter) { this.router = r; }

  async create(input: MemoryInput): Promise<Memory> {
    const ts = now();
    const id = uuid();
    const retention = input.retention ?? 'long';
    const expires = retention === 'session' ? new Date(Date.now() + 24 * 3600e3).toISOString() : retention === 'short' ? new Date(Date.now() + 30 * 24 * 3600e3).toISOString() : null;
    this.db.run(
      `INSERT INTO memories (id, workspace_id, project_id, agent_id, type, content, source, owner, confidence, provenance, sensitivity, retention, related_entities, version, archived, created_at, updated_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, input.workspace_id, input.project_id ?? null, input.agent_id ?? null, input.type, input.content, input.source ?? 'user', input.owner ?? 'user', input.confidence ?? 1, J.str(input.provenance ?? {}), input.sensitivity ?? 'private', retention, J.str(input.related_entities ?? []), 1, 0, ts, ts, expires],
    );
    this.db.run('INSERT INTO memory_versions (memory_id, version, content, changed_at) VALUES (?,?,?,?)', [id, 1, input.content, ts]);
    if (this.db.ftsAvailable) this.db.run('INSERT INTO memories_fts (content, memory_id) VALUES (?,?)', [input.content, id]);
    this.bus.emit({ name: 'memory.created', summary: `Memory saved (${input.type}): ${input.content.slice(0, 80)}`, project_id: input.project_id, agent_id: input.agent_id, data: { memory_id: id, type: input.type } });
    // embedding is best-effort and never blocks or fails the write
    void this.embedOne(id, input.content, input.sensitivity ?? 'private');
    return this.get(id)!;
  }

  /** Awaitable embedding (used by tests and bulk re-embed). */
  async embedOne(id: string, content: string, sensitivity: string) {
    if (!this.router || sensitivity === 'secret') return;
    const current = this.get(id);
    if (!current || current.content !== content || current.sensitivity === 'secret') return;
    try {
      const r = await this.router.embed([content.slice(0, 6000)]);
      if (!r) return;
      const buf = Buffer.from(new Float32Array(r.vectors[0]).buffer);
      // An older embedding request may finish after an edit or sensitivity change.
      this.db.run("UPDATE memories SET embedding=?, has_embedding=1, embedding_model=? WHERE id=? AND content=? AND sensitivity != 'secret'", [buf, r.model_id, id, content]);
    } catch { /* embeddings are optional */ }
  }

  get(id: string): Memory | undefined {
    const r = this.db.get<any>(`SELECT ${MEMORY_SELECT} FROM memories WHERE id = ?`, [id]);
    return r ? mapRow<Memory>(r, MEMORY_JSON_COLS, MEMORY_BOOL_COLS) : undefined;
  }

  update(id: string, patch: { content?: string; confidence?: number; sensitivity?: Memory['sensitivity']; retention?: Memory['retention']; archived?: boolean }): Memory {
    const m = this.get(id);
    if (!m) throw new Error('Memory not found');
    const ts = now();
    if (patch.content != null && patch.content !== m.content) {
      const v = m.version + 1;
      this.db.run('UPDATE memories SET content=?, version=?, has_embedding=0, embedding=NULL, updated_at=? WHERE id=?', [patch.content, v, ts, id]);
      this.db.run('INSERT INTO memory_versions (memory_id, version, content, changed_at) VALUES (?,?,?,?)', [id, v, patch.content, ts]);
      if (this.db.ftsAvailable) { this.db.run('DELETE FROM memories_fts WHERE memory_id = ?', [id]); this.db.run('INSERT INTO memories_fts (content, memory_id) VALUES (?,?)', [patch.content, id]); }
      void this.embedOne(id, patch.content, patch.sensitivity ?? m.sensitivity);
    }
    for (const k of ['confidence', 'sensitivity', 'retention'] as const) if (patch[k] != null) this.db.run(`UPDATE memories SET ${k}=?, updated_at=? WHERE id=?`, [patch[k], ts, id]);
    if (patch.sensitivity === 'secret') this.db.run('UPDATE memories SET embedding=NULL, has_embedding=0, embedding_model=NULL WHERE id=?', [id]);
    if (patch.archived != null) this.db.run('UPDATE memories SET archived=?, updated_at=? WHERE id=?', [patch.archived ? 1 : 0, ts, id]);
    this.bus.emit({ name: 'memory.updated', summary: `Memory updated: ${id.slice(0, 8)}`, data: { memory_id: id } });
    return this.get(id)!;
  }

  delete(id: string) {
    this.db.run('DELETE FROM memories WHERE id = ?', [id]);
    this.db.run('DELETE FROM memory_versions WHERE memory_id = ?', [id]);
    if (this.db.ftsAvailable) this.db.run('DELETE FROM memories_fts WHERE memory_id = ?', [id]);
    this.bus.emit({ name: 'memory.deleted', summary: `Memory deleted: ${id.slice(0, 8)}`, data: { memory_id: id } });
  }

  versions(id: string) {
    return this.db.all<any>('SELECT * FROM memory_versions WHERE memory_id = ? ORDER BY version DESC', [id]);
  }

  list(f: { type?: string; project_id?: string | null; agent_id?: string; archived?: boolean; limit?: number; offset?: number } = {}): Memory[] {
    const where: string[] = []; const p: unknown[] = [];
    if (f.type) { where.push('type = ?'); p.push(f.type); }
    if (f.project_id) { where.push('project_id = ?'); p.push(f.project_id); }
    if (f.agent_id) { where.push('(agent_id = ? OR agent_id IS NULL)'); p.push(f.agent_id); }
    where.push('archived = ?'); p.push(f.archived ? 1 : 0);
    where.push('(expires_at IS NULL OR expires_at > ?)'); p.push(now());
    p.push(Math.min(f.limit ?? 100, 500), f.offset ?? 0);
    return this.db.all<any>(`SELECT ${MEMORY_SELECT} FROM memories WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`, p).map((r) => mapRow<Memory>(r, MEMORY_JSON_COLS, MEMORY_BOOL_COLS));
  }

  /** Hybrid search: keyword (FTS5/LIKE) + semantic (cosine) fused with RRF. */
  async search(query: string, f: { project_id?: string | null; agent_id?: string; type?: string; limit?: number } = {}): Promise<Array<{ memory: Memory; score: number; matched_by: string[] }>> {
    const limit = f.limit ?? 10;
    const ranks = new Map<string, { score: number; by: Set<string> }>();
    const bump = (id: string, rank: number, by: string) => {
      const e = ranks.get(id) ?? { score: 0, by: new Set<string>() };
      e.score += 1 / (60 + rank); e.by.add(by); ranks.set(id, e);
    };
    const allowed = (m: Memory) => !m.archived && (!f.type || m.type === f.type) && (!f.project_id || m.project_id === f.project_id || m.project_id === null) && (!f.agent_id || !m.agent_id || m.agent_id === f.agent_id) && (!m.expires_at || m.expires_at > now());

    // keyword
    const terms = query.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? [];
    let kw: string[] = [];
    if (terms.length) {
      if (this.db.ftsAvailable) {
        try { kw = this.db.all<{ memory_id: string }>('SELECT memory_id FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT 50', [terms.map((t) => `"${t}"`).join(' OR ')]).map((r) => r.memory_id); } catch { kw = []; }
      } else {
        kw = this.db.all<{ id: string }>('SELECT id FROM memories WHERE ' + terms.map(() => 'LOWER(content) LIKE ?').join(' OR ') + ' LIMIT 50', terms.map((t) => `%${t}%`)).map((r) => r.id);
      }
    }
    kw.forEach((id, i) => bump(id, i, 'keyword'));

    // semantic
    if (this.router) {
      try {
        const q = await this.router.embed([query]);
        if (q) {
          const qv = new Float32Array(q.vectors[0]);
          const rows = this.db.all<any>('SELECT id, embedding FROM memories WHERE has_embedding = 1 AND embedding_model = ?', [q.model_id]);
          const sims = rows.map((r) => ({ id: r.id as string, s: cosine(qv, new Float32Array(new Uint8Array(r.embedding).buffer)) })).filter((x) => x.s > 0.2).sort((a, b) => b.s - a.s).slice(0, 50);
          sims.forEach((x, i) => bump(x.id, i, 'semantic'));
        }
      } catch { /* semantic path unavailable; keyword results still returned */ }
    }

    const out: Array<{ memory: Memory; score: number; matched_by: string[] }> = [];
    for (const [id, e] of [...ranks.entries()].sort((a, b) => b[1].score - a[1].score)) {
      const m = this.get(id);
      if (m && allowed(m)) out.push({ memory: m, score: e.score, matched_by: [...e.by] });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Capability honesty: tells the UI whether semantic search is currently possible. */
  async semanticStatus(): Promise<{ available: boolean; embedded: number; total: number; reason: string | null }> {
    const total = this.db.get<{ c: number }>('SELECT COUNT(*) c FROM memories')?.c ?? 0;
    const embedded = this.db.get<{ c: number }>('SELECT COUNT(*) c FROM memories WHERE has_embedding = 1')?.c ?? 0;
    if (!this.router) return { available: false, embedded, total, reason: 'No router' };
    const probe = await this.router.embed(['probe']).catch(() => null);
    return { available: !!probe, embedded, total, reason: probe ? null : 'No embedding-capable provider (add OpenAI/Google/Mistral key or run Ollama with `ollama pull nomic-embed-text`). Keyword search still works.' };
  }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
