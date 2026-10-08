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
import { computerTools } from '../tools/builtin/computer.js';
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
import { SkillService } from '../skills/service.js';
import { LearningService } from '../learning/service.js';
import { GraphService } from '../graph/service.js';
import { ApiWorkbench } from '../workbench/service.js';
import { EducationService } from '../education/service.js';
import { BusinessService } from '../business/service.js';
import { MediaLibrary } from '../media/service.js';
import { FinanceService } from '../finance/service.js';
import { PaperTradingService } from '../trading/paper-service.js';
import { WellnessService } from '../wellness/service.js';

import { registerSystemRoutes } from './routes/system.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerWorkflowRoutes } from './routes/workflows.js';
import { registerConnectorRoutes } from './routes/connectors.js';
import { registerModelRoutes } from './routes/models.js';
import { registerSecurityRoutes } from './routes/security.js';
import { registerMemoryRoutes } from './routes/memory.js';
import { registerVoiceRoutes } from './routes/voice.js';
import { registerVisionRoutes } from './routes/vision.js';
import { registerSkillRoutes } from './routes/skills.js';
import { registerLearningRoutes } from './routes/learning.js';
import { registerDataRoutes } from './routes/data.js';
import { registerGraphRoutes } from './routes/graph.js';
import { registerWorkbenchRoutes } from './routes/workbench.js';
import { registerEducationRoutes } from './routes/education.js';
import { registerBusinessRoutes } from './routes/business.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerFinanceRoutes } from './routes/finance.js';
import { registerPaperTradingRoutes } from './routes/paper-trading.js';
import { registerWellnessRoutes } from './routes/wellness.js';

export async function createServer(config: TJConfig) {
  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });

  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin) || ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'].includes(origin)),
    credentials: true,
  });

  const db = new Database(config.dbPath);
  db.migrate();

  const bus = new EventBus(db);
  const log = new Logger('tj', config.logsDir);
  const settings = new SettingsRepo(db);
  const audit = new Audit(db);
  const skills = new SkillService(config.dataDir, audit);
  const learning = new LearningService(db, audit);
  const education = new EducationService(db);
  const media = new MediaLibrary(db, path.join(config.dataDir, 'media'));
  const vault = new Vault(db, config.vaultPath);
  const finance = new FinanceService(db, vault);
  const wellness = new WellnessService(db, vault);
  const permissions = new PermissionEngine(db, audit, settings);
  const approvals = new ApprovalService(db, bus, audit, permissions);
  const workbench = new ApiWorkbench(db, vault);
  const ws = new WorkspaceService(db, bus, settings.get<string>('project_storage_dir', config.projectsDir), config.dataDir);
  ws.init();
  const graph = new GraphService(db, () => ws.workspaceId);
  const business = new BusinessService(db, audit, () => ws.workspaceId);
  const paper = new PaperTradingService(db, audit, () => ws.workspaceId);

  const modelRegistry = new ModelRegistry(db, vault, bus, log, config.enableTestProvider);
  const router = new ModelRouter(modelRegistry, settings, bus);
  const memory = new MemoryService(db, bus, router);

  const sandbox = new Sandbox(() => [ws.projectStorageDir(), config.artifactsDir]);
  const tools = new ToolRegistry(permissions, approvals, bus, audit);
  for (const t of fsTools(sandbox, db, config.backupsDir)) tools.register(t);
  for (const t of shellTools()) tools.register(t);
  for (const t of computerTools(settings, config.artifactsDir, router)) tools.register(t);
  for (const t of memoryTools(memory)) tools.register(t);

  const connectors = new ConnectorService({ db, vault });
  for (const t of webTools(vault, db, (c, k) => vault.get(`connector:${c}:${k}`, 'web_tools', 'call'))) {
    tools.register(t);
  }

  const agentService = new AgentService(db, bus);
  const agentRuntime = new AgentRuntime(router, tools, agentService, bus, settings);
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

  const health = new HealthMonitor({ db, router, approvals, settings, version: config.version });
  const capabilities = new CapabilityRegistry({ db, router, tools, connectors, vault });

  registerSystemRoutes(app, { db, bus, health, capabilities, settings, orchestrator, approvals, agents: agentService, workspace: ws, coreDataDir: config.dataDir });
  registerChatRoutes(app, { ws, router, cognitive, orchestrator, health, settings });
  registerAgentRoutes(app, { agents: agentService });
  registerTaskRoutes(app, { tasks: taskService, db });
  registerWorkflowRoutes(app, { engine: workflowEngine, scheduler });
  registerConnectorRoutes(app, { connectors, permissions, approvals, audit });
  registerModelRoutes(app, { registry: modelRegistry, router });
  registerSecurityRoutes(app, { approvals, permissions });
  registerMemoryRoutes(app, { memory });
  registerVoiceRoutes(app, { settings, bus, health, orchestrator, tools, runtime: agentRuntime, agents: agentService, approvals, vault, router, dataDir: config.dataDir });
  registerVisionRoutes(app, { router, settings });
  registerSkillRoutes(app, { skills });
  registerLearningRoutes(app, { learning });
  registerDataRoutes(app);
  registerGraphRoutes(app, { graph });
  registerWorkbenchRoutes(app, { workbench, permissions, approvals, audit });
  registerEducationRoutes(app, { education });
  registerBusinessRoutes(app, { business });
  registerMediaRoutes(app, { media });
  registerFinanceRoutes(app, { finance });
  registerPaperTradingRoutes(app, { paper });
  registerWellnessRoutes(app, { wellness });

  const webDist = path.resolve(REPO_ROOT, 'apps', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((_req, reply) => { reply.sendFile('index.html'); });
  }

  return {
    app, db, bus, health, capabilities, scheduler, tools, router,
    orchestrator, connectors, vault, approvals, permissions,
    agentService, taskService, memory, workflowEngine, skills, learning, graph, workbench, education, business, media, finance, paper, wellness,
  };
}
