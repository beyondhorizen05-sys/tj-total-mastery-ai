import { createHash } from 'node:crypto';
import type { Database } from '../db/database.js';

/** An at-most-once action claim. Remote execution outcome can still be uncertain. */
export class ActionJournal {
  constructor(private db: Database) {}
  async once<T>(runId: string, stepId: string, operation: string, args: unknown, action: () => Promise<T>): Promise<T> {
    if (!runId || !stepId || !operation) throw new Error('Action journal requires run, step and operation identifiers');
    const key = createHash('sha256').update(JSON.stringify([runId, stepId])).digest('hex');
    const fingerprint = createHash('sha256').update(JSON.stringify([operation, args])).digest('hex');
    const ts = new Date().toISOString();
    const inserted = this.db.run(
      'INSERT OR IGNORE INTO external_action_journal (id, fingerprint, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [key, fingerprint, 'started', ts, ts]);
    if (inserted.changes === 0) {
      const existing = this.db.get<{ fingerprint: string; status: string; result: string | null }>(
        'SELECT fingerprint, status, result FROM external_action_journal WHERE id=?', [key]);
      if (!existing || existing.fingerprint !== fingerprint) throw this.uncertain('Action definition changed after an earlier attempt');
      if (existing.status === 'completed' && existing.result !== null) {
        try { return JSON.parse(existing.result) as T; }
        catch { throw this.uncertain('Saved result cannot be decoded'); }
      }
      throw this.uncertain('Action already started and cannot safely be replayed');
    }
    try {
      const result = await action();
      const content = JSON.stringify(result);
      if (content === undefined || content.length > 128_000) {
        throw this.uncertain('Action finished but outcome is not safely serializable');
      }
      this.db.run("UPDATE external_action_journal SET status='completed', result=?, updated_at=? WHERE id=?",
        [content, new Date().toISOString(), key]);
      return result;
    } catch (error) {
      this.db.run("UPDATE external_action_journal SET status='uncertain', updated_at=? WHERE id=?",
        [new Date().toISOString(), key]);
      throw this.uncertain(error instanceof Error ? error.message : String(error));
    }
  }
  private uncertain(detail: string): Error {
    return Object.assign(new Error(detail + '. Reconcile the remote outcome before reattempting.'), { noRetry: true });
  }
}
