import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from '../src/db/database.js';
import { SettingsRepo } from '../src/db/repo.js';
import { Audit } from '../src/security/audit.js';
import { PermissionEngine } from '../src/security/permissions.js';
import { ApprovalService } from '../src/security/approvals.js';
import { EventBus } from '../src/core/event-bus.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { Sandbox } from '../src/tools/sandbox.js';
import { fsTools } from '../src/tools/builtin/fs.js';
import { ok, type ToolContext } from '../src/tools/types.js';

describe('Permissions & Approvals', () => {
  let db: Database;
  let audit: Audit;
  let settings: SettingsRepo;
  let permissions: PermissionEngine;
  let approvals: ApprovalService;
  let bus: EventBus;
  const tempDirs: string[] = [];

  beforeEach(() => {
    db = new Database(':memory:');
    db.migrate();
    audit = new Audit(db);
    settings = new SettingsRepo(db);
    permissions = new PermissionEngine(db, audit, settings);
    bus = new EventBus(db);
    approvals = new ApprovalService(db, bus, audit, permissions);
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
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

  it('fails closed for a stored policy with an invalid expiry timestamp', () => {
    settings.set('autonomy_level', 1);
    permissions.addPolicy({
      name: 'Malformed temporary grant', permission: 'filesystem.write', resource: null, agent: null,
      decision: 'allow', scope: 'global', expires_at: 'not-a-date',
    });

    const result = permissions.evaluate({ permission: 'filesystem.write', resource: '/workspace/file.txt' });
    expect(result.decision).toBe('deny');
    expect(result.reason).toContain('Autonomy level 1');
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

  it('requires a fresh approval for any edited high-risk tool payload', async () => {
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
      approvals.decide(approval.id, 'edit', 'test_user', { tool: 'test_high_risk', args: { target: 'approved-target', message: 'changed after review' } });
      await run;
    }).rejects.toThrow(/submit the updated action again/i);
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

  it('requires and honors explicit approval before reading outside configured roots, even at privileged autonomy', async () => {
    settings.set('autonomy_level', 5);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-file-approval-'));
    tempDirs.push(root);
    const workspace = path.join(root, 'workspace');
    const outside = path.join(root, 'private');
    const backups = path.join(root, 'backups');
    fs.mkdirSync(workspace);
    fs.mkdirSync(outside);
    const secret = 'outside-root private contents';
    const target = path.join(outside, 'secret.txt');
    fs.writeFileSync(target, secret);
    const sandbox = new Sandbox(() => [workspace]);
    const tools = new ToolRegistry(permissions, approvals, bus, audit);
    tools.register(fsTools(sandbox, db, backups).find((tool) => tool.id === 'fs_read')!);
    const ctx: ToolContext = { workspace_id: 'default', project_id: null, project_root: workspace, agent_id: null, agent_permissions: null, task_id: null, workflow_run_id: null };

    const run = tools.execute('fs_read', { path: target }, ctx);
    const approval = approvals.list('pending')[0];
    expect(approval).toBeDefined();
    expect(approval.risk).toBe('medium');
    expect(approval.risks).toContain('Resource is outside configured project and artifact roots');
    approvals.decide(approval.id, 'deny', 'test_user');
    await expect(run).rejects.toThrow(/denied/);

    const approvedRun = tools.execute('fs_read', { path: target }, ctx);
    const secondApproval = approvals.list('pending')[0];
    approvals.decide(secondApproval.id, 'approve_once', 'test_user');
    const result = await approvedRun;
    expect(result.ok).toBe(true);
    expect(result.output).toContain(secret);
  });

  it('blocks outside-root writes until approval and does not mutate on denial', async () => {
    settings.set('autonomy_level', 5);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-file-write-approval-'));
    tempDirs.push(root);
    const workspace = path.join(root, 'workspace');
    const outside = path.join(root, 'private');
    fs.mkdirSync(workspace);
    fs.mkdirSync(outside);
    const target = path.join(outside, 'new.txt');
    const sandbox = new Sandbox(() => [workspace]);
    const tools = new ToolRegistry(permissions, approvals, bus, audit);
    tools.register(fsTools(sandbox, db, path.join(root, 'backups')).find((tool) => tool.id === 'fs_write')!);
    const ctx: ToolContext = { workspace_id: 'default', project_id: null, project_root: workspace, agent_id: null, agent_permissions: null, task_id: null, workflow_run_id: null };

    const run = tools.execute('fs_write', { path: target, content: 'must not be written' }, ctx);
    const approval = approvals.list('pending')[0];
    expect(approval).toBeDefined();
    expect(fs.existsSync(target)).toBe(false);
    approvals.decide(approval.id, 'deny', 'test_user');
    await expect(run).rejects.toThrow(/denied/);
    expect(fs.existsSync(target)).toBe(false);
  });
});
