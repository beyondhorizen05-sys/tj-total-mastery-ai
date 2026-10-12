import { describe, expect, it } from 'vitest';
import type { Agent } from '@tj/schemas';
import { Database } from '../src/db/database.js';
import { EventBus } from '../src/core/event-bus.js';
import { SettingsRepo } from '../src/db/repo.js';
import { AgentRuntime, parseTextToolCall } from '../src/agents/runtime.js';
import type { AgentService } from '../src/agents/service.js';
import type { ModelRouter } from '../src/models/router.js';
import type { ToolRegistry } from '../src/tools/registry.js';

describe('AgentRuntime budget', () => {
  it('stops repeatedly guessing invalid fs_read paths before exhausting the agent loop', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const agent = {
        id: 'reader', name: 'Researcher', role: 'Researcher', description: '',
        personality: '', system_instructions: '', tools: ['fs_read', 'fs_list'],
        permissions: ['filesystem.read'], model_id: 'test/model', budget_usd: 1, spent_usd: 0,
      } as unknown as Agent;
      let attempts = 0;
      const router = {
        chat: async () => {
          attempts++;
          return {
            text: '', tool_calls: [{ id: String(attempts), name: 'fs_read', arguments: { path: 'missing-' + attempts + '.txt' } }],
            usage: { tokens_in: 1, tokens_out: 1 }, cost_usd: 0, model_id: 'test/model',
          };
        },
      } as unknown as ModelRouter;
      let toolExecutions = 0;
      const tools = {
        specs: () => [{ name: 'fs_read', description: 'Read a file', parameters: { type: 'object' } }],
        execute: async () => { toolExecutions++; return { ok: false, output: 'File not found: /sandbox/missing-' + toolExecutions + '.txt', duration_ms: 1 }; },
      } as unknown as ToolRegistry;
      const agents = { get: () => agent, setStatus: () => {}, addMetrics: () => {} } as unknown as AgentService;
      const result = await new AgentRuntime(router, tools, agents, new EventBus(db), new SettingsRepo(db)).run({
        agent, instruction: 'Read project files', workspace_id: 'default', project_id: null, project_root: '/sandbox', task_id: null,
      });
      expect(toolExecutions).toBe(3);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Three invalid file reads');
      expect(result.error).toContain('fs_list');
      expect(attempts).toBe(3);
    } finally { db.close(); }
  });

  it('refuses model-requested tools prohibited by task-specific policy, even with native tool calls', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const agent = {
        id: 'restricted-agent', name: 'Developer', role: 'Developer',
        description: '', personality: '', system_instructions: '',
        tools: ['fs_read', 'github_inspect_repository'], permissions: ['filesystem.read', 'network.http'],
        model_id: 'test/model', budget_usd: 1, spent_usd: 0,
      } as unknown as Agent;
      let modelCalls = 0;
      let executionCount = 0;
      const router = {
        chat: async () => {
          modelCalls++;
          return modelCalls === 1
            ? { text: '', tool_calls: [{ id: 'outside-tool', name: 'github_inspect_repository', arguments: { url: 'https://github.com/example/other' } }], usage: { tokens_in: 1, tokens_out: 1 }, model_id: 'test/model' }
            : { text: 'Static audit finished', tool_calls: [], usage: { tokens_in: 1, tokens_out: 1 }, model_id: 'test/model' };
        },
      } as unknown as ModelRouter;
      const tools = {
        specs: (ids: string[]) => ids.map((name) => ({ name, description: name, parameters: { type: 'object' } })),
        execute: async () => { executionCount++; return { ok: true, output: 'should not execute' }; },
      } as unknown as ToolRegistry;
      const agents = { get: () => agent, setStatus: () => {}, addMetrics: () => {} } as unknown as AgentService;
      const runtime = new AgentRuntime(router, tools, agents, new EventBus(db), new SettingsRepo(db));
      const result = await runtime.run({
        agent, instruction: 'Static review only', workspace_id: 'default', project_id: null, project_root: null, task_id: null,
        tool_allowlist: ['fs_read'],
      });
      expect(result.ok).toBe(false);
      expect(result.denied).toBe(true);
      expect(result.tool_calls[0]?.summary).toContain('explicit tool allowlist');
      expect(executionCount).toBe(0);
      expect(modelCalls).toBe(2);
    } finally { db.close(); }
  });

  it('emulates permission-checked tool calls on a selected model without native tool support', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const agent = { id: 'agent', name: 'Agent', role: 'worker', description: '', personality: '', system_instructions: '', tools: ['test_tool'], permissions: [], model_id: 'plain/model', budget_usd: 1, spent_usd: 0 } as unknown as Agent;
      const calls: Array<{ req: any; opts: any }> = [];
      const router = {
        modelSupportsTools: () => false,
        chat: async (req: any, opts: any) => {
          calls.push({ req, opts });
          return calls.length === 1
            ? { text: JSON.stringify({ tj_tool_call: { name: 'test_tool', arguments: { value: 'input' } } }), tool_calls: [], usage: { tokens_in: 4, tokens_out: 4 }, cost_usd: 0.01, model_id: 'plain/model' }
            : { text: 'The tool completed successfully.', tool_calls: [], usage: { tokens_in: 5, tokens_out: 4 }, cost_usd: 0.01, model_id: 'plain/model' };
        },
      } as unknown as ModelRouter;
      const toolRun = { count: 0 };
      const tools = {
        specs: () => [{ name: 'test_tool', description: 'A test action', parameters: { type: 'object' } }],
        execute: async (_name: string, args: Record<string, unknown>) => { toolRun.count++; expect(args).toEqual({ value: 'input' }); return { ok: true, output: 'verified result', duration_ms: 3 }; },
      } as unknown as ToolRegistry;
      const agents = { get: () => agent, setStatus: () => {}, addMetrics: () => {} } as unknown as AgentService;
      const result = await new AgentRuntime(router, tools, agents, new EventBus(db), new SettingsRepo(db)).run({ agent, instruction: 'complete work', workspace_id: 'default', project_id: null, project_root: null, task_id: null });
      expect(result.ok).toBe(true);
      expect(result.output).toBe('The tool completed successfully.');
      expect(result.tool_calls).toHaveLength(1);
      expect(toolRun.count).toBe(1);
      expect(calls.every(({ req, opts }) => req.needs_tools === false && !opts.tools && req.model_id === 'plain/model')).toBe(true);
      expect(calls[0].opts.messages[0].content).toContain('plan then execute');
      expect(calls[1].opts.messages.at(-1).content).toContain('untrusted data');
      expect(calls[1].opts.messages.at(-1).content).toContain('verified result');
    } finally { db.close(); }
  });

  it('rejects text-tool requests for tools outside the agent allowlist', () => {
    expect(() => parseTextToolCall('{"tj_tool_call":{"name":"admin_delete","arguments":{}}}', ['test_tool'])).toThrow(/not available/);
    expect(parseTextToolCall('Plain answer', ['test_tool'])).toBeNull();
  });

  it('does not report success when the model supplies an empty final answer', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const agent = { id: 'agent', name: 'Agent', role: 'worker', description: '', personality: '', system_instructions: '', tools: [], permissions: [], model_id: 'test/model', budget_usd: 1, spent_usd: 0 } as unknown as Agent;
      const router = { chat: async () => ({ text: '   ', tool_calls: [], usage: { tokens_in: 1, tokens_out: 0 }, cost_usd: 0, model_id: 'test/model' }) } as unknown as ModelRouter;
      let finalStatus = '';
      const agents = { get: () => agent, setStatus: (_id: string, status: string) => { finalStatus = status; }, addMetrics: () => {} } as unknown as AgentService;
      const tools = { specs: () => [] } as unknown as ToolRegistry;
      const result = await new AgentRuntime(router, tools, agents, new EventBus(db), new SettingsRepo(db)).run({ agent, instruction: 'answer', workspace_id: 'default', project_id: null, project_root: null, task_id: null });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Model returned no final answer');
      expect(finalStatus).toBe('failed');
    } finally { db.close(); }
  });

  it('preserves actionable tool errors and suppresses an identical failed retry', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const agent = { id: 'agent', name: 'Researcher', role: 'Researcher', description: '', personality: '', system_instructions: '', tools: ['fs_read'], permissions: ['filesystem.read'], model_id: 'plain/model', budget_usd: 1, spent_usd: 0 } as unknown as Agent;
      let modelCalls = 0; let toolExecutions = 0;
      const router = {
        modelSupportsTools: () => false,
        chat: async () => {
          modelCalls++;
          return modelCalls <= 2
            ? { text: JSON.stringify({ tj_tool_call: { name: 'fs_read', arguments: { path: 'missing.md' } } }), tool_calls: [], usage: { tokens_in: 1, tokens_out: 1 }, cost_usd: 0, model_id: 'plain/model' }
            : { text: 'I could not inspect the repository because the requested local file does not exist.', tool_calls: [], usage: { tokens_in: 1, tokens_out: 1 }, cost_usd: 0, model_id: 'plain/model' };
        },
      } as unknown as ModelRouter;
      const tools = {
        specs: () => [{ name: 'fs_read', description: 'Read a file', parameters: { type: 'object' } }],
        execute: async () => { toolExecutions++; return { ok: false, output: 'File not found: missing.md', duration_ms: 1 }; },
      } as unknown as ToolRegistry;
      const agents = { get: () => agent, setStatus: () => {}, addMetrics: () => {} } as unknown as AgentService;
      const result = await new AgentRuntime(router, tools, agents, new EventBus(db), new SettingsRepo(db)).run({ agent, instruction: 'Inspect the supplied repository', workspace_id: 'default', project_id: null, project_root: null, task_id: null });
      expect(toolExecutions).toBe(1);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('fs_read: File not found: missing.md');
      expect(result.output).toContain('File not found: missing.md');
      expect(result.tool_calls.some((call) => call.summary.includes('Repeated failed call suppressed'))).toBe(true);
    } finally { db.close(); }
  });

  it('accepts a different registered tool only when the agent explicitly verifies its recovery', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const agent = { id: 'agent', name: 'Researcher', role: 'Researcher', description: '', personality: '', system_instructions: '', tools: ['web_search', 'github_inspect_repository'], permissions: ['network.http'], model_id: 'plain/model', budget_usd: 1, spent_usd: 0 } as unknown as Agent;
      let modelCalls = 0;
      const router = {
        modelSupportsTools: () => false,
        chat: async () => {
          modelCalls++;
          if (modelCalls === 1) return { text: JSON.stringify({ tj_tool_call: { name: 'web_search', arguments: { query: 'obra/superpowers' } } }), tool_calls: [], usage: { tokens_in: 1, tokens_out: 1 }, cost_usd: 0, model_id: 'plain/model' };
          if (modelCalls === 2) return { text: JSON.stringify({ tj_tool_call: { name: 'github_inspect_repository', arguments: { url: 'https://github.com/obra/superpowers' } } }), tool_calls: [], usage: { tokens_in: 1, tokens_out: 1 }, cost_usd: 0, model_id: 'plain/model' };
          return { text: 'Recovery: recovered via github_inspect_repository. I inspected the repository and confirmed its README and license.', tool_calls: [], usage: { tokens_in: 1, tokens_out: 1 }, cost_usd: 0, model_id: 'plain/model' };
        },
      } as unknown as ModelRouter;
      const tools = {
        specs: () => [{ name: 'web_search', description: 'Search', parameters: { type: 'object' } }, { name: 'github_inspect_repository', description: 'Inspect public repository', parameters: { type: 'object' } }],
        execute: async (name: string) => name === 'web_search'
          ? { ok: false, output: 'NEEDS_API_KEY: add search credentials', duration_ms: 1 }
          : { ok: true, output: 'README and MIT license read', duration_ms: 1 },
      } as unknown as ToolRegistry;
      const agents = { get: () => agent, setStatus: () => {}, addMetrics: () => {} } as unknown as AgentService;
      const result = await new AgentRuntime(router, tools, agents, new EventBus(db), new SettingsRepo(db)).run({ agent, instruction: 'Inspect the public repository', workspace_id: 'default', project_id: null, project_root: null, task_id: null });
      expect(result.ok).toBe(true);
      expect(result.output).toContain('recovered through a verified alternative');
      expect(result.tool_calls.map((call) => call.ok)).toEqual([false, true]);
    } finally { db.close(); }
  });

  it('keeps a non-finite step request bounded', async () => {
    const db = new Database(':memory:'); db.migrate();
    try {
      const agent = { id: 'agent', name: 'Agent', role: 'worker', description: '', personality: '', system_instructions: '', tools: ['test_tool'], permissions: [], model_id: 'test/model', budget_usd: 1, spent_usd: 0 } as unknown as Agent;
      let calls = 0;
      const router = { chat: async () => { calls++; return { text: '', tool_calls: [{ id: `call-${calls}`, name: 'test_tool', arguments: {} }], usage: { tokens_in: 1, tokens_out: 1 }, cost_usd: 0, model_id: 'test/model' }; } } as unknown as ModelRouter;
      const tools = { specs: () => [{ name: 'test_tool' }], execute: async () => ({ ok: true, output: 'done', duration_ms: 1 }) } as unknown as ToolRegistry;
      const agents = { get: () => agent, setStatus: () => {}, addMetrics: () => {} } as unknown as AgentService;
      const result = await new AgentRuntime(router, tools, agents, new EventBus(db), new SettingsRepo(db)).run({ agent, instruction: 'work', workspace_id: 'default', project_id: null, project_root: null, task_id: null, max_steps: Number.POSITIVE_INFINITY });
      expect(calls).toBe(12);
      expect(result.error).toBe('Reached max steps (12) without a final answer');
    } finally { db.close(); }
  });

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
