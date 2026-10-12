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
import { Orchestrator, canAttemptBoundedRepair, targetsTjSource } from '../src/orchestrator/orchestrator.js';
import { scheduleRows } from '../src/orchestrator/scheduler.js';
import { assessGoalEvidence, snapshotProjectFiles } from '../src/orchestrator/evidence.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { PermissionEngine } from '../src/security/permissions.js';
import { ApprovalService } from '../src/security/approvals.js';
import { Audit } from '../src/security/audit.js';
import { fsTools } from '../src/tools/builtin/fs.js';
import { Sandbox } from '../src/tools/sandbox.js';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_TJ_PERSONA, type Agent } from '@tj/schemas';
import { REPO_ROOT } from '../src/config.js';

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
    const tools = new ToolRegistry(permissions, approvals, bus, audit);
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
    try {
      db.close();
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('allows one repair for a local coding/test failure but never retries permission or provider blockers', () => {
    expect(canAttemptBoundedRepair('Implement connector flow', 'Developer', 'TypeScript test failed: expected true')).toBe(true);
    expect(canAttemptBoundedRepair('Fix parser', 'Debugger', 'Permission denied for fs_write')).toBe(false);
    expect(canAttemptBoundedRepair('Build provider adapter', 'Developer', 'Provider 503 unavailable')).toBe(false);
    expect(canAttemptBoundedRepair('Send a calendar invite', 'Developer', 'Request failed')).toBe(false);
  });

  it('routes only explicit TJ source goals to the repository root', () => {
    expect(targetsTjSource('TJ_ACCEPTANCE_E2E_RESEARCH_BUILD_TEST: research and build a small project tracker')).toBe(false);
    expect(targetsTjSource('Inspect and improve TJ itself')).toBe(true);
    expect(targetsTjSource('Fix a bug in TJ source code')).toBe(true);
  });

  it('builds a GitHub-first plan for a supplied public repository without requiring web-search credentials', () => {
    const plan = cognitive.fallbackPlan('Inspect and integrate https://github.com/obra/superpowers');
    expect(plan.tasks[0].tools).toContain('github_inspect_repository');
    expect(plan.tasks[0].tools).not.toContain('web_search');
    expect(plan.tasks[0].description).toContain('Do not require web_search credentials');
  });

  it('uses the actual TJ source root for TJ repository goals instead of an empty scratch project', () => {
    const goal = 'Inspect TJ platform repository source code and diagnose the repeated task failure';
    const plan: Plan = {
      objective: goal, success_criteria: [], assumptions: [], constraints: [], risks: [], rollback: '',
      tasks: [{ id: 'inspect', title: 'Inspect TJ Platform Repository for security surface area', role: 'Researcher', description: 'Inspect TJ repository and source files', depends_on: [] }],
    };
    const prepared = orchestrator.prepare(goal, plan);
    expect(path.resolve(prepared.project.root_path)).toBe(path.resolve(REPO_ROOT));
  });

  it('recovers a TJ repository task from the real repo root after its scratch-folder failure', async () => {
    const goal = 'Inspect TJ platform repository source code';
    const plan: Plan = {
      objective: goal, success_criteria: [], assumptions: [], constraints: [], risks: [], rollback: '',
      tasks: [{ id: 'inspect', title: 'Inspect TJ Platform Repository for security surface area', role: 'Researcher', description: 'Inspect the TJ repository source files', depends_on: [] }],
    };
    const prepared = orchestrator.prepare(goal, plan);
    const emptyScratch = path.join(testDir, 'projects', 'empty-scratch'); fs.mkdirSync(emptyScratch, { recursive: true });
    ws.setProjectRoot(prepared.project.id, emptyScratch);
    tasks.setStatus(prepared.tasks[0].task.id, 'failed', { error: 'fs_read: File not found in empty scratch project; web_search: NEEDS_API_KEY: no search provider configured.' });
    const run = vi.spyOn(runtime, 'run').mockImplementation(async (input) => ({ ok: true, output: `Read source from ${input.project_root}`, steps: 1, tool_calls: [], artifacts: [], tokens_in: 0, tokens_out: 0, cost_usd: 0, model_id: 'test' }));
    const result = await orchestrator.recoverTask(prepared.tasks[0].task.id);
    expect(result.recovered).toBe(true);
    expect(run.mock.calls[0][0].project_root).toBe(REPO_ROOT);
  });

  it('diagnoses a local coding failure and completes one verified repair attempt', async () => {
    const goal = 'Implement a small software feature';
    const plan: Plan = {
      objective: goal, success_criteria: [], assumptions: [], constraints: [], risks: [], rollback: 'Restore project backup',
      tasks: [{ id: 'implement', title: 'Implement feature', role: 'Developer', description: 'Create feature.ts', depends_on: [] }],
    };
    const prepared = orchestrator.prepare(goal, plan);
    const run = vi.spyOn(runtime, 'run').mockImplementation(async (input) => {
      if (run.mock.calls.length === 1) return { ok: false, output: 'Compiler reported an invalid export.', error: 'TypeScript compile failed: invalid export', steps: 1, tool_calls: [], artifacts: [], tokens_in: 0, tokens_out: 0, cost_usd: 0, model_id: 'test' };
      fs.writeFileSync(path.join(input.project_root!, 'feature.ts'), 'export const featureReady = true;\n');
      return { ok: true, output: 'Fixed the export and verified the file.', steps: 2, tool_calls: [], artifacts: [], tokens_in: 0, tokens_out: 0, cost_usd: 0, model_id: 'test' };
    });
    vi.spyOn(cognitive, 'critique').mockResolvedValue({ verdict: 'pass', confidence: 1, issues: [], suggestions: [], model_id: 'test' });

    const result = await orchestrator.execute(prepared, goal, plan);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0].instruction).toContain('BOUNDED SELF-REPAIR');
    expect(run.mock.calls[1][0].instruction).toContain('TypeScript compile failed: invalid export');
    expect(result.status).toBe('completed');
    expect(result.task_results[0].output).toContain('Recovered after one bounded repair attempt');
    expect(tasks.get(prepared.tasks[0].task.id)?.status).toBe('completed');
  });

  it('hands completed dependency evidence directly from one agent to the next', async () => {
    const goal = 'Research and summarize an approach';
    const plan: Plan = {
      objective: goal, success_criteria: [], assumptions: [], constraints: [], risks: [], rollback: '',
      tasks: [
        { id: 'research', title: 'Research options', role: 'Researcher', description: 'Find options', depends_on: [] },
        { id: 'summarize', title: 'Summarize findings', role: 'Analyst', description: 'Synthesize the findings', depends_on: ['research'] },
      ],
    };
    const prepared = orchestrator.prepare(goal, plan);
    vi.spyOn(runtime, 'run').mockImplementation(async (input) => ({ ok: true, output: input.task_id === prepared.tasks[0].task.id ? 'Verified source evidence' : 'Summary complete', steps: 1, tool_calls: [], artifacts: [], tokens_in: 0, tokens_out: 0, cost_usd: 0, model_id: 'test' }));
    vi.spyOn(cognitive, 'critique').mockResolvedValue({ verdict: 'pass', confidence: 1, issues: [], suggestions: [], model_id: 'test' });

    await orchestrator.execute(prepared, goal, plan);
    const handoff = agents.messages({ project_id: prepared.project.id }).find((message) => message.kind === 'evidence');
    expect(handoff).toMatchObject({ from_agent_id: prepared.tasks[0].agent.id, to_agent_id: prepared.tasks[1].agent.id, task_id: prepared.tasks[1].task.id });
    expect(handoff?.content).toContain('Verified source evidence');
  });

  it('does not exceed one automatic repair when the repair attempt also fails', async () => {
    const goal = 'Implement a software component';
    const plan: Plan = {
      objective: goal, success_criteria: [], assumptions: [], constraints: [], risks: [], rollback: 'Restore project backup',
      tasks: [{ id: 'implement', title: 'Implement component', role: 'Developer', description: 'Create component.ts', depends_on: [] }],
    };
    const prepared = orchestrator.prepare(goal, plan);
    const run = vi.spyOn(runtime, 'run').mockResolvedValue({ ok: false, output: 'Still failing', error: 'Compile error', steps: 1, tool_calls: [], artifacts: [], tokens_in: 0, tokens_out: 0, cost_usd: 0, model_id: 'test' });
    const result = await orchestrator.execute(prepared, goal, plan);
    expect(run).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('failed');
    expect(result.task_results[0].error).toContain('bounded repair also failed');
  });

  it('recovers a blocked task after first repairing its failed prerequisite', async () => {
    const goal = 'Implement a software feature';
    const plan: Plan = {
      objective: goal, success_criteria: [], assumptions: [], constraints: [], risks: [], rollback: '',
      tasks: [
        { id: 'root', title: 'Implement base module', role: 'Developer', description: 'Create base module', depends_on: [] },
        { id: 'child', title: 'Test feature', role: 'QA Engineer', description: 'Test feature', depends_on: ['root'] },
      ],
    };
    const prepared = orchestrator.prepare(goal, plan);
    tasks.setStatus(prepared.tasks[0].task.id, 'failed', { error: 'TypeScript compile failed' });
    tasks.setStatus(prepared.tasks[1].task.id, 'blocked', { error: 'Dependency failed' });
    const recoveredOrder: string[] = [];
    vi.spyOn(runtime, 'run').mockImplementation(async (input) => {
      recoveredOrder.push(input.task_id!);
      return { ok: true, output: `Recovered ${input.task_id}`, steps: 1, tool_calls: [], artifacts: [], tokens_in: 0, tokens_out: 0, cost_usd: 0, model_id: 'test' };
    });

    const result = await orchestrator.recoverTask(prepared.tasks[1].task.id);
    expect(result.recovered).toBe(true);
    expect(result.attempted).toEqual(['Implement base module', 'Test feature']);
    expect(recoveredOrder).toEqual([prepared.tasks[0].task.id, prepared.tasks[1].task.id]);
    expect(tasks.get(prepared.tasks[0].task.id)?.status).toBe('completed');
    expect(tasks.get(prepared.tasks[1].task.id)?.status).toBe('completed');
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

  it('adds the read-only GitHub inspection tool to an existing network-approved developer agent', () => {
    const project = ws.createProject('GitHub tool assignment');
    const agent = agents.create({ workspace_id: 'default', project_id: project.id, role: 'Developer' });
    agents.update(agent.id, { tools: agent.tools.filter((tool) => tool !== 'github_inspect_repository') });
    const plan: Plan = { objective: 'Inspect GitHub', success_criteria: [], assumptions: [], constraints: [], risks: [], rollback: '', tasks: [{ id: 'inspect', title: 'Implement GitHub integration', role: 'Developer', description: 'Inspect first', depends_on: [] }] };
    const prepared = orchestrator.prepare('Inspect GitHub', plan, { project_id: project.id });
    expect(prepared.tasks[0].agent.tools).toContain('github_inspect_repository');
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
    expect(tasks.get(prepared.tasks[1].task.id)?.error).toContain('Research');
    expect(tasks.get(prepared.tasks[1].task.id)?.error).toContain('provider went offline');
    expect(tasks.get(prepared.tasks[1].task.id)?.error).toContain('Use Recover on this task');
  });

  it('explains historical generic blocked-task records using their failed dependency', () => {
    const plan = cognitive.fallbackPlan('Build a prototype app');
    plan.tasks = [
      { id: 'first', title: 'Research', role: 'Researcher', description: 'Find approach', depends_on: [] },
      { id: 'second', title: 'Build', role: 'Developer', description: 'Build after research', depends_on: ['first'] },
    ];
    const prepared = orchestrator.prepare('Build a prototype app', plan);
    tasks.setStatus(prepared.tasks[0].task.id, 'completed');
    tasks.setStatus(prepared.tasks[1].task.id, 'blocked', { error: 'A dependency failed' });
    expect(tasks.get(prepared.tasks[1].task.id)?.error).toContain('Research');
    expect(tasks.get(prepared.tasks[1].task.id)?.error).toContain('stale status');
    expect(tasks.get(prepared.tasks[1].task.id)?.error).toContain('Start a new goal run');
  });

  it('persists a partial goal and clears its active controller when model verification fails', async () => {
    const plan = cognitive.fallbackPlan('Prepare a greeting');
    plan.tasks = [{ id: 'draft', title: 'Draft greeting', role: 'Writer', description: 'Write a greeting', depends_on: [] }];
    const prepared = orchestrator.prepare('Prepare a greeting', plan);
    vi.spyOn(runtime, 'run').mockResolvedValue({ ok: true, output: 'Hello from TJ.', steps: 1, tool_calls: [], artifacts: [], tokens_in: 1, tokens_out: 2, cost_usd: 0, model_id: 'test/model' });
    vi.spyOn(cognitive, 'critique').mockRejectedValue(new Error('verifier offline'));
    const result = await orchestrator.execute(prepared, 'Prepare a greeting', plan);
    expect(result.status).toBe('partial');
    expect(result.verdict).toMatchObject({ verdict: 'revise', confidence: 0, verified_by: null });
    expect(result.verdict?.issues).toContain('Verification did not complete: verifier offline');
    expect(orchestrator.getPlan(result.plan_id)?.status).toBe('partial');
    expect(orchestrator.activeRuns()).toBe(0);
  });
});
