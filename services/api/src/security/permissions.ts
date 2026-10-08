import type { Permission, PolicyDecision, PolicyRule, RiskLevel } from '@tj/schemas';
import { PERMISSION_RISK, PERMISSIONS } from '@tj/schemas';
import type { Database } from '../db/database.js';
import type { Audit } from './audit.js';
import type { SettingsRepo } from '../db/repo.js';
import { uuid, now } from '../core/ids.js';
import path from 'node:path';

export interface PermissionContext {
  agent_id?: string | null;
  agent_permissions?: string[];
  permission: Permission;
  resource?: string | null;
  workflow_run_id?: string | null;
  actor?: string;
  /** when set, overrides stored autonomy level (used by tests & per-workflow policies) */
  autonomy_override?: number;
}

export interface PermissionResult {
  decision: PolicyDecision;
  risk: RiskLevel;
  reason: string;
  matched_policy?: string;
}

/**
 * Permission Engine (Spec §42). Deny-by-default, least privilege.
 * Decision inputs: user policy + agent's granted permissions + capability + resource + risk + autonomy level.
 */
export class PermissionEngine {
  constructor(private db: Database, private audit: Audit, private settings: SettingsRepo) {}

  static isKnown(p: string): p is Permission {
    return (PERMISSIONS as readonly string[]).includes(p);
  }

  evaluate(ctx: PermissionContext): PermissionResult {
    const risk = PERMISSION_RISK[ctx.permission] ?? 'high';
    const autonomy = ctx.autonomy_override ?? this.settings.get<number>('autonomy_level', 2);

    // 1. Agent must hold the permission at all (least privilege). Agent-less (user-initiated) calls skip this.
    if (ctx.agent_id && !ctx.agent_permissions?.includes(ctx.permission)) {
      return this.record(ctx, { decision: 'deny', risk, reason: `Agent does not hold permission ${ctx.permission}` });
    }

    if (this.settings.get<string>('privacy_mode', 'balanced') === 'local-only' && ['network.http', 'connector.use', 'external.publish'].includes(ctx.permission)) {
      return this.record(ctx, { decision: 'deny', risk, reason: 'Local-only privacy mode blocks outbound network and connector actions' });
    }

    // 2. Explicit policies (user-defined trusted automation rules, workflow-scoped approvals, denies).
    const policies = this.listPolicies().filter((p) => this.policyMatches(p, ctx));
    const deny = policies.find((p) => p.decision === 'deny');
    if (deny) return this.record(ctx, { decision: 'deny', risk, reason: `Denied by policy "${deny.name}"`, matched_policy: deny.id });
    if (risk === 'high' || risk === 'critical') return this.record(ctx, { decision: 'require_approval', risk, reason: `${risk} risk always requires just-in-time approval` });
    const allow = policies.find((p) => p.decision === 'allow');
    if (allow) return this.record(ctx, { decision: 'allow', risk, reason: `Allowed by policy "${allow.name}"`, matched_policy: allow.id });

    // 3. Autonomy-level defaults (Spec §11).
    const sandboxed = this.isSandboxed(ctx.resource);
    if (autonomy <= 1) {
      const readOnly = risk === 'low' && (ctx.permission.endsWith('.read') || ctx.permission === 'system.info' || ctx.permission === 'network.http');
      return this.record(ctx, { decision: readOnly ? 'allow' : 'deny', risk, reason: readOnly ? `Read-only access at autonomy ${autonomy}` : `Autonomy level ${autonomy} permits no actions` });
    }
    if (autonomy === 2) {
      if (risk === 'low') return this.record(ctx, { decision: 'allow', risk, reason: 'Low-risk operation at Draft autonomy' });
      if (risk === 'medium' && sandboxed) return this.record(ctx, { decision: 'allow', risk, reason: 'Draft write inside TJ sandbox' });
      return this.record(ctx, { decision: 'require_approval', risk, reason: `${risk} risk at Draft autonomy requires approval` });
    }
    if (autonomy === 3) {
      if (risk === 'low' || (risk === 'medium' && sandboxed)) return this.record(ctx, { decision: 'allow', risk, reason: 'Controlled execution: low-risk auto-approved' });
      return this.record(ctx, { decision: 'require_approval', risk, reason: `${risk} risk requires just-in-time approval` });
    }
    if (autonomy === 4) {
      if (risk === 'low' || risk === 'medium') return this.record(ctx, { decision: 'allow', risk, reason: 'Workflow autonomy: medium-risk auto-approved' });
      return this.record(ctx, { decision: 'require_approval', risk, reason: `${risk} risk requires just-in-time approval` });
    }
    return this.record(ctx, { decision: 'allow', risk, reason: 'Privileged autonomy' });
  }

  private isSandboxed(resource?: string | null): boolean {
    if (!resource) return false;
    const sandbox = this.settings.get<string>('sandbox_root', '');
    if (!sandbox || !path.isAbsolute(resource)) return false;
    const relative = path.relative(path.resolve(sandbox), path.resolve(resource));
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  }

  private record(ctx: PermissionContext, r: PermissionResult): PermissionResult {
    this.audit.log({
      actor: ctx.actor ?? (ctx.agent_id ? `agent:${ctx.agent_id}` : 'user'),
      agent_id: ctx.agent_id ?? null,
      action: 'permission.evaluate',
      permission: ctx.permission,
      resource: ctx.resource ?? null,
      decision: r.decision,
      details: { risk: r.risk, reason: r.reason, workflow_run_id: ctx.workflow_run_id ?? null, matched_policy: r.matched_policy ?? null },
    });
    return r;
  }

  private policyMatches(p: PolicyRule, ctx: PermissionContext): boolean {
    if (p.expires_at && new Date(p.expires_at) < new Date()) return false;
    if (!globMatch(p.permission, ctx.permission)) return false;
    if (p.agent && p.agent !== ctx.agent_id) return false;
    if (p.resource && !(ctx.resource && globMatch(p.resource, ctx.resource))) return false;
    if (p.scope.startsWith('workflow:') && p.scope.slice('workflow:'.length) !== ctx.workflow_run_id) return false;
    return true;
  }

  listPolicies(): PolicyRule[] {
    return this.db.all<any>('SELECT * FROM policies ORDER BY created_at DESC');
  }

  addPolicy(p: Omit<PolicyRule, 'id' | 'created_at'>): PolicyRule {
    const rule: PolicyRule = { ...p, id: uuid(), created_at: now() };
    this.db.run('INSERT INTO policies (id, name, permission, resource, agent, decision, scope, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [rule.id, rule.name, rule.permission, rule.resource, rule.agent, rule.decision, rule.scope, rule.expires_at, rule.created_at]);
    this.audit.log({ actor: 'user', action: 'policy.create', permission: rule.permission, resource: rule.resource, decision: rule.decision, details: { name: rule.name, scope: rule.scope } });
    return rule;
  }

  removePolicy(id: string) {
    this.db.run('DELETE FROM policies WHERE id = ?', [id]);
    this.audit.log({ actor: 'user', action: 'policy.delete', decision: 'removed', details: { id } });
  }
}

export function globMatch(pattern: string, value: string): boolean {
  if (pattern === '*' || pattern === value) return true;
  const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase();
  const p = norm(pattern), v = norm(value);
  if (p.endsWith('*')) return v.startsWith(p.slice(0, -1));
  return p === v;
}
