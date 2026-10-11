import { describe, it, expect } from 'vitest';
import { Database } from '../src/db/database.js';
import { ActionJournal } from '../src/workflows/action-journal.js';
import { Vault } from '../src/security/vault.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
describe('Durable action journal', () => {
  it('returns cached success without executing twice', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      let calls = 0;
      const act = async () => { calls++; return { receipt: 'ok' }; };
      const j = new ActionJournal(db);
      expect(await j.once('run','send','connector:webhook',{target:'a'},act)).toEqual({receipt:'ok'});
      expect(await new ActionJournal(db).once('run','send','connector:webhook',{target:'a'},act)).toEqual({receipt:'ok'});
      expect(calls).toBe(1);
    } finally { db.close(); }
  });
  it('rejects changed payloads for the same workflow step', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const j = new ActionJournal(db);
      await j.once('run','send','external',{target:'a'},async()=>({ok:true}));
      await expect(j.once('run','send','external',{target:'b'},async()=>({ok:true}))).rejects.toMatchObject({noRetry:true});
    } finally { db.close(); }
  });
  it('fails closed on unknown external outcomes', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      let calls = 0;
      const j = new ActionJournal(db);
      await expect(j.once('run','send','external',{},async()=>{calls++;throw new Error('response lost');})).rejects.toMatchObject({noRetry:true});
      await expect(j.once('run','send','external',{},async()=>{calls++;return true;})).rejects.toThrow(/already started/);
      expect(calls).toBe(1);
      expect(db.get<{status:string}>('SELECT status FROM external_action_journal')?.status).toBe('uncertain');
    } finally { db.close(); }
  });
  it('never treats an interrupted started claim as completed', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const j = new ActionJournal(db);
      await expect(j.once('run','x','op',{},async()=>{throw new Error('crash simulation');})).rejects.toThrow(/Reconcile/);
      expect(db.get<{status:string}>('SELECT status FROM external_action_journal')?.status).toBe('uncertain');
    } finally { db.close(); }
  });
  it('encrypts completed action receipts in the production vault instead of plaintext SQLite', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-action-vault-'));
    const db = new Database(':memory:'); db.migrate();
    try {
      const vault = new Vault(db, folder);
      const journal = new ActionJournal(db, vault);
      const sensitive = 'confidential-private-action-result';
      let calls = 0;
      const original = await journal.once('vault-run','step-one','external', { id: 1 }, async () => {
        calls++;
        return { content: sensitive };
      });
      expect(original.content).toBe(sensitive);
      const row = db.get<{ result: string }>('SELECT result FROM external_action_journal');
      expect(row?.result).toMatch(/^vault:/);
      expect(row?.result).not.toContain(sensitive);
      const replay = await new ActionJournal(db, vault).once('vault-run','step-one','external', { id: 1 }, async () => {
        calls++; return { content: 'SHOULD NOT EXECUTE' };
      });
      expect(replay).toEqual(original);
      expect(calls).toBe(1);
    } finally {
      db.close();
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

});
