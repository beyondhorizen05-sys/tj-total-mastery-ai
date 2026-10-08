import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from '../src/db/database.js';
import { SettingsRepo } from '../src/db/repo.js';
import { Audit } from '../src/security/audit.js';
import { PermissionEngine } from '../src/security/permissions.js';
import { ApprovalService } from '../src/security/approvals.js';
import { EventBus } from '../src/core/event-bus.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ok, type ToolContext } from '../src/tools/types.js';

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

  it('requires approval for a high-risk tool and rejects an edited target', async () => {
    settings.set('autonomy_level', 5);
    const tools = new ToolRegistry(permissions, approvals, bus, audit);
    let executions = 0;
    tools.register({
      id: 'test_high_risk', name: 'High-risk test', description: 'Test tool', domain: 'test',
      input_schema: {}, permission: 'memory.read', risk: 'high', reversible: false,
      resource: (args) => String(args.target),
      execute: async () => { executions++; return ok('done'); },
    });
    const ctx: ToolContext = { workspace_id: 'default', project_id: null, project_root: null, agent_id: null, agent_permissions: null, task_id: null, workflow_run_id: null };
    const run = tools.execute('test_high_risk', { target: 'approved-target' }, ctx);
    expect(approvals.pendingCount()).toBe(1);
    const approval = approvals.list('pending')[0];
    expect(approval.risk).toBe('high');
    await expect(async () => {
      approvals.decide(approval.id, 'edit', 'test_user', { tool: 'test_high_risk', args: { target: 'different-target' } });
      await run;
    }).rejects.toThrow(/changes the approved resource/);
    expect(executions).toBe(0);
  });

  it('keeps computer typing text out of persisted approval records', async () => {
    const tools = new ToolRegistry(permissions, approvals, bus, audit);
    const secret = 'private dictated text for a desktop app';
    let executed = '';
    tools.register({
      id: 'computer_write', name: 'Write text', description: 'Test typing', domain: 'computer',
      input_schema: {}, permission: 'computer.control', risk: 'medium', reversible: false,
      describe: (args) => ({ action: 'Write text', target: `${String(args.text).length} characters in focused app`, why: 'User requested typing', risks: [] }),
      execute: async (args) => { executed = String(args.text); return ok('done'); },
    });
    const ctx: ToolContext = { workspace_id: 'default', project_id: null, project_root: null, agent_id: null, agent_permissions: null, task_id: null, workflow_run_id: null };
    const run = tools.execute('computer_write', { text: secret }, ctx);
    const approval = approvals.list('pending')[0];
    expect(approval).toBeDefined();
    expect(JSON.stringify(approval)).not.toContain(secret);
    expect(approval.target).toContain(`${secret.length} characters`);
    approvals.decide(approval.id, 'approve_once', 'test_user');
    expect((await run).ok).toBe(true);
    expect(executed).toBe(secret);
  });
});
