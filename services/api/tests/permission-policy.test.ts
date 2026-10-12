import { describe, expect, it } from 'vitest';
import { Database } from '../src/db/database.js';
import { SettingsRepo } from '../src/db/repo.js';
import { Audit } from '../src/security/audit.js';
import { PermissionEngine } from '../src/security/permissions.js';

function createPermissions() {
  const db = new Database(':memory:');
  db.migrate();
  return { db, permissions: new PermissionEngine(db, new Audit(db), new SettingsRepo(db)) };
}

describe('one-time permission policies', () => {
  it('consumes a once allow after it grants one otherwise approval-required write', () => {
    const { db, permissions } = createPermissions();
    try {
      const rule = permissions.addPolicy({ name: 'One outside write', permission: 'filesystem.write', resource: 'C:/outside/*', agent: null, decision: 'allow', scope: 'once', expires_at: null });
      const evaluate = () => permissions.evaluate({ permission: 'filesystem.write', resource: 'C:/outside/file.txt', autonomy_override: 2 });

      expect(evaluate()).toMatchObject({ decision: 'allow', matched_policy: rule.id });
      expect(permissions.listPolicies().some((policy) => policy.id === rule.id)).toBe(false);
      expect(evaluate().decision).toBe('require_approval');
    } finally {
      db.close();
    }
  });

  it('consumes a once deny after denying one matching request', () => {
    const { db, permissions } = createPermissions();
    try {
      const rule = permissions.addPolicy({ name: 'Deny one read', permission: 'memory.read', resource: null, agent: null, decision: 'deny', scope: 'once', expires_at: null });

      expect(permissions.evaluate({ permission: 'memory.read', autonomy_override: 2 })).toMatchObject({ decision: 'deny', matched_policy: rule.id });
      expect(permissions.evaluate({ permission: 'memory.read', autonomy_override: 2 }).decision).toBe('allow');
    } finally {
      db.close();
    }
  });

  it('does not consume a once rule when its resource constraint does not match', () => {
    const { db, permissions } = createPermissions();
    try {
      const rule = permissions.addPolicy({ name: 'One protected write', permission: 'filesystem.write', resource: 'C:/protected/*', agent: null, decision: 'allow', scope: 'once', expires_at: null });

      expect(permissions.evaluate({ permission: 'filesystem.write', resource: 'C:/elsewhere/file.txt', autonomy_override: 2 }).decision).toBe('require_approval');
      expect(permissions.listPolicies().some((policy) => policy.id === rule.id)).toBe(true);
      expect(permissions.evaluate({ permission: 'filesystem.write', resource: 'C:/protected/file.txt', autonomy_override: 2 }).decision).toBe('allow');
    } finally {
      db.close();
    }
  });
});
