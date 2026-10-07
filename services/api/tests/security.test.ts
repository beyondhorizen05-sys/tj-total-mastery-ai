import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from '../src/db/database.js';
import { SettingsRepo } from '../src/db/repo.js';
import { Audit } from '../src/security/audit.js';
import { PermissionEngine } from '../src/security/permissions.js';
import { ApprovalService } from '../src/security/approvals.js';
import { EventBus } from '../src/core/event-bus.js';

describe('Permissions & Approvals', () => {
  let db: Database;
  let audit: Audit;
  let settings: SettingsRepo;
  let permissions: PermissionEngine;
  let approvals: ApprovalService;
  let bus: EventBus;

  beforeEach(() => {
    db = new Database(':memory:');
    db.migrate();
    audit = new Audit(db);
    settings = new SettingsRepo(db);
    permissions = new PermissionEngine(db, audit, settings);
    bus = new EventBus(db);
    approvals = new ApprovalService(db, bus, audit, permissions);
  });

  it('denies by default if agent lacks permission', () => {
    const res = permissions.evaluate({
      agent_id: 'agent-1',
      agent_permissions: ['memory.read'],
      permission: 'filesystem.write',
      resource: '/workspace/test.txt',
    });
    expect(res.decision).toBe('deny');
    expect(res.reason).toContain('Agent does not hold permission');
  });

  it('allows low-risk read actions when agent holds permission at draft autonomy', () => {
    settings.set('autonomy_level', 2);
    const res = permissions.evaluate({
      agent_id: 'agent-1',
      agent_permissions: ['memory.read'],
      permission: 'memory.read',
      resource: 'item-1',
    });
    expect(res.decision).toBe('allow');
  });

  it('explicit policy overrides autonomy defaults', () => {
    permissions.addPolicy({
      name: 'Block specific file',
      permission: 'filesystem.read',
      resource: '/secret.env',
      agent: null,
      decision: 'deny',
      scope: 'global',
      expires_at: null,
    });

    const res = permissions.evaluate({
      agent_id: 'agent-1',
      agent_permissions: ['filesystem.read'],
      permission: 'filesystem.read',
      resource: '/secret.env',
    });
    expect(res.decision).toBe('deny');
    expect(res.reason).toContain('Denied by policy');
  });

  it('approval lifecycle: request, wait, decide', async () => {
    const req = approvals.request({
      workspace_id: 'default',
      action: 'delete_database',
      target: 'main.db',
      why: 'Maintenance routine',
      tools: ['db_tool'],
      resources_affected: ['main.db'],
      risks: ['data loss'],
      rollback_available: false,
      permission: 'cmd.execute',
      risk: 'high',
    });

    expect(req.status).toBe('pending');
    expect(approvals.pendingCount()).toBe(1);

    // Resolve asynchronously
    setTimeout(() => {
      approvals.decide(req.id, 'approve_once', 'test_user');
    }, 10);

    const decided = await approvals.waitFor(req.id);
    expect(decided.status).toBe('approved');
    expect(decided.decided_by).toBe('test_user');
    expect(approvals.pendingCount()).toBe(0);
  });

  it('STOP ALL denies every pending approval', () => {
    approvals.request({
      workspace_id: 'default',
      action: 'action1',
      target: 'target1',
      why: 'why1',
      tools: [],
      resources_affected: [],
      risks: [],
      rollback_available: false,
      permission: 'cmd.execute',
      risk: 'high',
    });
    approvals.request({
      workspace_id: 'default',
      action: 'action2',
      target: 'target2',
      why: 'why2',
      tools: [],
      resources_affected: [],
      risks: [],
      rollback_available: false,
      permission: 'cmd.execute',
      risk: 'high',
    });

    expect(approvals.pendingCount()).toBe(2);
    approvals.denyAllPending('stop_all');
    expect(approvals.pendingCount()).toBe(0);

    const list = approvals.list();
    expect(list.every((a) => a.status === 'denied')).toBe(true);
  });
});
