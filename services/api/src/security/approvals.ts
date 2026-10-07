import type { Approval, RiskLevel } from '@tj/schemas';
import type { Database } from '../db/database.js';
import type { EventBus } from '../core/event-bus.js';
import type { Audit } from './audit.js';
import type { PermissionEngine } from './permissions.js';
import { uuid, now } from '../core/ids.js';
import { J, mapRow } from '../db/repo.js';

export interface ApprovalRequest {
  workspace_id: string;
  project_id?: string | null;
  agent_id?: string | null;
  task_id?: string | null;
  workflow_run_id?: string | null;
  action: string;
  target: string;
  why: string;
  tools: string[];
  resources_affected: string[];
  estimated_cost?: string | null;
  risks: string[];
  rollback_available: boolean;
  permission: string;
  risk: RiskLevel;
  payload?: Record<string, unknown>;
}

const APPROVAL_COLS = ['tools', 'resources_affected', 'risks', 'payload'];

/**
 * High-Stakes Action Gate (Spec §44, §86).
 * Execution awaits a decision; the pending promise is resolved by the user via API.
 */
export class ApprovalService {
  private waiters = new Map<string, { resolve: (a: Approval) => void }>();

  constructor(private db: Database, private bus: EventBus, private audit: Audit, private permissions: PermissionEngine) {}

  request(req: ApprovalRequest): Approval {
    const a: Approval = {
      id: uuid(), workspace_id: req.workspace_id, project_id: req.project_id ?? null, agent_id: req.agent_id ?? null,
      task_id: req.task_id ?? null, workflow_run_id: req.workflow_run_id ?? null, action: req.action, target: req.target,
      why: req.why, tools: req.tools, resources_affected: req.resources_affected, estimated_cost: req.estimated_cost ?? null,
      risks: req.risks, rollback_available: req.rollback_available, permission: req.permission, risk: req.risk,
      status: 'pending', decided_at: null, decided_by: null, payload: req.payload ?? {}, created_at: now(),
    };
    this.db.run(
      `INSERT INTO approvals (id, workspace_id, project_id, agent_id, task_id, workflow_run_id, action, target, why, tools, resources_affected, estimated_cost, risks, rollback_available, permission, risk, status, payload, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [a.id, a.workspace_id, a.project_id, a.agent_id, a.task_id, a.workflow_run_id, a.action, a.target, a.why, J.str(a.tools), J.str(a.resources_affected), a.estimated_cost, J.str(a.risks), a.rollback_available ? 1 : 0, a.permission, a.risk, a.status, J.str(a.payload), a.created_at],
    );
    this.bus.emit({ name: 'approval.requested', severity: 'warning', summary: `Approval requested: ${a.action} → ${a.target}`, agent_id: a.agent_id, task_id: a.task_id, workflow_run_id: a.workflow_run_id, project_id: a.project_id, data: { approval_id: a.id, permission: a.permission, risk: a.risk } });
    this.audit.log({ actor: a.agent_id ? `agent:${a.agent_id}` : 'tj', agent_id: a.agent_id, action: `approval.requested:${a.action}`, permission: a.permission, resource: a.target, decision: 'pending', details: { approval_id: a.id } });
    return a;
  }

  /** Blocks until the user decides (or timeout). */
  waitFor(id: string, timeoutMs = 24 * 60 * 60 * 1000): Promise<Approval> {
    const current = this.get(id);
    if (current && current.status !== 'pending') return Promise.resolve(current);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        const a = this.get(id);
        if (a && a.status === 'pending') this.db.run("UPDATE approvals SET status='expired', decided_at=? WHERE id=?", [now(), id]);
        resolve(this.get(id)!);
      }, timeoutMs);
      this.waiters.set(id, { resolve: (a) => { clearTimeout(timer); resolve(a); } });
    });
  }

  decide(id: string, decision: 'approve_once' | 'approve_workflow' | 'deny' | 'edit', decidedBy = 'user', editedPayload?: Record<string, unknown>): Approval {
    const a = this.get(id);
    if (!a) throw new Error('Approval not found');
    if (a.status !== 'pending') return a;
    const status = decision === 'approve_once' ? 'approved' : decision === 'approve_workflow' ? 'approved_workflow' : decision === 'edit' ? 'edited' : 'denied';
    const payload = decision === 'edit' && editedPayload ? editedPayload : a.payload;
    this.db.run('UPDATE approvals SET status=?, decided_at=?, decided_by=?, payload=? WHERE id=?', [status, now(), decidedBy, J.str(payload), id]);
    if (decision === 'approve_workflow' && a.workflow_run_id) {
      this.permissions.addPolicy({ name: `Approved for workflow run ${a.workflow_run_id.slice(0, 8)}`, permission: a.permission, resource: null, agent: null, decision: 'allow', scope: `workflow:${a.workflow_run_id}`, expires_at: null });
    }
    const final = this.get(id)!;
    const granted = status !== 'denied';
    this.bus.emit({ name: granted ? 'approval.granted' : 'approval.denied', severity: granted ? 'info' : 'warning', summary: `${granted ? 'Approved' : 'Denied'}: ${a.action} → ${a.target}`, agent_id: a.agent_id, task_id: a.task_id, workflow_run_id: a.workflow_run_id, project_id: a.project_id, data: { approval_id: id, decision } });
    this.audit.log({ actor: decidedBy, agent_id: a.agent_id, action: `approval.${status}:${a.action}`, permission: a.permission, resource: a.target, decision: status, details: { approval_id: id } });
    this.waiters.get(id)?.resolve(final);
    this.waiters.delete(id);
    return final;
  }

  get(id: string): Approval | undefined {
    const r = this.db.get<any>('SELECT * FROM approvals WHERE id = ?', [id]);
    return r ? mapRow<Approval>(r, APPROVAL_COLS, ['rollback_available']) : undefined;
  }

  list(status?: string, limit = 100): Approval[] {
    const rows = status
      ? this.db.all<any>('SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC LIMIT ?', [status, limit])
      : this.db.all<any>('SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?', [limit]);
    return rows.map((r) => mapRow<Approval>(r, APPROVAL_COLS, ['rollback_available']));
  }

  pendingCount(): number {
    return this.db.get<{ c: number }>("SELECT COUNT(*) c FROM approvals WHERE status='pending'")?.c ?? 0;
  }

  /** STOP ALL: deny every pending approval. */
  denyAllPending(by = 'stop_all') {
    for (const a of this.list('pending')) this.decide(a.id, 'deny', by);
  }
}
