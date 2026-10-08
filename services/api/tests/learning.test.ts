import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { Database } from '../src/db/database.js';
import { Audit } from '../src/security/audit.js';
import { LearningService } from '../src/learning/service.js';
import { registerLearningRoutes } from '../src/server/routes/learning.js';

describe('feedback and controlled improvement proposals', () => {
  let dir: string;
  let db: Database;
  let audit: Audit;
  let learning: LearningService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-learning-'));
    db = new Database(path.join(dir, 'test.sqlite'));
    db.migrate();
    audit = new Audit(db);
    learning = new LearningService(db, audit);
    const ts = new Date().toISOString();
    db.run('INSERT INTO workflows (id, workspace_id, name, version, steps, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', ['wf-1', 'default', 'Demo workflow', 1, '[]', ts, ts]);
    for (const id of ['run-1', 'run-2']) db.run('INSERT INTO workflow_runs (id, workflow_id, workflow_version, status, step_state, error, triggered_by, created_at) VALUES (?,?,?,?,?,?,?,?)', [id, 'wf-1', 1, 'failed', JSON.stringify({ first: { status: 'failed', error: 'Timeout', output: 'private output' } }), 'Timeout', 'test', ts]);
    db.run('INSERT INTO events (id, name, ts, severity, summary) VALUES (?,?,?,?,?)', ['event-1', 'workflow.failed', ts, 'error', 'Demo workflow failed']);
    for (let i = 0; i < 2; i++) audit.log({ actor: 'user', action: 'permission.evaluate', permission: 'network.http', decision: 'deny', details: { reason: 'Local-only mode', secret: 'must not display' } });
  });

  afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('only accepts feedback on existing outcomes and keeps the user note out of audit events', () => {
    expect(() => learning.feedback({ source_type: 'workflow_run', source_id: 'missing', rating: 'needs_improvement' })).toThrow('does not exist');
    const item = learning.feedback({ source_type: 'workflow_run', source_id: 'run-1', rating: 'needs_improvement', note: 'Please fix this private detail' });
    expect(learning.listFeedback()).toEqual([expect.objectContaining({ id: item.id, note: 'Please fix this private detail' })]);
    expect(JSON.stringify(audit.list())).not.toContain('private detail');
  });

  it('derives deduplicated inspectable proposals from real failures, denials, and correction', () => {
    learning.feedback({ source_type: 'event', source_id: 'event-1', rating: 'needs_improvement', note: 'Please improve this.' });
    expect(learning.analyze().created).toBe(3);
    expect(learning.analyze().created).toBe(0);
    const proposals = learning.listProposals();
    expect(proposals.map((p) => p.category).sort()).toEqual(['permission_denial', 'user_correction', 'workflow_reliability']);
    const runEvidence = learning.inspectEvidence('workflow_run', 'run-1');
    expect(runEvidence).toMatchObject({ status: 'failed', error: 'Timeout', steps: { first: { status: 'failed', error: 'Timeout' } } });
    expect(JSON.stringify(runEvidence)).not.toContain('private output');
    expect(learning.inspectEvidence('audit', proposals.find((p) => p.category === 'permission_denial')!.evidence[0].id)).toMatchObject({ decision: 'deny', reason: 'Local-only mode' });
    expect(JSON.stringify(learning.inspectEvidence('audit', proposals.find((p) => p.category === 'permission_denial')!.evidence[0].id))).not.toContain('must not display');
  });

  it('records explicit accept/reject decisions without changing code, policies or workflow definitions', () => {
    const proposal = learning.analyze().proposals[0];
    const policiesBefore = db.get<{ count: number }>('SELECT COUNT(*) count FROM policies')?.count;
    expect(learning.decide(proposal.id, 'accept', 'Plan a controlled change').status).toBe('accepted');
    expect(() => learning.decide(proposal.id, 'reject')).toThrow('already reviewed');
    expect(db.get<{ count: number }>('SELECT COUNT(*) count FROM policies')?.count).toBe(policiesBefore);
    expect(db.get<{ version: number }>('SELECT version FROM workflows WHERE id = ?', ['wf-1'])?.version).toBe(1);
  });

  it('serves the complete feedback and review loop through API routes', async () => {
    const app = Fastify();
    registerLearningRoutes(app, { learning });
    try {
      const feedback = await app.inject({ method: 'POST', url: '/api/v1/learning/feedback', payload: { source_type: 'workflow_run', source_id: 'run-1', rating: 'needs_improvement', note: 'Retry should explain failure' } });
      expect(feedback.statusCode).toBe(201);
      const analyzed = await app.inject({ method: 'POST', url: '/api/v1/learning/analyze' });
      expect(analyzed.statusCode).toBe(200);
      expect(analyzed.json().created).toBe(3);
      const proposal = analyzed.json().proposals.find((p: any) => p.category === 'user_correction');
      const evidence = await app.inject({ method: 'GET', url: `/api/v1/learning/evidence/feedback/${proposal.evidence[0].id}` });
      expect(evidence.json().evidence.note).toBe('Retry should explain failure');
      const review = await app.inject({ method: 'POST', url: `/api/v1/learning/proposals/${proposal.id}/review`, payload: { decision: 'reject', note: 'Already handled' } });
      expect(review.json().proposal.status).toBe('rejected');
      const again = await app.inject({ method: 'POST', url: `/api/v1/learning/proposals/${proposal.id}/review`, payload: { decision: 'accept' } });
      expect(again.statusCode).toBe(409);
    } finally { await app.close(); }
  });
});
