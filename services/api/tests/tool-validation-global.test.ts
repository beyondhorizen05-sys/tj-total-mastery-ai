import { describe, it, expect } from 'vitest';
import { Database } from '../src/db/database.js';
import { EventBus } from '../src/core/event-bus.js';
import { Audit } from '../src/security/audit.js';
import { SettingsRepo } from '../src/db/repo.js';
import { PermissionEngine } from '../src/security/permissions.js';
import { ApprovalService } from '../src/security/approvals.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ok } from '../src/tools/types.js';
describe('Central tool argument validation', () => {
  it('blocks invalid arguments before the tool or approval gate', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const bus = new EventBus(db), audit = new Audit(db);
      const permissions = new PermissionEngine(db, audit, new SettingsRepo(db));
      const tools = new ToolRegistry(permissions, new ApprovalService(db, bus, audit, permissions), bus, audit);
      let calls = 0;
      tools.register({
        id: 'read', name: 'Read', description: 'Test read', domain: 'filesystem',
        input_schema: { type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false },
        permission:'system.info',risk:'low',reversible:true,
        execute: async () => { calls++;return ok('read'); },
      });
      const ctx = { workspace_id:'default',project_id:null,project_root:null,agent_id:null,agent_permissions:null,task_id:null,workflow_run_id:null };
      expect((await tools.execute('read', { path: 3 }, ctx)).error).toContain('rejected');
      expect((await tools.execute('read', JSON.parse('{"path":"ok","__proto__":{"a":1}}'), ctx)).error).toContain('Unsafe');
      expect(calls).toBe(0);
      expect((await tools.execute('read', { path:'good' }, ctx)).ok).toBe(true);
      expect(calls).toBe(1);
    } finally { db.close(); }
  });
});
