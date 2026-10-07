import { randomUUID } from 'node:crypto';
import type { ChatOptions, ChatResult, DiscoveredModel, EmbedResult, ProviderAdapter } from '../types.js';
import { ProviderError } from '../types.js';
import { textOf } from './openai-format.js';

/**
 * Deterministic TEST provider. NOT an AI. Only registered when TJ_ENABLE_TEST_PROVIDER=1
 * and is always displayed as "Test Provider (deterministic, not AI)".
 *
 * It exists so the full agent/workflow/tool pipeline can be exercised in automated tests
 * without network access or credentials. Behaviours are scripted via message content:
 *   - "TOOL:<name> <json>"   → emits a tool call
 *   - "FAIL:<kind>"           → throws a ProviderError of that kind (auth|rate_limit|unavailable)
 *   - otherwise               → echoes a short deterministic reply (streamed if requested)
 * It can also be put into a global failure mode via TestProviderControl for provider-failover tests.
 */
export const TestProviderControl = { failKind: null as null | 'auth' | 'rate_limit' | 'unavailable', failCount: 0 };

export class TestProviderAdapter implements ProviderAdapter {
  readonly kind = 'test';
  async testConnection() { return { ok: true, latency_ms: 1, detail: 'deterministic test provider (not an AI)' }; }
  async listModels(): Promise<DiscoveredModel[]> {
    return [
      { id: 'tj-test-echo', display_name: 'Test Echo (deterministic, not AI)', context_length: 32000, supports_tools: true, supports_vision: false },
      { id: 'tj-test-planner', display_name: 'Test Planner (deterministic, not AI)', context_length: 32000, supports_tools: true, supports_vision: false },
    ];
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const t = performance.now();
    if (TestProviderControl.failKind && TestProviderControl.failCount !== 0) {
      if (TestProviderControl.failCount > 0) TestProviderControl.failCount--;
      throw new ProviderError(`Simulated ${TestProviderControl.failKind} failure`, TestProviderControl.failKind);
    }
    const last = [...opts.messages].reverse().find((m) => m.role === 'user' || m.role === 'tool');
    const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user');
    const prompt = last ? textOf(last) : '';
    const userText = lastUser ? textOf(lastUser) : '';

    const fail = userText.match(/FAIL:(auth|rate_limit|unavailable)/);
    if (fail && last?.role === 'user') throw new ProviderError(`Simulated ${fail[1]} failure`, fail[1] as any);

    const toolReq = userText.match(/TOOL:([a-z0-9_.-]+)\s*(\{[\s\S]*\})?/i);
    if (toolReq && last?.role === 'user' && opts.tools?.some((tl) => tl.name === toolReq[1])) {
      let args: Record<string, unknown> = {};
      try { args = toolReq[2] ? JSON.parse(toolReq[2]) : {}; } catch {}
      return { text: '', tool_calls: [{ id: randomUUID(), name: toolReq[1], arguments: args }], finish_reason: 'tool_calls', usage: { tokens_in: 10, tokens_out: 5 }, latency_ms: Math.round(performance.now() - t), raw_model: opts.model };
    }

    let reply: string;
    if (opts.json) reply = this.jsonReply(opts, userText);
    else if (last?.role === 'tool') reply = `Tool result received: ${prompt.slice(0, 200)}`;
    else reply = `[test-echo] ${userText.slice(0, 300)}`;

    if (opts.onDelta) for (const chunk of reply.match(/.{1,12}/gs) ?? []) opts.onDelta(chunk);
    return { text: reply, tool_calls: [], finish_reason: 'stop', usage: { tokens_in: Math.ceil(prompt.length / 4), tokens_out: Math.ceil(reply.length / 4) }, latency_ms: Math.round(performance.now() - t), raw_model: opts.model };
  }

  private jsonReply(opts: ChatOptions, userText: string): string {
    const sys = opts.messages.filter((m) => m.role === 'system').map(textOf).join('\n');
    if (/intent classifier/i.test(sys)) {
      const complex = /build|research|create a team|deploy|prototype|plan/i.test(userText) && userText.length > 40;
      return JSON.stringify({ intent: complex ? 'goal' : 'chat', complexity: complex ? 'high' : 'low', domains: complex ? ['research', 'development'] : ['general'], needs_tools: complex, summary: userText.slice(0, 80) });
    }
    if (/planner/i.test(sys)) {
      return JSON.stringify({
        objective: userText.slice(0, 120), success_criteria: ['Prototype files exist', 'Tests pass'], assumptions: ['Local tools available'], constraints: ['Sandboxed project directory'],
        risks: ['Scope creep'], rollback: 'Delete generated project directory',
        tasks: [
          { id: 't1', title: 'Research approaches', role: 'Researcher', description: 'Compare approaches and record evidence', depends_on: [], tools: ['web_search', 'memory_search'] },
          { id: 't2', title: 'Decide architecture', role: 'Analyst', description: 'Choose strongest architecture with rationale', depends_on: ['t1'], tools: [] },
          { id: 't3', title: 'Build prototype', role: 'Developer', description: 'Write a minimal working prototype', depends_on: ['t2'], tools: ['fs_write', 'fs_read', 'shell_exec'] },
          { id: 't4', title: 'Test prototype', role: 'QA Engineer', description: 'Run and verify the prototype', depends_on: ['t3'], tools: ['shell_exec', 'fs_read'] },
        ],
      });
    }
    if (/critic|verifier/i.test(sys)) return JSON.stringify({ verdict: 'pass', confidence: 0.8, issues: [], suggestions: [] });
    return JSON.stringify({ result: userText.slice(0, 100) });
  }

  async embed(texts: string[]): Promise<EmbedResult> {
    // deterministic bag-of-chars hash embedding (64 dims) — enough to test vector plumbing
    const vectors = texts.map((tx) => {
      const v = new Array(64).fill(0);
      for (let i = 0; i < tx.length; i++) v[(tx.charCodeAt(i) * 31 + i) % 64] += 1;
      const n = Math.hypot(...v) || 1;
      return v.map((x) => x / n);
    });
    return { vectors, model: 'tj-test-embed', tokens: texts.join('').length / 4 };
  }
  embeddingModel() { return 'tj-test-embed'; }
}
