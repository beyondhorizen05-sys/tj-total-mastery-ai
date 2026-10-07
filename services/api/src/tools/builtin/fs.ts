import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Tool, ToolContext } from '../types.js';
import { ok, fail } from '../types.js';
import type { Sandbox } from '../sandbox.js';
import type { Database } from '../../db/database.js';
import { backupFile, searchTree } from './fs-helpers.js';

const MAX_READ = 200_000;

export function fsTools(sandbox: Sandbox, db: Database, backupsDir: string): Tool[] {
  const resolve = (a: any, ctx: ToolContext) => {
    const abs = sandbox.resolve(String(a.path ?? ''), ctx.project_root);
    if (sandbox.isForbidden(abs)) throw new Error(`Path is in a protected system location: ${abs}`);
    return abs;
  };
  const resolveDir = (a: any, ctx: ToolContext) => resolve({ path: a.path ?? '.' }, ctx);

  return [
    {
      id: 'fs_read', name: 'Read file', description: 'Read a text file (UTF-8). Path is relative to the project root.', domain: 'files',
      input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      permission: 'filesystem.read', risk: 'low', reversible: true, resource: resolve,
      async execute(a, ctx) {
        const abs = resolve(a, ctx);
        if (!fs.existsSync(abs)) return fail(`File not found: ${abs}`);
        const st = fs.statSync(abs);
        if (!st.isFile()) return fail(`Not a file: ${abs}`);
        const buf = fs.readFileSync(abs);
        const text = buf.subarray(0, MAX_READ).toString('utf8');
        return ok(text + (buf.length > MAX_READ ? `\n…[truncated, ${buf.length} bytes total]` : ''), { data: { path: abs, size: st.size } });
      },
    },
    {
      id: 'fs_list', name: 'List directory', description: 'List files and folders in a directory.', domain: 'files',
      input_schema: { type: 'object', properties: { path: { type: 'string' } } },
      permission: 'filesystem.read', risk: 'low', reversible: true, resource: resolveDir,
      async execute(a, ctx) {
        const abs = resolveDir(a, ctx);
        if (!fs.existsSync(abs)) return fail(`Not found: ${abs}`);
        const entries = fs.readdirSync(abs, { withFileTypes: true }).filter((e) => e.name !== 'node_modules' && e.name !== '.git').slice(0, 500);
        return ok(entries.map((e) => `${e.isDirectory() ? 'd' : '-'} ${e.name}`).join('\n') || '(empty)', { data: { path: abs, count: entries.length } });
      },
    },
    {
      id: 'fs_write', name: 'Write file', description: 'Create or overwrite a text file. Existing content is backed up automatically.', domain: 'files',
      input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      permission: 'filesystem.write', risk: 'medium', reversible: true, resource: resolve,
      describe: (a) => ({ action: 'Write file', target: String(a.path), why: 'Agent wants to create/modify a file', risks: ['Overwrites existing content (a backup is kept)'] }),
      async execute(a, ctx) {
        const abs = resolve(a, ctx);
        if (typeof a.content !== 'string') return fail('content must be a string');
        const existed = fs.existsSync(abs);
        const backupId = existed ? backupFile(db, backupsDir, abs, 'overwrite') : null;
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, a.content, 'utf8');
        const checksum = crypto.createHash('sha256').update(a.content).digest('hex');
        return ok(`${existed ? 'Overwrote' : 'Created'} ${abs} (${a.content.length} chars)`, {
          data: { path: abs, backup_id: backupId, checksum },
          artifacts: [{ kind: 'file', name: path.basename(abs), path: abs, summary: existed ? 'modified' : 'created' }],
        });
      },
    },
    {
      id: 'fs_delete', name: 'Delete file', description: 'Delete a file. A backup is kept so it can be restored.', domain: 'files',
      input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      permission: 'filesystem.delete', risk: 'high', reversible: true, resource: resolve,
      describe: (a) => ({ action: 'Delete file', target: String(a.path), why: 'Agent wants to delete a file', risks: ['Data loss (a backup copy is kept for restore)'] }),
      async execute(a, ctx) {
        const abs = resolve(a, ctx);
        if (!fs.existsSync(abs)) return fail(`Not found: ${abs}`);
        if (!fs.statSync(abs).isFile()) return fail('Only files can be deleted with this tool');
        const id = backupFile(db, backupsDir, abs, 'delete');
        fs.unlinkSync(abs);
        return ok(`Deleted ${abs}`, { data: { path: abs, backup_id: id } });
      },
    },
    {
      id: 'fs_search', name: 'Search files', description: 'Search file names and contents under a directory for a text query.', domain: 'files',
      input_schema: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' } }, required: ['query'] },
      permission: 'filesystem.read', risk: 'low', reversible: true, resource: resolveDir,
      async execute(a, ctx) {
        const hits = searchTree(resolveDir(a, ctx), String(a.query));
        return ok(hits.join('\n') || 'No matches', { data: { count: hits.length } });
      },
    },
  ];
}
