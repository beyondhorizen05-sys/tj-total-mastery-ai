import crypto from 'node:crypto';
import type { Database } from '../db/database.js';
import type { Audit } from '../security/audit.js';

export class LearningError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export interface Feedback {
  id: string;
  source_type: 'workflow_run' | 'event';
  source_id: string;
  rating: 'helpful' | 'needs_improvement';
  note: string;
  created_at: string;
}

export interface Proposal {
  id: string;
  fingerprint: string;
  category: 'workflow_reliability' | 'permission_denial' | 'user_correction';
  title: string;
  summary: string;
  recommendation: string;
  evidence: Array<{ type: string; id: string }>;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
}

const MAX_NOTE = 2000;

/** Deterministic suggestions from persisted outcomes. Review only; never modifies code or policy. */
export class LearningService {
  constructor(private db: Database, private audit: Audit) {
    db.exec(`CREATE TABLE IF NOT EXISTS user_feedback (
      id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
      rating TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_user_feedback_source ON user_feedback(source_type, source_id)');
    db.exec(`CREATE TABLE IF NOT EXISTS improvement_proposals (
      id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
      title TEXT NOT NULL, summary TEXT NOT NULL, recommendation TEXT NOT NULL,
      evidence TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
      decided_at TEXT, decision_note TEXT
    )`);
  }

  feedback(input: { source_type: unknown; source_id: unknown; rating: unknown; note?: unknown }): Feedback {
    if (input.source_type !== 'workflow_run' && input.source_type !== 'event') throw new LearningError('Choose a workflow run or Activity event');
    if (typeof input.source_id !== 'string' || !input.source_id || input.source_id.length > 100) throw new LearningError('Valid source id required');
    if (input.rating !== 'helpful' && input.rating !== 'needs_improvement') throw new LearningError('Choose helpful or needs_improvement');
    if (typeof input.note !== 'string' && input.note !== undefined) throw new LearningError('Feedback note must be text');
    const note = (input.note ?? '') as string;
    if (note.length > MAX_NOTE) throw new LearningError('Feedback note exceeds 2000 characters');
    const table = input.source_type === 'workflow_run' ? 'workflow_runs' : 'events';
    if (!this.db.get(`SELECT id FROM ${table} WHERE id = ?`, [input.source_id])) throw new LearningError('Referenced run or event does not exist', 404);
    const row: Feedback = { id: crypto.randomUUID(), source_type: input.source_type, source_id: input.source_id, rating: input.rating, note, created_at: new Date().toISOString() };
    this.db.run('INSERT INTO user_feedback (id, source_type, source_id, rating, note, created_at) VALUES (?,?,?,?,?,?)', [row.id, row.source_type, row.source_id, row.rating, row.note, row.created_at]);
    this.audit.log({ actor: 'user:api', action: 'feedback.submit', resource: `${row.source_type}:${row.source_id}`, decision: row.rating, details: { feedback_id: row.id } });
    return row;
  }

  listFeedback(limit = 100): Feedback[] {
    const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 500)) : 100;
    return this.db.all<Feedback>('SELECT * FROM user_feedback ORDER BY created_at DESC LIMIT ?', [bounded]);
  }

  listProposals(): Proposal[] {
    return this.db.all<any>('SELECT * FROM improvement_proposals ORDER BY created_at DESC').map((row) => ({ ...row, evidence: JSON.parse(row.evidence) }));
  }

  getProposal(id: string): Proposal | undefined { return this.listProposals().find((proposal) => proposal.id === id); }

  inspectEvidence(type: string, id: string): Record<string, unknown> {
    if (!id || id.length > 100) throw new LearningError('Invalid evidence id');
    if (type === 'feedback') {
      const row = this.db.get<Feedback>('SELECT * FROM user_feedback WHERE id = ?', [id]);
      if (!row) throw new LearningError('Evidence not found', 404);
      return { ...row };
    }
    if (type === 'workflow_run') {
      const row = this.db.get<any>('SELECT id, workflow_id, status, error, step_state, created_at, completed_at FROM workflow_runs WHERE id = ?', [id]);
      if (!row) throw new LearningError('Evidence not found', 404);
      const steps = JSON.parse(row.step_state ?? '{}') as Record<string, { status?: string; error?: string }>;
      return { id: row.id, workflow_id: row.workflow_id, status: row.status, error: row.error, created_at: row.created_at, completed_at: row.completed_at, steps: Object.fromEntries(Object.entries(steps).map(([key, value]) => [key, { status: value.status, error: value.error }])) };
    }
    if (type === 'event') {
      const row = this.db.get<any>('SELECT id, name, severity, summary, ts FROM events WHERE id = ?', [id]);
      if (!row) throw new LearningError('Evidence not found', 404);
      return row;
    }
    if (type === 'audit') {
      const row = this.db.get<any>('SELECT id, ts, action, permission, resource, decision, details FROM audit_log WHERE id = ?', [id]);
      if (!row) throw new LearningError('Evidence not found', 404);
      const details = JSON.parse(row.details ?? '{}');
      return { id: row.id, ts: row.ts, action: row.action, permission: row.permission, resource: row.resource, decision: row.decision, reason: typeof details.reason === 'string' ? details.reason : undefined };
    }
    throw new LearningError('Unknown evidence type');
  }

  private propose(candidate: Omit<Proposal, 'id' | 'fingerprint' | 'status' | 'created_at' | 'decided_at' | 'decision_note'>, key: string): boolean {
    const fingerprint = crypto.createHash('sha256').update(`${candidate.category}:${key}:${candidate.evidence.map((item) => item.id).join(',')}`).digest('hex');
    if (this.db.get('SELECT id FROM improvement_proposals WHERE fingerprint = ?', [fingerprint])) return false;
    this.db.run('INSERT INTO improvement_proposals (id, fingerprint, category, title, summary, recommendation, evidence, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [
      crypto.randomUUID(), fingerprint, candidate.category, candidate.title, candidate.summary, candidate.recommendation,
      JSON.stringify(candidate.evidence), 'pending', new Date().toISOString(),
    ]);
    return true;
  }

  analyze(): { created: number; proposals: Proposal[] } {
    let created = 0;
    // Repeated failed workflow runs are actionable evidence, without reading stored inputs or outputs.
    const failed = this.db.all<{ workflow_id: string; name: string; count: number }>(
      `SELECT r.workflow_id, w.name, COUNT(*) AS count FROM workflow_runs r
       JOIN workflows w ON w.id = r.workflow_id WHERE r.status = 'failed'
       GROUP BY r.workflow_id HAVING COUNT(*) >= 2 ORDER BY count DESC LIMIT 20`,
    );
    for (const row of failed) {
      const ids = this.db.all<{ id: string }>("SELECT id FROM workflow_runs WHERE workflow_id = ? AND status = 'failed' ORDER BY created_at DESC LIMIT 10", [row.workflow_id]);
      if (this.propose({
        category: 'workflow_reliability', title: `Review repeated failures: ${row.name}`,
        summary: `${row.count} failed runs were recorded for this workflow.`,
        recommendation: 'Inspect the linked run errors and step states, then revise the workflow in a controlled change and rerun its tests.',
        evidence: ids.map((item) => ({ type: 'workflow_run', id: item.id })),
      }, row.workflow_id)) created++;
    }
    // Audit denials indicate a blocked action, not permission to bypass policy.
    const denied = this.db.all<{ action: string; permission: string | null; count: number }>(
      `SELECT action, permission, COUNT(*) AS count FROM audit_log
       WHERE decision = 'deny' GROUP BY action, permission HAVING COUNT(*) >= 2 ORDER BY count DESC LIMIT 20`,
    );
    for (const row of denied) {
      const entries = this.db.all<{ id: string }>("SELECT id FROM audit_log WHERE action = ? AND permission IS ? AND decision = 'deny' ORDER BY ts DESC LIMIT 10", [row.action, row.permission]);
      if (this.propose({
        category: 'permission_denial', title: `Review repeated denial: ${row.action}`,
        summary: `${row.count} denied attempts were recorded for ${row.permission ?? 'an unspecified permission'}.`,
        recommendation: 'Inspect why the action was denied. Adjust the task or request an explicit scoped permission through the normal approval process; do not bypass the policy.',
        evidence: entries.map((item) => ({ type: 'audit', id: item.id })),
      }, `${row.action}:${row.permission ?? ''}`)) created++;
    }
    // A direct user correction is itself sufficient evidence for a proposal.
    const negative = this.db.all<Feedback>("SELECT * FROM user_feedback WHERE rating = 'needs_improvement' ORDER BY created_at DESC LIMIT 50");
    for (const row of negative) {
      if (this.propose({
        category: 'user_correction', title: `Review user feedback on ${row.source_type.replace('_', ' ')}`,
        summary: `The user marked ${row.source_type} ${row.source_id} as needing improvement.`,
        recommendation: 'Read the linked feedback and source outcome, propose a specific change, test it in isolation, and seek approval before deployment.',
        evidence: [{ type: 'feedback', id: row.id }, { type: row.source_type, id: row.source_id }],
      }, row.id)) created++;
    }
    this.audit.log({ actor: 'user:api', action: 'learning.analyze', decision: 'completed', details: { proposals_created: created } });
    return { created, proposals: this.listProposals() };
  }

  decide(id: string, decision: 'accept' | 'reject', note?: string): Proposal {
    if (decision !== 'accept' && decision !== 'reject') throw new LearningError('Choose accept or reject');
    if (typeof note !== 'string' && note !== undefined) throw new LearningError('Decision note must be text');
    if ((note ?? '').length > MAX_NOTE) throw new LearningError('Decision note exceeds 2000 characters');
    const current = this.getProposal(id);
    if (!current) throw new LearningError('Proposal not found', 404);
    if (current.status !== 'pending') throw new LearningError('Proposal was already reviewed', 409);
    this.db.run('UPDATE improvement_proposals SET status = ?, decided_at = ?, decision_note = ? WHERE id = ?', [decision === 'accept' ? 'accepted' : 'rejected', new Date().toISOString(), note ?? null, id]);
    this.audit.log({ actor: 'user:api', action: 'learning.review', resource: id, decision, details: { proposal_id: id } });
    return this.getProposal(id)!;
  }
}
