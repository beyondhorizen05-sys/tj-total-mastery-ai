import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerChatRoutes } from '../src/server/routes/chat.js';

function createChatHarness(intent: 'chat' | 'goal', autonomyLevel = 2) {
  const app = Fastify();
  const stored: Array<{ role: string; content: string }> = [];
  const cognitive = {
    classify: vi.fn(async () => ({ intent, complexity: 'low', domains: ['general'], needs_tools: intent === 'goal', summary: 'classified', source: 'model' })),
    plan: vi.fn(async (goal: string) => ({ plan: { objective: goal, success_criteria: [], assumptions: [], constraints: [], risks: [], rollback: '', tasks: [] }, source: 'model', model_id: 'test/model', cost_usd: 0 })),
  };
  const orchestrator = {
    prepare: vi.fn(() => ({ tasks: [] })),
    execute: vi.fn(async () => ({
      summary: 'Goal work finished.', evidence: { changed_files: [], source_calls: 0, test_calls: 0, gaps: [] },
      artifacts: [], plan_id: 'plan-1', status: 'completed', plan_source: 'model',
    })),
  };
  const router = { chat: vi.fn(async () => ({ text: 'Hello from TJ.', model_id: 'test/model', provider_id: 'test', cost_usd: 0 })) };
  const capabilityWorkflow = { assess: vi.fn(async () => null), request: vi.fn() };
  const messages = {
    createConversation: vi.fn(() => ({ id: 'conversation-1' })),
    addMessage: vi.fn((message: { role: string; content: string }) => { stored.push(message); return message; }),
    messages: vi.fn(() => stored),
  };
  const health = { isStopped: vi.fn(() => false), setState: vi.fn() };
  const settings = { get: vi.fn((key: string, fallback: unknown) => key === 'autonomy_level' ? autonomyLevel : fallback) };

  registerChatRoutes(app, {
    ws: messages,
    router,
    cognitive,
    orchestrator,
    health,
    settings,
    capabilityWorkflow,
  } as any);

  return { app, cognitive, orchestrator, router, capabilityWorkflow, settings };
}

describe('Auto chat intent routing', () => {
  it('answers conversational intent directly without creating a plan or capability request', async () => {
    const h = createChatHarness('chat');
    try {
      const response = await h.app.inject({ method: 'POST', url: '/api/v1/chat', payload: { mode: 'auto', content: 'Hi TJ, how are you today?' } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ content: 'Hello from TJ.', provider_id: 'test' });
      expect(h.cognitive.classify).toHaveBeenCalledOnce();
      expect(h.cognitive.plan).not.toHaveBeenCalled();
      expect(h.orchestrator.prepare).not.toHaveBeenCalled();
      expect(h.capabilityWorkflow.assess).not.toHaveBeenCalled();
      expect(h.router.chat).toHaveBeenCalledOnce();
    } finally {
      await h.app.close();
    }
  });

  it('sends goal intent through planning and orchestration', async () => {
    const h = createChatHarness('goal');
    try {
      const response = await h.app.inject({ method: 'POST', url: '/api/v1/chat', payload: { mode: 'auto', content: 'Build a small task tracker with tests.' } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'completed', plan_id: 'plan-1' });
      expect(h.cognitive.plan).toHaveBeenCalledOnce();
      expect(h.orchestrator.prepare).toHaveBeenCalledOnce();
      expect(h.orchestrator.execute).toHaveBeenCalledOnce();
      expect(h.router.chat).not.toHaveBeenCalled();
      expect(h.capabilityWorkflow.assess).toHaveBeenCalledOnce();
    } finally {
      await h.app.close();
    }
  });

  it('keeps level 0 chat available but blocks goal orchestration in Auto and explicit Build modes', async () => {
    const direct = createChatHarness('chat', 0);
    try {
      const response = await direct.app.inject({ method: 'POST', url: '/api/v1/chat', payload: { mode: 'auto', content: 'Hi TJ.' } });
      expect(response.statusCode).toBe(200);
      expect(response.json().content).toBe('Hello from TJ.');
      expect(direct.router.chat).toHaveBeenCalledOnce();
    } finally {
      await direct.app.close();
    }

    for (const mode of ['auto', 'build'] as const) {
      const blocked = createChatHarness('goal', 0);
      try {
        const response = await blocked.app.inject({ method: 'POST', url: '/api/v1/chat', payload: { mode, content: 'Build a small task tracker.' } });
        expect(response.statusCode, `mode ${mode}`).toBe(200);
        expect(response.json(), `mode ${mode}`).toMatchObject({ status: 'autonomy_blocked' });
        expect(blocked.settings.get).toHaveBeenCalledWith('autonomy_level', 2);
        expect(blocked.cognitive.plan).not.toHaveBeenCalled();
        expect(blocked.orchestrator.prepare).not.toHaveBeenCalled();
        expect(blocked.capabilityWorkflow.assess).not.toHaveBeenCalled();
      } finally {
        await blocked.app.close();
      }
    }
  });
});
