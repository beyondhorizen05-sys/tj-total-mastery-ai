import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Database } from '../../db/database.js';
import { uuid, now } from '../../core/ids.js';

/** Back up an existing file before it is overwritten/deleted so the change can be undone (Spec §21). */
export function backupFile(db: Database, backupsDir: string, abs: string, reason: string): string | null {
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  const buf = fs.readFileSync(abs);
  const id = uuid();
  const dest = path.join(backupsDir, 'files', `${id}${path.extname(abs)}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  const sum = crypto.createHash('sha256').update(buf).digest('hex');
  db.run('INSERT INTO file_versions (id, path, backup_path, checksum, size_bytes, created_at, reason) VALUES (?,?,?,?,?,?,?)', [id, abs, dest, sum, buf.length, now(), reason]);
  return id;
}

/** Restore a file from a previous backup (undo). */
export function restoreFile(db: Database, backupId: string): { path: string } {
  const v = db.get<any>('SELECT * FROM file_versions WHERE id = ?', [backupId]);
  if (!v) throw new Error('Backup not found');
  fs.mkdirSync(path.dirname(v.path), { recursive: true });
  fs.copyFileSync(v.backup_path, v.path);
  return { path: v.path };
}

/** Recursive text search used by fs_search. */
export function searchTree(root: string, query: string, maxHits = 50): string[] {
  const q = query.toLowerCase();
  const hits: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || hits.length >= maxHits) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (e.name.toLowerCase().includes(q)) { hits.push(`${p} (name)`); continue; }
      try {
        if (fs.statSync(p).size > 1_000_000) continue;
        const lines = fs.readFileSync(p, 'utf8').split('\n');
        const i = lines.findIndex((l) => l.toLowerCase().includes(q));
        if (i >= 0) hits.push(`${p}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
      } catch {}
    }
  };
  walk(root, 0);
  return hits;
}
