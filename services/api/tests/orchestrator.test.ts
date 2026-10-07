import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../src/db/database.js';
import { EventBus } from '../src/core/event-bus.js';
import { Logger } from '../src/core/logger.js';
import { Vault } from '../src/security/vault.js';
import { SettingsRepo } from '../src/db/repo.js';
import { ModelRegistry } from '../src/models/registry.js';
import { ModelRouter } from '../src/models/router.js';
import { MemoryService } from '../src/memory/memory.js';
import { AgentService } from '../src/agents/service.js';
import { AgentRuntime } from '../src/agents/runtime.js';
import { TaskService } from '../src/tasks/service.js';
import { WorkspaceService } from '../src/core/workspace.js';
import { CognitiveEngine } from '../src/cognitive/engine.js';
import { Orchestrator } from '../src/orchestrator/orchestrator.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { PermissionEngine } from '../src/security/permissions.js';
import { ApprovalService } from '../src/security/approvals.js';
import { Audit } from '../src/security/audit.js';
import { fsTools } from '../src/tools/builtin/fs.js';
import { Sandbox } from '../src/tools/sandbox.js';
import fs from 'node:fs';
import path from 'node:path';

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

    runtime = new AgentRuntime(router, tools, agents, bus);
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
});
