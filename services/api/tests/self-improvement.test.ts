import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SelfImprovementService } from '../src/self-improvement/service.js';
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
  it('applies a verified prompt edit and safely rolls it back', async () => {
    const root = fixture();
    const service = new SelfImprovementService(root, model([
      '{"files":["docs/guide.md"]}',
      '{"edits":[{"path":"docs/guide.md","content":"Improved guide\\n"}]}',
    ]));
    const started = await service.start('Improve the TJ guide');
    const run = await finished(service, started.id);
    expect(run.state).toBe('completed');
    expect(run.diff).toContain('Improved guide');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Improved guide\n');
    const restarted = new SelfImprovementService(root, model([]));
    expect((await restarted.rollback(run.id)).state).toBe('rolled_back');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Original guide\n');
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
    ]));
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
    ]));
    const run = await finished(service, (await service.start('Repair guide')).id);
    expect(run.state).toBe('completed');
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'Bad whitespace  \n');
    const restarted = new SelfImprovementService(root, model([]));
    expect((await restarted.rollback(run.id)).state).toBe('rolled_back');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Original guide\n');
  });

  it('retains edits until rollback is explicitly approved after repair fails', async () => {
    const root = fixture();
    const service = new SelfImprovementService(root, model([
      '{"files":["docs/guide.md"]}',
      '{"edits":[{"path":"docs/guide.md","content":"Bad whitespace  \\n"}]}',
      '{"edits":[{"path":"docs/guide.md","content":"Still bad  \\n"}]}',
    ]));
    const run = await finished(service, (await service.start('Improve guide safely')).id);
    expect(run.state).toBe('awaiting_approval');
    expect(run.checks).toHaveLength(2);
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Still bad  \n');
    await expect(service.start('Another improvement')).rejects.toThrow('Review or approve rollback');
    expect((await service.rollback(run.id)).state).toBe('rolled_back');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Original guide\n');
  });

  it('requests approval and restores source only after approval is granted', async () => {
    const root = fixture();
    let decide!: (value: { status: string }) => void;
    const approval = {
      request: () => ({ id: 'rollback-approval' }),
      waitFor: () => new Promise((resolve) => { decide = resolve; }),
    } as unknown as ApprovalService;
    const service = new SelfImprovementService(root, model([
      '{"files":["docs/guide.md"]}',
      '{"edits":[{"path":"docs/guide.md","content":"Bad whitespace  \\n"}]}',
      '{"edits":[{"path":"docs/guide.md","content":"Still bad  \\n"}]}',
    ]), undefined, approval);
    const run = await finished(service, (await service.start('Improve guide safely')).id);
    expect(run.state).toBe('awaiting_approval');
    expect(run.approval_id).toBe('rollback-approval');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Still bad  \n');
    decide({ status: 'approved' });
    for (let i = 0; i < 20 && service.get(run.id)?.state !== 'rolled_back'; i++) await new Promise((resolve) => setTimeout(resolve, 25));
    expect(service.get(run.id)?.state).toBe('rolled_back');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Original guide\n');
  });

  it('accepts a second prompt after a verified TJ edit', async () => {
    const root = fixture();
    const service = new SelfImprovementService(root, model([
      '{"files":["docs/guide.md"]}',
      '{"edits":[{"path":"docs/guide.md","content":"First guide\\n"}]}',
      '{"files":["docs/guide.md"]}',
      '{"edits":[{"path":"docs/guide.md","content":"Second guide\\n"}]}',
    ]));
    const first = await finished(service, (await service.start('Improve guide first')).id);
    expect(first.state).toBe('completed');
    const second = await finished(service, (await service.start('Improve guide again')).id);
    expect(second.state).toBe('completed');
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('Second guide\n');
    await service.rollback(second.id);
    expect(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8')).toBe('First guide\n');
  });
});
