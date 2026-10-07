import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Database } from '../db/database.js';
import { uuid, now } from '../core/ids.js';
import { registerSecret } from '../core/logger.js';

/**
 * Secrets Vault (Spec §43).
 *  - AES-256-GCM per-secret encryption.
 *  - Master key: env TJ_VAULT_MASTER_KEY, else generated and stored in <vault>/master.key.
 *    On Windows the key file is additionally wrapped with DPAPI (CurrentUser) so it cannot
 *    be read by other user accounts or after copying to another machine.
 *  - Secrets are referenced by opaque refs ("sec_…"); plaintext never enters DB rows, logs,
 *    or API responses. Every read is access-logged.
 */
export class Vault {
  private key: Buffer;
  readonly protection: 'env' | 'dpapi' | 'file';

  constructor(private db: Database, vaultDir: string) {
    fs.mkdirSync(vaultDir, { recursive: true });
    const r = loadOrCreateMasterKey(vaultDir);
    this.key = r.key;
    this.protection = r.protection;
  }

  put(opts: { label: string; scope: string; value: string; ref?: string; expires_at?: string | null }): string {
    const ref = opts.ref ?? `sec_${uuid().replace(/-/g, '').slice(0, 20)}`;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(opts.value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const existing = this.db.get('SELECT ref FROM secrets WHERE ref = ?', [ref]);
    if (existing) {
      this.db.run('UPDATE secrets SET ciphertext=?, iv=?, tag=?, rotated_at=?, label=?, scope=?, expires_at=? WHERE ref=?', [ct.toString('base64'), iv.toString('base64'), tag.toString('base64'), now(), opts.label, opts.scope, opts.expires_at ?? null, ref]);
    } else {
      this.db.run('INSERT INTO secrets (ref, scope, label, ciphertext, iv, tag, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)', [ref, opts.scope, opts.label, ct.toString('base64'), iv.toString('base64'), tag.toString('base64'), now(), opts.expires_at ?? null]);
    }
    registerSecret(opts.value);
    return ref;
  }

  get(ref: string, accessor: string, purpose: string): string | null {
    const row = this.db.get<any>('SELECT * FROM secrets WHERE ref = ?', [ref]);
    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(row.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    this.db.run('UPDATE secrets SET last_accessed_at=?, access_count=access_count+1 WHERE ref=?', [now(), ref]);
    this.db.run('INSERT INTO secret_access_log (id, ref, ts, accessor, purpose) VALUES (?,?,?,?,?)', [uuid(), ref, now(), accessor, purpose]);
    registerSecret(pt);
    return pt;
  }

  delete(ref: string) {
    this.db.run('DELETE FROM secrets WHERE ref = ?', [ref]);
  }

  has(ref: string) {
    return !!this.db.get('SELECT ref FROM secrets WHERE ref = ?', [ref]);
  }

  /** Metadata only — never plaintext. */
  list() {
    return this.db.all<any>('SELECT ref, scope, label, created_at, rotated_at, expires_at, last_accessed_at, access_count FROM secrets ORDER BY created_at DESC');
  }

  accessLog(ref: string, limit = 50) {
    return this.db.all<any>('SELECT * FROM secret_access_log WHERE ref = ? ORDER BY ts DESC LIMIT ?', [ref, limit]);
  }

  static mask(value: string): string {
    if (!value) return '';
    if (value.length <= 8) return '••••••••';
    return `${value.slice(0, 3)}••••••••${value.slice(-4)}`;
  }
}

function loadOrCreateMasterKey(vaultDir: string): { key: Buffer; protection: 'env' | 'dpapi' | 'file' } {
  const env = process.env.TJ_VAULT_MASTER_KEY;
  if (env) {
    const k = Buffer.from(env, 'base64');
    if (k.length !== 32) throw new Error('TJ_VAULT_MASTER_KEY must be 32 bytes base64');
    return { key: k, protection: 'env' };
  }
  const keyFile = path.join(vaultDir, 'master.key');
  const dpapiFile = path.join(vaultDir, 'master.key.dpapi');
  const isWin = process.platform === 'win32';

  if (isWin && fs.existsSync(dpapiFile)) {
    const unwrapped = dpapi('unprotect', fs.readFileSync(dpapiFile, 'utf8').trim());
    if (unwrapped) return { key: Buffer.from(unwrapped, 'base64'), protection: 'dpapi' };
  }
  if (fs.existsSync(keyFile)) {
    return { key: Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64'), protection: 'file' };
  }
  const key = crypto.randomBytes(32);
  if (isWin) {
    const wrapped = dpapi('protect', key.toString('base64'));
    if (wrapped) {
      fs.writeFileSync(dpapiFile, wrapped, { mode: 0o600 });
      return { key, protection: 'dpapi' };
    }
  }
  fs.writeFileSync(keyFile, key.toString('base64'), { mode: 0o600 });
  return { key, protection: 'file' };
}

function dpapi(op: 'protect' | 'unprotect', b64: string): string | null {
  try {
    const script = op === 'protect'
      ? `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String('${b64}'); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))`
      : `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String('${b64}'); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return out.trim() || null;
  } catch {
    return null;
  }
}
