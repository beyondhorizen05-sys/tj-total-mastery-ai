import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { Database } from '../src/db/database.js';
import { EventBus } from '../src/core/event-bus.js';
import { MemoryService } from '../src/memory/memory.js';
import { chunkDocument, detectFormat } from '../src/memory/chunker.js';
import { reciprocalRankFusion, analyzeQueryWeights } from '../src/memory/hybrid-retriever.js';
import { KnowledgeIndexer } from '../src/memory/knowledge-indexer.js';
import { memoryTools } from '../src/tools/builtin/memory-tools.js';
import { registerMemoryRoutes } from '../src/server/routes/memory.js';

describe('Production Hybrid RAG & Knowledge Subsystem', () => {
  describe('Document Chunker (Semantic & Structural)', () => {
    it('detects format accurately from content and file paths', () => {
      expect(detectFormat('# Title', 'doc.md')).toBe('markdown');
      expect(detectFormat('export function run() {}', 'src/run.ts')).toBe('code');
      expect(detectFormat('This is plain English prose.', 'notes.txt')).toBe('text');
      expect(detectFormat('```ts\nconst x = 1;\n```')).toBe('markdown');
      expect(detectFormat('function test() { return 42; }')).toBe('code');
    });

    it('chunks markdown respecting header hierarchy and code block fences', () => {
      const markdown = `
# Project Architecture

Here is the introduction to our project.

## Core Services

We implement several core services:
1. Orchestrator
2. EventBus

\`\`\`typescript
export class Orchestrator {
  start() {
    console.log("running");
  }
}
\`\`\`

### Data Persistence

The database uses SQLite in WAL mode for high concurrency.
`.trim();

      const chunks = chunkDocument(markdown, {
        filePath: 'docs/arch.md',
        targetChunkChars: 150,
      });

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks[0].total_chunks).toBe(chunks.length);
      expect(chunks[0].file_path).toBe('docs/arch.md');

      // Check header preservation
      const coreServiceChunk = chunks.find((c) => c.section_title?.includes('Core Services') || c.content.includes('Core Services'));
      expect(coreServiceChunk).toBeDefined();

      // Ensure code fence was preserved intact
      const codeFenceChunk = chunks.find((c) => c.content.includes('export class Orchestrator'));
      expect(codeFenceChunk).toBeDefined();
      expect(codeFenceChunk!.content).toContain('```typescript');
      expect(codeFenceChunk!.content).toContain('console.log("running");');
    });

    it('chunks source code preserving top-level declarations and line numbers', () => {
      const code = `
import { Database } from './db.js';

export class StateGraph {
  constructor(private name: string) {}

  compile() {
    return true;
  }
}

export function helperFunction(val: number): number {
  return val * 2;
}
`.trim();

      const chunks = chunkDocument(code, {
        filePath: 'src/core/state-graph.ts',
        format: 'code',
        targetChunkChars: 100,
      });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].start_line).toBe(1);
      expect(chunks[0].end_line).toBeGreaterThanOrEqual(chunks[0].start_line);
      expect(chunks[0].file_path).toBe('src/core/state-graph.ts');
    });

    it('chunks prose text at sentence boundaries with overlap', () => {
      const prose = `
Artificial intelligence agents require persistent memory to retain context across long sessions.
Without durable memory, each interaction begins anew with zero historical recall.
Hybrid retrieval bridges this gap by combining fast keyword search with dense vector similarity.
Reciprocal rank fusion synthesizes disparate ranking signals into a coherent relevance score.
This architecture enables accurate context injection without overwhelming token windows.
`.trim();

      const chunks = chunkDocument(prose, {
        format: 'text',
        targetChunkChars: 180,
        maxChunkChars: 250,
        overlapChars: 50,
      });

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks[0].content).toContain('Artificial intelligence');
    });
  });

  describe('Hybrid Retriever & Reciprocal Rank Fusion (RRF)', () => {
    it('adapts weights dynamically based on query characteristics', () => {
      // Identifier / path query favors keywords
      const codeQuery = analyzeQueryWeights('src/core/stateGraph.ts');
      expect(codeQuery.keywordWeight).toBeGreaterThan(codeQuery.vectorWeight);

      // Quoted query favors keywords
      const quoteQuery = analyzeQueryWeights('"exact match string"');
      expect(quoteQuery.keywordWeight).toBeGreaterThan(quoteQuery.vectorWeight);

      // Conversational / natural language query favors semantic vector
      const naturalQuery = analyzeQueryWeights('how does the multi-agent graph handle feedback critic loops');
      expect(naturalQuery.vectorWeight).toBeGreaterThan(naturalQuery.keywordWeight);
    });

    it('fuses keyword and semantic rankings correctly via RRF', () => {
      const kwResults = [
        { id: 'doc-1', item: { title: 'Doc 1' } },
        { id: 'doc-2', item: { title: 'Doc 2' } },
      ];
      const vecResults = [
        { id: 'doc-2', item: { title: 'Doc 2' } },
        { id: 'doc-3', item: { title: 'Doc 3' } },
      ];

      const fused = reciprocalRankFusion(kwResults, vecResults, 'general query', {
        k: 60,
        keywordWeight: 0.5,
        vectorWeight: 0.5,
      });

      // doc-2 appeared in BOTH keyword and semantic top ranks, so it must rank #1
      expect(fused.length).toBe(3);
      expect(fused[0].id).toBe('doc-2');
      expect(fused[0].matched_by).toContain('keyword');
      expect(fused[0].matched_by).toContain('semantic');
      expect(fused[0].score).toBeGreaterThan(fused[1].score);
    });
  });

  describe('KnowledgeIndexer & Memory Tools', () => {
    let db: Database;
    let bus: EventBus;
    let memory: MemoryService;
    let indexer: KnowledgeIndexer;

    beforeEach(() => {
      db = new Database(':memory:');
      db.migrate();
      bus = new EventBus(db);
      memory = new MemoryService(db, bus, null);
      indexer = new KnowledgeIndexer(db, bus, memory, null);
    });

    afterEach(() => {
      db.close();
    });

    it('indexes markdown document into memory chunks and performs hybrid queries', async () => {
      const doc = `
# TJ Agent Architecture

TJ is an autonomous operating system built with local-first privacy.

## State Graph Engine

The state graph engine allows cyclic node execution with critic loops.
Reducers accumulate state updates cleanly across agent steps.

## Memory Service

The hybrid memory service fuses BM25 FTS5 and dense cosine embeddings.
`.trim();

      const result = await indexer.ingestDocument({
        file_path: 'docs/tj-arch.md',
        content: doc,
        category: 'architecture',
      });

      expect(result.file_path).toBe('docs/tj-arch.md');
      expect(result.chunks_created).toBeGreaterThanOrEqual(1);
      expect(result.memory_ids.length).toBe(result.chunks_created);

      // Search via KnowledgeIndexer query
      const queryResults = await indexer.query('State Graph Engine critic loops');
      expect(queryResults.length).toBeGreaterThan(0);
      expect(queryResults[0].content).toContain('state graph engine');
      expect(queryResults[0].file_path).toBe('docs/tj-arch.md');

      // Re-indexing the same file cleans up old chunks and creates fresh ones
      const reindexResult = await indexer.ingestDocument({
        file_path: 'docs/tj-arch.md',
        content: '# Updated Arch\n\nOnly one chunk now.',
      });

      expect(reindexResult.chunks_created).toBe(1);
      const afterCount = db.get<{ c: number }>('SELECT COUNT(*) c FROM memories WHERE source = ?', ['file:docs/tj-arch.md']);
      expect(afterCount?.c).toBe(1);
    });

    it('provides knowledge_ingest and knowledge_query tools to agents', async () => {
      const tools = memoryTools(memory, indexer);
      expect(tools.map((t) => t.id)).toEqual(
        expect.arrayContaining(['memory_search', 'memory_save', 'knowledge_ingest', 'knowledge_query'])
      );

      const ingestTool = tools.find((t) => t.id === 'knowledge_ingest')!;
      const queryTool = tools.find((t) => t.id === 'knowledge_query')!;

      const ingestRes = await ingestTool.execute(
        {
          file_path: 'specs/security.md',
          content: '# Security Policy\nAll sensitive keys are encrypted in the vault using AES-256-GCM.',
        },
        { workspace_id: 'default', task_id: 'task-1' } as any,
      );
      expect(ingestRes.ok).toBe(true);
      expect(ingestRes.output).toContain('Indexed');

      const queryRes = await queryTool.execute(
        { query: 'AES-256-GCM vault security' },
        { workspace_id: 'default' } as any,
      );
      expect(queryRes.ok).toBe(true);
      expect(queryRes.output).toContain('AES-256-GCM');
      expect(queryRes.output).toContain('specs/security.md');
    });

    it('handles HTTP endpoints /api/v1/memory/ingest and /api/v1/memory/status', async () => {
      const app = Fastify();
      registerMemoryRoutes(app, { memory, indexer });

      // GET status
      const statusRes = await app.inject({ method: 'GET', url: '/api/v1/memory/status' });
      expect(statusRes.statusCode).toBe(200);
      expect(statusRes.json().indexer_available).toBe(true);

      // POST ingest
      const ingestRes = await app.inject({
        method: 'POST',
        url: '/api/v1/memory/ingest',
        payload: {
          file_path: 'guides/getting-started.md',
          content: '# Getting Started\nRun pnpm install and pnpm dev to start TJ.',
        },
      });
      expect(ingestRes.statusCode).toBe(200);
      expect(ingestRes.json().ok).toBe(true);
      expect(ingestRes.json().result.chunks_created).toBeGreaterThanOrEqual(1);

      await app.close();
    });
  });
});
