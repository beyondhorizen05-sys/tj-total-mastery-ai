import type { Tool } from '../types.js';
import { ok, fail } from '../types.js';
import type { MemoryService } from '../../memory/memory.js';

export function memoryTools(memory: MemoryService): Tool[] {
  return [
    {
      id: 'memory_search', name: 'Search memory', description: 'Search TJ memory (hybrid keyword + semantic) for relevant prior knowledge.', domain: 'memory',
      input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
      permission: 'memory.read', risk: 'low', reversible: true, resource: () => 'memory',
      async execute(a, ctx) {
        const hits = await memory.search(String(a.query), { project_id: ctx.project_id, agent_id: ctx.agent_id ?? undefined, limit: Number(a.limit ?? 5) });
        if (!hits.length) return ok('No matching memories.');
        return ok(hits.map((h, i) => `${i + 1}. [${h.memory.type}] ${h.memory.content} (conf ${h.memory.confidence}, via ${h.matched_by.join('+')})`).join('\n'), { data: { count: hits.length } });
      },
    },
    {
      id: 'memory_save', name: 'Save memory', description: 'Save a durable fact, decision or finding to memory with provenance.', domain: 'memory',
      input_schema: { type: 'object', properties: { content: { type: 'string' }, type: { type: 'string', enum: ['semantic', 'episodic', 'procedural', 'project', 'preference'] }, confidence: { type: 'number' } }, required: ['content'] },
      permission: 'memory.write', risk: 'low', reversible: true, resource: () => 'memory',
      async execute(a, ctx) {
        if (!String(a.content ?? '').trim()) return fail('content is required');
        const m = await memory.create({ workspace_id: ctx.workspace_id, project_id: ctx.project_id, agent_id: ctx.agent_id, type: (a.type as any) ?? 'semantic', content: String(a.content), source: ctx.agent_id ? `agent:${ctx.agent_id}` : 'tj', owner: 'tj', confidence: Number(a.confidence ?? 0.7), provenance: { task_id: ctx.task_id, workflow_run_id: ctx.workflow_run_id } });
        return ok(`Saved memory ${m.id}`, { data: { memory_id: m.id } });
      },
    },
  ];
}
