import { describe, expect, it } from 'vitest';
import { Database } from '../src/db/database.js';
import { EventBus } from '../src/core/event-bus.js';
import { Audit } from '../src/security/audit.js';
import { SettingsRepo } from '../src/db/repo.js';
import { PermissionEngine } from '../src/security/permissions.js';
import { ApprovalService } from '../src/security/approvals.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ActionJournal } from '../src/workflows/action-journal.js';
import { ok } from '../src/tools/types.js';

describe('Durable agent tool effects', () => {
  it('executes a non-reversible agent tool only once for the same action key', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const bus = new EventBus(db), audit = new Audit(db);
      const permissions = new PermissionEngine(db, audit, new SettingsRepo(db));
      const approvals = new ApprovalService(db, bus, audit, permissions);
      const tools = new ToolRegistry(permissions, approvals, bus, audit, new ActionJournal(db));
      let calls = 0;
      tools.register({ id:'send', name:'Send', description:'Test side effect', domain:'test',
        input_schema:{type:'object',properties:{text:{type:'string'}},required:['text']},
        permission:'system.info', risk:'low', reversible:false,
        execute:async()=>{calls++;return ok('delivered');} });
      const ctx = {workspace_id:'default',project_id:null,project_root:null,agent_id:'agent1',
        agent_permissions:['system.info'],task_id:'task1',workflow_run_id:'run1',effect_key:'agent:task1:0:0'};
      const first = await tools.execute('send',{text:'hello'},ctx);
      const second = await tools.execute('send',{text:'hello'},ctx);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(calls).toBe(1);
      const changed = await tools.execute('send',{text:'changed'},ctx);
      expect(changed.ok).toBe(false);
      expect(changed.error).toContain('Action definition changed');
      expect(calls).toBe(1);
    } finally { db.close(); }
  });
});
