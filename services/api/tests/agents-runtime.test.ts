import { describe, expect, it } from 'vitest';
import type { Agent } from '@tj/schemas';
import { Database } from '../src/db/database.js';
import { EventBus } from '../src/core/event-bus.js';
import { SettingsRepo } from '../src/db/repo.js';
import { AgentRuntime } from '../src/agents/runtime.js';
import type { AgentService } from '../src/agents/service.js';
import type { ModelRouter } from '../src/models/router.js';
import type { ToolRegistry } from '../src/tools/registry.js';

describe('AgentRuntime budget', () => {
  it('stops a multi-step run once its unpersisted model cost exhausts the budget', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const agent = {
        id: 'agent', name: 'Agent', role: 'worker', description: '', personality: '',
        system_instructions: '', tools: [], permissions: [], model_id: 'test/model',
        budget_usd: 0.05, spent_usd: 0,
      } as unknown as Agent;
      let calls = 0;
      const router = { chat: async () => {
        calls++;
        return {
          text: '', tool_calls: [{ id: `call-${calls}`, name: 'test_tool', arguments: {} }],
          usage: { tokens_in: 1, tokens_out: 1 }, cost_usd: 0.05, model_id: 'test/model',
        };
      } } as unknown as ModelRouter;
      const tools = {
        specs: () => [{ name: 'test_tool' }],
        execute: async () => ({ ok: true, output: 'step done', duration_ms: 1 }),
      } as unknown as ToolRegistry;
      let recordedCost = 0;
      const agents = {
        get: () => agent,
        setStatus: () => {},
        addMetrics: (_id: string, metrics: { cost: number }) => { recordedCost = metrics.cost; },
      } as unknown as AgentService;
      const runtime = new AgentRuntime(router, tools, agents, new EventBus(db), new SettingsRepo(db));
      const result = await runtime.run({ agent, instruction: 'do several steps', workspace_id: 'default', project_id: null, project_root: null, task_id: null, max_steps: 3 });
      expect(calls).toBe(1);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Agent budget exhausted');
      expect(recordedCost).toBe(0.05);
    } finally { db.close(); }
  });
});
