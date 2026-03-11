/**
 * @forgeframe/memory — MemoryRetriever
 *
 * Combines FTS keyword search with semantic similarity for ranked retrieval.
 * Weights results by strength (recency + access frequency).
 */

import type { MemoryStore } from './store.js';
import type { Embedder } from './embedder.js';
import type { Memory, MemoryResult, MemoryQuery } from './types.js';

export class MemoryRetriever {
  private _store: MemoryStore;
  private _embedder: Embedder | null;

  constructor(store: MemoryStore, embedder?: Embedder | null) {
    this._store = store;
    this._embedder = embedder ?? null;
  }

  /**
   * Retrieve memories ranked by combined keyword + strength score.
   * Semantic similarity (embedding-based) will be added when the
   * embedding pipeline is wired.
   */
  query(q: MemoryQuery): MemoryResult[] {
    const limit = q.limit || 10;
    const minStrength = q.minStrength || 0.0;

    let candidates: Memory[] = [];

    if (q.text) {
      candidates = this._store.search(q.text, limit * 3);
    }

    if (q.sessionId) {
      const sessionMemories = this._store.getBySession(q.sessionId);
      candidates = this._mergeUnique(candidates, sessionMemories);
    }

    // Filter by minimum strength
    candidates = candidates.filter((m) => m.strength >= minStrength);

    // Filter by tags if specified
    if (q.tags && q.tags.length > 0) {
      candidates = candidates.filter((m) =>
        q.tags!.some((tag) => m.tags.includes(tag))
      );
    }

    // Score: combine text relevance position with strength
    const results: MemoryResult[] = candidates.map((memory, index) => {
      const positionScore = 1.0 - (index / Math.max(candidates.length, 1));
      const score = (positionScore * 0.6) + (memory.strength * 0.4);
      return { memory, score };
    });

    // Record access for retrieved memories
    results.slice(0, limit).forEach((r) => {
      this._store.recordAccess(r.memory.id);
    });

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
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
