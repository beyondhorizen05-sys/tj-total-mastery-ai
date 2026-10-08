import crypto from 'node:crypto';
import type { Database } from '../db/database.js';
import type { Vault } from '../security/vault.js';

export type EncryptedRow = { id: string; iv: string; ciphertext: string; tag: string };

/** The data key is protected by TJ's Vault; record contents use authenticated AES-256-GCM. */
export class FinanceSecureStore {
  private key: Buffer;
  constructor(db: Database, vault: Vault) {
    db.exec('CREATE TABLE IF NOT EXISTS finance_crypto (id INTEGER PRIMARY KEY CHECK(id=1), key_ref TEXT NOT NULL)');
    const existing = db.get<{ key_ref: string }>('SELECT key_ref FROM finance_crypto WHERE id=1');
    if (existing) {
      const encoded = vault.get(existing.key_ref, 'finance', 'load encrypted financial records');
      if (!encoded) throw new Error('Finance encryption key is unavailable. Financial records cannot be read.');
      this.key = Buffer.from(encoded, 'base64');
    } else {
      this.key = crypto.randomBytes(32);
      const ref = vault.put({ scope: 'finance:data-key', label: 'Finance data encryption key', value: this.key.toString('base64') });
      db.run('INSERT INTO finance_crypto (id,key_ref) VALUES (1,?)', [ref]);
    }
    if (this.key.length !== 32) throw new Error('Finance encryption key is invalid.');
  }

  seal(id: string, kind: 'transaction' | 'budget', value: unknown): EncryptedRow {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`tj-finance:${kind}:${id}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { id, iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  }

  open<T>(row: EncryptedRow, kind: 'transaction' | 'budget'): T {
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(row.iv, 'base64'));
    decipher.setAAD(Buffer.from(`tj-finance:${kind}:${row.id}`));
    decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8')) as T;
  }
}
