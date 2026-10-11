import { describe, expect, it } from 'vitest';
import type { Agent } from '@tj/schemas';
import { Database } from '../src/db/database.js';
import { SettingsRepo } from '../src/db/repo.js';
import { EventBus } from '../src/core/event-bus.js';
import { AgentRuntime } from '../src/agents/runtime.js';
import type { ModelRouter } from '../src/models/router.js';
import type { ToolRegistry } from '../src/tools/registry.js';
import type { AgentService } from '../src/agents/service.js';
describe('Heterogeneous model assignments (mocked)', () => {
  it('runs agents with two independent model IDs through the shared router', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const requested: string[] = [];
      const router = { chat: async (request: { model_id: string }) => {
        requested.push(request.model_id);
        return { text: 'Response ' + request.model_id, tool_calls: [],
          finish_reason: 'stop', usage: { tokens_in: 12, tokens_out: 8 },
          cost_usd: 0, model_id: request.model_id };
      } } as unknown as ModelRouter;
      const runtime = new AgentRuntime(router, { specs: () => [] } as unknown as ToolRegistry,
        { get: () => undefined, setStatus: () => {}, addMetrics: () => {} } as unknown as AgentService,
        new EventBus(db), new SettingsRepo(db));
      const mk = (id: string, model_id: string) => ({
        id, name: id, model_id, role: 'researcher', description: '',
        personality: '', system_instructions: '', tools: [], permissions: [],
        budget_usd: null, spent_usd: 0,
      }) as unknown as Agent;
      const input = (agent: Agent) => ({
        agent, instruction: 'Summarize', workspace_id: 'default',
        project_id: null, project_root: null, task_id: null,
      });
      const [one, two] = await Promise.all([
        runtime.run(input(mk('research', 'free/alpha'))),
        runtime.run(input(mk('coding', 'local/beta'))),
      ]);
      expect(one.ok && two.ok).toBe(true);
      expect([one.model_id, two.model_id]).toEqual(['free/alpha', 'local/beta']);
      expect(requested.sort()).toEqual(['free/alpha', 'local/beta']);
    } finally { db.close(); }
  });
});