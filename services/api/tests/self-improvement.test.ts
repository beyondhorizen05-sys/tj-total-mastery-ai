import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SelfImprovementService, verificationPlan } from '../src/self-improvement/service.js';
import type { ModelRouter } from '../src/models/router.js';
import type { ApprovalService } from '../src/security/approvals.js';

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-improvement-test-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, '.gitignore'), '.tj-data/\n');
  fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'Original guide\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', 'add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', 'commit', '-qm', 'baseline'], { cwd: root });
  return root;
}
function model(responses: string[]): Pick<ModelRouter, 'chat'> {
  return { chat: async () => ({ text: responses.shift() ?? '', usage: { tokens_in: 0, tokens_out: 0 } }) } as unknown as Pick<ModelRouter, 'chat'>;
}
function autoApproval(status = 'approved') {
  return {
    request: () => ({ id: `approval-${crypto.randomUUID()}` }),
    waitFor: async () => ({ status }),
  } as unknown as ApprovalService;
}
async function finished(service: SelfImprovementService, id: string) {
  for (let i = 0; i < 100; i++) {
    const run = service.get(id)!;
    if (run.finished_at) return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Improvement did not finish');
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('TJ self improvement', () => {
  it('runs API unit, security, integration, type, and build gates for API changes', () => {
    const commands = verificationPlan(['services/api/src/tools/example.ts']).map((check) => check.label);
    expect(commands).toEqual(expect.arrayContaining([
      'git diff --check',
      'pnpm --filter @tj/api typecheck',
      'pnpm --filter @tj/api test',
      'pnpm --filter @tj/api test -- tests/security.test.ts tests/sandbox.test.ts',
      'pnpm --filter @tj/api run test:e2e',
      'pnpm --filter @tj/web build',
      'pnpm --filter @tj/api build',
    ]));
  });

  it('runs web typecheck and production build without API test claims', () => {
    const commands = verificationPlan(['apps/web/src/views/example.tsx']).map((check) => check.label);
    expect(commands).toEqual(['git diff --check', 'pnpm --filter @tj/web typecheck', 'pnpm --filter @tj/web build']);
  });

  it('allows source improvements to include API test files and treats them as API changes', () => {
    const root = fixture();
    fs.mkdirSync(path.join(root, 'services', 'api', 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'services', 'api', 'tests', 'example.test.ts'), 'export {}\n');
    const service = new SelfImprovementService(root, model([]));
    const run = { ...({} as any), files: ['services/api/tests/example.test.ts'] };
    expect(verificationPlan(run.files).some((check) => check.label === 'pnpm --filter @tj/api test')).toBe(true);
    expect(() => service['safePath']('services/api/tests/example.test.ts')).not.toThrow();
  });

  it('applies a verified prompt edit and safely rolls it back', async () => {
    const root = fixture();
    const service = new SelfImprovementService(root, model([
      '{"files":["docs/guide.md"]}',
      '{"edits":[{"path":"docs/guide.md","content":"Improved guide\\n"}]}',
    ]), undefined, autoApproval());
    const started = await service.start('Improve the TJ guide');
    const run = await finished(service, started.id);
    expect(run.state).toBe('completed');
    expect(run.diff).toContain('Improved guide');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Improved guide\n');
    const restarted = new SelfImprovementService(root, model([]));
    expect((await restarted.rollback(run.id)).state).toBe('rolled_back');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Original guide\n');
  });

  it('preserves unrelated in-progress source edits while deploying a reviewed candidate', async () => {
    const root = fixture();
    const unrelated = path.join(root, 'docs', 'other.md');
    fs.writeFileSync(unrelated, 'Committed content\n');
    execFileSync('git', ['add', 'docs/other.md'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', 'commit', '-qm', 'Add unrelated file'], { cwd: root });
    fs.writeFileSync(unrelated, 'User work in progress\n');
    const service = new SelfImprovementService(root, model([
      '{"files":["docs/guide.md"]}',
      '{"edits":[{"path":"docs/guide.md","content":"Improved guide\\n"}]}',
    ]), undefined, autoApproval());
    const run = await finished(service, (await service.start('Improve the guide')).id);
    expect(run.state).toBe('completed');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Improved guide\n');
    expect(fs.readFileSync(unrelated, 'utf8')).toBe('User work in progress\n');
  });

  it('bases a selected candidate on the user’s uncommitted edits to that same file', async () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'User draft\n');
    const service = new SelfImprovementService(root, model([
      '{"files":["docs/guide.md"]}',
      '{"edits":[{"path":"docs/guide.md","content":"User draft\\nImproved section\\n"}]}',
    ]), undefined, autoApproval());
    const run = await finished(service, (await service.start('Add a section to the guide')).id);
    expect(run.state, run.error ?? run.stage).toBe('completed');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('User draft\nImproved section\n');
  });

  it('rejects a model path outside its selected source files', async () => {
    const root = fixture();
    const service = new SelfImprovementService(root, model(['{"files":["../private.txt"]}']));
    const started = await service.start('Modify private files');
    const run = await finished(service, started.id);
    expect(run.state).toBe('failed');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Original guide\n');
  });

  it('repairs a failed focused check using its output', async () => {
    const root = fixture();
    const service = new SelfImprovementService(root, model([
      '{"files":["docs/guide.md"]}',
      '{"edits":[{"path":"docs/guide.md","content":"Bad whitespace  \\n"}]}',
      '{"edits":[{"path":"docs/guide.md","content":"Repaired guide\\n"}]}',
    ]), undefined, autoApproval());
    const started = await service.start('Improve guide safely');
    const run = await finished(service, started.id);
    expect(run.state).toBe('completed');
    expect(run.checks[0]?.exit_code).not.toBe(0);
    expect(run.checks.at(-1)?.exit_code).toBe(0);
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Repaired guide\n');
  });

  it('can roll back the first edit if repair metadata was saved before the repair write', async () => {
    const root = fixture();
    const service = new SelfImprovementService(root, model([
      '{"files":["docs/guide.md"]}',
      '{"edits":[{"path":"docs/guide.md","content":"Bad whitespace  \\n"}]}',
      '{"edits":[{"path":"docs/guide.md","content":"Repaired guide\\n"}]}',
    ]), undefined, autoApproval());
    const run = await finished(service, (await service.start('Repair guide')).id);
    expect(run.state).toBe('completed');
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'Bad whitespace  \n');
    const restarted = new SelfImprovementService(root, model([]));
    expect((await restarted.rollback(run.id)).state).toBe('rolled_back');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Original guide\n');
  });

  it('keeps failed candidate edits isolated and leaves TJ source untouched', async () => {
    const root = fixture();
    const service = new SelfImprovementService(root, model([
      '{"files":["docs/guide.md"]}',
      '{"edits":[{"path":"docs/guide.md","content":"Bad whitespace  \\n"}]}',
      '{"edits":[{"path":"docs/guide.md","content":"Still bad  \\n"}]}',
    ]));
    const run = await finished(service, (await service.start('Improve guide safely')).id);
    expect(run.state).toBe('failed');
    expect(run.checks).toHaveLength(2);
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Original guide\n');
  });

  it('waits for explicit deployment approval after candidate checks pass', async () => {
    const root = fixture();
    let decide!: (value: { status: string }) => void;
    const approval = {
      request: (request: { action: string }) => ({ id: request.action === 'self_improvement_deploy' ? 'deploy-approval' : 'unexpected-approval' }),
      waitFor: () => new Promise((resolve) => { decide = resolve; }),
    } as unknown as ApprovalService;
    const service = new SelfImprovementService(root, model([
      '{"files":["docs/guide.md"]}',
      '{"edits":[{"path":"docs/guide.md","content":"Approved guide\\n"}]}',
    ]), undefined, approval);
    const started = await service.start('Improve guide safely');
    for (let i = 0; i < 100 && service.get(started.id)?.state !== 'awaiting_deployment_approval'; i++) await new Promise((resolve) => setTimeout(resolve, 25));
    expect(service.get(started.id)?.state).toBe('awaiting_deployment_approval');
    expect(service.get(started.id)?.approval_id).toBe('deploy-approval');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Original guide\n');
    decide({ status: 'approved' });
    const run = await finished(service, started.id);
    expect(run.state).toBe('completed');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Approved guide\n');
  });

  it('reattaches deployment approval after a service restart', async () => {
    const root = fixture();
    const decisions: Array<(value: { status: string }) => void> = [];
    const approval = {
      request: () => ({ id: 'persisted-deploy-approval' }),
      waitFor: () => new Promise<{ status: string }>((resolve) => { decisions.push(resolve); }),
    } as unknown as ApprovalService;
    const service = new SelfImprovementService(root, model([
      '{"files":["docs/guide.md"]}',
      '{"edits":[{"path":"docs/guide.md","content":"Restart-safe guide\\n"}]}',
    ]), undefined, approval);
    const started = await service.start('Improve the guide');
    for (let i = 0; i < 100 && service.get(started.id)?.state !== 'awaiting_deployment_approval'; i++) await new Promise((resolve) => setTimeout(resolve, 25));
    expect(service.get(started.id)?.state).toBe('awaiting_deployment_approval');
    const restarted = new SelfImprovementService(root, model([]), undefined, approval);
    expect(restarted.get(started.id)?.state).toBe('awaiting_deployment_approval');
    expect(decisions).toHaveLength(2);
    decisions[1]!({ status: 'approved' });
    const run = await finished(restarted, started.id);
    expect(run.state).toBe('completed');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Restart-safe guide\n');
  });

  it('does not deploy a verified candidate when deployment approval is denied', async () => {
    const root = fixture();
    const service = new SelfImprovementService(root, model([
      '{"files":["docs/guide.md"]}',
      '{"edits":[{"path":"docs/guide.md","content":"Rejected guide\\n"}]}',
    ]), undefined, autoApproval('denied'));
    const run = await finished(service, (await service.start('Improve guide')).id);
    expect(run.state).toBe('failed');
    expect(run.stage).toContain('Deployment declined');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Original guide\n');
  });

  it('does not overwrite a source file changed by the user while approval is pending', async () => {
    const root = fixture();
    let decide!: (value: { status: string }) => void;
    const approval = {
      request: () => ({ id: 'race-check-approval' }),
      waitFor: () => new Promise((resolve) => { decide = resolve; }),
    } as unknown as ApprovalService;
    const service = new SelfImprovementService(root, model([
      '{"files":["docs/guide.md"]}',
      '{"edits":[{"path":"docs/guide.md","content":"Candidate guide\\n"}]}',
    ]), undefined, approval);
    const started = await service.start('Improve the guide');
    for (let i = 0; i < 100 && service.get(started.id)?.state !== 'awaiting_deployment_approval'; i++) await new Promise((resolve) => setTimeout(resolve, 25));
    expect(service.get(started.id)?.state).toBe('awaiting_deployment_approval');
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'User edit\n');
    decide({ status: 'approved' });
    const run = await finished(service, started.id);
    expect(run.state).toBe('failed');
    expect(run.error).toContain('Source changed while awaiting approval');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('User edit\n');
  });

  it('restores an interrupted deployment after restart when files match the saved candidate', () => {
    const root = fixture();
    const dataDir = path.join(root, '.tj-data');
    const id = 'interrupted-deployment';
    const candidate = path.join(dataDir, 'self-improvement', 'candidates', id);
    fs.mkdirSync(candidate, { recursive: true });
    const original = 'Original guide\n';
    const deployed = 'Partially deployed guide\n';
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), deployed);
    const afterHash = crypto.createHash('sha256').update(deployed).digest('hex');
    const run = {
      id, prompt: 'Improve guide', state: 'deploying', stage: 'Applying approved candidate', files: ['docs/guide.md'], checks: [],
      diff: '', error: null, model_id: null, candidate_path: candidate, approval_id: 'approved',
      created_at: new Date().toISOString(), finished_at: null,
    };
    const statePath = path.join(dataDir, 'self-improvement', 'runs.json');
    fs.writeFileSync(statePath, JSON.stringify({
      runs: [run],
      snapshots: [[id, [['docs/guide.md', { before: original, afterHash }]]]],
    }));
    const restarted = new SelfImprovementService(root, model([]), dataDir);
    expect(restarted.get(id)?.state).toBe('failed');
    expect(restarted.get(id)?.stage).toContain('restored');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe(original);
    expect(fs.existsSync(candidate)).toBe(false);
  });

  it('accepts a second prompt after a verified TJ edit', async () => {
    const root = fixture();
    const service = new SelfImprovementService(root, model([
      '{"files":["docs/guide.md"]}',
      '{"edits":[{"path":"docs/guide.md","content":"First guide\\n"}]}',
      '{"files":["docs/guide.md"]}',
      '{"edits":[{"path":"docs/guide.md","content":"Second guide\\n"}]}',
    ]), undefined, autoApproval());
    const first = await finished(service, (await service.start('Improve guide first')).id);
    expect(first.state).toBe('completed');
    const second = await finished(service, (await service.start('Improve guide again')).id);
    expect(second.state).toBe('completed');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Second guide\n');
    await service.rollback(second.id);
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('First guide\n');
  });
});
