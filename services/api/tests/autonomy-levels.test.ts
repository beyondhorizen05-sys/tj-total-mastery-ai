import { describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { Database } from '../src/db/database.js';
import { SettingsRepo } from '../src/db/repo.js';
import { Audit } from '../src/security/audit.js';
import { PermissionEngine } from '../src/security/permissions.js';

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
