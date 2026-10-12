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
  const resolveDestination = (a: any, ctx: ToolContext) => {
    const abs = sandbox.resolve(String(a.destination ?? ''), ctx.project_root);
    if (sandbox.isForbidden(abs)) throw new Error(`Path is in a protected system location: ${abs}`);
    return abs;
  };
  const requireAllowedRoot = (abs: string, ctx: ToolContext) => {
    if (!sandbox.isInside(abs, ctx.project_root) && !ctx.approval_granted) throw new Error('This path is outside configured project and artifact roots. Request and receive approval before accessing it.');
    return abs;
  };
  const requiresOutsideApproval = (a: any, ctx: ToolContext) => !sandbox.isInside(resolve(a, ctx), ctx.project_root);
  const requiresOutsideApprovalDir = (a: any, ctx: ToolContext) => !sandbox.isInside(resolveDir(a, ctx), ctx.project_root);
  const transferResource = (a: any, ctx: ToolContext) => `${resolve(a, ctx)} -> ${resolveDestination(a, ctx)}`;
  const requiresTransferApproval = (a: any, ctx: ToolContext) => !sandbox.isInside(resolve(a, ctx), ctx.project_root) || !sandbox.isInside(resolveDestination(a, ctx), ctx.project_root);
  const hasRequiredAgentPermissions = (ctx: ToolContext, required: string[]) => !ctx.agent_permissions || required.every((permission) => ctx.agent_permissions!.includes(permission));
  const assertRegularFile = (filePath: string, label: string) => {
    const stats = fs.lstatSync(filePath);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`${label} must be a regular file; folders and symbolic links are not supported`);
  };
  const assertDestinationDirectory = (filePath: string) => {
    const parent = path.dirname(filePath);
    if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new Error(`Destination folder does not exist: ${parent}`);
    const canonicalTarget = path.join(fs.realpathSync(parent), path.basename(filePath));
    if (sandbox.isForbidden(canonicalTarget)) throw new Error(`Path resolves to a protected system location: ${canonicalTarget}`);
  };

  return [
    {
      id: 'fs_read', name: 'Read file', description: 'Read a text file (UTF-8). Path is relative to the project root.', domain: 'files',
      input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      permission: 'filesystem.read', risk: 'low', reversible: true, resource: resolve, requiresApproval: requiresOutsideApproval,
      async execute(a, ctx) {
        const abs = requireAllowedRoot(resolve(a, ctx), ctx);
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
      permission: 'filesystem.read', risk: 'low', reversible: true, resource: resolveDir, requiresApproval: requiresOutsideApprovalDir,
      async execute(a, ctx) {
        const abs = requireAllowedRoot(resolveDir(a, ctx), ctx);
        if (!fs.existsSync(abs)) return fail(`Not found: ${abs}`);
        const entries = fs.readdirSync(abs, { withFileTypes: true }).filter((e) => e.name !== 'node_modules' && e.name !== '.git').slice(0, 500);
        return ok(entries.map((e) => `${e.isDirectory() ? 'd' : '-'} ${e.name}`).join('\n') || '(empty)', { data: { path: abs, count: entries.length } });
      },
    },
    {
      id: 'fs_write', name: 'Write file', description: 'Create or overwrite a text file. Existing content is backed up automatically.', domain: 'files',
      input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      permission: 'filesystem.write', risk: 'medium', reversible: true, resource: resolve, requiresApproval: requiresOutsideApproval,
      describe: (a) => ({ action: 'Write file', target: String(a.path), why: 'Agent wants to create/modify a file', risks: ['Overwrites existing content (a backup is kept)'] }),
      async execute(a, ctx) {
        const abs = requireAllowedRoot(resolve(a, ctx), ctx);
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
      id: 'fs_copy', name: 'Copy file', description: 'Copy a regular file to an existing destination folder. Requires read and write permissions; refuses overwrite unless overwrite is true, and backs up overwritten files.', domain: 'files',
      input_schema: { type: 'object', properties: { path: { type: 'string' }, destination: { type: 'string' }, overwrite: { type: 'boolean' } }, required: ['path', 'destination'] },
      permission: 'filesystem.write', risk: 'medium', reversible: true, resource: transferResource, requiresApproval: requiresTransferApproval,
      describe: (a) => ({ action: 'Copy file', target: `${String(a.path)} → ${String(a.destination)}`, why: 'Agent wants to copy a file', risks: a.overwrite ? ['Existing destination will be backed up before replacement'] : [] }),
      async execute(a, ctx) {
        if (!hasRequiredAgentPermissions(ctx, ['filesystem.read', 'filesystem.write'])) return fail('Copying requires filesystem.read and filesystem.write permissions');
        const source = requireAllowedRoot(resolve(a, ctx), ctx);
        const destination = requireAllowedRoot(resolveDestination(a, ctx), ctx);
        try {
          if (!fs.existsSync(source)) return fail(`Source file not found: ${source}`);
          assertRegularFile(source, 'Source');
          assertDestinationDirectory(destination);
          if (sandbox.normalize(source) === sandbox.normalize(destination)) return fail('Source and destination are the same path');
          const destinationExists = fs.existsSync(destination);
          if (destinationExists) {
            assertRegularFile(destination, 'Destination');
            if (a.overwrite !== true) return fail('Destination already exists; set overwrite=true to replace it after creating a backup');
          }
          const backupId = destinationExists ? backupFile(db, backupsDir, destination, 'copy_overwrite') : null;
          fs.copyFileSync(source, destination, destinationExists ? 0 : fs.constants.COPYFILE_EXCL);
          const checksum = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
          return ok(`Copied ${source} to ${destination}`, { data: { source, destination, checksum, backup_id: backupId }, artifacts: [{ kind: 'file', name: path.basename(destination), path: destination, summary: 'copied' }] });
        } catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
      },
    },
    {
      id: 'fs_move', name: 'Move file', description: 'Move a regular file to an existing destination folder. Requires read, write, and delete permissions; always requests approval and keeps a restorable source backup.', domain: 'files',
      input_schema: { type: 'object', properties: { path: { type: 'string' }, destination: { type: 'string' }, overwrite: { type: 'boolean' } }, required: ['path', 'destination'] },
      permission: 'filesystem.delete', risk: 'high', reversible: true, resource: transferResource, requiresApproval: () => true,
      describe: (a) => ({ action: 'Move file', target: `${String(a.path)} → ${String(a.destination)}`, why: 'Agent wants to move a file and remove it from its current location', risks: ['Source path changes', ...(a.overwrite ? ['Existing destination will be backed up before replacement'] : [])] }),
      async execute(a, ctx) {
        if (!hasRequiredAgentPermissions(ctx, ['filesystem.read', 'filesystem.write', 'filesystem.delete'])) return fail('Moving requires filesystem.read, filesystem.write, and filesystem.delete permissions');
        const source = requireAllowedRoot(resolve(a, ctx), ctx);
        const destination = requireAllowedRoot(resolveDestination(a, ctx), ctx);
        try {
          if (!fs.existsSync(source)) return fail(`Source file not found: ${source}`);
          assertRegularFile(source, 'Source');
          assertDestinationDirectory(destination);
          if (sandbox.normalize(source) === sandbox.normalize(destination)) return fail('Source and destination are the same path');
          const destinationExists = fs.existsSync(destination);
          if (destinationExists) {
            assertRegularFile(destination, 'Destination');
            if (a.overwrite !== true) return fail('Destination already exists; set overwrite=true to replace it after creating a backup');
          }
          const sourceBackupId = backupFile(db, backupsDir, source, 'move_source');
          const destinationBackupId = destinationExists ? backupFile(db, backupsDir, destination, 'move_overwrite') : null;
          if (sourceBackupId) db.run('UPDATE file_versions SET reason = ? WHERE id = ?', [`move_source:${JSON.stringify({ destination, destination_backup_id: destinationBackupId })}`, sourceBackupId]);
          fs.copyFileSync(source, destination);
          fs.unlinkSync(source);
          const checksum = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
          return ok(`Moved ${source} to ${destination}`, { data: { source, destination, checksum, source_backup_id: sourceBackupId, destination_backup_id: destinationBackupId }, artifacts: [{ kind: 'file', name: path.basename(destination), path: destination, summary: 'moved' }] });
        } catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
      },
    },
    {
      id: 'fs_restore', name: 'Restore file version', description: 'Restore a file from its TJ backup ID. The current file is backed up first. For a move backup, source_only=true restores the original source but leaves a changed destination untouched; otherwise the move can be undone only if the moved destination is unchanged.', domain: 'files',
      input_schema: { type: 'object', properties: { backup_id: { type: 'string' }, source_only: { type: 'boolean' } }, required: ['backup_id'] },
      permission: 'filesystem.delete', risk: 'high', reversible: true,
      resource: (a) => {
        const record = db.get<{ id: string; path: string; reason: string }>('SELECT id, path, reason FROM file_versions WHERE id = ?', [String(a.backup_id ?? '')]);
        if (!record) return null;
        if (record.reason.startsWith('move_source:')) {
          try { return `${record.id}:${record.path} -> ${String((JSON.parse(record.reason.slice('move_source:'.length)) as { destination: string }).destination)}`; } catch { return `${record.id}:${record.path}`; }
        }
        return `${record.id}:${record.path}`;
      },
      requiresApproval: () => true,
      describe: (a) => ({ action: 'Restore file version', target: String(db.get<{ path: string }>('SELECT path FROM file_versions WHERE id = ?', [String(a.backup_id ?? '')])?.path ?? a.backup_id), why: 'Agent wants to restore a backed-up file version', risks: ['Current file will be backed up first'] }),
      async execute(a, ctx) {
        const backup = db.get<{ id: string; path: string; backup_path: string; checksum: string; reason: string }>('SELECT id, path, backup_path, checksum, reason FROM file_versions WHERE id = ?', [String(a.backup_id ?? '')]);
        if (!backup) return fail('Backup version not found');
        const destination = requireAllowedRoot(backup.path, ctx);
        try {
          if (!fs.existsSync(backup.backup_path)) return fail('Backup data is missing; the file was not changed');
          assertRegularFile(backup.backup_path, 'Backup');
          const snapshot = fs.readFileSync(backup.backup_path);
          if (crypto.createHash('sha256').update(snapshot).digest('hex') !== backup.checksum) return fail('Backup checksum mismatch; the file was not changed');
          if (backup.reason.startsWith('move_source:') && a.source_only !== true) {
            let move: { destination: string; destination_backup_id: string | null };
            try { move = JSON.parse(backup.reason.slice('move_source:'.length)); }
            catch { return fail('Move rollback metadata is invalid; no file was changed'); }
            const movedPath = requireAllowedRoot(resolve({ path: move.destination }, ctx), ctx);
            assertDestinationDirectory(destination);
            if (!fs.existsSync(movedPath)) return fail(`Moved file is missing at ${movedPath}; source was not changed`);
            assertRegularFile(movedPath, 'Moved file');
            const movedChecksum = crypto.createHash('sha256').update(fs.readFileSync(movedPath)).digest('hex');
            if (movedChecksum !== backup.checksum) return fail('Moved file changed after the move. It was left untouched; restore the source backup separately if needed.');
            let priorDestination: { backup_path: string; checksum: string } | undefined;
            if (move.destination_backup_id) {
              priorDestination = db.get<{ backup_path: string; checksum: string }>('SELECT backup_path, checksum FROM file_versions WHERE id = ?', [move.destination_backup_id]);
              if (!priorDestination || !fs.existsSync(priorDestination.backup_path)) return fail('Previous destination backup is missing; no file was changed');
              const priorBytes = fs.readFileSync(priorDestination.backup_path);
              if (crypto.createHash('sha256').update(priorBytes).digest('hex') !== priorDestination.checksum) return fail('Previous destination backup checksum mismatch; no file was changed');
            }
            if (fs.existsSync(destination)) {
              assertRegularFile(destination, 'Current source');
              backupFile(db, backupsDir, destination, 'pre_undo_move_source');
            }
            backupFile(db, backupsDir, movedPath, 'pre_undo_move_destination');
            fs.copyFileSync(backup.backup_path, destination);
            if (priorDestination) fs.copyFileSync(priorDestination.backup_path, movedPath);
            else fs.unlinkSync(movedPath);
            return ok(`Undid file move: restored ${destination}${priorDestination ? ` and previous destination ${movedPath}` : ` and removed ${movedPath}`}`, { data: { source: destination, destination: movedPath, undone_move: true, restored_backup_id: backup.id } });
          }
          if (fs.existsSync(destination)) {
            assertRegularFile(destination, 'Current file');
            backupFile(db, backupsDir, destination, 'pre_restore');
          }
          assertDestinationDirectory(destination);
          fs.copyFileSync(backup.backup_path, destination);
          const checksum = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
          return ok(`Restored ${destination} from backup ${backup.id}`, { data: { path: destination, restored_backup_id: backup.id, checksum }, artifacts: [{ kind: 'file', name: path.basename(destination), path: destination, summary: 'restored' }] });
        } catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
      },
    },
    {
      id: 'fs_delete', name: 'Delete file', description: 'Delete a file. A backup is kept so it can be restored.', domain: 'files',
      input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      permission: 'filesystem.delete', risk: 'high', reversible: true, resource: resolve, requiresApproval: requiresOutsideApproval,
      describe: (a) => ({ action: 'Delete file', target: String(a.path), why: 'Agent wants to delete a file', risks: ['Data loss (a backup copy is kept for restore)'] }),
      async execute(a, ctx) {
        const abs = requireAllowedRoot(resolve(a, ctx), ctx);
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
      permission: 'filesystem.read', risk: 'low', reversible: true, resource: resolveDir, requiresApproval: requiresOutsideApprovalDir,
      async execute(a, ctx) {
        const hits = searchTree(requireAllowedRoot(resolveDir(a, ctx), ctx), String(a.query));
        return ok(hits.join('\n') || 'No matches', { data: { count: hits.length } });
      },
    },
  ];
}
