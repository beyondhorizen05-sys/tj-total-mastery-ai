import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ModelRouter } from '../models/router.js';

type State = 'queued' | 'planning' | 'editing' | 'verifying' | 'completed' | 'failed' | 'rolled_back';
export interface ImprovementRun {
  id: string;
  prompt: string;
  state: State;
  stage: string;
  files: string[];
  checks: Array<{ command: string; exit_code: number; output: string }>;
  diff: string;
  error: string | null;
  model_id: string | null;
  created_at: string;
  finished_at: string | null;
}

const ALLOWED = /^(?:apps\/web\/src|services\/api\/src|packages\/schemas\/src|docs)\/[\w./-]+\.(?:ts|tsx|css|md)$/;
const MAX_FILES = 3;
const MAX_SOURCE = 35_000;

/** Bounded, local-only source edits. The model never receives secrets or a shell. */
export class SelfImprovementService {
  private runs = new Map<string, ImprovementRun>();
  private snapshots = new Map<string, Map<string, { before: string; afterHash: string }>>();
  private active: string | null = null;
  private stateFile: string;

  constructor(private root: string, private router: Pick<ModelRouter, 'chat'>, dataDir = path.join(root, '.tj-data')) {
    const directory = path.join(dataDir, 'self-improvement');
    fs.mkdirSync(directory, { recursive: true });
    this.stateFile = path.join(directory, 'runs.json');
    if (fs.existsSync(this.stateFile)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as { runs: ImprovementRun[]; snapshots: Array<[string, Array<[string, { before: string; afterHash: string }]>]> };
        this.runs = new Map(saved.runs.map((r) => [r.id, r]));
        this.snapshots = new Map(saved.snapshots.map(([id, values]) => [id, new Map(values)]));
        for (const run of this.runs.values()) {
          if (['queued', 'planning', 'editing', 'verifying'].includes(run.state)) {
            for (const [relative, snapshot] of this.snapshots.get(run.id) ?? []) {
              const target = this.safePath(relative);
              if (fs.existsSync(target) && sha(fs.readFileSync(target, 'utf8')) === snapshot.afterHash) fs.writeFileSync(target, snapshot.before, 'utf8');
            }
            run.state = 'failed'; run.stage = 'Interrupted'; run.error = 'TJ stopped during this change. Matching source edits were restored.'; run.finished_at = new Date().toISOString();
            this.snapshots.delete(run.id);
          }
        }
        this.persist();
      } catch { /* keep source unchanged if saved state cannot be read */ }
    }
  }

  list(): ImprovementRun[] { return [...this.runs.values()].reverse().map((r) => ({ ...r, checks: [...r.checks] })); }
  get(id: string): ImprovementRun | undefined { return this.runs.get(id); }

  async start(prompt: string, modelId?: string): Promise<ImprovementRun> {
    if (this.active) throw new Error('Another TJ improvement is already running.');
    const status = await this.git(['status', '--porcelain', '--untracked-files=all']);
    const owned = new Map<string, string>();
    for (const [id, files] of this.snapshots) if (this.runs.get(id)?.state === 'completed') {
      for (const [relative, snapshot] of files) owned.set(relative, snapshot.afterHash);
    }
    for (const line of status.stdout.split(/\r?\n/).filter(Boolean)) {
      const relative = line.slice(3).replaceAll('\\', '/');
      const expected = owned.get(relative);
      if (!expected || !ALLOWED.test(relative) || !fs.existsSync(this.safePath(relative)) || sha(fs.readFileSync(this.safePath(relative), 'utf8')) !== expected) {
        throw new Error('TJ source has changes outside a verified TJ improvement. Commit or move them before another automatic run.');
      }
    }
    const run: ImprovementRun = {
      id: crypto.randomUUID(), prompt, state: 'queued', stage: 'Waiting to start', files: [], checks: [], diff: '', error: null,
      model_id: modelId ?? null, created_at: new Date().toISOString(), finished_at: null,
    };
    this.runs.set(run.id, run);
    this.active = run.id;
    this.persist();
    void this.execute(run, modelId).finally(() => { this.active = null; });
    return run;
  }

  async rollback(id: string): Promise<ImprovementRun> {
    if (this.active) throw new Error('Wait for the current improvement to finish.');
    const run = this.runs.get(id);
    const originals = this.snapshots.get(id);
    if (!run || run.state !== 'completed' || !originals) throw new Error('This improvement cannot be rolled back.');
    for (const [relative, snapshot] of originals) {
      const current = fs.readFileSync(this.safePath(relative), 'utf8');
      if (sha(current) !== snapshot.afterHash) throw new Error(`File changed since this run: ${relative}. Rollback stopped to protect newer work.`);
    }
    for (const [relative, snapshot] of originals) fs.writeFileSync(this.safePath(relative), snapshot.before, 'utf8');
    run.state = 'rolled_back'; run.stage = 'Original files restored'; run.finished_at = new Date().toISOString();
    this.snapshots.delete(id);
    this.persist();
    return run;
  }

  private async execute(run: ImprovementRun, modelId?: string): Promise<void> {
    const originals = new Map<string, { before: string; afterHash: string }>();
    try {
      run.state = 'planning'; run.stage = 'Choosing source files';
      const manifest = (await this.git(['ls-files'])).stdout.split(/\r?\n/).map((p) => p.replaceAll('\\', '/')).filter((p) => ALLOWED.test(p)).slice(0, 1200);
      if (!manifest.length) throw new Error('No editable TJ source files were found.');
      const selection = await this.ask(
        `Choose 1 to ${MAX_FILES} existing files needed for this change. Return only JSON: {"files":["path"]}. Do not choose files unless needed.\nRequest: ${run.prompt}\nFiles:\n${manifest.join('\n')}`,
        modelId,
      );
      const selected = parseJson<{ files?: unknown }>(selection).files;
      if (!Array.isArray(selected) || selected.length < 1 || selected.length > MAX_FILES || new Set(selected).size !== selected.length || selected.some((p) => typeof p !== 'string' || !manifest.includes(p))) {
        throw new Error('Model selected invalid or too many source files.');
      }
      const files = selected as string[];
      run.files = files;
      const sources = files.map((relative) => {
        const content = fs.readFileSync(this.safePath(relative), 'utf8');
        if (content.length > MAX_SOURCE) throw new Error(`Selected file is too large for a safe edit: ${relative}`);
        return { path: relative, content };
      });
      run.state = 'editing'; run.stage = 'Generating source changes';
      const answer = await this.ask(
        `Implement the user's request in the supplied TJ files. Return only JSON: {"edits":[{"path":"one selected path","content":"complete replacement file"}]}. Preserve unrelated behavior. Edit only selected paths. No commands, new files, secrets, or placeholders.\nRequest: ${run.prompt}\nCurrent files:\n${JSON.stringify(sources)}`,
        modelId,
      );
      const edits = parseJson<{ edits?: unknown }>(answer).edits;
      if (!Array.isArray(edits) || !edits.length || edits.length > files.length) throw new Error('Model did not return valid file edits.');
      const seen = new Set<string>();
      for (const edit of edits) {
        if (!edit || typeof edit.path !== 'string' || typeof edit.content !== 'string' || !files.includes(edit.path) || seen.has(edit.path) || !edit.content.trim() || edit.content.length > 100_000) {
          throw new Error('Model returned an invalid source edit.');
        }
        seen.add(edit.path);
        const before = sources.find((s) => s.path === edit.path)!.content;
        if (before === edit.content) continue;
        originals.set(edit.path, { before, afterHash: sha(edit.content) });
      }
      if (!originals.size) throw new Error('Model proposed no actual changes.');
      // Do not overwrite source changed by a person while the model was generating.
      for (const [relative, snapshot] of originals) {
        if (fs.readFileSync(this.safePath(relative), 'utf8') !== snapshot.before) throw new Error(`File changed during planning: ${relative}`);
      }
      this.snapshots.set(run.id, originals);
      this.persist();
      for (const edit of edits) if (originals.has(edit.path)) fs.writeFileSync(this.safePath(edit.path), edit.content, 'utf8');
      run.files = [...originals.keys()];
      run.state = 'verifying'; run.stage = 'Checking types and build';
      run.stage = 'Checking source diff';
      const whitespace = await runProcess('git', ['diff', '--check', '--', ...run.files], this.root, 20_000);
      run.checks.push({ command: 'git diff --check', exit_code: whitespace.code, output: (whitespace.stdout + '\n' + whitespace.stderr).slice(-6000) });
      if (whitespace.code !== 0) throw new Error('Source diff check failed. Original files were restored.');
      const targets = new Set(run.files.map((p) => p.startsWith('apps/web/') ? 'web' : p.startsWith('docs/') ? 'docs' : 'api'));
      const checks: Array<[string, string[]]> = [];
      if (targets.has('api')) checks.push(['pnpm --filter @tj/api typecheck', ['--filter', '@tj/api', 'typecheck']]);
      if (targets.has('web') || targets.has('api')) checks.push(['pnpm --filter @tj/web build', ['--filter', '@tj/web', 'build']]);
      if (targets.has('api')) checks.push(['pnpm --filter @tj/api build', ['--filter', '@tj/api', 'build']]);
      for (const [label, args] of checks) {
        run.stage = `Running ${label}`;
        const result = await runProcess('pnpm', args, this.root, 180_000);
        run.checks.push({ command: label, exit_code: result.code, output: (result.stdout + '\n' + result.stderr).slice(-6000) });
        if (result.code !== 0) throw new Error(`${label} failed (exit ${result.code}). Original files were restored.`);
      }
      const diff = await this.git(['diff', '--', ...run.files]);
      run.diff = diff.stdout.slice(0, 100_000);
      run.state = 'completed'; run.stage = 'Changes applied and checks passed';
    } catch (error) {
      for (const [relative, snapshot] of originals) {
        const target = this.safePath(relative);
        if (fs.existsSync(target) && sha(fs.readFileSync(target, 'utf8')) === snapshot.afterHash) fs.writeFileSync(target, snapshot.before, 'utf8');
      }
      run.state = 'failed'; run.stage = 'Stopped'; run.error = error instanceof Error ? error.message : String(error);
      this.snapshots.delete(run.id);
    } finally { run.finished_at = new Date().toISOString(); this.persist(); }
  }

  private persist(): void {
    const temporary = `${this.stateFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ runs: [...this.runs.values()], snapshots: [...this.snapshots].map(([id, values]) => [id, [...values]]) }), 'utf8');
    fs.renameSync(temporary, this.stateFile);
  }

  private safePath(relative: string): string {
    if (!ALLOWED.test(relative) || relative.includes('..') || relative.includes('\\')) throw new Error('Unsafe source path.');
    const resolved = path.resolve(this.root, relative);
    if (!resolved.startsWith(this.root + path.sep)) throw new Error('Source path escaped the TJ repository.');
    const real = fs.realpathSync(resolved);
    if (!real.startsWith(fs.realpathSync(this.root) + path.sep)) throw new Error('Source symlink escaped the TJ repository.');
    return resolved;
  }

  private async ask(content: string, modelId?: string): Promise<string> {
    const result = await this.router.chat({ task_type: 'coding', complexity: 'high', model_id: modelId ?? null }, {
      messages: [
        { role: 'system', content: 'You edit a local open-source TypeScript project. Return strict JSON only, without markdown. If the request cannot be implemented within the provided files, return {"error":"reason"}.' },
        { role: 'user', content },
      ],
      temperature: 0,
    });
    return result.text;
  }

  private async git(args: string[]) {
    const result = await runProcess('git', args, this.root, 20_000);
    if (result.code !== 0) throw new Error(`Git failed: ${result.stderr.slice(-500)}`);
    return result;
  }
}

function parseJson<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(trimmed) as T & { error?: string };
  if (parsed.error) throw new Error(`Model could not make this change: ${parsed.error}`);
  return parsed;
}
function sha(text: string): string { return crypto.createHash('sha256').update(text).digest('hex'); }
function runProcess(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Only pnpm uses cmd.exe on Windows because pnpm is a .cmd shim. Its args are fixed above.
    const useCmd = process.platform === 'win32' && command === 'pnpm';
    const child = useCmd
      ? spawn('cmd.exe', ['/d', '/s', '/c', `pnpm ${args.join(' ')}`], { cwd, windowsHide: true })
      : spawn(command, args, { cwd, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); if (stdout.length > 120_000) stdout = stdout.slice(-120_000); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); if (stderr.length > 120_000) stderr = stderr.slice(-120_000); });
    const timer = setTimeout(() => { child.kill(); resolve({ code: -1, stdout, stderr: stderr + '\nTimed out' }); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(error) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}
