/**
 * Knowledge Indexer & Document Ingestion Engine.
 *
 * Implements RAG document ingestion:
 * - Semantic chunking (Markdown, Code, Prose)
 * - Atomic file refresh (pruning stale chunks before writing updated ones)
 * - Metadata indexing with heading breadcrumbs and line boundaries
 * - Hybrid search with Reciprocal Rank Fusion (RRF)
 */

import type { Memory } from '@tj/schemas';
import type { Database } from '../db/database.js';
import type { EventBus } from '../core/event-bus.js';
import type { ModelRouter } from '../models/router.js';
import { MemoryService } from './memory.js';
import { chunkDocument, type DocumentChunk, type DocumentFormat } from './chunker.js';
import { reciprocalRankFusion, type RankedHit } from './hybrid-retriever.js';

export interface IngestDocumentOptions {
  workspace_id?: string;
  project_id?: string | null;
  agent_id?: string | null;
  file_path: string;
  content: string;
  format?: DocumentFormat;
  category?: string;
}

export interface IngestResult {
  file_path: string;
  chunks_created: number;
  total_characters: number;
  memory_ids: string[];
}

export interface KnowledgeQueryResult {
  file_path?: string;
  section_title?: string;
  start_line?: number;
  end_line?: number;
  chunk_index?: number;
  total_chunks?: number;
  content: string;
  score: number;
  matched_by: ('keyword' | 'semantic')[];
  memory: Memory;
}

export class KnowledgeIndexer {
  constructor(
    private db: Database,
    private bus: EventBus,
    private memory: MemoryService,
    private router: ModelRouter | null = null,
  ) {}

  setRouter(router: ModelRouter) {
    this.router = router;
  }

  /**
   * Ingests a complete document or code file: chunks it, cleans older chunks for this file,
   * stores new chunks into the memory store, and triggers embedding vectors.
   */
  async ingestDocument(input: IngestDocumentOptions): Promise<IngestResult> {
    const filePath = input.file_path;
    const workspaceId = input.workspace_id ?? 'default';

    // 1. Generate semantic chunks
    const chunks = chunkDocument(input.content, {
      filePath,
      format: input.format,
    });

    if (chunks.length === 0) {
      return {
        file_path: filePath,
        chunks_created: 0,
        total_characters: 0,
        memory_ids: [],
      };
    }

    // 2. Prune previous memories associated with this exact file path
    const fileSource = `file:${filePath}`;
    const oldMemories = this.db.all<{ id: string }>(
      'SELECT id FROM memories WHERE source = ? AND workspace_id = ?',
      [fileSource, workspaceId],
    );
    for (const old of oldMemories) {
      this.memory.delete(old.id);
    }

    // 3. Save each chunk with full provenance and structural metadata
    const memoryIds: string[] = [];
    for (const chunk of chunks) {
      const memory = await this.memory.create({
        workspace_id: workspaceId,
        project_id: input.project_id ?? null,
        agent_id: input.agent_id ?? null,
        type: 'project',
        content: chunk.content,
        source: fileSource,
        owner: 'system',
        confidence: 0.95,
        provenance: {
          file_path: filePath,
          chunk_index: chunk.chunk_index,
          total_chunks: chunk.total_chunks,
          section_title: chunk.section_title,
          start_line: chunk.start_line,
          end_line: chunk.end_line,
          char_count: chunk.char_count,
          category: input.category ?? 'document',
          ...chunk.metadata,
        },
        sensitivity: 'internal',
        retention: 'long',
      });
      memoryIds.push(memory.id);
    }

    this.bus.emit({
      name: 'memory.created',
      summary: `Indexed ${chunks.length} chunks from ${filePath}`,
      project_id: input.project_id ?? undefined,
      agent_id: input.agent_id ?? undefined,
      data: {
        file_path: filePath,
        chunks_count: chunks.length,
        memory_ids: memoryIds,
      },
    });

    return {
      file_path: filePath,
      chunks_created: chunks.length,
      total_characters: input.content.length,
      memory_ids: memoryIds,
    };
  }

  /**
   * Queries the knowledge base with hybrid retrieval and structural breadcrumbs.
   */
  async query(
    queryText: string,
    options: {
      project_id?: string | null;
      agent_id?: string;
      file_path?: string;
      limit?: number;
      minScore?: number;
    } = {},
  ): Promise<KnowledgeQueryResult[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 10, 50));
    const hits = await this.memory.search(queryText, {
      project_id: options.project_id,
      agent_id: options.agent_id,
      type: 'project',
      limit: limit * 2,
    });

    // Filter by specific file path if requested
    const filteredHits = options.file_path
      ? hits.filter((h) => h.memory.source === `file:${options.file_path}`)
      : hits;

    const results: KnowledgeQueryResult[] = [];

    for (const hit of filteredHits.slice(0, limit)) {
      const prov = (hit.memory.provenance as Record<string, unknown>) ?? {};
      results.push({
        file_path: typeof prov.file_path === 'string' ? prov.file_path : undefined,
        section_title: typeof prov.section_title === 'string' ? prov.section_title : undefined,
        start_line: typeof prov.start_line === 'number' ? prov.start_line : undefined,
        end_line: typeof prov.end_line === 'number' ? prov.end_line : undefined,
        chunk_index: typeof prov.chunk_index === 'number' ? prov.chunk_index : undefined,
        total_chunks: typeof prov.total_chunks === 'number' ? prov.total_chunks : undefined,
        content: hit.memory.content,
        score: hit.score,
        matched_by: hit.matched_by as ('keyword' | 'semantic')[],
        memory: hit.memory,
      });
    }

    return results;
  }
}
