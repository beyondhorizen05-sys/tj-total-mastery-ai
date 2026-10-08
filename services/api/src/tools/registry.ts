import type { ToolDefinition } from '@tj/schemas';
import type { Tool, ToolContext, ToolResult } from './types.js';
import { ToolDenied, fail } from './types.js';
import type { PermissionEngine } from '../security/permissions.js';
import type { ApprovalService } from '../security/approvals.js';
import type { EventBus } from '../core/event-bus.js';
import type { Audit } from '../security/audit.js';
import type { ToolSpec } from '../models/types.js';

/**
 * Tool & Skill Engine (Spec §4 Layer 6, §39). Every execution passes through:
 *   permission evaluation → (approval gate) → execute → audit + events
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();
  constructor(private permissions: PermissionEngine, private approvals: ApprovalService, private bus: EventBus, private audit: Audit) {}

  register(tool: Tool) { this.tools.set(tool.id, tool); }
  get(id: string) { return this.tools.get(id); }
  list(): Tool[] { return [...this.tools.values()]; }
  ids(): string[] { return [...this.tools.keys()]; }

  definitions(filter?: string[]): ToolDefinition[] {
    return this.list().filter((t) => !filter || filter.includes(t.id)).map((t) => ({ id: t.id, name: t.name, description: t.description, input_schema: t.input_schema, permissions: [t.permission], risk: t.risk, domain: t.domain, reversible: t.reversible }));
  }

  /** Tool specs in model-facing format. */
  specs(filter?: string[]): ToolSpec[] {
    return this.list().filter((t) => !filter || filter.includes(t.id)).map((t) => ({ name: t.id, description: t.description, parameters: t.input_schema }));
  }

  async execute(toolId: string, args: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(toolId);
    if (!tool) return fail(`Unknown tool "${toolId}"`);
    const t = performance.now();
    let resource: string | null = null;
    try { resource = tool.resource?.(args ?? {}, ctx) ?? null; } catch (e: any) { return fail(e.message); }

    const decision = this.permissions.evaluate({ agent_id: ctx.agent_id, agent_permissions: ctx.agent_permissions ?? undefined, permission: tool.permission, resource, workflow_run_id: ctx.workflow_run_id, actor: ctx.agent_id ? `agent:${ctx.agent_id}` : 'user' });
    const needsApproval = decision.decision === 'require_approval' || tool.risk === 'high' || tool.risk === 'critical';

    this.bus.emit({ name: 'tool.called', severity: 'debug', summary: `${tool.name}${resource ? ' → ' + resource : ''}`, agent_id: ctx.agent_id, task_id: ctx.task_id, workflow_run_id: ctx.workflow_run_id, project_id: ctx.project_id, data: { tool: toolId, args: redactArgs(args, toolId), decision: decision.decision } });

    if (decision.decision === 'deny') {
      this.bus.emit({ name: 'permission.denied', severity: 'warning', summary: `Denied ${tool.name}: ${decision.reason}`, agent_id: ctx.agent_id, task_id: ctx.task_id, workflow_run_id: ctx.workflow_run_id, project_id: ctx.project_id, data: { tool: toolId, resource } });
      throw new ToolDenied(`Permission denied for ${tool.id}: ${decision.reason}`);
    }

    if (needsApproval) {
      const d = tool.describe?.(args) ?? { action: tool.name, target: resource ?? '(none)', why: 'Requested by agent', risks: [] };
      const sensitiveText = toolId === 'computer_type' || toolId === 'computer_write';
      const approvalArgs = sensitiveText ? { ...args, text: `[REDACTED: ${String(args.text ?? '').length} characters]` } : args;
      const approval = this.approvals.request({ workspace_id: ctx.workspace_id, project_id: ctx.project_id, agent_id: ctx.agent_id, task_id: ctx.task_id, workflow_run_id: ctx.workflow_run_id, action: d.action, target: d.target, why: d.why, tools: [tool.id], resources_affected: resource ? [resource] : [], risks: d.risks.length ? d.risks : [`${tool.risk} risk operation`], rollback_available: tool.reversible, permission: tool.permission, risk: tool.risk, payload: { tool: toolId, args: approvalArgs } });
      ctx.progress?.(`Waiting for approval: ${d.action} → ${d.target}`);
      const final = await this.approvals.waitFor(approval.id);
      if (final.status === 'denied' || final.status === 'expired') {
        throw new ToolDenied(`Action "${d.action}" was ${final.status} by user`, approval.id);
      }
      if (final.status === 'edited' && final.payload?.args) {
        if (sensitiveText) throw new ToolDenied('Text entry cannot be edited inside an approval. Submit a new request instead.', approval.id);
        const editedArgs = final.payload.args as Record<string, any>;
        const editedResource = tool.resource?.(editedArgs, ctx) ?? null;
        if (editedResource !== resource) throw new ToolDenied('Edited action changes the approved resource; submit a new approval', approval.id);
        args = editedArgs;
      }
    }

    try {
      const r = await tool.execute(args ?? {}, ctx);
      r.duration_ms = Math.round(performance.now() - t);
      this.bus.emit({ name: r.ok ? 'tool.completed' : 'tool.failed', severity: r.ok ? 'debug' : 'warning', summary: `${tool.name} ${r.ok ? 'completed' : 'failed'} in ${r.duration_ms}ms`, agent_id: ctx.agent_id, task_id: ctx.task_id, workflow_run_id: ctx.workflow_run_id, project_id: ctx.project_id, data: { tool: toolId, ok: r.ok, error: r.error } });
      this.audit.log({ actor: ctx.agent_id ? `agent:${ctx.agent_id}` : 'user', agent_id: ctx.agent_id, action: `tool.execute:${toolId}`, permission: tool.permission, resource, decision: r.ok ? 'success' : 'failed', details: { duration_ms: r.duration_ms, error: r.error } });
      return r;
    } catch (e: any) {
      const r = fail(e.message ?? String(e));
      r.duration_ms = Math.round(performance.now() - t);
      this.bus.emit({ name: 'tool.failed', severity: 'error', summary: `${tool.name} threw: ${e.message}`, agent_id: ctx.agent_id, task_id: ctx.task_id, workflow_run_id: ctx.workflow_run_id, project_id: ctx.project_id, data: { tool: toolId } });
      return r;
    }
  }
}

function redactArgs(args: Record<string, any>, toolId: string): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if ((toolId === 'computer_type' || toolId === 'computer_write') && k === 'text') out[k] = `[REDACTED: ${String(v).length} characters]`;
    else if (/key|token|secret|password|authorization/i.test(k)) out[k] = '[REDACTED]';
    else if (typeof v === 'string' && v.length > 500) out[k] = v.slice(0, 500) + `… (${v.length} chars)`;
    else out[k] = v;
  }
  return out;
}
