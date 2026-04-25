# Wave 1: Hebbian Memory Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Hebbian learning into ForgeFrame's memory retrieval — co-retrieved memories strengthen their edges, non-co-retrieved neighbors weaken, dead synapses get pruned, and constitutional edges are never touched.

**Architecture:** The Hebbian engine lives in a new `hebbian.ts` module in `packages/memory/src/`. It hooks into `MemoryRetriever.query()` and `semanticQuery()` — after results are returned and access is recorded, a `hebbianUpdate()` call applies LTP (strengthening) to co-retrieved pairs and LTD (weakening) to non-co-retrieved neighbors. A 1-hour refractory period prevents session-hammering. Guardian temperature modulates the learning rate (calm=1x, warm=0.5x, trapped=0x). A new `hebbianImbalance` signal joins Guardian as the 7th signal. Migration 6 adds `last_hebbian_at` to `memory_edges`.

**Tech Stack:** TypeScript, better-sqlite3, vitest

**Spec reference:** `/Users/acamp/repos/ForgeFrame/docs/superpowers/specs/2026-04-12-signal-system-design.md` — Sections 2.2, 3.2, 3.3

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/memory/src/hebbian.ts` | CREATE | Hebbian engine: LTP, LTD, pruning, refractory period, co-retrieval tracking |
| `packages/memory/src/hebbian.test.ts` | CREATE | All Hebbian tests |
| `packages/memory/src/types.ts` | MODIFY | Add `lastHebbianAt` to `MemoryEdge`, `HebbianUpdate` result type, update `GuardianSignals` |
| `packages/memory/src/store.ts` | MODIFY | Migration 6, `updateEdgeWeight()`, `deleteEdgeById()`, `getEdgeBetween()`, `getAllEdgeWeights()` |
| `packages/memory/src/guardian.ts` | MODIFY | Add 7th signal `hebbianImbalance`, reweight to 1/7 |
| `packages/memory/src/guardian.test.ts` | CREATE | Guardian tests (currently untested — add coverage) |
| `packages/memory/src/retrieval.ts` | MODIFY | Call Hebbian update after search results |
| `packages/memory/src/index.ts` | MODIFY | Export `HebbianEngine` and new types |
| `packages/server/src/events.ts` | MODIFY | Add `hebbian:batch-update` event type |

---

## Task 1: Migration 6 — Add `last_hebbian_at` to `memory_edges`

**Files:**
- Modify: `packages/memory/src/store.ts:28-125` (MIGRATIONS + SCHEMA_VERSION)

- [ ] **Step 1: Write the failing test**

Create `packages/memory/src/hebbian.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';

describe('Hebbian Engine — Schema', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('memory_edges table has last_hebbian_at column', () => {
    const m1 = store.create({ content: 'memory alpha' });
    const m2 = store.create({ content: 'memory beta' });
    const edge = store.createEdge({
      sourceId: m1.id,
      targetId: m2.id,
      relationType: 'similar',
    });

    // The edge should have lastHebbianAt as null (never modified by Hebbian)
    expect(edge).toHaveProperty('lastHebbianAt');
    expect(edge.lastHebbianAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/hebbian.test.ts`
Expected: FAIL — `lastHebbianAt` property does not exist on edge

- [ ] **Step 3: Add migration 6 and update schema version**

In `packages/memory/src/store.ts`, change `SCHEMA_VERSION` from 5 to 6, and add migration 6:

```typescript
private static readonly SCHEMA_VERSION = 6;
```

Add to MIGRATIONS after the existing entry for 5:

```typescript
    6: `
      ALTER TABLE memory_edges ADD COLUMN last_hebbian_at INTEGER;
    `,
```

- [ ] **Step 4: Update `_rowToEdge` to include `lastHebbianAt`**

In `packages/memory/src/store.ts`, update the `_rowToEdge` method:

```typescript
  private _rowToEdge(row: any): MemoryEdge {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      relationType: row.relation_type,
      weight: row.weight,
      createdAt: row.created_at,
      lastHebbianAt: row.last_hebbian_at ?? null,
      metadata: JSON.parse(row.metadata ?? '{}'),
    };
  }
```

- [ ] **Step 5: Update `MemoryEdge` type**

In `packages/memory/src/types.ts`, add `lastHebbianAt` to the `MemoryEdge` interface:

```typescript
export interface MemoryEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: EdgeRelationType;
  weight: number;
  createdAt: number;
  lastHebbianAt: number | null;
  metadata: Record<string, unknown>;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/hebbian.test.ts`
Expected: PASS

- [ ] **Step 7: Run full test suite to check for regressions**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run`
Expected: All 386+ tests pass. If any tests reference `MemoryEdge` without `lastHebbianAt`, they will still pass because the field is nullable and existing code doesn't check for it.

- [ ] **Step 8: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame
git add packages/memory/src/store.ts packages/memory/src/types.ts packages/memory/src/hebbian.test.ts
git commit -m "add migration 6: last_hebbian_at column on memory_edges"
```

---

## Task 2: Store helpers — `updateEdgeWeight`, `getEdgeBetween`, `getAllEdgeWeights`

**Files:**
- Modify: `packages/memory/src/store.ts` (add 3 methods after existing edge methods ~line 590)

- [ ] **Step 1: Write failing tests**

Append to `packages/memory/src/hebbian.test.ts`:

```typescript
describe('Store — Edge helpers for Hebbian', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('updateEdgeWeight updates weight and last_hebbian_at', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    const edge = store.createEdge({
      sourceId: m1.id,
      targetId: m2.id,
      relationType: 'similar',
      weight: 1.0,
    });

    const before = Date.now();
    store.updateEdgeWeight(edge.id, 1.5);
    const updated = store.getEdge(edge.id)!;

    expect(updated.weight).toBe(1.5);
    expect(updated.lastHebbianAt).not.toBeNull();
    expect(updated.lastHebbianAt!).toBeGreaterThanOrEqual(before);
  });

  it('getEdgeBetween returns edge connecting two memories', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    store.createEdge({
      sourceId: m1.id,
      targetId: m2.id,
      relationType: 'similar',
      weight: 0.8,
    });

    // Either direction should work
    const edge1 = store.getEdgeBetween(m1.id, m2.id);
    const edge2 = store.getEdgeBetween(m2.id, m1.id);

    expect(edge1).not.toBeNull();
    expect(edge2).not.toBeNull();
    expect(edge1!.id).toBe(edge2!.id);
    expect(edge1!.weight).toBe(0.8);
  });

  it('getEdgeBetween returns null when no edge exists', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });

    expect(store.getEdgeBetween(m1.id, m2.id)).toBeNull();
  });

  it('getAllEdgeWeights returns all edge weights', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    const m3 = store.create({ content: 'gamma' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 0.5 });
    store.createEdge({ sourceId: m2.id, targetId: m3.id, relationType: 'related', weight: 1.5 });

    const weights = store.getAllEdgeWeights();
    expect(weights).toHaveLength(2);
    expect(weights.sort()).toEqual([0.5, 1.5]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/hebbian.test.ts`
Expected: FAIL — methods don't exist

- [ ] **Step 3: Implement the three methods**

Add to `packages/memory/src/store.ts` after the `deleteEdge` method (~line 586):

```typescript
  updateEdgeWeight(edgeId: string, weight: number): void {
    this._db.prepare(
      'UPDATE memory_edges SET weight = ?, last_hebbian_at = ? WHERE id = ?'
    ).run(weight, Date.now(), edgeId);
  }

  getEdgeBetween(memoryId1: string, memoryId2: string): MemoryEdge | null {
    const row = this._db.prepare(`
      SELECT * FROM memory_edges
      WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
      LIMIT 1
    `).get(memoryId1, memoryId2, memoryId2, memoryId1) as any;
    return row ? this._rowToEdge(row) : null;
  }

  getAllEdgeWeights(): number[] {
    const rows = this._db.prepare('SELECT weight FROM memory_edges').all() as any[];
    return rows.map((r) => r.weight);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/hebbian.test.ts`
Expected: PASS

- [ ] **Step 5: Run full suite**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame
git add packages/memory/src/store.ts packages/memory/src/hebbian.test.ts
git commit -m "add store helpers: updateEdgeWeight, getEdgeBetween, getAllEdgeWeights"
```

---

## Task 3: Hebbian Engine — LTP (co-retrieval strengthening)

**Files:**
- Create: `packages/memory/src/hebbian.ts`
- Modify: `packages/memory/src/types.ts` (add `HebbianBatchUpdate` type)

- [ ] **Step 1: Add the `HebbianBatchUpdate` type**

In `packages/memory/src/types.ts`, add after the `EdgeCreateInput` interface:

```typescript
export interface HebbianBatchUpdate {
  strengthened: Array<{ edgeId: string; weight: number }>;
  weakened: Array<{ edgeId: string; weight: number }>;
  pruned: string[];
  created: Array<{ edgeId: string; sourceId: string; targetId: string; weight: number }>;
}
```

- [ ] **Step 2: Write failing tests for LTP**

Append to `packages/memory/src/hebbian.test.ts`:

```typescript
import { HebbianEngine } from './hebbian.js';
import { CONSTITUTIONAL_TAGS } from './types.js';

describe('Hebbian Engine — LTP (co-retrieval strengthening)', () => {
  let store: MemoryStore;
  let engine: HebbianEngine;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
    engine = new HebbianEngine(store);
  });

  afterEach(() => {
    store.close();
  });

  it('strengthens edge between co-retrieved memories', () => {
    const m1 = store.create({ content: 'sovereignty principle' });
    const m2 = store.create({ content: 'sovereignty architecture' });
    const edge = store.createEdge({
      sourceId: m1.id,
      targetId: m2.id,
      relationType: 'similar',
      weight: 1.0,
    });

    const result = engine.hebbianUpdate([m1, m2]);

    const updated = store.getEdge(edge.id)!;
    expect(updated.weight).toBe(1.05);
    expect(result.strengthened).toHaveLength(1);
    expect(result.strengthened[0].edgeId).toBe(edge.id);
  });

  it('caps weight at 2.0', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    store.createEdge({
      sourceId: m1.id,
      targetId: m2.id,
      relationType: 'similar',
      weight: 1.98,
    });

    engine.hebbianUpdate([m1, m2]);

    const edge = store.getEdgeBetween(m1.id, m2.id)!;
    expect(edge.weight).toBe(2.0);
  });

  it('skips constitutional memories', () => {
    const m1 = store.create({ content: 'sovereignty principle', tags: ['principle'] });
    const m2 = store.create({ content: 'sovereignty architecture' });
    const edge = store.createEdge({
      sourceId: m1.id,
      targetId: m2.id,
      relationType: 'similar',
      weight: 1.0,
    });

    const result = engine.hebbianUpdate([m1, m2]);

    const updated = store.getEdge(edge.id)!;
    expect(updated.weight).toBe(1.0); // unchanged
    expect(result.strengthened).toHaveLength(0);
  });

  it('respects 1-hour refractory period', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    store.createEdge({
      sourceId: m1.id,
      targetId: m2.id,
      relationType: 'similar',
      weight: 1.0,
    });

    // First update should work
    engine.hebbianUpdate([m1, m2]);
    const afterFirst = store.getEdgeBetween(m1.id, m2.id)!;
    expect(afterFirst.weight).toBe(1.05);

    // Second update within 1 hour should skip
    engine.hebbianUpdate([m1, m2]);
    const afterSecond = store.getEdgeBetween(m1.id, m2.id)!;
    expect(afterSecond.weight).toBe(1.05); // unchanged
  });

  it('handles 3+ co-retrieved memories (all pairs)', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    const m3 = store.create({ content: 'gamma' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });
    store.createEdge({ sourceId: m2.id, targetId: m3.id, relationType: 'related', weight: 0.5 });
    store.createEdge({ sourceId: m1.id, targetId: m3.id, relationType: 'similar', weight: 0.8 });

    const result = engine.hebbianUpdate([m1, m2, m3]);

    expect(result.strengthened).toHaveLength(3);
    expect(store.getEdgeBetween(m1.id, m2.id)!.weight).toBe(1.05);
    expect(store.getEdgeBetween(m2.id, m3.id)!.weight).toBe(0.55);
    expect(store.getEdgeBetween(m1.id, m3.id)!.weight).toBe(0.85);
  });

  it('does nothing with 0 or 1 results', () => {
    const m1 = store.create({ content: 'alone' });
    const result = engine.hebbianUpdate([m1]);

    expect(result.strengthened).toHaveLength(0);
    expect(result.weakened).toHaveLength(0);
    expect(result.pruned).toHaveLength(0);
    expect(result.created).toHaveLength(0);
  });

  it('creates edge after 3 co-retrievals for unconnected pairs', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    // No edge between them

    // First two co-retrievals: no edge created
    engine.hebbianUpdate([m1, m2]);
    expect(store.getEdgeBetween(m1.id, m2.id)).toBeNull();

    engine.hebbianUpdate([m1, m2]);
    expect(store.getEdgeBetween(m1.id, m2.id)).toBeNull();

    // Third co-retrieval: edge created at weight 0.3
    engine.hebbianUpdate([m1, m2]);
    const edge = store.getEdgeBetween(m1.id, m2.id);
    expect(edge).not.toBeNull();
    expect(edge!.weight).toBe(0.3);
    expect(edge!.relationType).toBe('similar');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/hebbian.test.ts`
Expected: FAIL — `HebbianEngine` does not exist

- [ ] **Step 4: Implement HebbianEngine with LTP**

Create `packages/memory/src/hebbian.ts`:

```typescript
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/hebbian.test.ts`
Expected: All LTP tests PASS

- [ ] **Step 6: Run full suite**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame
git add packages/memory/src/hebbian.ts packages/memory/src/hebbian.test.ts packages/memory/src/types.ts
git commit -m "add Hebbian engine with LTP co-retrieval strengthening"
```

---

## Task 4: Hebbian Engine — LTD (long-term depression) + Pruning

**Files:**
- Modify: `packages/memory/src/hebbian.test.ts` (add LTD + pruning tests)

- [ ] **Step 1: Write failing tests for LTD and pruning**

Append to `packages/memory/src/hebbian.test.ts`:

```typescript
describe('Hebbian Engine — LTD (long-term depression)', () => {
  let store: MemoryStore;
  let engine: HebbianEngine;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
    engine = new HebbianEngine(store);
  });

  afterEach(() => {
    store.close();
  });

  it('weakens edges to non-co-retrieved neighbors', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    const m3 = store.create({ content: 'gamma — neighbor not in results' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });
    store.createEdge({ sourceId: m1.id, targetId: m3.id, relationType: 'related', weight: 0.5 });

    // m1 and m2 are co-retrieved, m3 is NOT
    const result = engine.hebbianUpdate([m1, m2]);

    // m1-m2 strengthened
    expect(store.getEdgeBetween(m1.id, m2.id)!.weight).toBe(1.05);
    // m1-m3 weakened (m3 not in results)
    expect(store.getEdgeBetween(m1.id, m3.id)!.weight).toBe(0.48);
    expect(result.weakened.length).toBeGreaterThanOrEqual(1);
  });

  it('does not weaken edges to constitutional neighbors', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    const principle = store.create({ content: 'sovereignty is non-negotiable', tags: ['principle'] });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });
    store.createEdge({ sourceId: m1.id, targetId: principle.id, relationType: 'related', weight: 0.5 });

    engine.hebbianUpdate([m1, m2]);

    // Edge to principle should be untouched
    expect(store.getEdgeBetween(m1.id, principle.id)!.weight).toBe(0.5);
  });

  it('prunes edges below 0.05 threshold', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    const m3 = store.create({ content: 'gamma — about to be pruned' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });
    store.createEdge({ sourceId: m1.id, targetId: m3.id, relationType: 'related', weight: 0.06 });

    const result = engine.hebbianUpdate([m1, m2]);

    // 0.06 - 0.02 = 0.04, which is < 0.05 threshold => pruned
    expect(store.getEdgeBetween(m1.id, m3.id)).toBeNull();
    expect(result.pruned).toHaveLength(1);
  });

  it('does not prune if weight stays above threshold', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    const m3 = store.create({ content: 'gamma' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });
    store.createEdge({ sourceId: m1.id, targetId: m3.id, relationType: 'related', weight: 0.2 });

    engine.hebbianUpdate([m1, m2]);

    // 0.2 - 0.02 = 0.18, above threshold
    const edge = store.getEdgeBetween(m1.id, m3.id)!;
    expect(edge.weight).toBeCloseTo(0.18);
  });

  it('LTD respects refractory period', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    const m3 = store.create({ content: 'gamma' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });
    store.createEdge({ sourceId: m1.id, targetId: m3.id, relationType: 'related', weight: 0.5 });

    // First update weakens m1-m3
    engine.hebbianUpdate([m1, m2]);
    expect(store.getEdgeBetween(m1.id, m3.id)!.weight).toBe(0.48);

    // Second update within refractory should NOT weaken further
    engine.hebbianUpdate([m1, m2]);
    expect(store.getEdgeBetween(m1.id, m3.id)!.weight).toBe(0.48);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/hebbian.test.ts`
Expected: All PASS — LTD logic was already implemented in Task 3. These tests verify the behavior.

- [ ] **Step 3: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame
git add packages/memory/src/hebbian.test.ts
git commit -m "add LTD and pruning tests for Hebbian engine"
```

---

## Task 5: Guardian — 7th signal `hebbianImbalance` + temperature modulation

**Files:**
- Modify: `packages/memory/src/types.ts:183-190` (add `hebbianImbalance` to `GuardianSignals`)
- Modify: `packages/memory/src/guardian.ts` (add 7th signal, reweight to 1/7)
- Create: `packages/memory/src/guardian.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/memory/src/guardian.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { GuardianComputer } from './guardian.js';
import type { GuardianSignals } from './types.js';

function calmSignals(): GuardianSignals {
  return {
    revisitWithoutAction: 0,
    timeSinceLastArtifactExit: 0,
    contradictionDensity: 0,
    orphanRatio: 0,
    decayVelocity: 0,
    recursionDepth: 0,
    hebbianImbalance: 0,
  };
}

describe('GuardianComputer', () => {
  const guardian = new GuardianComputer();

  it('returns calm state for zero signals', () => {
    const result = guardian.compute(calmSignals());
    expect(result.state).toBe('calm');
    expect(result.value).toBe(0);
  });

  it('uses 7 signals with equal weight (1/7)', () => {
    // If one signal is maxed out (1.0 after normalization), temperature = 1/7 ~= 0.143
    const signals = calmSignals();
    signals.recursionDepth = 5; // normalizes to 1.0
    const result = guardian.compute(signals);
    expect(result.value).toBeCloseTo(1 / 7, 4);
    expect(result.state).toBe('calm');
  });

  it('hebbianImbalance contributes to temperature', () => {
    const signals = calmSignals();
    signals.hebbianImbalance = 5.0; // normalizes to 1.0 (capped at 5.0)
    const result = guardian.compute(signals);
    expect(result.value).toBeCloseTo(1 / 7, 4);
  });

  it('all signals maxed = trapped', () => {
    const signals: GuardianSignals = {
      revisitWithoutAction: 10,
      timeSinceLastArtifactExit: 14 * 24 * 60 * 60 * 1000,
      contradictionDensity: 1.0,
      orphanRatio: 1.0,
      decayVelocity: 30,
      recursionDepth: 5,
      hebbianImbalance: 5.0,
    };
    const result = guardian.compute(signals);
    expect(result.value).toBeCloseTo(1.0, 1);
    expect(result.state).toBe('trapped');
  });

  it('hebbianMultiplier returns correct values per state', () => {
    expect(GuardianComputer.hebbianMultiplier('calm')).toBe(1.0);
    expect(GuardianComputer.hebbianMultiplier('warm')).toBe(0.5);
    expect(GuardianComputer.hebbianMultiplier('trapped')).toBe(0.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/guardian.test.ts`
Expected: FAIL — `hebbianImbalance` not on type, `hebbianMultiplier` method doesn't exist

- [ ] **Step 3: Update GuardianSignals type**

In `packages/memory/src/types.ts`, add the 7th signal:

```typescript
export interface GuardianSignals {
  revisitWithoutAction: number;
  timeSinceLastArtifactExit: number;
  contradictionDensity: number;
  orphanRatio: number;
  decayVelocity: number;
  recursionDepth: number;
  hebbianImbalance: number;
}
```

- [ ] **Step 4: Update GuardianComputer**

Replace `packages/memory/src/guardian.ts`:

```typescript
import type { GuardianSignals, GuardianTemperature } from './types.js';

export class GuardianComputer {
  compute(signals: GuardianSignals): GuardianTemperature {
    const normalized = {
      revisit: Math.min(signals.revisitWithoutAction / 10, 1),
      timeSinceShip: Math.min(signals.timeSinceLastArtifactExit / (14 * 24 * 60 * 60 * 1000), 1),
      contradictions: Math.min(signals.contradictionDensity, 1),
      orphans: Math.min(signals.orphanRatio, 1),
      decay: Math.min(signals.decayVelocity / 30, 1),
      recursion: Math.min(signals.recursionDepth / 5, 1),
      hebbianImbalance: Math.min(signals.hebbianImbalance / 5.0, 1),
    };

    const weight = 1 / 7;
    const raw =
      normalized.revisit * weight +
      normalized.timeSinceShip * weight +
      normalized.contradictions * weight +
      normalized.orphans * weight +
      normalized.decay * weight +
      normalized.recursion * weight +
      normalized.hebbianImbalance * weight;

    const value = Math.max(0, Math.min(1, raw));

    let state: 'calm' | 'warm' | 'trapped';
    if (value < 0.3) state = 'calm';
    else if (value < 0.6) state = 'warm';
    else state = 'trapped';

    return { value, state, signals, computedAt: Date.now() };
  }

  /**
   * Returns the Hebbian learning rate multiplier for a given Guardian state.
   * calm=1.0, warm=0.5, trapped=0.0
   */
  static hebbianMultiplier(state: 'calm' | 'warm' | 'trapped'): number {
    switch (state) {
      case 'calm': return 1.0;
      case 'warm': return 0.5;
      case 'trapped': return 0.0;
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/guardian.test.ts`
Expected: PASS

- [ ] **Step 6: Fix any callers that construct GuardianSignals without `hebbianImbalance`**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run`

If any tests fail because they construct `GuardianSignals` without `hebbianImbalance`, add `hebbianImbalance: 0` to those call sites. Known locations to check:
- `packages/server/src/tools.ts` — the `guardian_temp` tool handler constructs signals. Find where signals are built and add `hebbianImbalance: maxWeight / meanWeight` (or 0 if no edges).
- Any test files that directly construct `GuardianSignals` objects.

Search for all call sites:
```bash
cd /Users/acamp/repos/ForgeFrame && grep -rn 'GuardianSignals\|guardian.*compute\|guardian_temp' packages/ --include='*.ts' | grep -v node_modules | grep -v '.d.ts'
```

Update each call site to include `hebbianImbalance: 0` (or computed value).

- [ ] **Step 7: Run full suite**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame
git add packages/memory/src/types.ts packages/memory/src/guardian.ts packages/memory/src/guardian.test.ts
git commit -m "add hebbianImbalance as 7th Guardian signal, reweight to 1/7"
```

---

## Task 6: Guardian temperature modulates Hebbian learning rate

**Files:**
- Modify: `packages/memory/src/hebbian.test.ts` (add modulation tests)

- [ ] **Step 1: Write tests for Guardian modulation**

Append to `packages/memory/src/hebbian.test.ts`:

```typescript
describe('Hebbian Engine — Guardian temperature modulation', () => {
  let store: MemoryStore;
  let engine: HebbianEngine;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
    engine = new HebbianEngine(store);
  });

  afterEach(() => {
    store.close();
  });

  it('warm state halves the LTP increment', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });

    engine.setGuardianMultiplier(0.5); // warm
    engine.hebbianUpdate([m1, m2]);

    expect(store.getEdgeBetween(m1.id, m2.id)!.weight).toBeCloseTo(1.025);
  });

  it('trapped state halts all Hebbian updates', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    const m3 = store.create({ content: 'gamma' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });
    store.createEdge({ sourceId: m1.id, targetId: m3.id, relationType: 'related', weight: 0.5 });

    engine.setGuardianMultiplier(0.0); // trapped
    const result = engine.hebbianUpdate([m1, m2]);

    // No changes at all
    expect(result.strengthened).toHaveLength(0);
    expect(result.weakened).toHaveLength(0);
    expect(store.getEdgeBetween(m1.id, m2.id)!.weight).toBe(1.0);
    expect(store.getEdgeBetween(m1.id, m3.id)!.weight).toBe(0.5);
  });

  it('warm state halves the LTD decrement', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    const m3 = store.create({ content: 'gamma' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });
    store.createEdge({ sourceId: m1.id, targetId: m3.id, relationType: 'related', weight: 0.5 });

    engine.setGuardianMultiplier(0.5); // warm
    engine.hebbianUpdate([m1, m2]);

    // LTD decrement halved: 0.5 - (0.02 * 0.5) = 0.49
    expect(store.getEdgeBetween(m1.id, m3.id)!.weight).toBeCloseTo(0.49);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/hebbian.test.ts`
Expected: All PASS — the modulation logic was already implemented in Task 3.

- [ ] **Step 3: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame
git add packages/memory/src/hebbian.test.ts
git commit -m "add Guardian temperature modulation tests for Hebbian engine"
```

---

## Task 7: Wire Hebbian into MemoryRetriever

**Files:**
- Modify: `packages/memory/src/retrieval.ts` (call HebbianEngine after search)

- [ ] **Step 1: Write integration test**

Append to `packages/memory/src/hebbian.test.ts`:

```typescript
import { MemoryRetriever } from './retrieval.js';

describe('Hebbian Engine — Retriever integration', () => {
  let store: MemoryStore;
  let retriever: MemoryRetriever;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
    retriever = new MemoryRetriever(store, null, store);
  });

  afterEach(() => {
    store.close();
  });

  it('query() triggers Hebbian update on co-retrieved results', () => {
    const m1 = store.create({ content: 'sovereignty architecture patterns' });
    const m2 = store.create({ content: 'sovereignty data principles' });
    const edge = store.createEdge({
      sourceId: m1.id,
      targetId: m2.id,
      relationType: 'similar',
      weight: 1.0,
    });

    // Search for something that should return both
    retriever.query({ text: 'sovereignty' });

    // Edge should have been strengthened by Hebbian
    const updated = store.getEdge(edge.id)!;
    expect(updated.weight).toBe(1.05);
    expect(updated.lastHebbianAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/hebbian.test.ts -- -t "Retriever integration"`
Expected: FAIL — MemoryRetriever constructor doesn't accept store as 3rd arg, no Hebbian integration

- [ ] **Step 3: Update MemoryRetriever to wire in Hebbian**

Modify `packages/memory/src/retrieval.ts`. Add the HebbianEngine as an optional parameter, construct it when a store is available, and call it after results are returned.

Add import at the top:
```typescript
import { HebbianEngine } from './hebbian.js';
```

Update the class:
```typescript
export class MemoryRetriever {
  private _store: MemoryStore;
  private _embedder: Embedder | null;
  private _hebbian: HebbianEngine | null;

  constructor(store: MemoryStore, embedder?: Embedder | null, hebbianStore?: MemoryStore) {
    this._store = store;
    this._embedder = embedder ?? null;
    this._hebbian = hebbianStore ? new HebbianEngine(hebbianStore) : null;
  }

  /** Set Guardian multiplier on the internal Hebbian engine. */
  setGuardianMultiplier(multiplier: number): void {
    this._hebbian?.setGuardianMultiplier(multiplier);
  }

  /** Get the internal Hebbian engine (for testing or direct access). */
  get hebbian(): HebbianEngine | null {
    return this._hebbian;
  }
```

At the end of the `query()` method, after `recordAccess` and session handling, add before the return:

```typescript
    // Hebbian co-retrieval update
    if (this._hebbian && results.length >= 2) {
      this._hebbian.hebbianUpdate(results.map((r) => r.memory));
    }

    return results;
```

Similarly at the end of `semanticQuery()`, before the final return:

```typescript
    // Hebbian co-retrieval update
    if (this._hebbian && final.length >= 2) {
      this._hebbian.hebbianUpdate(final.map((r) => r.memory));
    }

    return final;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/hebbian.test.ts`
Expected: PASS

- [ ] **Step 5: Run full suite**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run`
Expected: All tests pass. Existing tests construct `MemoryRetriever(store, null)` which still works since `hebbianStore` is optional — Hebbian simply won't fire.

- [ ] **Step 6: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame
git add packages/memory/src/retrieval.ts packages/memory/src/hebbian.test.ts
git commit -m "wire Hebbian engine into MemoryRetriever query path"
```

---

## Task 8: SSE events + exports

**Files:**
- Modify: `packages/server/src/events.ts` (add `hebbian:batch-update` event)
- Modify: `packages/memory/src/index.ts` (export HebbianEngine + types)

- [ ] **Step 1: Add `hebbian:batch-update` event type**

In `packages/server/src/events.ts`, add to the `ServerEventMap` interface:

```typescript
import type { Memory, MemoryEdge, GuardianTemperature, HebbianBatchUpdate } from '@forgeframe/memory';

export interface ServerEventMap {
  'memory:created': [memory: Memory];
  'memory:accessed': [memory: Memory];
  'memory:updated': [memory: Memory];
  'memory:deleted': [id: string];
  'memory:decayed': [count: number];
  'memory:promoted': [memory: Memory];
  'session:started': [sessionId: string];
  'session:ended': [sessionId: string];
  'edge:created':   [edge: MemoryEdge];
  'edge:deleted':   [edgeId: string];
  'guardian:update': [temp: GuardianTemperature];
  'hebbian:batch-update': [update: HebbianBatchUpdate];
}
```

- [ ] **Step 2: Export HebbianEngine and HebbianBatchUpdate from index.ts**

In `packages/memory/src/index.ts`, add:

```typescript
export { HebbianEngine } from './hebbian.js';
```

And add `HebbianBatchUpdate` to the types export line:

```typescript
export type { MemoryEdge, EdgeCreateInput, EdgeRelationType, GuardianSignals, GuardianTemperature, ArtifactState, ArtifactStatus, MemoryType, HebbianBatchUpdate } from './types.js';
```

- [ ] **Step 3: Build to verify types compile**

Run: `cd /Users/acamp/repos/ForgeFrame && npm run build`
Expected: All packages compile clean

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame
git add packages/memory/src/index.ts packages/server/src/events.ts
git commit -m "export HebbianEngine, add hebbian:batch-update SSE event"
```

---

## Task 9: Wire Guardian temperature into server tools

**Files:**
- Modify: `packages/server/src/tools.ts` (update `guardian_temp` handler to include `hebbianImbalance`)

- [ ] **Step 1: Find and update the guardian_temp tool handler**

Search for where `GuardianSignals` is constructed in `packages/server/src/tools.ts`. The handler builds signals from store metrics. Add `hebbianImbalance` to the signals object:

```typescript
const weights = store.getAllEdgeWeights();
const maxWeight = weights.length > 0 ? Math.max(...weights) : 0;
const meanWeight = weights.length > 0 ? weights.reduce((a, b) => a + b, 0) / weights.length : 1;
const hebbianImbalance = meanWeight > 0 ? maxWeight / meanWeight : 0;
```

Add `hebbianImbalance` to the signals object passed to `guardian.compute()`.

- [ ] **Step 2: Build and test**

Run: `cd /Users/acamp/repos/ForgeFrame && npm run build && npx vitest run`
Expected: All compile, all tests pass

- [ ] **Step 3: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame
git add packages/server/src/tools.ts
git commit -m "add hebbianImbalance signal to guardian_temp tool"
```

---

## Task 10: Final verification

- [ ] **Step 1: Full build**

Run: `cd /Users/acamp/repos/ForgeFrame && npm run build`
Expected: Zero TypeScript errors across all packages

- [ ] **Step 2: Full test suite**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run --reporter=verbose`
Expected: All tests pass (should be 386 + ~20 new = ~406+)

- [ ] **Step 3: Verify new test count**

Count the new Hebbian + Guardian tests and confirm they cover:
- Co-retrieval strengthens edge weight
- Non-co-retrieved neighbor edges weaken
- Edges below 0.05 get pruned
- Constitutional edges skip Hebbian
- Refractory period prevents re-modification within 1 hour
- Weight caps at 2.0
- Guardian calm = 1x learning rate
- Guardian warm = 0.5x learning rate
- Guardian trapped = 0x (halt)
- hebbianImbalance signal computation
- Retriever integration fires Hebbian on search

- [ ] **Step 4: Manual smoke test with real MCP server (optional)**

```bash
cd /Users/acamp/repos/ForgeFrame
node packages/server/dist/index.js
# In another terminal, call memory_search and check that edges update
```
