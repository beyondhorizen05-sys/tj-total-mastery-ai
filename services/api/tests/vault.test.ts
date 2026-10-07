import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Database } from '../src/db/database.js';
import { Vault } from '../src/security/vault.js';

describe('Vault & Secret Leakage', () => {
  let db: Database;
  let vault: Vault;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-vault-test-'));
    db = new Database(':memory:');
    db.migrate();
    vault = new Vault(db, tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('encrypts secrets at rest using AES-256-GCM', () => {
    const rawSecret = 'sk-super-secret-api-key-12345';
    const ref = vault.put({
      label: 'OpenAI API Key',
      scope: 'provider:openai',
      value: rawSecret,
    });

    expect(ref).toBeDefined();

    // Verify raw secret does NOT exist in plaintext in the database
    const row = db.get<any>('SELECT * FROM secrets WHERE ref = ?', [ref]);
    expect(row).toBeDefined();
    expect(row.ciphertext).not.toBe(rawSecret);
    expect(row.ciphertext).not.toContain('super-secret');
    expect(row.iv).toBeDefined();
    expect(row.tag).toBeDefined();

    // Decrypts accurately via accessor
    const decrypted = vault.get(ref, 'test_runner', 'unit_test');
    expect(decrypted).toBe(rawSecret);
  });

  it('updates existing secrets and preserves ref', () => {
    const ref = vault.put({
      label: 'GitHub Token',
      scope: 'connector:github',
      value: 'ghp_secret_token_abc',
    });

    const decryptedBefore = vault.get(ref, 'test_runner', 'pre_update');
    expect(decryptedBefore).toBe('ghp_secret_token_abc');

    vault.put({
      ref,
      label: 'GitHub Token',
      scope: 'connector:github',
      value: 'ghp_secret_token_xyz',
    });

    const decryptedAfter = vault.get(ref, 'test_runner', 'post_update');
    expect(decryptedAfter).toBe('ghp_secret_token_xyz');
  });

  it('handles deletion cleanly', () => {
    const ref = vault.put({
      label: 'Temp Key',
      scope: 'temp',
      value: 'val123',
    });

    expect(vault.has(ref)).toBe(true);
    vault.delete(ref);
    expect(vault.has(ref)).toBe(false);
    expect(vault.get(ref, 'test_runner', 'read')).toBeNull();
  });
});
