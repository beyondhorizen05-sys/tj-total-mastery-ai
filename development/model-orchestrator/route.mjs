#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const task = value('--task');
const files = value('--files')?.split(',').map((x) => x.trim()).filter(Boolean) ?? [];
const classify = (description, scope) => {
  const text = `${description} ${scope.join(' ')}`.toLowerCase();
  if (/security|auth|credential|permission|architecture|migration|cross.system|regression|release|critical|tauri|rust/.test(text)) return 'architecture';
  if (/readme|documentation|docs\/|format|typo|small styling|simple test/.test(text)) return 'routine';
  if (/visual|theme|animation|scene|three\.js|design/.test(text)) return 'visual';
  return 'implementation';
};
const kind = value('--kind') ?? classify(task ?? '', files);
const override = value('--model');
const run = args.includes('--run');
if (!task || files.length === 0) {
  console.error('Usage: node route.mjs --kind architecture|implementation|routine --task "..." --files path[,path] [--model ID] [--run]');
  process.exit(2);
}
const policies = {
  architecture: { preferred: 'gpt-6-astra', fallback: 'gpt-6-sol', effort: 'high' },
  security: { preferred: 'gpt-6-astra', fallback: 'gpt-6-sol', effort: 'high' },
  regression: { preferred: 'gpt-6-astra', fallback: 'gpt-6-sol', effort: 'high' },
  implementation: { preferred: 'gpt-6.1-sol', fallback: 'gpt-6-sol', effort: 'medium' },
  visual: { preferred: 'gpt-6.1-sol', fallback: 'gpt-6-sol', effort: 'medium' },
  routine: { preferred: 'gpt-6-luna', fallback: 'gpt-6-sol', effort: 'low' },
};
const policy = policies[kind];
if (!policy) throw new Error(`Unknown task kind: ${kind}`);
// This host's desktop interface exposes these IDs. CLI execution remains the access check.
const exposed = new Set(['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']);
const selected = override ?? (exposed.has(policy.preferred) ? policy.preferred : policy.fallback);
if (!exposed.has(selected)) throw new Error(`Model ${selected} is not exposed on this host; availability cannot be verified.`);
const git = (params) => spawnSync('git', params, { cwd: root, encoding: 'utf8' });
if (git(['rev-parse', '--show-toplevel']).status !== 0) throw new Error('Project is not a Git checkout.');
const checked = files.map((file) => resolve(root, file));
if (checked.some((file) => !file.startsWith(root + '\\') && file !== root)) throw new Error('File scope escapes project root.');
const summary = { task, kind, files, preferred: policy.preferred, selected, effort: policy.effort, mode: run ? 'execution' : 'preview' };
console.log(JSON.stringify(summary, null, 2));
if (!run) process.exit(0);
if (git(['status', '--porcelain']).stdout.trim()) throw new Error('Shared checkout has changes. Commit or review them before launching an isolated task.');
const lock = resolve(root, '.git', 'tj-model-orchestrator.lock');
if (existsSync(lock)) throw new Error('Another model run is active.');
const fd = openSync(lock, 'wx');
const log = resolve(root, 'development/model-orchestrator/execution-log.md');
const prompt = `${task}\n\nWork only on these files: ${files.join(', ')}. Preserve existing behavior. Run focused validation. Report changed files, checks, and failures. Do not commit or push. This is a separate development session in an isolated worktree.`;
let observed = 'Unconfirmed';
let status = 'failed';
try {
  const child = spawn('codex', ['exec', '--worktree', '--model', selected, '-c', `model_reasoning_effort=${policy.effort}`, '--json', prompt], { cwd: root, shell: false, stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.setEncoding('utf8');
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      process.stdout.write(line + '\n');
      try {
        const event = JSON.parse(line);
        const reported = event?.model ?? event?.payload?.model ?? event?.turn?.model;
        if (typeof reported === 'string') observed = reported;
      } catch { /* Event may be plain CLI output. */ }
    }
  });
  const code = await new Promise((resolveCode) => child.on('close', resolveCode));
  status = code === 0 ? 'completed' : `failed (${code})`;
} finally {
  closeSync(fd);
  unlinkSync(lock);
  const date = new Date().toISOString().slice(0, 10);
  appendFileSync(log, `| ${date} | ${task.replaceAll('|', '/').replaceAll('\n', ' ')} | ${policy.preferred} | ${observed} | ${policy.effort} | Isolated CLI ${status} | Review diff and focused checks before integration. |\n`);
}
