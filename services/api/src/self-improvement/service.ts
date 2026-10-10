import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ModelRouter } from '../models/router.js';
import type { ApprovalService } from '../security/approvals.js';

type State = 'queued' | 'planning' | 'editing' | 'verifying' | 'awaiting_deployment_approval' | 'deploying' | 'awaiting_approval' | 'completed' | 'failed' | 'rolled_back';
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
  approval_id?: string | null;
  candidate_path?: string | null;
  created_at: string;
  finished_at: string | null;
}

const ALLOWED = /^(?:apps\/web\/src|services\/api\/(?:src|tests)|packages\/schemas\/src|docs)\/[\w./-]+\.(?:ts|tsx|css|md)$/;
const MAX_FILES = 3;
const MAX_SOURCE = 35_000;

interface VerificationCheck { label: string; command: string; args: string[]; timeout_ms: number }

/** Choose acceptance gates from the paths actually changed. */
export function verificationPlan(files: string[]): VerificationCheck[] {
  const api = files.some((file) => file.startsWith('services/api/') || file.startsWith('packages/schemas/'));
  const web = files.some((file) => file.startsWith('apps/web/') || file.startsWith('packages/schemas/'));
  const checks: VerificationCheck[] = [
    { label: 'git diff --check', command: 'git', args: ['diff', '--check', '--', ...files], timeout_ms: 20_000 },
  ];
  if (api) checks.push({ label: 'pnpm --filter @tj/api typecheck', command: 'pnpm', args: ['--filter', '@tj/api', 'typecheck'], timeout_ms: 180_000 });
  if (web) checks.push({ label: 'pnpm --filter @tj/web typecheck', command: 'pnpm', args: ['--filter', '@tj/web', 'typecheck'], timeout_ms: 180_000 });
  if (api) {
    checks.push({ label: 'pnpm --filter @tj/api test', command: 'pnpm', args: ['--filter', '@tj/api', 'test'], timeout_ms: 300_000 });
    checks.push({ label: 'pnpm --filter @tj/api test -- tests/security.test.ts tests/sandbox.test.ts', command: 'pnpm', args: ['--filter', '@tj/api', 'test', '--', 'tests/security.test.ts', 'tests/sandbox.test.ts'], timeout_ms: 120_000 });
    checks.push({ label: 'pnpm --filter @tj/api run test:e2e', command: 'pnpm', args: ['--filter', '@tj/api', 'run', 'test:e2e'], timeout_ms: 240_000 });
  }
  if (web || api) checks.push({ label: 'pnpm --filter @tj/web build', command: 'pnpm', args: ['--filter', '@tj/web', 'build'], timeout_ms: 180_000 });
  if (api) checks.push({ label: 'pnpm --filter @tj/api build', command: 'pnpm', args: ['--filter', '@tj/api', 'build'], timeout_ms: 180_000 });
  return checks;
}

/** Bounded, local-only source edits. The model never receives secrets or a shell. */
export class SelfImprovementService {
  private runs = new Map<string, ImprovementRun>();
  private snapshots = new Map<string, Map<string, { before: string; afterHash: string; acceptedHashes?: string[] }>>();
  private active: string | null = null;
  private controller: AbortController | null = null;
  private stateFile: string;
  private candidateRoot: string;

  constructor(private root: string, private router: Pick<ModelRouter, 'chat'>, dataDir = path.join(root, '.tj-data'), private approvals?: ApprovalService) {
    const directory = path.join(dataDir, 'self-improvement');
    fs.mkdirSync(directory, { recursive: true });
    this.candidateRoot = path.join(directory, 'candidates');
    fs.mkdirSync(this.candidateRoot, { recursive: true });
    this.stateFile = path.join(directory, 'runs.json');
    if (fs.existsSync(this.stateFile)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as { runs: ImprovementRun[]; snapshots: Array<[string, Array<[string, { before: string; afterHash: string; acceptedHashes?: string[] }]>]> };
        this.runs = new Map(saved.runs.map((r) => [r.id, r]));
        this.snapshots = new Map(saved.snapshots.map(([id, values]) => [id, new Map(values)]));
        for (const run of this.runs.values()) {
          if (run.state === 'deploying') this.recoverInterruptedDeployment(run);
          if (['queued', 'planning', 'editing', 'verifying'].includes(run.state)) {
            const snapshots = this.snapshots.get(run.id);
            if (snapshots?.size) {
              run.state = 'awaiting_approval'; run.stage = 'Interrupted; approve rollback or inspect the changes';
              run.error = 'TJ stopped during this change. Source edits were retained for review.';
            } else {
              run.state = 'failed'; run.stage = 'Interrupted'; run.error = 'TJ stopped before source edits were applied.';
            }
            run.finished_at = new Date().toISOString();
          }
        }
        this.persist();
        for (const run of this.runs.values()) {
          if (run.state === 'awaiting_approval') this.watchRollbackApproval(run);
          if (run.state === 'awaiting_deployment_approval') this.watchDeploymentApproval(run);
        }
      } catch { /* keep source unchanged if saved state cannot be read */ }
    }
  }

  list(): ImprovementRun[] { return [...this.runs.values()].reverse().map((r) => ({ ...r, checks: [...r.checks] })); }
  get(id: string): ImprovementRun | undefined { return this.runs.get(id); }
  stopAll(): void { this.controller?.abort(); }

  async start(prompt: string, modelId?: string): Promise<ImprovementRun> {
    if (this.active) throw new Error('Another TJ improvement is already running.');
    if ([...this.runs.values()].some((run) => ['awaiting_approval', 'awaiting_deployment_approval'].includes(run.state))) throw new Error('Resolve the previous improvement approval before starting another change.');
    const run: ImprovementRun = {
      id: crypto.randomUUID(), prompt, state: 'queued', stage: 'Waiting to start', files: [], checks: [], diff: '', error: null,
      model_id: modelId ?? null, created_at: new Date().toISOString(), finished_at: null,
    };
    this.runs.set(run.id, run);
    this.active = run.id;
    this.controller = new AbortController();
    this.persist();
    void this.execute(run, modelId, this.controller.signal).finally(() => { this.active = null; this.controller = null; });
    return run;
  }

  async rollback(id: string): Promise<ImprovementRun> {
    if (this.active) throw new Error('Wait for the current improvement to finish.');
    const run = this.runs.get(id);
    const originals = this.snapshots.get(id);
    if (!run || !['completed', 'awaiting_approval'].includes(run.state) || !originals) throw new Error('This improvement cannot be rolled back.');
    for (const [relative, snapshot] of originals) {
      const current = fs.readFileSync(this.safePath(relative), 'utf8');
      if (![snapshot.afterHash, ...(snapshot.acceptedHashes ?? [])].includes(sha(current)) && current !== snapshot.before) throw new Error(`File changed since this run: ${relative}. Rollback stopped to protect newer work.`);
    }
    for (const [relative, snapshot] of originals) fs.writeFileSync(this.safePath(relative), snapshot.before, 'utf8');
    run.state = 'rolled_back'; run.stage = 'Original files restored'; run.finished_at = new Date().toISOString();
    this.snapshots.delete(id);
    this.persist();
    return run;
  }

  private async createCandidate(run: ImprovementRun, sourceFiles: Array<{ path: string; content: string }>): Promise<string> {
    const target = path.join(this.candidateRoot, run.id);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    const tracked = (await this.git(['ls-files'])).stdout.split(/\r?\n/).filter(Boolean);
    const repository = fs.realpathSync(this.root);
    for (const relative of tracked) {
      if (relative === '.tj-data' || relative.startsWith('.tj-data/')) continue;
      const source = path.resolve(this.root, relative);
      if (!source.startsWith(this.root + path.sep) || !fs.existsSync(source)) continue;
      const real = fs.realpathSync(source);
      if (!real.startsWith(repository + path.sep)) throw new Error(`Cannot copy source symlink outside the repository: ${relative}`);
      const destination = path.join(target, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(real, destination);
    }
    // Start selected files from the actual working tree, including the user's
    // uncommitted edits. The isolated candidate must build on what they see.
    for (const source of sourceFiles) {
      const destination = path.join(target, source.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, source.content, 'utf8');
    }
    for (const relative of ['node_modules', 'apps/web/node_modules', 'services/api/node_modules', 'packages/schemas/node_modules']) {
      const source = path.join(this.root, relative);
      const destination = path.join(target, relative);
      if (fs.existsSync(source) && !fs.existsSync(destination)) {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.symlinkSync(source, destination, 'junction');
      }
    }
    await this.gitAt(target, ['init', '-q']);
    await this.gitAt(target, ['add', '-A']);
    await this.gitAt(target, ['-c', 'user.email=tj-self-improvement@localhost', '-c', 'user.name=TJ Self Improvement', 'commit', '-qm', 'Isolated TJ improvement baseline']);
    run.candidate_path = target;
    this.persist();
    return target;
  }

  private watchDeploymentApproval(run: ImprovementRun): void {
    if (!this.approvals || run.state !== 'awaiting_deployment_approval' || !run.approval_id) return;
    void this.approvals.waitFor(run.approval_id).then(async (decision) => {
      if (run.state !== 'awaiting_deployment_approval') return;
      if (decision.status !== 'approved' && decision.status !== 'approved_workflow') {
        run.state = 'failed'; run.stage = 'Deployment declined; TJ source was not changed';
        run.error = 'Deployment approval was declined or expired.';
        run.finished_at = new Date().toISOString();
        await this.removeCandidate(run.candidate_path ?? undefined);
        this.persist();
        return;
      }
      try {
        const originals = this.snapshots.get(run.id);
        if (!originals || !run.candidate_path) throw new Error('Isolated candidate is unavailable.');
        for (const [relative, snapshot] of originals) {
          if (fs.readFileSync(this.safePath(relative), 'utf8') !== snapshot.before) throw new Error(`Source changed while awaiting approval: ${relative}`);
        }
        const writes: Array<[string, string]> = [];
        for (const [relative, snapshot] of originals) {
          const content = fs.readFileSync(path.join(run.candidate_path, relative), 'utf8');
          if (sha(content) !== snapshot.afterHash) throw new Error(`Candidate changed after verification: ${relative}`);
          writes.push([relative, content]);
        }
        run.state = 'deploying'; run.stage = 'Applying the approved candidate'; this.persist();
        const deployed: string[] = [];
        try {
          for (const [relative, content] of writes) {
            const snapshot = originals.get(relative)!;
            const target = this.safePath(relative);
            if (fs.readFileSync(target, 'utf8') !== snapshot.before) throw new Error(`Source changed immediately before deployment: ${relative}`);
            const temporary = `${target}.tj-${run.id}.tmp`;
            fs.writeFileSync(temporary, content, 'utf8');
            fs.renameSync(temporary, target);
            deployed.push(relative);
          }
        } catch (error) {
          const restoreErrors: string[] = [];
          for (const relative of originals.keys()) {
            const temporary = `${this.safePath(relative)}.tj-${run.id}.tmp`;
            if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
          }
          for (const relative of deployed.reverse()) {
            const target = this.safePath(relative);
            const snapshot = originals.get(relative)!;
            if (sha(fs.readFileSync(target, 'utf8')) !== snapshot.afterHash) { restoreErrors.push(relative); continue; }
            fs.writeFileSync(target, snapshot.before, 'utf8');
          }
          if (restoreErrors.length) throw new Error(`${error instanceof Error ? error.message : String(error)}. Partial deployment could not restore files changed afterward: ${restoreErrors.join(', ')}`);
          throw error;
        }
        run.state = 'completed'; run.stage = 'Approved changes deployed after isolated checks passed';
        run.finished_at = new Date().toISOString();
      await this.removeCandidate(run.candidate_path ?? undefined);
      } catch (error) {
        run.state = 'failed'; run.stage = 'Deployment stopped; review the recorded diff';
        run.error = error instanceof Error ? error.message : String(error);
        run.finished_at = new Date().toISOString();
      }
      this.persist();
    }).catch((error) => {
      run.state = 'failed'; run.stage = 'Approval processing failed; TJ source was not changed';
      run.error = error instanceof Error ? error.message : String(error);
      run.finished_at = new Date().toISOString(); this.persist();
    });
  }

  private async removeCandidate(candidate: string | undefined): Promise<void> {
    if (!candidate) return;
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(this.candidateRoot + path.sep)) throw new Error('Candidate cleanup path escaped the self-improvement sandbox.');
    fs.rmSync(resolved, { recursive: true, force: true });
  }

  private recoverInterruptedDeployment(run: ImprovementRun): void {
    const originals = this.snapshots.get(run.id);
    if (!originals) {
      run.state = 'failed'; run.stage = 'Interrupted deployment needs manual review';
      run.error = 'TJ stopped during deployment without a saved source snapshot.';
      run.finished_at = new Date().toISOString(); return;
    }
    try {
      for (const [relative, snapshot] of originals) {
        const temporary = `${this.safePath(relative)}.tj-${run.id}.tmp`;
        if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
        const content = fs.readFileSync(this.safePath(relative), 'utf8');
        if (content !== snapshot.before && sha(content) !== snapshot.afterHash) throw new Error(`Source changed during interruption: ${relative}`);
      }
      for (const [relative, snapshot] of originals) {
        if (sha(fs.readFileSync(this.safePath(relative), 'utf8')) === snapshot.afterHash) fs.writeFileSync(this.safePath(relative), snapshot.before, 'utf8');
      }
      run.state = 'failed'; run.stage = 'Interrupted deployment was restored; candidate was not activated';
      run.error = 'TJ stopped while deploying. The incomplete source update was restored; review the run before retrying.';
    } catch (error) {
      run.state = 'failed'; run.stage = 'Interrupted deployment needs manual review';
      run.error = error instanceof Error ? error.message : String(error);
    }
    run.finished_at = new Date().toISOString();
    if (run.candidate_path && path.resolve(run.candidate_path).startsWith(this.candidateRoot + path.sep)) fs.rmSync(run.candidate_path, { recursive: true, force: true });
  }

  private watchRollbackApproval(run: ImprovementRun): void {
    if (!this.approvals || run.state !== 'awaiting_approval') return;
    if (!run.approval_id) {
      const approval = this.approvals.request({
        workspace_id: 'default', action: 'self_improvement_rollback', target: run.id,
        why: `TJ could not verify this source change after a repair attempt. Review the diff and check output before deciding whether to restore the original files.`,
        tools: ['self-improvement'], resources_affected: run.files, risks: ['Restoring files discards the unverified TJ edits.'],
        rollback_available: false, permission: 'source.write', risk: 'high', payload: { run_id: run.id, error: run.error },
      });
      run.approval_id = approval.id;
      this.persist();
    }
    const approvalId = run.approval_id;
    void this.approvals.waitFor(approvalId).then(async (decision) => {
      if (decision.status === 'approved' || decision.status === 'approved_workflow') {
        try { await this.rollback(run.id); }
        catch (error) { run.error = `Approved rollback could not safely complete: ${error instanceof Error ? error.message : String(error)}`; this.persist(); }
      } else if (run.state === 'awaiting_approval') {
        run.stage = 'Rollback declined; unverified changes retained for review';
        this.persist();
      }
    });
  }

  private async execute(run: ImprovementRun, modelId: string | undefined, signal: AbortSignal): Promise<void> {
    const originals = new Map<string, { before: string; afterHash: string; acceptedHashes?: string[] }>();
    try {
      run.state = 'planning'; run.stage = 'Choosing source files';
      const manifest = (await this.git(['ls-files'])).stdout.split(/\r?\n/).map((p) => p.replaceAll('\\', '/')).filter((p) => ALLOWED.test(p)).slice(0, 1200);
      if (!manifest.length) throw new Error('No editable TJ source files were found.');
      const selection = await this.ask(
        `Choose 1 to ${MAX_FILES} existing files needed for this change. Return only JSON: {"files":["path"]}. Do not choose files unless needed.\nRequest: ${run.prompt}\nFiles:\n${manifest.join('\n')}`,
        modelId, signal,
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
      const candidate = await this.createCandidate(run, sources);
      run.state = 'editing'; run.stage = 'Generating source changes';
      const answer = await this.ask(
        `Implement the user's request in the supplied TJ files. Return only JSON: {"edits":[{"path":"one selected path","content":"complete replacement file"}]}. Preserve unrelated behavior. Edit only selected paths. No commands, new files, secrets, or placeholders. If tests are supplied, add or update meaningful coverage; never delete, skip, weaken, or suppress a failing test just to get a green result.\nRequest: ${run.prompt}\nCurrent files:\n${JSON.stringify(sources)}`,
        modelId, signal,
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
      if (signal.aborted) throw new Error('Improvement stopped by user.');
      // Do not overwrite source changed by a person while the model was generating.
      for (const [relative, snapshot] of originals) {
        if (fs.readFileSync(this.safePath(relative), 'utf8') !== snapshot.before) throw new Error(`File changed during planning: ${relative}`);
      }
      this.snapshots.set(run.id, originals);
      this.persist();
      for (const edit of edits) if (originals.has(edit.path)) fs.writeFileSync(path.join(candidate, edit.path), edit.content, 'utf8');
      run.files = [...originals.keys()];
      let failure = await this.verify(run, signal);
      if (failure && !signal.aborted) {
        run.stage = 'Focused check failed; generating one repair from the failure output';
        this.persist();
        const current = run.files.map((relative) => ({ path: relative, content: fs.readFileSync(path.join(candidate, relative), 'utf8') }));
        const answer = await this.ask(
          `The previous edit failed verification. Inspect the exact check failure, identify its cause, and choose a different fix when the first approach was wrong. Repair only the selected source files. Return only JSON: {"edits":[{"path":"selected path","content":"complete replacement file"}]}. Do not delete, skip, weaken, or suppress tests or errors to obtain a green result. No new paths, commands, secrets, or placeholders.\nRequest: ${run.prompt}\nFailure: ${failure}\nCurrent files: ${JSON.stringify(current)}`,
          modelId, signal,
        );
        const repairEdits = parseJson<{ edits?: unknown }>(answer).edits;
        if (!Array.isArray(repairEdits) || !repairEdits.length || repairEdits.length > run.files.length) throw new Error('Repair model returned invalid file edits.');
        const seenRepair = new Set<string>();
        for (const edit of repairEdits) {
          if (!edit || typeof edit.path !== 'string' || typeof edit.content !== 'string' || !run.files.includes(edit.path) || seenRepair.has(edit.path) || !edit.content.trim() || edit.content.length > 100_000) throw new Error('Repair model returned an invalid source edit.');
          seenRepair.add(edit.path);
          const target = path.join(candidate, edit.path);
          const snapshot = originals.get(edit.path)!;
          if (sha(fs.readFileSync(target, 'utf8')) !== snapshot.afterHash) throw new Error(`File changed during repair: ${edit.path}`);
        }
        if (signal.aborted) throw new Error('Improvement stopped by user.');
        for (const edit of repairEdits) {
          const snapshot = originals.get(edit.path)!;
          snapshot.acceptedHashes = [...new Set([...(snapshot.acceptedHashes ?? []), snapshot.afterHash, sha(edit.content)])];
          snapshot.afterHash = sha(edit.content);
        }
        this.persist();
        for (const edit of repairEdits) fs.writeFileSync(path.join(candidate, edit.path), edit.content, 'utf8');
        failure = await this.verify(run, signal);
      }
      if (failure) throw new Error(`Verification failed after a repair attempt: ${failure}`);
      if (signal.aborted) throw new Error('Improvement stopped by user.');
      const diff = await this.gitAt(candidate, ['diff', '--', ...run.files]);
      run.diff = diff.stdout.slice(0, 100_000);
      if (!this.approvals) throw new Error('Approval service is unavailable; candidate changes were not deployed.');
      const approval = this.approvals.request({
        workspace_id: 'default', action: 'self_improvement_deploy', target: run.id,
        why: 'Review the verified isolated source diff and test results. TJ will apply these changes only after approval.',
        tools: ['self-improvement'], resources_affected: run.files,
        risks: ['Approving writes the verified candidate files into the TJ source tree.'],
        rollback_available: true, permission: 'source.write', risk: 'high', payload: { run_id: run.id, files: run.files, diff: run.diff, checks: run.checks },
      });
      run.state = 'awaiting_deployment_approval';
      run.stage = 'Isolated checks passed; waiting for deployment approval';
      run.approval_id = approval.id;
      this.persist();
      this.watchDeploymentApproval(run);
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error);
      run.state = 'failed'; run.stage = 'Candidate rejected; TJ source was not changed';
      if (run.candidate_path) run.diff = (await this.gitAt(run.candidate_path, ['diff', '--', ...run.files]).catch(() => ({ stdout: '' }))).stdout.slice(0, 100_000);
      this.snapshots.delete(run.id);
      await this.removeCandidate(run.candidate_path ?? undefined).catch(() => {});
    } finally {
      if (run.state !== 'awaiting_deployment_approval') run.finished_at = new Date().toISOString();
      this.persist();
      if (run.state === 'awaiting_approval') this.watchRollbackApproval(run);
    }
  }

  private async verify(run: ImprovementRun, signal: AbortSignal): Promise<string | null> {
    run.state = 'verifying'; run.stage = 'Checking source diff';
    const checks = verificationPlan(run.files);
    for (const { label, command, args, timeout_ms } of checks) {
      if (signal.aborted) return 'Improvement stopped by user.';
      run.stage = `Running ${label}`;
      const result = await runProcess(command, args, run.candidate_path ?? this.root, timeout_ms, signal);
      const output = (result.stdout + '\n' + result.stderr).slice(-6000);
      run.checks.push({ command: label, exit_code: result.code, output });
      this.persist();
      if (result.code !== 0) return `${label} failed (exit ${result.code}): ${output}`;
    }
    return null;
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

  private async ask(content: string, modelId?: string, signal?: AbortSignal): Promise<string> {
    const result = await this.router.chat({ task_type: 'coding', complexity: 'high', model_id: modelId ?? null }, {
      messages: [
        { role: 'system', content: 'You edit a local open-source TypeScript project. Return strict JSON only, without markdown. If the request cannot be implemented within the provided files, return {"error":"reason"}.' },
        { role: 'user', content },
      ],
      temperature: 0,
      signal,
    });
    return result.text;
  }

  private async git(args: string[]) {
    return this.gitAt(this.root, args);
  }

  private async gitAt(cwd: string, args: string[]) {
    const result = await runProcess('git', args, cwd, 20_000);
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
function runProcess(command: string, args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }> {
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
    const onAbort = () => { child.kill(); resolve({ code: -2, stdout, stderr: stderr + '\nStopped by user' }); };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.on('error', (error) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve({ code: -1, stdout, stderr: String(error) }); });
    child.on('close', (code) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}
