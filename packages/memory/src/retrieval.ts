/**
 * @forgeframe/memory — MemoryRetriever
 *
 * Combines FTS keyword search with semantic similarity for ranked retrieval.
 * Weights results by strength (recency + access frequency).
 */

import type { MemoryStore } from './store.js';
import type { Embedder } from './embedder.js';
import type { Memory, MemoryResult, MemoryQuery } from './types.js';
import { HebbianEngine } from './hebbian.js';

export class MemoryRetriever {
  private _store: MemoryStore;
  private _embedder: Embedder | null;
  private _hebbian: HebbianEngine | null;

  constructor(store: MemoryStore, embedder?: Embedder | null, opts?: { hebbian?: boolean }) {
    this._store = store;
    this._embedder = embedder ?? null;
    this._hebbian = opts?.hebbian ? new HebbianEngine(store) : null;
  }

  setGuardianMultiplier(multiplier: number): void {
    this._hebbian?.setGuardianMultiplier(multiplier);
  }

  get hebbian(): HebbianEngine | null {
    return this._hebbian;
  }

  /**
   * Retrieve memories using Reciprocal Rank Fusion (RRF) combining FTS
   * keyword results with graph-connected neighbors.
   */
  query(q: MemoryQuery): MemoryResult[] {
    const limit = q.limit ?? 10;
    const ftsRanked = this._store.searchWithRank(q.text ?? '', limit * 3);
    const candidates = new Map<string, { memory: Memory; ftsRank?: number; bm25Rank?: number; graphRank?: number }>();

    // Strategy 1: FTS with BM25 rank
    ftsRanked.forEach(({ memory: mem, bm25Rank }) => {
      candidates.set(mem.id, { memory: mem, ftsRank: candidates.size + 1, bm25Rank });
    });

    // Strategy 2: Graph walk from top-3 FTS seeds
    const seeds = ftsRanked.slice(0, 3).map((r) => r.memory);
    const graphNeighbors: Memory[] = [];
    for (const seed of seeds) {
      const sub = this._store.getSubgraph(seed.id, 1);
      for (const node of sub.nodes) {
        if (!candidates.has(node.id)) {
          graphNeighbors.push(node);
        }
      }
    }
    graphNeighbors.forEach((mem, idx) => {
      const existing = candidates.get(mem.id);
      if (existing) {
        existing.graphRank = idx + 1;
      } else {
        candidates.set(mem.id, { memory: mem, graphRank: idx + 1 });
      }
    });

    // RRF fusion with BM25-based FTS scoring
    const k = 60;
    const allBm25 = [...candidates.values()].map((c) => Math.abs(c.bm25Rank || 1));
    const maxBm25 = allBm25.length > 0 ? Math.max(...allBm25) : 1;
    const scored: MemoryResult[] = [];
    for (const [, { memory, ftsRank, bm25Rank, graphRank }] of candidates) {
      if (q.minStrength && memory.strength < q.minStrength) continue;
      if (q.tags?.length && !q.tags.some(t => memory.tags.includes(t))) continue;

      let score = 0;
      if (ftsRank) {
        // Use BM25 rank (negative: more negative = better) normalized to [0,1]
        score += Math.abs(bm25Rank || 0) / maxBm25 * (1 / (k + ftsRank));
      }
      if (graphRank) score += 1 / (k + graphRank);
      score += memory.strength * 0.01;

      scored.push({ memory, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, limit);

    const coRetrievedIds = results.map(r => r.memory.id);
    for (const r of results) {
      this._store.reconsolidate(r.memory.id, {
        relevanceScore: r.score,
        query: q.text,
        coRetrievedIds,
      });
    }

    if (q.sessionId) {
      const sessionMems = this._store.getBySession(q.sessionId);
      for (const mem of sessionMems) {
        if (!results.some(r => r.memory.id === mem.id)) {
          results.push({ memory: mem, score: mem.strength * 0.2 });
        }
      }
    }

    // Hebbian co-retrieval update
    if (this._hebbian && results.length >= 2) {
      this._hebbian.hebbianUpdate(results.map((r) => r.memory));
    }

    return results;
  }

  /**
   * Semantic search: embeds the query, brute-force cosine sim against stored embeddings,
   * merges with FTS results. Falls back to FTS-only if embedder unavailable.
   */
  async semanticQuery(q: MemoryQuery): Promise<MemoryResult[]> {
    const limit = q.limit || 10;
    const minStrength = q.minStrength || 0.0;

    // FTS results (position-scored)
    let ftsResults: Map<string, { memory: Memory; score: number }> = new Map();
    if (q.text) {
      const ftsMemories = this._store.search(q.text, limit * 3);
      ftsMemories.forEach((m, i) => {
        const posScore = 1.0 - (i / Math.max(ftsMemories.length, 1));
        ftsResults.set(m.id, { memory: m, score: posScore });
      });
    }

    // Semantic results
    let semScores: Map<string, number> = new Map();
    if (q.text && this._embedder) {
      const queryEmbedding = await this._embedder.embed(q.text);
      if (queryEmbedding) {
        const stored = this._store.getAllEmbeddings();
        for (const { id, embedding } of stored) {
          const sim = cosineSimilarity(queryEmbedding, embedding);
          if (sim > 0.3) {
            semScores.set(id, sim);
          }
        }
      }
    }

    // Merge candidate IDs
    const allIds = new Set([...ftsResults.keys(), ...semScores.keys()]);
    const results: MemoryResult[] = [];

    for (const id of allIds) {
      const fts = ftsResults.get(id);
      const memory = fts?.memory ?? this._store.get(id);
      if (!memory || memory.strength < minStrength) continue;

      // Tag filter
      if (q.tags && q.tags.length > 0) {
        if (!q.tags.some((tag) => memory.tags.includes(tag))) continue;
      }

      const textScore = fts?.score ?? 0;
      const semanticScore = semScores.get(id) ?? 0;
      const score = (textScore * 0.4) + (semanticScore * 0.4) + (memory.strength * 0.2);

      results.push({ memory, score });
    }

    // Session memories (if requested)
    if (q.sessionId) {
      const sessionMemories = this._store.getBySession(q.sessionId);
      for (const m of sessionMemories) {
        if (!allIds.has(m.id) && m.strength >= minStrength) {
          if (!q.tags || q.tags.length === 0 || q.tags.some((t) => m.tags.includes(t))) {
            results.push({ memory: m, score: m.strength * 0.2 });
          }
        }
      }
    }

    results.sort((a, b) => b.score - a.score);
    const final = results.slice(0, limit);

    // Record access
    for (const r of final) {
      this._store.recordAccess(r.memory.id);
    }

    // Hebbian co-retrieval update
    if (this._hebbian && final.length >= 2) {
      this._hebbian.hebbianUpdate(final.map((r) => r.memory));
    }

    return final;
  }

  private _mergeUnique(a: Memory[], b: Memory[]): Memory[] {
    const seen = new Set(a.map((m) => m.id));
    const merged = [...a];
    for (const m of b) {
      if (!seen.has(m.id)) {
        merged.push(m);
        seen.add(m.id);
      }
    }
    return merged;
  }
}

function cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
