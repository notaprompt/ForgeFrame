/**
 * @forgeframe/memory — Hebbian Engine
 *
 * Implements Hebbian learning on the memory graph:
 * - LTP: co-retrieved memories strengthen their connecting edges
 * - LTD: non-co-retrieved neighbors weaken
 * - Pruning: edges below 0.05 get deleted
 * - Refractory: 1-hour cooldown per edge
 * - Constitutional guard: principle/voice edges never modified
 */

import type { MemoryStore } from './store.js';
import type { Memory, MemoryEdge, HebbianBatchUpdate } from './types.js';
import { CONSTITUTIONAL_TAGS } from './types.js';

const LTP_INCREMENT = 0.05;
const LTD_DECREMENT = 0.02;
const WEIGHT_CAP = 2.0;
const PRUNE_THRESHOLD = 0.05;
const REFRACTORY_MS = 60 * 60 * 1000; // 1 hour
const CO_RETRIEVAL_THRESHOLD = 3;
const NEW_EDGE_WEIGHT = 0.3;

export class HebbianEngine {
  private _store: MemoryStore;
  private _guardianMultiplier: number = 1.0;
  /** Tracks co-retrieval count for pairs without edges. Key: sorted "id1:id2" */
  private _coRetrievalCounts: Map<string, number> = new Map();

  constructor(store: MemoryStore) {
    this._store = store;
  }

  /**
   * Set the Guardian temperature multiplier for Hebbian learning rate.
   * calm=1.0, warm=0.5, trapped=0.0
   */
  setGuardianMultiplier(multiplier: number): void {
    this._guardianMultiplier = Math.max(0, Math.min(1, multiplier));
  }

  /**
   * Apply Hebbian update to co-retrieved memories.
   * Called after search returns results.
   */
  hebbianUpdate(results: Memory[]): HebbianBatchUpdate {
    const batch: HebbianBatchUpdate = {
      strengthened: [],
      weakened: [],
      pruned: [],
      created: [],
    };

    if (results.length < 2 || this._guardianMultiplier === 0) {
      return batch;
    }

    const now = Date.now();
    const resultIds = new Set(results.map((m) => m.id));

    // LTP: strengthen co-retrieved pairs
    this._applyLTP(results, resultIds, now, batch);

    // LTD: weaken non-co-retrieved neighbors
    this._applyLTD(results, resultIds, now, batch);

    return batch;
  }

  private _isConstitutional(memory: Memory): boolean {
    return memory.tags.some((t) =>
      (CONSTITUTIONAL_TAGS as readonly string[]).includes(t)
    );
  }

  private _isRefractoryActive(edge: MemoryEdge, now: number): boolean {
    return edge.lastHebbianAt !== null && (now - edge.lastHebbianAt) < REFRACTORY_MS;
  }

  private _applyLTP(
    results: Memory[],
    _resultIds: Set<string>,
    now: number,
    batch: HebbianBatchUpdate,
  ): void {
    const increment = LTP_INCREMENT * this._guardianMultiplier;
    if (increment === 0) return;

    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const m1 = results[i];
        const m2 = results[j];

        // Skip if either is constitutional
        if (this._isConstitutional(m1) || this._isConstitutional(m2)) continue;

        const edge = this._store.getEdgeBetween(m1.id, m2.id);

        if (!edge) {
          // Track co-retrieval for unconnected pairs
          const pairKey = [m1.id, m2.id].sort().join(':');
          const count = (this._coRetrievalCounts.get(pairKey) ?? 0) + 1;
          this._coRetrievalCounts.set(pairKey, count);

          if (count >= CO_RETRIEVAL_THRESHOLD) {
            try {
              const newEdge = this._store.createEdge({
                sourceId: m1.id,
                targetId: m2.id,
                relationType: 'similar',
                weight: NEW_EDGE_WEIGHT,
              });
              batch.created.push({
                edgeId: newEdge.id,
                sourceId: m1.id,
                targetId: m2.id,
                weight: NEW_EDGE_WEIGHT,
              });
              this._coRetrievalCounts.delete(pairKey);
            } catch {
              // unique constraint — edge already exists via different path
            }
          }
          continue;
        }

        if (this._isRefractoryActive(edge, now)) continue;

        const newWeight = Math.min(WEIGHT_CAP, edge.weight + increment);
        this._store.updateEdgeWeight(edge.id, newWeight);
        batch.strengthened.push({ edgeId: edge.id, weight: newWeight });
      }
    }
  }

  private _applyLTD(
    results: Memory[],
    resultIds: Set<string>,
    now: number,
    batch: HebbianBatchUpdate,
  ): void {
    const decrement = LTD_DECREMENT * this._guardianMultiplier;
    if (decrement === 0) return;

    for (const m of results) {
      if (this._isConstitutional(m)) continue;

      const edges = this._store.getEdges(m.id);
      for (const edge of edges) {
        const neighborId = edge.sourceId === m.id ? edge.targetId : edge.sourceId;

        // Only weaken edges to nodes NOT in the result set
        if (resultIds.has(neighborId)) continue;

        // Check if neighbor is constitutional
        const neighbor = this._store.get(neighborId);
        if (!neighbor) continue;
        if (this._isConstitutional(neighbor)) continue;

        if (this._isRefractoryActive(edge, now)) continue;

        const newWeight = edge.weight - decrement;

        if (newWeight < PRUNE_THRESHOLD) {
          this._store.deleteEdge(edge.id);
          batch.pruned.push(edge.id);
        } else {
          this._store.updateEdgeWeight(edge.id, newWeight);
          batch.weakened.push({ edgeId: edge.id, weight: newWeight });
        }
      }
    }
  }
}
