import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../src/db/database.js';
import { EventBus } from '../src/core/event-bus.js';
import { Logger } from '../src/core/logger.js';
import { Vault } from '../src/security/vault.js';
import { SettingsRepo } from '../src/db/repo.js';
import { ModelRegistry } from '../src/models/registry.js';
import { ModelRouter } from '../src/models/router.js';
import { MemoryService } from '../src/memory/memory.js';
import { AgentService } from '../src/agents/service.js';
import { AgentRuntime, isTestCommand } from '../src/agents/runtime.js';
import { TaskService } from '../src/tasks/service.js';
import { WorkspaceService } from '../src/core/workspace.js';
import { CognitiveEngine } from '../src/cognitive/engine.js';
import type { Plan } from '../src/cognitive/types.js';
import { Orchestrator } from '../src/orchestrator/orchestrator.js';
import { scheduleRows } from '../src/orchestrator/scheduler.js';
import { assessGoalEvidence, snapshotProjectFiles } from '../src/orchestrator/evidence.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { PermissionEngine } from '../src/security/permissions.js';
import { ApprovalService } from '../src/security/approvals.js';
import { Audit } from '../src/security/audit.js';
import { fsTools } from '../src/tools/builtin/fs.js';
import { shellTools } from '../src/tools/builtin/shell.js';
import { webTools } from '../src/tools/builtin/web.js';
import { Sandbox } from '../src/tools/sandbox.js';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_TJ_PERSONA, type Agent } from '@tj/schemas';

describe('Orchestrator End-to-End with Test Provider', () => {
  let db: Database;
  let vault: Vault;
  let bus: EventBus;
  let log: Logger;
  let settings: SettingsRepo;
  let registry: ModelRegistry;
  let router: ModelRouter;
  let memory: MemoryService;
  let agents: AgentService;
  let runtime: AgentRuntime;
  let tools: ToolRegistry;
  let tasks: TaskService;
  let ws: WorkspaceService;
  let cognitive: CognitiveEngine;
  let orchestrator: Orchestrator;
  const testDir = path.resolve('tests/tmp-orch');

  beforeEach(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    db = new Database(path.join(testDir, 'test.sqlite'));
    db.migrate();
    bus = new EventBus(db);
    log = new Logger('test');
    vault = new Vault(db, path.join(testDir, 'vault'));
    settings = new SettingsRepo(db);

    registry = new ModelRegistry(db, vault, bus, log, true);
    registry.bootstrapFromEnv();
    await registry.fetchModels('test');

    router = new ModelRouter(registry, settings, bus);
    memory = new MemoryService(db, bus, router);
    agents = new AgentService(db, bus);

    const audit = new Audit(db);
    const permissions = new PermissionEngine(db, audit, settings);
    const approvals = new ApprovalService(db, bus, audit, permissions);
    tools = new ToolRegistry(permissions, approvals, bus, audit);
    const sandbox = new Sandbox(() => [testDir]);
    for (const t of fsTools(sandbox, db, path.join(testDir, 'backups'))) {
      tools.register(t);
    }

    runtime = new AgentRuntime(router, tools, agents, bus, settings);
    tasks = new TaskService(db, bus);
    ws = new WorkspaceService(db, bus, path.join(testDir, 'projects'), testDir);
    cognitive = new CognitiveEngine(router);

    orchestrator = new Orchestrator(
      cognitive, agents, runtime, tasks, ws, memory, bus, db
    );

    // Default user/workspace
    db.run("INSERT OR IGNORE INTO users (id, display_name) VALUES ('user_default', 'User')");
    db.run("INSERT OR IGNORE INTO workspaces (id, name, owner_id, data_dir) VALUES ('default', 'Default', 'user_default', ?)", [testDir]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    try {
      db.close();
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('plans and prepares a project with multiple specialized tasks', async () => {
    const planRes = await cognitive.plan('Build a prototype service');
    expect(planRes.plan.tasks.length).toBeGreaterThan(0);

    const prepared = orchestrator.prepare('Build a prototype service', planRes.plan, {
      project_name: 'Test Prototype Project',
    });

    expect(prepared.project.id).toBeDefined();
    expect(prepared.tasks.length).toBe(planRes.plan.tasks.length);

    // Tasks should exist in database
    const dbTasks = tasks.list({ project_id: prepared.project.id });
    expect(dbTasks.length).toBe(planRes.plan.tasks.length);
  });

  it('uses the saved TJ presentation in specialist agent replies', () => {
    settings.set('tj_persona', { ...DEFAULT_TJ_PERSONA, embodiment: 'male', relationship: 'boyfriend', user_address: 'Jazib', warmth: 82 });
    const agent = agents.create({ workspace_id: 'default', name: 'Planner', role: 'Planner' });
    const prompt = (runtime as unknown as { systemPrompt: (agent: Agent, input: { project_root: null }) => string }).systemPrompt(agent, { project_root: null });
    expect(prompt).toContain('You are Planner, role: Planner');
    expect(prompt).toContain('TJ’s saved presentation');
    expect(prompt).toContain('chosen presentation is male');
    expect(prompt).toContain('boyfriend-style companion');
    expect(prompt).toContain('Address the user as Jazib');
    expect(prompt).toContain('warmth 82');
  });

  it('counts only actual successful test commands as software-goal evidence', () => {
    expect(isTestCommand('pnpm --filter @tj/api test')).toBe(true);
    expect(isTestCommand('python -m pytest tests')).toBe(true);
    expect(isTestCommand('echo test passed')).toBe(false);
    const goal = 'Build and test a prototype app';
    const plan = { tasks: [], success_criteria: ['Prototype works and tests pass'] } as unknown as Plan;
    const before = snapshotProjectFiles(testDir);
    const claim = assessGoalEvidence(goal, plan, testDir, before, [{ tool: 'shell_exec', task_title: 'Test prototype', summary: 'exit_code: 0', test_command: false }]);
    expect(claim.test_calls).toBe(0);
    expect(claim.gaps).toEqual(expect.arrayContaining([expect.stringMatching(/test command/i)]));
    const real = assessGoalEvidence(goal, plan, testDir, before, [{ tool: 'shell_exec', task_title: 'Any task', summary: 'exit_code: 0', test_command: true }]);
    expect(real.test_calls).toBe(1);
  });

  it('does not mark the project-app acceptance goal complete on model claims alone', async () => {
    const goal = 'TJ, research three good approaches for a personal project management app, decide the strongest architecture, create a team to build a small working prototype, test it and give me the result.';
    const planRes = await cognitive.plan(goal);
    const prepared = orchestrator.prepare(goal, planRes.plan);
    const result = await orchestrator.execute(prepared, goal, planRes.plan, { max_repairs: 0 });
    expect(result.status).toBe('partial');
    expect(result.evidence.changed_files).toEqual([]);
    expect(result.evidence.gaps).toEqual(expect.arrayContaining([
      expect.stringMatching(/project file/),
      expect.stringMatching(/source retrieval/),
      expect.stringMatching(/test command/),
    ]));
    expect(orchestrator.getPlan(result.plan_id)?.status).toBe('partial');
  });

  it('counts real project files, retrieved sources, and a successful test tool as evidence', () => {
    const root = path.join(testDir, 'evidence-project');
    fs.mkdirSync(root, { recursive: true });
    const before = snapshotProjectFiles(root);
    fs.writeFileSync(path.join(root, 'prototype.ts'), 'export const ready = true;\n');
    const plan = cognitive.fallbackPlan('Build and test a prototype app');
    const evidence = assessGoalEvidence('Research and build a prototype app, then test it', plan, root, before, [
      { tool: 'web_fetch', task_title: 'Research approaches', summary: 'Source: https://example.org/article' },
      { tool: 'shell_exec', task_title: 'Test prototype', summary: 'exit_code: 0', test_command: true },
    ]);
    expect(evidence.changed_files).toContain('prototype.ts');
    expect(evidence.source_calls).toBe(1);
    expect(evidence.test_calls).toBe(1);
    expect(evidence.gaps).toEqual([]);
  });

  it('keeps dependencies when a plan references a later task', async () => {
    const plan = cognitive.fallbackPlan('Build a prototype app');
    plan.tasks = [
      { id: 'second', title: 'Build', role: 'Developer', description: 'Build after research', depends_on: ['first'] },
      { id: 'first', title: 'Research', role: 'Researcher', description: 'Find approach', depends_on: [] },
    ];
    const prepared = orchestrator.prepare('Build a prototype app', plan);
    expect(tasks.dependencies(prepared.tasks[0].task.id)).toEqual([prepared.tasks[1].task.id]);
    const order: string[] = [];
    await scheduleRows(prepared.tasks, async (row) => { order.push(row.pt.id); tasks.setStatus(row.task.id, 'completed'); return true; }, tasks, new AbortController().signal, 2);
    expect(order).toEqual(['first', 'second']);
  });

  it('persists an execution exception as a failed task and blocks its dependent', async () => {
    const plan = cognitive.fallbackPlan('Build a prototype app');
    plan.tasks = [
      { id: 'first', title: 'Research', role: 'Researcher', description: 'Find approach', depends_on: [] },
      { id: 'second', title: 'Build', role: 'Developer', description: 'Build after research', depends_on: ['first'] },
    ];
    const prepared = orchestrator.prepare('Build a prototype app', plan);
    await scheduleRows(prepared.tasks, async () => { throw new Error('provider went offline'); }, tasks, new AbortController().signal, 2);
    expect(tasks.get(prepared.tasks[0].task.id)?.status).toBe('failed');
    expect(tasks.get(prepared.tasks[0].task.id)?.error).toContain('provider went offline');
    expect(tasks.get(prepared.tasks[1].task.id)?.status).toBe('blocked');
  });
  it('executes real local research, project creation, tests and evidence through the agent orchestration pipeline', async () => {
    // Fixture provider is NOT AI. Real tools, permissions, files, shell, task persistence and evidence run.
    settings.set('autonomy_level', 4); // Isolated, user-owned test workspace only.
    vault.put({ ref: 'connector:searxng:url', scope: 'connector', label: 'Local search fixture', value: 'http://127.0.0.1:8080' });
    vi.stubGlobal('fetch', vi.fn(async (url: URL | string) => {
      if (!String(url).startsWith('http://127.0.0.1:8080/search?')) throw new Error('Unexpected outbound network request');
      return new Response(JSON.stringify({ results: [
        { title: 'Node.js built-in test runner', url: 'https://nodejs.org/api/test.html', content: 'Dependency-free tests using node:test' },
      ] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    for (const tool of shellTools()) tools.register(tool);
    for (const tool of webTools(vault, db, (provider, key) => vault.get('connector:' + provider + ':' + key, 'fixture', 'research'))) tools.register(tool);

    const appTest = "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('prototype basic execution', () => assert.equal(2 + 2, 4));\n";
    const pkg = JSON.stringify({ name: 'tj-acceptance-fixture', version: '1.0.0', private: true, type: 'module', scripts: { test: 'node --test app.test.mjs' } });
    const task = (id: string, title: string, role: string, description: string, deps: string[]) =>
      ({ id, title, role, description, depends_on: deps });
    const plan: Plan = {
      objective: 'Create and test a tiny Node project using actual tools',
      success_criteria: ['Research the approach', 'Build an app prototype', 'Tests pass'],
      assumptions: ['Local fixture SearXNG responds with a linked source'],
      constraints: ['Only touch isolated test project workspace'], risks: ['Do not assert live provider acceptance'],
      rollback: 'Delete isolated test directory',
      tasks: [
        task('research', 'Research verified source', 'Researcher', 'TOOL:web_search {"query":"Node.js test runner","max_results":1}', []),
        task('choose', 'Decide architecture', 'Analyst', 'Choose Node.js built-in test runner from the preceding source', ['research']),
        task('code', 'Build prototype code', 'Developer', 'TOOL:fs_write ' + JSON.stringify({ path: 'app.test.mjs', content: appTest }), ['choose']),
        task('package', 'Build test manifest', 'Developer', 'TOOL:fs_write ' + JSON.stringify({ path: 'package.json', content: pkg }), ['code']),
        task('test', 'Test prototype app', 'QA Engineer', 'TOOL:shell_exec {"command":"npm test"}', ['package']),
      ],
    };
    const goal = 'Research a Node.js approach, build and test a working prototype app with real project files';
    const prepared = orchestrator.prepare(goal, plan, { project_name: 'Acceptance Fixture Prototype' });
    const done = await orchestrator.execute(prepared, goal, plan, { max_repairs: 0, concurrency: 3 });
    expect(done.status, done.summary).toBe('completed');
    expect(done.task_results).toHaveLength(5);
    expect(done.task_results.every((row) => row.status === 'completed')).toBe(true);
    expect(done.evidence.gaps).toEqual([]);
    expect(done.evidence.changed_files).toEqual(expect.arrayContaining(['app.test.mjs', 'package.json']));
    expect(done.evidence.source_calls).toBe(1);
    expect(done.evidence.test_calls).toBe(1);
    expect(fs.readFileSync(path.join(prepared.project.root_path, 'app.test.mjs'), 'utf8')).toBe(appTest);
    expect(fs.existsSync(path.join(prepared.project.root_path, 'package.json'))).toBe(true);
    expect(db.get<{ source_url: string }>('SELECT source_url FROM research_notes ORDER BY created_at DESC LIMIT 1')?.source_url)
      .toBe('https://nodejs.org/api/test.html');
    expect(db.get<{ count: number }>('SELECT COUNT(*) count FROM artifacts WHERE project_id=?', [prepared.project.id])?.count)
      .toBeGreaterThanOrEqual(2);
    expect(orchestrator.getPlan(done.plan_id)?.status).toBe('completed');
    expect(ws.getProject(prepared.project.id)?.status).toBe('completed');
  });

  it('rejects an unknown project rather than creating orphan plan records', () => {
    const plan = cognitive.fallbackPlan('Build a prototype');
    expect(() => orchestrator.prepare('Build a prototype', plan, { project_id: 'missing-project' }))
      .toThrow(/does not exist/);
    expect(orchestrator.listPlans()).toHaveLength(0);
  });

  it('marks plans failed and frees active controllers after an infrastructure exception', async () => {
    const plan: Plan = {
      objective: 'Verify failure cleanup', success_criteria: ['done'], assumptions: [], constraints: [],
      risks: [], rollback: 'none',
      tasks: [{ id:'a', title:'Decide architecture', role:'Analyst', description:'Choose approach', depends_on:[] }],
    };
    const prepared = orchestrator.prepare('Build a prototype and test failure cleanup', plan);
    const spy = vi.spyOn(cognitive, 'critique').mockRejectedValueOnce(new Error('verification unavailable'));
    try {
      await expect(orchestrator.execute(prepared, plan.objective, plan, { max_repairs: 0 }))
        .rejects.toThrow(/verification unavailable/);
      expect(orchestrator.getPlan(prepared.plan_id)?.status).toBe('failed');
      expect(orchestrator.activeRuns()).toBe(0);
    } finally { spy.mockRestore(); }
  });

});
