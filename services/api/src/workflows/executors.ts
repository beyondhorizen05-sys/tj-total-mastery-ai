import type { WorkflowStep } from '@tj/schemas';
import type { StepContext, WorkflowEngine } from './engine.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ModelRouter } from '../models/router.js';
import type { AgentRuntime } from '../agents/runtime.js';
import type { AgentService } from '../agents/service.js';
import type { ConnectorService } from '../connectors/service.js';
import type { ApprovalService } from '../security/approvals.js';
import type { PermissionEngine } from '../security/permissions.js';

export interface StepExecutorDeps {
  tools: ToolRegistry;
  router: ModelRouter;
  agentRuntime: AgentRuntime;
  agentService: AgentService;
  connectors: ConnectorService;
  approvals: ApprovalService;
  permissions: PermissionEngine;
}

/**
 * Registers real workflow step executors with the WorkflowEngine:
 * - 'tool': resolves and executes tool via registry
 * - 'model': calls ModelRouter chat()
 * - 'agent': runs agent task via AgentRuntime
 * - 'connector': invokes action via ConnectorService
 * - 'approval': checks or requests human approval
 * - 'wait': async delay
 * - 'transform': simple projection
 */
export function registerBuiltinStepExecutors(engine: WorkflowEngine, deps: StepExecutorDeps) {
  // 1. Tool step
  engine.registerExecutor('tool', async (step: WorkflowStep, config: Record<string, unknown>, ctx: StepContext) => {
    const toolName = String(config.tool ?? step.name);
    const input = (config.input as Record<string, unknown>) ?? {};
    return await deps.tools.execute(
      toolName,
      input,
      {
        workspace_id: 'default',
        project_id: ctx.run.project_id ?? null,
        project_root: null,
        agent_id: 'workflow',
        agent_permissions: step.permissions,
        task_id: null,
        workflow_run_id: ctx.run.id,
        signal: ctx.signal,
      }
    );
  });

  // 2. Model step
  engine.registerExecutor('model', async (_step: WorkflowStep, config: Record<string, unknown>) => {
    const prompt = String(config.prompt ?? '');
    const system = config.system ? String(config.system) : undefined;
    const response = await deps.router.chat(
      {
        task_type: 'chat',
      },
      {
        messages: [
          ...(system ? [{ role: 'system' as const, content: system }] : []),
          { role: 'user' as const, content: prompt },
        ],
      }
    );
    return response.text;
  });

  // 3. Agent step
  engine.registerExecutor('agent', async (step: WorkflowStep, config: Record<string, unknown>, ctx: StepContext) => {
    const agentId = String(config.agent_id ?? 'generalist');
    const instruction = String(config.instruction ?? step.name);
    const agent = deps.agentService.get(agentId) ?? deps.agentService.list()[0];
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    return await deps.agentRuntime.run({
      agent,
      instruction,
      workspace_id: 'default',
      project_id: ctx.run.project_id ?? null,
      project_root: null,
      task_id: `${ctx.run.id}:${step.id}`,
      workflow_run_id: ctx.run.id,
      signal: ctx.signal,
    });
  });

  // 4. Connector step
  engine.registerExecutor('connector', async (_step: WorkflowStep, config: Record<string, unknown>) => {
    const connectorId = String(config.connector_id);
    const action = String(config.action);
    const input = (config.input as Record<string, any>) ?? {};
    return await deps.connectors.execute(connectorId, action, input);
  });

  // 5. Approval step
  engine.registerExecutor('approval', async (step: WorkflowStep, config: Record<string, unknown>, ctx: StepContext) => {
    const action = String(config.action ?? step.name);
    const why = String(config.description ?? `Approval required for step "${step.name}"`);
    const req = deps.approvals.request({
      workspace_id: 'default',
      project_id: ctx.run.project_id ?? null,
      agent_id: 'workflow',
      workflow_run_id: ctx.run.id,
      action,
      target: step.name,
      why,
      tools: [],
      resources_affected: [],
      risks: [],
      rollback_available: false,
      permission: step.permissions[0] ?? 'action.execute',
      risk: (step.risk as any) ?? 'medium',
      payload: config,
    });
    const decided = await deps.approvals.waitFor(req.id);
    if (decided.status === 'denied' || decided.status === 'expired') {
      throw new Error(`Approval ${decided.status}: ${action}`);
    }
    return { approval_id: req.id, status: decided.status };
  });

  // 6. Wait step
  engine.registerExecutor('wait', async (_step: WorkflowStep, config: Record<string, unknown>) => {
    const ms = Math.min(Number(config.ms ?? 1000), 60000);
    await new Promise((r) => setTimeout(r, ms));
    return { waited_ms: ms };
  });

  // 7. Transform step
  engine.registerExecutor('transform', async (_step: WorkflowStep, config: Record<string, unknown>) => {
    return config.value ?? null;
  });
}
