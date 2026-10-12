import { describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { Database } from '../src/db/database.js';
import { SettingsRepo } from '../src/db/repo.js';
import { Audit } from '../src/security/audit.js';
import { PermissionEngine } from '../src/security/permissions.js';
import { ApprovalService } from '../src/security/approvals.js';
import { EventBus } from '../src/core/event-bus.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ok, type ToolContext } from '../src/tools/types.js';


describe('autonomy level decisions', () => {
  it('applies distinct read, sandbox write, outside write, and high-risk gates across levels 1–4', () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const settings = new SettingsRepo(db);
      const permissions = new PermissionEngine(db, new Audit(db), settings);
      const sandbox = path.join(os.tmpdir(), 'tj-autonomy-sandbox');
      settings.set('sandbox_root', sandbox);
      permissions.addPolicy({ name: 'Explicit allow', permission: 'filesystem.delete', resource: null, agent: null, decision: 'allow', scope: 'global', expires_at: null });
      const read = () => permissions.evaluate({ permission: 'memory.read', autonomy_override: level }).decision;
      const write = (resource: string) => permissions.evaluate({ permission: 'filesystem.write', resource, autonomy_override: level }).decision;
      const high = () => permissions.evaluate({ permission: 'filesystem.delete', resource: path.join(sandbox, 'file.txt'), autonomy_override: level }).decision;
      let level = 1;
      expect([read(), write(path.join(sandbox, 'file.txt')), high()]).toEqual(['allow', 'deny', 'deny']);
      level = 2;
      expect([read(), write(path.join(sandbox, 'file.txt')), write(path.join(os.tmpdir(), 'elsewhere.txt')), high()]).toEqual(['allow', 'allow', 'require_approval', 'require_approval']);
      level = 3;
      expect([read(), write(path.join(sandbox, 'file.txt')), write(path.join(os.tmpdir(), 'elsewhere.txt')), high()]).toEqual(['allow', 'allow', 'require_approval', 'require_approval']);
      level = 4;
      expect([read(), write(path.join(sandbox, 'file.txt')), write(path.join(os.tmpdir(), 'elsewhere.txt')), high()]).toEqual(['allow', 'allow', 'allow', 'require_approval']);
      level = 0;
      expect([read(), write(path.join(sandbox, 'file.txt')), high()]).toEqual(['deny', 'deny', 'deny']);
      level = 5;
      expect([read(), write(path.join(os.tmpdir(), 'elsewhere.txt')), high()]).toEqual(['allow', 'allow', 'require_approval']);
    } finally { db.close(); }
  });

  it('makes level 0 action-free and keeps privileged level 5 behind JIT approval for high-impact actions', () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const settings = new SettingsRepo(db);
      const permissions = new PermissionEngine(db, new Audit(db), settings);
      permissions.addPolicy({ name: 'Explicit read allow', permission: 'memory.read', resource: null, agent: null, decision: 'allow', scope: 'global', expires_at: null });
      expect(permissions.evaluate({ permission: 'memory.read', autonomy_override: 0 }).decision).toBe('deny');
      expect(permissions.evaluate({ permission: 'filesystem.read', autonomy_override: 0 }).decision).toBe('deny');
      expect(permissions.evaluate({ permission: 'system.info', autonomy_override: 0 }).decision).toBe('deny');

      expect(permissions.evaluate({ permission: 'filesystem.write', resource: 'C:/outside/file.txt', autonomy_override: 5 }).decision).toBe('allow');
      expect(permissions.evaluate({ permission: 'email.send', autonomy_override: 5 }).decision).toBe('require_approval');
      expect(permissions.evaluate({ permission: 'finance.trade', autonomy_override: 5 }).decision).toBe('require_approval');
    } finally { db.close(); }
  });
});


describe('Full Autonomy high-risk owner opt-in', () => {
  it('defaults to manual high-risk approval and requires Privileged level 5', () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const settings = new SettingsRepo(db);
      const permissions = new PermissionEngine(db, new Audit(db), settings);
      expect(permissions.isHighRiskAutoApprovalEnabled()).toBe(false);
      settings.set('auto_approve_high_risk', true);
      settings.set('autonomy_level', 4);
      expect(permissions.evaluate({ permission: 'filesystem.delete' }).decision).toBe('require_approval');
      settings.set('autonomy_level', 5);
      expect(permissions.isHighRiskAutoApprovalEnabled()).toBe(true);
      expect(permissions.evaluate({ permission: 'filesystem.delete' }).decision).toBe('allow');
      expect(permissions.evaluate({ permission: 'process.manage' }).decision).toBe('allow');
      expect(permissions.evaluate({ permission: 'payments.execute' }).decision).toBe('require_approval');
      settings.set('auto_approve_high_risk', false);
      expect(permissions.evaluate({ permission: 'filesystem.delete' }).decision).toBe('require_approval');
    } finally { db.close(); }
  });

  it('never overrides explicit denies, missing permissions, or local-only network policy', () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const settings = new SettingsRepo(db);
      const permissions = new PermissionEngine(db, new Audit(db), settings);
      settings.set('autonomy_level', 5);
      settings.set('auto_approve_high_risk', true);
      permissions.addPolicy({ name: 'Deny deletion', permission: 'filesystem.delete', resource: null, agent: null, decision: 'deny', scope: 'always', expires_at: null });
      expect(permissions.evaluate({ permission: 'filesystem.delete' }).decision).toBe('deny');
      expect(permissions.evaluate({ permission: 'process.manage', agent_id: 'a', agent_permissions: ['filesystem.read'] }).decision).toBe('deny');
      settings.set('privacy_mode', 'local-only');
      expect(permissions.evaluate({ permission: 'external.publish' }).decision).toBe('deny');
    } finally { db.close(); }
  });
});


describe('Full Autonomy tool execution', () => {
  function setup() {
    const db = new Database(':memory:'); db.migrate();
    const settings = new SettingsRepo(db);
    settings.set('autonomy_level', 5);
    settings.set('auto_approve_high_risk', true);
    const audit = new Audit(db);
    const permissions = new PermissionEngine(db, audit, settings);
    const bus = new EventBus(db);
    const approvals = new ApprovalService(db, bus, audit, permissions);
    const tools = new ToolRegistry(permissions, approvals, bus, audit);
    const ctx: ToolContext = {
      workspace_id: 'default', project_id: 'p', project_root: '/workspace',
      agent_id: 'agent', agent_permissions: ['filesystem.delete', 'shell.execute', 'filesystem.read', 'payments.execute'],
      task_id: 'task', workflow_run_id: null,
    };
    return { db, settings, approvals, tools, ctx };
  }

  it('auto-approves eligible high-risk actions and records the decision without pending approvals', async () => {
    const { db, approvals, tools, ctx } = setup();
    try {
      let executions = 0;
      tools.register({
        id: 'safe-test-delete', name: 'Test high action', description: 'Test', domain: 'test',
        input_schema: {}, permission: 'filesystem.delete', risk: 'high', reversible: true,
        resource: () => '/workspace/test.txt',
        execute: async () => { executions++; return ok('executed'); },
      });
      expect((await tools.execute('safe-test-delete', {}, ctx)).ok).toBe(true);
      expect(executions).toBe(1);
      expect(approvals.pendingCount()).toBe(0);
      const history = approvals.list();
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ status: 'approved', decided_by: 'full_autonomy_policy', risk: 'high' });
    } finally { db.close(); }
  });

  it('auto-approves custom project shell commands but still gates outside-folder access', async () => {
    const { db, approvals, tools, ctx } = setup();
    try {
      let executions = 0;
      tools.register({
        id: 'shell_exec', name: 'Test shell', description: 'Test', domain: 'shell',
        input_schema: {}, permission: 'shell.execute', risk: 'medium', reversible: false,
        requiresApproval: () => true,
        execute: async () => { executions++; return ok('ran'); },
      });
      expect((await tools.execute('shell_exec', { command: 'npm run custom-script' }, ctx)).ok).toBe(true);
      expect(executions).toBe(1);
      expect(approvals.pendingCount()).toBe(0);

      tools.register({
        id: 'outside-file', name: 'Outside', description: 'Test', domain: 'files',
        input_schema: {}, permission: 'filesystem.read', risk: 'low', reversible: true,
        resource: () => '/other/private.txt', requiresApproval: () => true,
        execute: async () => { executions++; return ok('forbidden'); },
      });
      const pendingRun = tools.execute('outside-file', {}, ctx);
      expect(approvals.pendingCount()).toBe(1);
      approvals.decide(approvals.list('pending')[0].id, 'deny', 'test');
      await expect(pendingRun).rejects.toThrow(/denied/);
      expect(executions).toBe(1);
    } finally { db.close(); }
  });

  it('critical actions and explicit denies cannot bypass approval', async () => {
    const { db, approvals, tools, ctx } = setup();
    try {
      let executed = false;
      tools.register({
        id: 'critical-test', name: 'Critical', description: 'Test', domain: 'test',
        input_schema: {}, permission: 'payments.execute', risk: 'critical', reversible: false,
        execute: async () => { executed = true; return ok('unexpected'); },
      });
      const pendingRun = tools.execute('critical-test', {}, ctx);
      expect(approvals.pendingCount()).toBe(1);
      approvals.decide(approvals.list('pending')[0].id, 'deny', 'test');
      await expect(pendingRun).rejects.toThrow(/denied/);
      expect(executed).toBe(false);
    } finally { db.close(); }
  });
});
