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
import { Logger, maskSecrets } from '../core/logger.js';
import { WorkspaceService } from '../core/workspace.js';
import { Vault } from '../security/vault.js';
import { Audit } from '../security/audit.js';
import { PermissionEngine } from '../security/permissions.js';
import { ApprovalService } from '../security/approvals.js';
import { ModelRegistry } from '../models/registry.js';
import { ModelRouter } from '../models/router.js';
import { ChatGPTPlanService } from '../models/chatgpt-plan.js';
import { Sandbox } from '../tools/sandbox.js';
import { ToolRegistry } from '../tools/registry.js';
import { fsTools } from '../tools/builtin/fs.js';
import { shellTools } from '../tools/builtin/shell.js';
import { computerTools } from '../tools/builtin/computer.js';
import { webTools } from '../tools/builtin/web.js';
import { githubRepositoryTool } from '../tools/builtin/github.js';
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
import { registerFileSearchRoutes } from './routes/file-search.js';
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
import { SelfImprovementService } from '../self-improvement/service.js';
import { registerSelfImprovementRoutes } from './routes/self-improvement.js';
import { CapabilityWorkflowService } from '../self-improvement/capability-workflow.js';

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

  const chatgptPlan = new ChatGPTPlanService(db, vault, config.enableChatGPTPlanSignIn,
    async (account) => {
      if (!modelRegistry.getProvider(account.id)) modelRegistry.addProvider({ id: account.id, name: `ChatGPT Account (${account.email ?? account.id})`, kind: 'chatgpt-plan' });
      else modelRegistry.updateProvider(account.id, { enabled: true });
      try { await modelRegistry.fetchModels(account.id); } catch { modelRegistry.setHealth(account.id, 'unknown', 'Connected; model discovery needs retry.', null); }
    },
    (account) => modelRegistry.removeProvider(account.id),
  );
  const modelRegistry = new ModelRegistry(db, vault, bus, log, config.enableTestProvider, chatgptPlan);
  for (const account of chatgptPlan.accounts()) {
    if (account.credential_ref && vault.has(account.credential_ref) && !modelRegistry.getProvider(account.id)) {
      modelRegistry.addProvider({ id: account.id, name: `ChatGPT Account (${account.email ?? account.id})`, kind: 'chatgpt-plan' });
    }
    const provider = modelRegistry.getProvider(account.id);
    if (provider && provider.enabled !== config.enableChatGPTPlanSignIn) modelRegistry.updateProvider(account.id, { enabled: config.enableChatGPTPlanSignIn });
  }
  const router = new ModelRouter(modelRegistry, settings, bus, approvals);
  const improvements = new SelfImprovementService(REPO_ROOT, router, config.dataDir, approvals);
  const memory = new MemoryService(db, bus, router);

  const sandbox = new Sandbox(() => {
    const allowedRoots = settings.get<unknown>('allowed_roots', []);
    return [ws.projectStorageDir(), config.artifactsDir, ...(Array.isArray(allowedRoots) ? allowedRoots.filter((root): root is string => typeof root === 'string') : [])];
  });
  const tools = new ToolRegistry(permissions, approvals, bus, audit);
  for (const t of fsTools(sandbox, db, config.backupsDir)) tools.register(t);
  for (const t of shellTools()) tools.register(t);
  for (const t of computerTools(settings, config.artifactsDir, router)) tools.register(t);
  for (const t of memoryTools(memory)) tools.register(t);

  const connectors = new ConnectorService({ db, vault });
  for (const connector of await connectors.list()) {
    const runtime = connectors.getRuntime(connector.id);
    if (!runtime) continue;
    for (const action of runtime.manifest.actions) {
      const actionPermissions = action.permissions ?? runtime.manifest.permissions;
      const permission = actionPermissions.includes('email.read') && action.risk === 'low' ? 'email.read' : 'connector.use';
      const permissionList = [...new Set(actionPermissions.filter((item) => item !== permission))];
      tools.register({
        id: `connector_${connector.id}_${action.id}`,
        name: `${connector.name}: ${action.name}`,
        description: `${action.description}. This action is available only when the connector is configured; external write or delete actions require user approval.`,
        domain: `connector:${connector.id}`,
        input_schema: action.input_schema,
        permission: permission as import('@tj/schemas').Permission,
        permissions: permissionList as import('@tj/schemas').Permission[],
        risk: action.risk ?? 'medium',
        reversible: action.risk === 'low',
        resource: () => `${connector.id}:${action.id}`,
        describe: (args) => ({
          action: `Use ${connector.name}: ${action.name}`,
          target: `${connector.id}:${action.id}`,
          why: `The requested task requires this connector action. ${JSON.stringify(args).slice(0, 600)}`,
          risks: action.risk === 'high' || action.risk === 'critical' ? [`External connector action rated ${action.risk}; approve this exact action before it runs.`] : [],
        }),
        execute: async (args) => {
          const result = await connectors.execute(connector.id, action.id, args);
          const serialized = maskSecrets(JSON.stringify(result));
          return { ok: true, output: serialized.slice(0, 30_000), data: { connector_id: connector.id, action_id: action.id } };
        },
      });
    }
  }
  for (const t of webTools(vault, db, (c, k) => vault.get(`connector:${c}:${k}`, 'web_tools', 'call'))) {
    tools.register(t);
  }
  tools.register(githubRepositoryTool(fetch, () => vault.get('connector:github:token', 'github_repository_tool', 'read_token')));

  const agentService = new AgentService(db, bus);
  const taskService = new TaskService(db, bus);
  const interruptedTasks = taskService.recoverInterruptedOnStartup();
  if (interruptedTasks) console.warn(`Recovered ${interruptedTasks} interrupted task(s) after API restart; review their saved execution steps before retrying.`);
  approvals.denyAllPending('service_restart_recovery');
  const interruptedAgents = agentService.resetActive();
  if (interruptedAgents) console.warn(`Reset ${interruptedAgents} agent(s) left active after API restart.`);
  const agentRuntime = new AgentRuntime(router, tools, agentService, bus, settings, taskService);

  const cognitive = new CognitiveEngine(router);
  const orchestrator = new Orchestrator(
    cognitive, agentService, agentRuntime, taskService, ws, memory, bus, db
  );

  const workflowEngine = new WorkflowEngine(db, bus, () => 'default');
  registerBuiltinStepExecutors(workflowEngine, {
    tools, router, agentRuntime, agentService, connectors, approvals, permissions, workspace: ws,
  });

  const scheduler = new AutomationScheduler({ db, engine: workflowEngine, bus });
  await scheduler.start();

  const health = new HealthMonitor({ db, router, registry: modelRegistry, approvals, settings, version: config.version });
  tools.register({
    id: 'tj_self_improve', name: 'Improve TJ', domain: 'development',
    description: 'Investigate a TJ bug or capability gap and prepare an isolated, tested source improvement for review.',
    input_schema: { type: 'object', properties: { prompt: { type: 'string', minLength: 8, maxLength: 4000 } }, required: ['prompt'], additionalProperties: false },
    permission: 'code.execute', risk: 'high', reversible: false,
    describe: (args) => ({ action: 'Prepare a TJ source improvement', target: 'TJ application source', why: String(args.prompt ?? '').slice(0, 500), risks: ['Runs source analysis and tests in an isolated candidate; applying verified changes still requires a separate deployment approval.'] }),
    execute: async (args) => {
      if (health.isStopped()) return { ok: false, output: 'TJ is stopped. Resume the system before starting source improvements.', error: 'System is stopped.' };
      try {
        const run = await improvements.start(String(args.prompt ?? ''));
        return { ok: true, output: `Self-improvement run ${run.id} started (${run.state}: ${run.stage}). Inspect it in TJ Self Improvement; verified deployment requires its separate approval.`, data: { run_id: run.id, state: run.state } };
      } catch (error) {
        return { ok: false, output: error instanceof Error ? error.message : String(error), error: error instanceof Error ? error.message : String(error) };
      }
    },
  });
  const capabilities = new CapabilityRegistry({ db, router, tools, connectors, vault });
  const capabilityWorkflow = new CapabilityWorkflowService({ capabilities, router, approvals, improvements, ws, health, cognitive, orchestrator, dataDir: config.dataDir });

  registerSystemRoutes(app, { db, bus, health, capabilities, settings, orchestrator, improvements, approvals, agents: agentService, workspace: ws, coreDataDir: config.dataDir, workflowEngine, scheduler });
  registerChatRoutes(app, { ws, router, cognitive, orchestrator, health, settings, capabilityWorkflow });
  registerAgentRoutes(app, { agents: agentService, orchestrator });
  registerTaskRoutes(app, { tasks: taskService, orchestrator });
  registerWorkflowRoutes(app, { engine: workflowEngine, scheduler, health, cognitive, orchestrator, workspace: ws });
  registerConnectorRoutes(app, { connectors, permissions, approvals, audit });
  registerModelRoutes(app, { registry: modelRegistry, router, chatgptPlan });
  registerSecurityRoutes(app, { approvals, permissions, settings, sandbox, audit });
  registerFileSearchRoutes(app, { sandbox, allowedRoots: () => {
    const roots = settings.get<unknown>('allowed_roots', []);
    return Array.isArray(roots) ? roots.filter((root): root is string => typeof root === 'string') : [];
  } });
  registerMemoryRoutes(app, { memory });
  registerVoiceRoutes(app, { settings, bus, health, orchestrator, tools, runtime: agentRuntime, agents: agentService, approvals, vault, router, dataDir: config.dataDir, capabilityWorkflow, workflowEngine, scheduler });
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
  registerSelfImprovementRoutes(app, improvements, health);

  const webDist = path.resolve(REPO_ROOT, 'apps', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((_req, reply) => { reply.sendFile('index.html'); });
  }

  app.addHook('onClose', async () => { scheduler.stop(); workflowEngine.cancelAll(); chatgptPlan.close(); });

  return {
    app, db, bus, health, capabilities, scheduler, tools, router,
    orchestrator, connectors, vault, approvals, permissions,
    agentService, taskService, memory, workflowEngine, skills, learning, graph, workbench, education, business, media, finance, paper, wellness,
  };
}
