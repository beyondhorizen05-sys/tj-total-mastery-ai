import type { Tool } from '../types.js';
import { ok, fail } from '../types.js';
import type { MemoryService } from '../../memory/memory.js';
import type { KnowledgeIndexer } from '../../memory/knowledge-indexer.js';

export function memoryTools(memory: MemoryService, indexer?: KnowledgeIndexer): Tool[] {
  const tools: Tool[] = [
    {
      id: 'memory_search',
      name: 'Search memory',
      description: 'Search TJ memory (hybrid keyword + semantic) for relevant prior knowledge.',
      domain: 'memory',
      input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
      permission: 'memory.read',
      risk: 'low',
      reversible: true,
      resource: () => 'memory',
      async execute(a, ctx) {
        const hits = await memory.search(String(a.query), {
          project_id: ctx.project_id,
          agent_id: ctx.agent_id ?? undefined,
          limit: Number(a.limit ?? 5),
        });
        if (!hits.length) return ok('No matching memories.');
        return ok(
          hits.map((h, i) => `${i + 1}. [${h.memory.type}] ${h.memory.content} (conf ${h.memory.confidence}, via ${h.matched_by.join('+')})`).join('\n'),
          { data: { count: hits.length } },
        );
      },
    },
    {
      id: 'memory_save',
      name: 'Save memory',
      description: 'Save a durable fact, decision or finding to memory with provenance.',
      domain: 'memory',
      input_schema: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          type: { type: 'string', enum: ['semantic', 'episodic', 'procedural', 'project', 'preference'] },
          confidence: { type: 'number' },
        },
        required: ['content'],
      },
      permission: 'memory.write',
      risk: 'low',
      reversible: true,
      resource: () => 'memory',
      async execute(a, ctx) {
        if (!String(a.content ?? '').trim()) return fail('content is required');
        const m = await memory.create({
          workspace_id: ctx.workspace_id,
          project_id: ctx.project_id,
          agent_id: ctx.agent_id,
          type: (a.type as any) ?? 'semantic',
          content: String(a.content),
          source: ctx.agent_id ? `agent:${ctx.agent_id}` : 'tj',
          owner: 'tj',
          confidence: Number(a.confidence ?? 0.7),
          provenance: { task_id: ctx.task_id, workflow_run_id: ctx.workflow_run_id },
        });
        return ok(`Saved memory ${m.id}`, { data: { memory_id: m.id } });
      },
    },
  ];

  if (indexer) {
    tools.push({
      id: 'knowledge_ingest',
      name: 'Ingest knowledge document',
      description: 'Ingest and index a document, markdown guide, or source code file with semantic chunking and structural breadcrumbs.',
      domain: 'memory',
      input_schema: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          content: { type: 'string' },
          format: { type: 'string', enum: ['markdown', 'code', 'text', 'auto'] },
          category: { type: 'string' },
        },
        required: ['file_path', 'content'],
      },
      permission: 'memory.write',
      risk: 'low',
      reversible: true,
      resource: () => 'memory',
      async execute(a, ctx) {
        if (!String(a.file_path ?? '').trim()) return fail('file_path is required');
        if (!String(a.content ?? '').trim()) return fail('content is required');
        const result = await indexer.ingestDocument({
          workspace_id: ctx.workspace_id,
          project_id: ctx.project_id,
          agent_id: ctx.agent_id,
          file_path: String(a.file_path),
          content: String(a.content),
          format: a.format as any,
          category: a.category ? String(a.category) : undefined,
        });
        return ok(`Indexed ${result.chunks_created} chunks from ${result.file_path} (${result.total_characters} characters)`, { data: { ...result } });
      },
    });

    tools.push({
      id: 'knowledge_query',
      name: 'Query knowledge base',
      description: 'Query the knowledge base using hybrid retrieval (BM25 + Semantic vector RRF) to find relevant document and code chunks with file paths and line ranges.',
      domain: 'memory',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          file_path: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
      permission: 'memory.read',
      risk: 'low',
      reversible: true,
      resource: () => 'memory',
      async execute(a, ctx) {
        if (!String(a.query ?? '').trim()) return fail('query is required');
        const hits = await indexer.query(String(a.query), {
          project_id: ctx.project_id,
          agent_id: ctx.agent_id ?? undefined,
          file_path: a.file_path ? String(a.file_path) : undefined,
          limit: Number(a.limit ?? 5),
        });
        if (!hits.length) return ok('No matching knowledge chunks found.');
        const formatted = hits.map((h, i) => {
          const loc = h.file_path ? ` [${h.file_path}${h.start_line ? ` L${h.start_line}-L${h.end_line}` : ''}]` : '';
          const sec = h.section_title ? ` (${h.section_title})` : '';
          return `${i + 1}.${loc}${sec} (Score: ${(h.score * 100).toFixed(1)}%)\n${h.content}`;
        }).join('\n\n---\n\n');
        return ok(formatted, { data: { count: hits.length } });
      },
    });
  }

  return tools;
}
