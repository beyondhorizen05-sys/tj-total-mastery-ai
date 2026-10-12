import { randomUUID } from 'node:crypto';
import type { ChatOptions, ChatResult, DiscoveredModel, EmbedResult, ProviderAdapter } from '../types.js';
import { ProviderError } from '../types.js';
import { textOf } from './openai-format.js';

/**
 * Deterministic TEST provider. NOT an AI. Only registered when TJ_ENABLE_TEST_PROVIDER=1
 * and is always displayed as "Test Provider (deterministic, not AI)".
 *
 * It exists so the full agent/workflow/tool pipeline can be exercised in automated tests
 * without network access or credentials. Behaviours are scripted via message content:
 *   - "TOOL:<name> <json>"   → emits a tool call
 *   - "FAIL:<kind>"           → throws a ProviderError of that kind (auth|rate_limit|unavailable)
 *   - otherwise               → echoes a short deterministic reply (streamed if requested)
 * It can also be put into a global failure mode via TestProviderControl for provider-failover tests.
 */
export const TestProviderControl = { failKind: null as null | 'auth' | 'rate_limit' | 'unavailable', failCount: 0 };

export class TestProviderAdapter implements ProviderAdapter {
  readonly kind = 'test';
  async testConnection() { return { ok: true, latency_ms: 1, detail: 'deterministic test provider (not an AI)' }; }
  async listModels(): Promise<DiscoveredModel[]> {
    return [
      { id: 'tj-test-echo', display_name: 'Test Echo (deterministic, not AI)', context_length: 32000, supports_tools: true, supports_vision: false },
      { id: 'tj-test-planner', display_name: 'Test Planner (deterministic, not AI)', context_length: 32000, supports_tools: true, supports_vision: false },
    ];
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const t = performance.now();
    if (TestProviderControl.failKind && TestProviderControl.failCount !== 0) {
      if (TestProviderControl.failCount > 0) TestProviderControl.failCount--;
      throw new ProviderError(`Simulated ${TestProviderControl.failKind} failure`, TestProviderControl.failKind);
    }
    const last = [...opts.messages].reverse().find((m) => m.role === 'user' || m.role === 'tool');
    const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user');
    const prompt = last ? textOf(last) : '';
    const userText = lastUser ? textOf(lastUser) : '';

    const fail = userText.match(/FAIL:(auth|rate_limit|unavailable)/);
    if (fail && last?.role === 'user') throw new ProviderError(`Simulated ${fail[1]} failure`, fail[1] as any);

    const toolReq = userText.match(/TOOL:([a-z0-9_.-]+)\s*(\{[\s\S]*\})?/i);
    if (toolReq && last?.role === 'user' && opts.tools?.some((tl) => tl.name === toolReq[1])) {
      let args: Record<string, unknown> = {};
      try { args = toolReq[2] ? JSON.parse(toolReq[2]) : {}; } catch {}
      return { text: '', tool_calls: [{ id: randomUUID(), name: toolReq[1], arguments: args }], finish_reason: 'tool_calls', usage: { tokens_in: 10, tokens_out: 5 }, latency_ms: Math.round(performance.now() - t), raw_model: opts.model };
    }

    let reply: string;
    if (opts.json) reply = this.jsonReply(opts, userText);
    else if (last?.role === 'tool') reply = `Tool result received: ${prompt.slice(0, 200)}`;
    else reply = `[test-echo] ${userText.slice(0, 300)}`;

    if (opts.onDelta) for (const chunk of reply.match(/.{1,12}/gs) ?? []) opts.onDelta(chunk);
    return { text: reply, tool_calls: [], finish_reason: 'stop', usage: { tokens_in: Math.ceil(prompt.length / 4), tokens_out: Math.ceil(reply.length / 4) }, latency_ms: Math.round(performance.now() - t), raw_model: opts.model };
  }

  private jsonReply(opts: ChatOptions, userText: string): string {
    const sys = opts.messages.filter((m) => m.role === 'system').map(textOf).join('\n');
    if (/intent classifier/i.test(sys)) {
      const complex = /build|research|create a team|deploy|prototype|plan/i.test(userText) && userText.length > 40;
      return JSON.stringify({ intent: complex ? 'goal' : 'chat', complexity: complex ? 'high' : 'low', domains: complex ? ['research', 'development'] : ['general'], needs_tools: complex, summary: userText.slice(0, 80) });
    }
    if (/planner/i.test(sys)) {
      if (userText.includes('TJ_ACCEPTANCE_E2E_RESEARCH_BUILD_TEST')) {
        const packageJson = JSON.stringify({ name: 'tj-project-tracker-prototype', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2);
        const trackerModule = [
          "import fs from 'node:fs';",
          "import path from 'node:path';",
          "import { randomUUID } from 'node:crypto';",
          'export function createTaskStore(filePath) {',
          '  const file = path.resolve(filePath);',
          "  const load = () => { if (!fs.existsSync(file)) return []; const data = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(data)) throw new Error('Task store must be a JSON array.'); return data; };",
          "  const save = (tasks) => { fs.writeFileSync(file, JSON.stringify(tasks, null, 2) + '\\n', 'utf8'); };",
          "  return { list: load, add(title) { const text = String(title ?? '').trim(); if (!text) throw new Error('Task title is required.'); const task = { id: randomUUID(), title: text, completed: false, createdAt: new Date().toISOString() }; save([...load(), task]); return task; }, complete(id) { const tasks = load(); const task = tasks.find((item) => item.id === id); if (!task) throw new Error('Task not found: ' + id); task.completed = true; task.completedAt = new Date().toISOString(); save(tasks); return task; } };",
          '}',
          '',
        ].join('\n');
        const cli = [
          "import path from 'node:path';",
          "import { createTaskStore } from './tracker.mjs';",
          "const store = createTaskStore(path.join(process.cwd(), 'tasks.json'));",
          'const [command, ...args] = process.argv.slice(2);',
          'try {',
          "  if (command === 'add') { const task = store.add(args.join(' ')); console.log('Added: ' + task.title + ' (' + task.id + ')'); }",
          "  else if (command === 'list') { const tasks = store.list(); console.log(tasks.length ? tasks.map((task) => (task.completed ? '[x] ' : '[ ] ') + task.title).join('\\n') : 'No tasks yet.'); }",
          "  else if (command === 'complete') { const task = store.complete(args[0]); console.log('Completed: ' + task.title); }",
          "  else throw new Error('Usage: node index.mjs add <title> | list | complete <id>');",
          "} catch (error) { console.error(error.message); process.exitCode = 1; }",
          '',
        ].join('\n');
        const testFile = [
          "import test from 'node:test';",
          "import assert from 'node:assert/strict';",
          "import fs from 'node:fs';",
          "import os from 'node:os';",
          "import path from 'node:path';",
          "import { spawnSync } from 'node:child_process';",
          "import { fileURLToPath } from 'node:url';",
          "import { createTaskStore } from './tracker.mjs';",
          "test('creates, persists, lists, and completes project tasks', () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-tracker-test-')); try { const file = path.join(dir, 'tasks.json'); const store = createTaskStore(file); const task = store.add('Prepare release plan'); assert.equal(task.completed, false); assert.deepEqual(createTaskStore(file).list().map((item) => item.title), ['Prepare release plan']); assert.equal(createTaskStore(file).complete(task.id).completed, true); assert.equal(createTaskStore(file).list()[0].completed, true); } finally { fs.rmSync(dir, { recursive: true, force: true }); } });",
          "test('rejects blank task titles and unknown task IDs', () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-tracker-validation-')); try { const store = createTaskStore(path.join(dir, 'tasks.json')); assert.throws(() => store.add('   '), /title is required/i); assert.throws(() => store.complete('missing'), /task not found/i); } finally { fs.rmSync(dir, { recursive: true, force: true }); } });",
          "test('CLI smoke test adds and lists a task', () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-tracker-cli-')); try { const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.mjs'); const add = spawnSync(process.execPath, [cli, 'add', 'Release prototype'], { cwd: dir, encoding: 'utf8' }); assert.equal(add.status, 0, add.stderr); assert.match(add.stdout, /Added: Release prototype/); const list = spawnSync(process.execPath, [cli, 'list'], { cwd: dir, encoding: 'utf8' }); assert.equal(list.status, 0, list.stderr); assert.match(list.stdout, /Release prototype/); } finally { fs.rmSync(dir, { recursive: true, force: true }); } });",
          '',
        ].join('\n');
        const tool = (name: string, args: Record<string, unknown>) => `TOOL:${name} ${JSON.stringify(args)}`;
        return JSON.stringify({
          objective: userText.slice(0, 180), success_criteria: ['Three architecture approaches have source evidence', 'A working project task tracker can add, list, and complete tasks', 'Automated tests pass and smoke commands execute'], assumptions: ['Test-only deterministic provider and mocked Tavily response'], constraints: ['Use only the isolated project directory'], risks: ['This fixture does not measure live AI quality'], rollback: 'Remove the isolated test project',
          tasks: [
            { id: 'research', title: 'Research three project tracker approaches', role: 'Researcher', description: tool('web_search', { query: 'Compare local-first JSON, client-server relational database, and event-sourced approaches for a personal project management app', max_results: 3 }), depends_on: [], tools: ['web_search'], risk: 'low' },
            { id: 'design', title: 'Choose the strongest prototype architecture', role: 'Analyst', description: 'Compare the three retrieved approaches. Choose local-first JSON storage for this small single-user prototype because it needs no server or external database; state its trade-offs and future migration path.', depends_on: ['research'], tools: [], risk: 'low' },
            { id: 'package', title: 'Create the package manifest', role: 'Developer', description: tool('fs_write', { path: 'package.json', content: packageJson }), depends_on: ['design'], tools: ['fs_write'], risk: 'medium' },
            { id: 'tracker', title: 'Implement persistent task operations', role: 'Developer', description: tool('fs_write', { path: 'tracker.mjs', content: trackerModule }), depends_on: ['package'], tools: ['fs_write'], risk: 'medium' },
            { id: 'cli', title: 'Build the project tracker command line', role: 'Developer', description: tool('fs_write', { path: 'index.mjs', content: cli }), depends_on: ['tracker'], tools: ['fs_write'], risk: 'medium' },
            { id: 'test-file', title: 'Write task tracker tests', role: 'QA Engineer', description: tool('fs_write', { path: 'tracker.test.mjs', content: testFile }), depends_on: ['cli'], tools: ['fs_write'], risk: 'medium' },
            { id: 'test', title: 'Test the tracker and smoke-check its commands', role: 'QA Engineer', description: tool('shell_exec', { command: 'npm test; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node index.mjs add "Release prototype"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node index.mjs list', timeout_s: 30 }), depends_on: ['test-file'], tools: ['shell_exec'], risk: 'medium' },
          ],
        });
      }
      return JSON.stringify({
        objective: userText.slice(0, 120), success_criteria: ['Prototype files exist', 'Tests pass'], assumptions: ['Local tools available'], constraints: ['Sandboxed project directory'],
        risks: ['Scope creep'], rollback: 'Delete generated project directory',
        tasks: [
          { id: 't1', title: 'Research approaches', role: 'Researcher', description: 'Compare approaches and record evidence', depends_on: [], tools: ['web_search', 'memory_search'] },
          { id: 't2', title: 'Decide architecture', role: 'Analyst', description: 'Choose strongest architecture with rationale', depends_on: ['t1'], tools: [] },
          { id: 't3', title: 'Build prototype', role: 'Developer', description: 'Write a minimal working prototype', depends_on: ['t2'], tools: ['fs_write', 'fs_read', 'shell_exec'] },
          { id: 't4', title: 'Test prototype', role: 'QA Engineer', description: 'Run and verify the prototype', depends_on: ['t3'], tools: ['shell_exec', 'fs_read'] },
        ],
      });
    }
    if (/critic|verifier/i.test(sys)) return JSON.stringify({ verdict: 'pass', confidence: 0.8, issues: [], suggestions: [] });
    return JSON.stringify({ result: userText.slice(0, 100) });
  }

  async embed(texts: string[]): Promise<EmbedResult> {
    // deterministic bag-of-chars hash embedding (64 dims) — enough to test vector plumbing
    const vectors = texts.map((tx) => {
      const v = new Array(64).fill(0);
      for (let i = 0; i < tx.length; i++) v[(tx.charCodeAt(i) * 31 + i) % 64] += 1;
      const n = Math.hypot(...v) || 1;
      return v.map((x) => x / n);
    });
    return { vectors, model: 'tj-test-embed', tokens: texts.join('').length / 4 };
  }
  embeddingModel() { return 'tj-test-embed'; }
}
