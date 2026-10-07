import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';

import type { TJConfig } from '../config.js';
import { REPO_ROOT } from '../config.js';
import { Database } from '../db/database.js';
import { SettingsRepo } from '../db/repo.js';
import { EventBus } from '../core/event-bus.js';
import { Logger } from '../core/logger.js';
import { WorkspaceService } from '../core/workspace.js';
import { Vault } from '../security/vault.js';
import { Audit } from '../security/audit.js';
import { PermissionEngine } from '../security/permissions.js';
import { ApprovalService } from '../security/approvals.js';
import { ModelRegistry } from '../models/registry.js';
import { ModelRouter } from '../models/router.js';
import { Sandbox } from '../tools/sandbox.js';
import { ToolRegistry } from '../tools/registry.js';
import { fsTools } from '../tools/builtin/fs.js';
import { shellTools } from '../tools/builtin/shell.js';
import { webTools } from '../tools/builtin/web.js';
import { memoryTools } from '../tools/builtin/memory-tools.js';
import { MemoryService } from '../memory/memory.js';
import { AgentService } from '../agents/service.js';
import { AgentRuntime } from '../agents/runtime.js';
import { TaskService } from '../tasks/service.js';
import { CognitiveEngine } from '../cognitive/engine.js';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { WorkflowEngine } from '../workflows/engine.js';
import { registerBuiltinStepExecutors } from '../workflows/executors.js';
import { AutomationScheduler } from '../workflows/automation-scheduler.js';
import { ConnectorService } from '../connectors/service.js';
import { HealthMonitor } from '../core/health.js';
import { CapabilityRegistry } from '../core/capabilities.js';

import { registerSystemRoutes } from './routes/system.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerWorkflowRoutes } from './routes/workflows.js';
import { registerConnectorRoutes } from './routes/connectors.js';
import { registerModelRoutes } from './routes/models.js';
import { registerSecurityRoutes } from './routes/security.js';
import { registerMemoryRoutes } from './routes/memory.js';

export async function createServer(config: TJConfig) {
  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });

  await app.register(cors, {
    origin: (origin, cb) => cb(null, true),
    credentials: true,
  });

  const db = new Database(config.dbPath);
  db.migrate();

  const bus = new EventBus(db);
  const log = new Logger('tj', config.logsDir);
  const settings = new SettingsRepo(db);
  const audit = new Audit(db);
  const vault = new Vault(db, config.vaultPath);
  const permissions = new PermissionEngine(db, audit, settings);
  const approvals = new ApprovalService(db, bus, audit, permissions);
  const ws = new WorkspaceService(db, bus, config.projectsDir, config.dataDir);

  const modelRegistry = new ModelRegistry(db, vault, bus, log, config.enableTestProvider);
  const router = new ModelRouter(modelRegistry, settings, bus);
  const memory = new MemoryService(db, bus, router);

  const sandbox = new Sandbox(() => [config.projectsDir, config.artifactsDir]);
  const tools = new ToolRegistry(permissions, approvals, bus, audit);
  for (const t of fsTools(sandbox, db, config.backupsDir)) tools.register(t);
  for (const t of shellTools()) tools.register(t);
  for (const t of memoryTools(memory)) tools.register(t);

  const connectors = new ConnectorService({ db, vault });
  for (const t of webTools(vault, db, (c, k) => vault.get(`connector:${c}:${k}`, 'web_tools', 'call'))) {
    tools.register(t);
  }

  const agentService = new AgentService(db, bus);
  const agentRuntime = new AgentRuntime(router, tools, agentService, bus);
  const taskService = new TaskService(db, bus);

  const cognitive = new CognitiveEngine(router);
  const orchestrator = new Orchestrator(
    cognitive, agentService, agentRuntime, taskService, ws, memory, bus, db
  );

  const workflowEngine = new WorkflowEngine(db, bus, () => 'default');
  registerBuiltinStepExecutors(workflowEngine, {
    tools, router, agentRuntime, agentService, connectors, approvals, permissions,
  });

  const scheduler = new AutomationScheduler({ db, engine: workflowEngine, bus });
  await scheduler.start();

  const health = new HealthMonitor({ db, router, approvals, version: config.version });
  const capabilities = new CapabilityRegistry({ db, router, tools, connectors, vault });

  const existingUser = db.get('SELECT id FROM users LIMIT 1');
  if (!existingUser) {
    db.run('INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)',
      ['user_default', 'TJ User', new Date().toISOString()]);
    db.run('INSERT INTO workspaces (id, name, owner_id, data_dir, created_at) VALUES (?, ?, ?, ?, ?)',
      ['default', 'Default Workspace', 'user_default', config.dataDir, new Date().toISOString()]);
  }

  registerSystemRoutes(app, { db, bus, health, capabilities, settings, orchestrator, approvals, agents: agentService });
  registerChatRoutes(app, { ws, router, cognitive, orchestrator, health });
  registerAgentRoutes(app, { agents: agentService });
  registerTaskRoutes(app, { tasks: taskService, db });
  registerWorkflowRoutes(app, { engine: workflowEngine, scheduler });
  registerConnectorRoutes(app, { connectors, permissions, approvals, audit });
  registerModelRoutes(app, { registry: modelRegistry, router });
  registerSecurityRoutes(app, { approvals, permissions });
  registerMemoryRoutes(app, { memory });

  const webDist = path.resolve(REPO_ROOT, 'apps', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((_req, reply) => { reply.sendFile('index.html'); });
  }

  return {
    app, db, bus, health, capabilities, scheduler, tools, router,
    orchestrator, connectors, vault, approvals, permissions,
    agentService, taskService, memory, workflowEngine,
  };
}
