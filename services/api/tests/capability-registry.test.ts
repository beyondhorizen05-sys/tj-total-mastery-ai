import { describe, expect, it, vi } from 'vitest';
import { CapabilityRegistry } from '../src/core/capabilities.js';

function registry(options: { embedded?: number; embeddings?: Array<Record<string, unknown>> } = {}) {
  const router = { candidates: vi.fn(({ task_type }: { task_type: string }) => task_type === 'embedding' ? options.embeddings ?? [] : []) };
  const db = {
    ftsAvailable: true,
    get: vi.fn((sql: string) => sql.includes('COUNT(*)') ? { count: options.embedded ?? 0 } : { ok: 1 }),
  };
  const value = new CapabilityRegistry({
    db: db as never, router: router as never,
    tools: { get: () => null } as never,
    connectors: { list: async () => [], getPlanned: () => [] } as never,
    vault: {} as never,
  });
  return { value, router };
}

describe('capability registry status evidence', () => {
  it('does not advertise semantic search as experimental from stored vectors alone', async () => {
    const { value, router } = registry({ embedded: 3, embeddings: [] });
    const semantic = (await value.list()).find((item) => item.capability_id === 'memory.semantic');
    expect(semantic).toMatchObject({ status: 'NEEDS_SETUP', health: 'misconfigured', provider: null, missing: expect.stringContaining('No enabled embedding model') });
    expect(router.candidates).toHaveBeenCalledWith({ task_type: 'embedding' });
  });

  it('requires both a configured embedding route and embedded memories before advertising the feature', async () => {
    const candidate = { provider_id: 'ollama', model: 'nomic-embed-text' };
    const empty = await registry({ embedded: 0, embeddings: [candidate] }).value.list();
    expect(empty.find((item) => item.capability_id === 'memory.semantic')).toMatchObject({ status: 'NEEDS_SETUP', provider: 'ollama', required_credentials: [], missing: expect.stringContaining('no memories have embeddings') });

    const ready = await registry({ embedded: 2, embeddings: [candidate] }).value.list();
    expect(ready.find((item) => item.capability_id === 'memory.semantic')).toMatchObject({ status: 'EXPERIMENTAL', provider: 'ollama', missing: null });
  });
});
