/**
 * @forgeframe/memory — MemoryRetriever
 *
 * Combines FTS keyword search with semantic similarity for ranked retrieval.
 * Weights results by strength (recency + access frequency).
 */

import type { MemoryStore } from './store.js';
import type { Memory, MemoryResult, MemoryQuery } from './types.js';

export class MemoryRetriever {
  private _store: MemoryStore;

  constructor(store: MemoryStore) {
    this._store = store;
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
