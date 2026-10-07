import type { Agent } from '@tj/schemas';
import type { ModelRouter } from '../models/router.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { AgentService } from './service.js';
import type { EventBus } from '../core/event-bus.js';
import type { ChatMessage } from '../models/types.js';
import { ToolDenied } from '../tools/types.js';
import type { ToolContext } from '../tools/types.js';
import type { AgentRunInput, AgentRunResult } from './runtime-types.js';

export type { AgentRunInput, AgentRunResult } from './runtime-types.js';

const DEFAULT_MAX_STEPS = 12;

/**
 * Agent runtime: a bounded tool-calling loop.
 * Model → tool calls → permission gate (inside ToolRegistry) → results → model … until a final answer.
 * Agent status/current task are updated against real execution so Agent Town reflects truth.
 */
export class AgentRuntime {
  constructor(private router: ModelRouter, private tools: ToolRegistry, private agents: AgentService, private bus: EventBus) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const { agent } = input;
    const maxSteps = input.max_steps ?? DEFAULT_MAX_STEPS;
    const toolSpecs = this.tools.specs(agent.tools);
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt(agent, input) },
      { role: 'user', content: input.context ? `Context from upstream work:\n${input.context}\n\nYour task:\n${input.instruction}` : input.instruction },
    ];
    const res: AgentRunResult = { ok: false, output: '', steps: 0, tool_calls: [], artifacts: [], tokens_in: 0, tokens_out: 0, cost_usd: 0, model_id: null };
    const ctx: ToolContext = {
      workspace_id: input.workspace_id, project_id: input.project_id, project_root: input.project_root, agent_id: agent.id,
      agent_permissions: agent.permissions, task_id: input.task_id, workflow_run_id: input.workflow_run_id ?? null, signal: input.signal,
      progress: (m) => input.onProgress?.(m),
    };

    this.agents.setStatus(agent.id, 'thinking', input.task_id);
    this.bus.emit({ name: 'agent.started', summary: `${agent.name} started: ${input.instruction.slice(0, 100)}`, agent_id: agent.id, task_id: input.task_id, project_id: input.project_id, workflow_run_id: input.workflow_run_id ?? null });

    try {
      for (let step = 0; step < maxSteps; step++) {
        if (input.signal?.aborted) throw new Error('Cancelled');
        if (this.overBudget(agent.id)) { res.error = 'Agent budget exhausted'; break; }
        res.steps = step + 1;
        this.agents.setStatus(agent.id, 'thinking', input.task_id);
        const r = await this.router.chat(
          { task_type: input.task_type ?? 'chat', complexity: 'medium', needs_tools: toolSpecs.length > 0, model_id: agent.model_id },
          { messages, tools: toolSpecs.length ? toolSpecs : undefined, temperature: 0.2, signal: input.signal },
          { project_id: input.project_id, agent_id: agent.id },
        );
        res.tokens_in += r.usage.tokens_in; res.tokens_out += r.usage.tokens_out; res.cost_usd += r.cost_usd ?? 0; res.model_id = r.model_id;
        if (r.fallback_from) res.fallback_from = r.fallback_from;

        if (!r.tool_calls.length) { res.ok = true; res.output = r.text; break; }

        messages.push({ role: 'assistant', content: r.text, tool_calls: r.tool_calls });
        this.agents.setStatus(agent.id, 'working', input.task_id);
        for (const tc of r.tool_calls) messages.push(await this.runTool(tc, ctx, res));
        if (step === maxSteps - 1) res.error = `Reached max steps (${maxSteps}) without a final answer`;
      }
      if (!res.ok && !res.error) res.error = 'No final answer produced';
      if (!res.ok && !res.output) res.output = res.error ?? '';
    } catch (e: any) {
      res.ok = false; res.error = e.message; res.output = res.output || `Failed: ${e.message}`;
    } finally {
      this.finish(agent, input, res);
    }
    return res;
  }

  private async runTool(tc: { id: string; name: string; arguments: Record<string, unknown> }, ctx: ToolContext, res: AgentRunResult): Promise<ChatMessage> {
    let content: string;
    try {
      const tr = await this.tools.execute(tc.name, tc.arguments, ctx);
      res.tool_calls.push({ tool: tc.name, ok: tr.ok, summary: tr.output.slice(0, 160), duration_ms: tr.duration_ms });
      if (tr.artifacts) res.artifacts.push(...tr.artifacts);
      content = tr.output.slice(0, 12000);
    } catch (e: any) {
      if (!(e instanceof ToolDenied)) throw e;
      res.tool_calls.push({ tool: tc.name, ok: false, summary: e.message });
      content = `DENIED: ${e.message}. Do not retry this action; choose a different approach or report that it is blocked.`;
      res.denied = true;
    }
    return { role: 'tool', tool_call_id: tc.id, name: tc.name, content };
  }

  private finish(agent: Agent, input: AgentRunInput, res: AgentRunResult) {
    this.agents.setStatus(agent.id, res.ok ? 'completed' : input.signal?.aborted ? 'stopped' : 'failed', null);
    this.agents.addMetrics(agent.id, { tasks_completed: res.ok ? 1 : 0, tasks_failed: res.ok ? 0 : 1, tool_calls: res.tool_calls.length, tokens: res.tokens_in + res.tokens_out, cost: res.cost_usd });
    this.bus.emit({ name: res.ok ? 'agent.completed' : 'agent.failed', severity: res.ok ? 'info' : 'error', summary: `${agent.name} ${res.ok ? 'completed' : 'failed'} (${res.tool_calls.length} tool calls)`, agent_id: agent.id, task_id: input.task_id, project_id: input.project_id, workflow_run_id: input.workflow_run_id ?? null, data: { error: res.error, steps: res.steps } });
  }

  private overBudget(agentId: string): boolean {
    const a = this.agents.get(agentId);
    return !!a && a.budget_usd != null && a.spent_usd >= a.budget_usd;
  }

  private systemPrompt(agent: Agent, input: AgentRunInput): string {
    return [
      `You are ${agent.name}, role: ${agent.role}. ${agent.description}`,
      agent.personality ? `Personality: ${agent.personality}` : '',
      agent.system_instructions,
      input.project_root ? `Project directory (relative paths resolve here): ${input.project_root}` : '',
      `Available tools: ${agent.tools.join(', ') || 'none'}. Platform: ${process.platform}.`,
      'Finish with a concise final answer stating exactly what you did, what you verified, and what remains.',
    ].filter(Boolean).join('\n');
  }
}
