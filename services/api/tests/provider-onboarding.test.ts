import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { registerModelRoutes } from '../src/server/routes/models.js';
import type { ModelRegistry } from '../src/models/registry.js';
import type { ModelRouter } from '../src/models/router.js';
import type { ChatGPTPlanService } from '../src/models/chatgpt-plan.js';
describe('Automatic provider discovery (mocked)', () => {
  const payload = { name: 'Local test', kind: 'ollama', base_url: 'http://127.0.0.1:11434' };
  for (const success of [true, false]) {
    it(success ? 'discovers models immediately' : 'reports unverified provider without inventing success', async () => {
      const registry = {
        addProvider: vi.fn(() => ({ id: 'local', requires_api_key: false, credential_ref: null })),
        fetchModels: vi.fn(async () => {
          if (!success) throw new Error('Local model server not running');
          return [{ id: 'local/test-model' }];
        }),
      } as unknown as ModelRegistry;
      const app = Fastify();
      registerModelRoutes(app, { registry, router: {} as ModelRouter, chatgptPlan: {} as ChatGPTPlanService });
      const res = await app.inject({ method: 'POST', url: '/api/v1/models/providers', payload });
      expect(res.statusCode).toBe(200);
      expect(res.json().discovery.status).toBe(success ? 'discovered' : 'unverified');
      expect(res.json().discovery.model_count).toBe(success ? 1 : 0);
      expect(registry.fetchModels).toHaveBeenCalledOnce();
      await app.close();
    });
  }
});