/**
 * Production Hybrid Retriever with Reciprocal Rank Fusion (RRF) & Relevance Filtering.
 *
 * Implements RAG Engineer best practices:
 * - Fuses BM25 / FTS5 keyword results with Dense Vector Cosine Similarity
 * - Dynamic weighting based on query characteristics (identifiers vs semantic natural language)
 * - Anti-hallucination threshold filtering (discards noisy bottom-tier hits)
 * - Deduplication and coherent provenance tracking
 */

export interface RankedHit<T = unknown> {
  id: string;
  item: T;
  score: number;
  matched_by: ('keyword' | 'semantic')[];
  keywordRank?: number;
  semanticRank?: number;
}

export interface HybridRetrieverOptions {
  /** RRF smoothing constant (default: 60) */
  k?: number;
  /** Keyword weight (default: auto or 0.5) */
  keywordWeight?: number;
  /** Semantic vector weight (default: auto or 0.5) */
  vectorWeight?: number;
  /** Minimum relevance score to retain a hit (default: 0.005) */
  minRelevanceScore?: number;
  /** Maximum number of combined hits to return (default: 10) */
  limit?: number;
}

/**
 * Analyzes query syntax to determine optimal hybrid weights.
 * Technical identifiers, file paths, and exact quotes favor keyword retrieval;
 * natural language sentences favor dense semantic embeddings.
 */
export function analyzeQueryWeights(query: string): { keywordWeight: number; vectorWeight: number } {
  const trimmed = query.trim();

  // If query uses quotes, symbols, camelCase, snake_case, or paths
  const hasQuotes = /"[^"]+"/.test(trimmed);
  const hasPaths = /[\\/][A-Za-z0-9_.-]+/.test(trimmed);
  const hasCamelCase = /[a-z]+[A-Z]/.test(trimmed);
  const hasSnakeCase = /[a-z0-9]+_[a-z0-9]+/i.test(trimmed);
  const hasIdentifiers = hasCamelCase || hasSnakeCase;
  const isVeryShort = trimmed.split(/\s+/).length <= 2;

  if (hasQuotes || hasPaths || hasIdentifiers) {
    return { keywordWeight: 0.7, vectorWeight: 0.3 };
  }
  if (isVeryShort) {
    return { keywordWeight: 0.6, vectorWeight: 0.4 };
  }
  // Natural language query (3+ words, standard punctuation)
  return { keywordWeight: 0.4, vectorWeight: 0.6 };
}

/**
 * Computes Reciprocal Rank Fusion of keyword and semantic rankings.
 */
export function reciprocalRankFusion<T>(
  keywordResults: { id: string; item: T }[],
  semanticResults: { id: string; item: T; similarity?: number }[],
  query: string,
  options: HybridRetrieverOptions = {},
): RankedHit<T>[] {
  const k = options.k ?? 60;
  const limit = options.limit ?? 10;
  const minScore = options.minRelevanceScore ?? 0.005;

  let kwWeight = options.keywordWeight;
  let vecWeight = options.vectorWeight;

  if (kwWeight == null || vecWeight == null) {
    const dynamic = analyzeQueryWeights(query);
    kwWeight = kwWeight ?? dynamic.keywordWeight;
    vecWeight = vecWeight ?? dynamic.vectorWeight;
  }

  interface Intermediate {
    item: T;
    score: number;
    matched_by: Set<'keyword' | 'semantic'>;
    kwRank?: number;
    vecRank?: number;
  }

  const map = new Map<string, Intermediate>();

  // 1. Process keyword ranks (0-indexed rank)
  for (let i = 0; i < keywordResults.length; i++) {
    const { id, item } = keywordResults[i];
    const rankScore = (kwWeight ?? 0.5) / (k + i + 1);
    const existing = map.get(id);
    if (existing) {
      existing.score += rankScore;
      existing.matched_by.add('keyword');
      existing.kwRank = i + 1;
    } else {
      map.set(id, {
        item,
        score: rankScore,
        matched_by: new Set(['keyword']),
        kwRank: i + 1,
      });
    }
  }

  // 2. Process semantic vector ranks (0-indexed rank)
  for (let i = 0; i < semanticResults.length; i++) {
    const { id, item } = semanticResults[i];
    const rankScore = (vecWeight ?? 0.5) / (k + i + 1);
    const existing = map.get(id);
    if (existing) {
      existing.score += rankScore;
      existing.matched_by.add('semantic');
      existing.vecRank = i + 1;
    } else {
      map.set(id, {
        item,
        score: rankScore,
        matched_by: new Set(['semantic']),
        vecRank: i + 1,
      });
    }
  }

  // 3. Sort by aggregated RRF score descending
  const sorted = [...map.entries()]
    .map(([id, entry]) => ({
      id,
      item: entry.item,
      score: entry.score,
      matched_by: [...entry.matched_by],
      keywordRank: entry.kwRank,
      semanticRank: entry.vecRank,
    }))
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => b.score - a.score);

  return sorted.slice(0, limit);
}
