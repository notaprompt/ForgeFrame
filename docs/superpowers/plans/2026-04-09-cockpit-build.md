# ForgeFrame Cockpit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Cockpit — ForgeFrame's operational surface — from memory layer upgrade through WebGL frontend, producing a live data-driven graph UI served at `GET /`.

**Architecture:** Extend `@forgeframe/memory` with edges table + temporal fields. Add Guardian temperature computation and artifact state machine. Build a vanilla HTML/CSS/JS + WebGL2 frontend (no framework, no build step) that connects to the existing Hono HTTP API via REST + SSE. Replace the swarm viewer at `GET /`.

**Tech Stack:** TypeScript (backend), Vanilla JS + WebGL2 + CSS custom properties (frontend), better-sqlite3, Hono, vitest

**Spec:** `docs/superpowers/specs/2026-04-09-cockpit-design.md`
**Design reference:** `.superpowers/brainstorm/86116-1775788246/content/cockpit-olive-v2.html`

**Security note:** Frontend uses `textContent` for user-generated content. Any HTML rendering of memory content must use safe DOM methods or a sanitizer — never raw innerHTML with untrusted data.

---

## File Structure

### Memory Package (`packages/memory/src/`)
| File | Action | Responsibility |
|---|---|---|
| `types.ts` | Modify | Add edge types, temporal fields, guardian types, artifact types |
| `store.ts` | Modify | Migration 5, edge CRUD, temporal queries, artifact CRUD |
| `retrieval.ts` | Modify | RRF fusion, graph traversal strategy |
| `guardian.ts` | Create | Temperature computation from signals |
| `index.ts` | Modify | Export new modules and types |

### Server Package (`packages/server/src/`)
| File | Action | Responsibility |
|---|---|---|
| `http.ts` | Modify | New endpoints: edges, graph, history, promote, artifacts, guardian, full graph |
| `tools.ts` | Modify | New MCP tools: memory_link, memory_graph, memory_promote, guardian_temp |
| `events.ts` | Modify | New event types: edge:created, edge:deleted, guardian:update, artifact:promoted |

### Cockpit Frontend (`cockpit/web/`)
| File | Action | Responsibility |
|---|---|---|
| `index.html` | Create | Single-file Cockpit UI — layout, styles, WebGL shader, all JS |

### Tests (`packages/memory/src/`, `packages/server/src/`)
| File | Action | Responsibility |
|---|---|---|
| `packages/memory/src/edges.test.ts` | Create | Edge CRUD, constraints, graph traversal |
| `packages/memory/src/guardian.test.ts` | Create | Temperature computation |
| `packages/memory/src/retrieval.test.ts` | Create | RRF fusion |
| `packages/server/src/http-edges.test.ts` | Create | Edge + graph API endpoints |

---

## Wave 1: Types + Schema (parallel, no dependencies)

### Task 1: Memory Edge Types

**Files:**
- Modify: `packages/memory/src/types.ts`

- [ ] **Step 1: Add edge and temporal types to types.ts**

Add after the `DistilledArtifactInput` interface:

```typescript
// --- Edge types ---

export const EDGE_RELATION_TYPES = [
  'led-to', 'contradicts', 'supersedes', 'implements',
  'similar', 'derived-from', 'related',
] as const;
export type EdgeRelationType = typeof EDGE_RELATION_TYPES[number];

export interface MemoryEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: EdgeRelationType;
  weight: number;
  createdAt: number;
  metadata: Record<string, unknown>;
}

export interface EdgeCreateInput {
  sourceId: string;
  targetId: string;
  relationType: EdgeRelationType;
  weight?: number;
  metadata?: Record<string, unknown>;
}

// --- Temporal fields (added to Memory via ALTER) ---

export const MEMORY_TYPES = ['semantic', 'episodic', 'principle', 'artifact'] as const;
export type MemoryType = typeof MEMORY_TYPES[number];

// --- Guardian types ---

export interface GuardianSignals {
  revisitWithoutAction: number;
  timeSinceLastArtifactExit: number;
  contradictionDensity: number;
  orphanRatio: number;
  decayVelocity: number;
  recursionDepth: number;
}

export interface GuardianTemperature {
  value: number;          // 0.0 (calm) - 1.0 (trapped)
  state: 'calm' | 'warm' | 'trapped';
  signals: GuardianSignals;
  computedAt: number;
}

// --- Artifact types ---

export const ARTIFACT_STATES = ['draft', 'ready', 'shipped', 'trapped'] as const;
export type ArtifactState = typeof ARTIFACT_STATES[number];

export interface ArtifactStatus {
  memoryId: string;
  state: ArtifactState;
  readiness: number;      // 0.0 - 1.0
  promotedAt: number;
  shippedAt?: number;
}
```

- [ ] **Step 2: Extend Memory interface with temporal fields**

In the existing `Memory` interface, add after `metadata`:

```typescript
  validFrom?: number;
  supersededBy?: string;
  supersededAt?: number;
  memoryType: MemoryType;
  readiness: number;
```

- [ ] **Step 3: Update exports in index.ts**

Add to `packages/memory/src/index.ts`:

```typescript
export type { MemoryEdge, EdgeCreateInput, EdgeRelationType, GuardianSignals, GuardianTemperature, ArtifactState, ArtifactStatus, MemoryType } from './types.js';
export { EDGE_RELATION_TYPES, MEMORY_TYPES, ARTIFACT_STATES } from './types.js';
export { GuardianComputer } from './guardian.js';
```

- [ ] **Step 4: Commit**

```bash
git add packages/memory/src/types.ts packages/memory/src/index.ts
git commit -m "add edge, temporal, guardian, and artifact types"
```

### Task 2: Schema Migration 5

**Files:**
- Modify: `packages/memory/src/store.ts`

- [ ] **Step 1: Write failing test for migration**

Create `packages/memory/src/edges.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { unlinkSync } from 'fs';

const TEST_DB = `/tmp/forgeframe-edges-test-${Date.now()}.db`;

describe('Migration 5: edges + temporal', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: TEST_DB });
  });

  afterEach(() => {
    store.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_DB + '-wal'); } catch {}
    try { unlinkSync(TEST_DB + '-shm'); } catch {}
  });

  it('creates memory_edges table', () => {
    const tables = (store as any)._db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_edges'"
    ).all();
    expect(tables).toHaveLength(1);
  });

  it('adds temporal columns to memories', () => {
    const mem = store.create({ content: 'test temporal' });
    expect(mem.memoryType).toBe('semantic');
    expect(mem.readiness).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/edges.test.ts`
Expected: FAIL — `memory_edges` table doesn't exist, `memoryType` not on Memory

- [ ] **Step 3: Add Migration 5 to store.ts**

Update `SCHEMA_VERSION` to `5` and add migration:

```typescript
private static readonly SCHEMA_VERSION = 5;
```

Add to MIGRATIONS:

```typescript
    5: `
      CREATE TABLE IF NOT EXISTS memory_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        created_at INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        UNIQUE(source_id, target_id, relation_type)
      );

      CREATE INDEX IF NOT EXISTS idx_edges_source ON memory_edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON memory_edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_edges_type ON memory_edges(relation_type);

      ALTER TABLE memories ADD COLUMN valid_from INTEGER;
      ALTER TABLE memories ADD COLUMN superseded_by TEXT;
      ALTER TABLE memories ADD COLUMN superseded_at INTEGER;
      ALTER TABLE memories ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'semantic';
      ALTER TABLE memories ADD COLUMN readiness REAL NOT NULL DEFAULT 0;
    `,
```

- [ ] **Step 4: Update _rowToMemory to include new fields**

In `_rowToMemory`, add:

```typescript
    validFrom: row.valid_from ?? undefined,
    supersededBy: row.superseded_by ?? undefined,
    supersededAt: row.superseded_at ?? undefined,
    memoryType: row.memory_type ?? 'semantic',
    readiness: row.readiness ?? 0,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/edges.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/memory/src/store.ts packages/memory/src/edges.test.ts
git commit -m "add migration 5: memory_edges table and temporal fields"
```

---

## Wave 2: Edge CRUD + Guardian (parallel, depends on Wave 1)

### Task 3: Edge CRUD Methods on MemoryStore

**Files:**
- Modify: `packages/memory/src/store.ts`
- Modify: `packages/memory/src/edges.test.ts`

- [ ] **Step 1: Write failing tests for edge CRUD**

Append to `packages/memory/src/edges.test.ts`:

```typescript
describe('Edge CRUD', () => {
  let store: MemoryStore;
  let memA: string;
  let memB: string;
  let memC: string;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: TEST_DB });
    memA = store.create({ content: 'memory A' }).id;
    memB = store.create({ content: 'memory B' }).id;
    memC = store.create({ content: 'memory C' }).id;
  });

  afterEach(() => {
    store.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_DB + '-wal'); } catch {}
    try { unlinkSync(TEST_DB + '-shm'); } catch {}
  });

  it('creates an edge', () => {
    const edge = store.createEdge({
      sourceId: memA,
      targetId: memB,
      relationType: 'led-to',
    });
    expect(edge.sourceId).toBe(memA);
    expect(edge.targetId).toBe(memB);
    expect(edge.relationType).toBe('led-to');
    expect(edge.weight).toBe(1.0);
  });

  it('enforces unique constraint on source+target+type', () => {
    store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    expect(() =>
      store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' })
    ).toThrow();
  });

  it('allows different relation types between same nodes', () => {
    store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    const e2 = store.createEdge({ sourceId: memA, targetId: memB, relationType: 'similar' });
    expect(e2.relationType).toBe('similar');
  });

  it('lists edges for a memory', () => {
    store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    store.createEdge({ sourceId: memC, targetId: memA, relationType: 'similar' });
    const edges = store.getEdges(memA);
    expect(edges).toHaveLength(2);
  });

  it('deletes an edge', () => {
    const edge = store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    const deleted = store.deleteEdge(edge.id);
    expect(deleted).toBe(true);
    expect(store.getEdges(memA)).toHaveLength(0);
  });

  it('cascades edge deletion when memory is deleted', () => {
    store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    store.delete(memA);
    expect(store.getEdges(memB)).toHaveLength(0);
  });

  it('traverses N hops from a node', () => {
    store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    store.createEdge({ sourceId: memB, targetId: memC, relationType: 'led-to' });
    const subgraph = store.getSubgraph(memA, 2);
    expect(subgraph.nodes).toHaveLength(3);
    expect(subgraph.edges).toHaveLength(2);
  });

  it('limits traversal to requested hops', () => {
    store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    store.createEdge({ sourceId: memB, targetId: memC, relationType: 'led-to' });
    const subgraph = store.getSubgraph(memA, 1);
    expect(subgraph.nodes).toHaveLength(2);
    expect(subgraph.edges).toHaveLength(1);
  });

  it('returns edge count', () => {
    store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    store.createEdge({ sourceId: memA, targetId: memC, relationType: 'similar' });
    expect(store.edgeCount()).toBe(2);
  });

  it('gets supersession chain', () => {
    const m2 = store.create({ content: 'updated A' });
    store.supersede(memA, m2.id);
    const chain = store.getSupersessionChain(m2.id);
    expect(chain).toHaveLength(2);
    expect(chain[0].id).toBe(m2.id);
    expect(chain[1].id).toBe(memA);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/edges.test.ts`
Expected: FAIL — methods don't exist

- [ ] **Step 3: Implement edge CRUD methods on MemoryStore**

Add to `store.ts` after the existing `merge` method. Add import at top:

```typescript
import type { EdgeCreateInput, MemoryEdge } from './types.js';
```

Methods to add:

```typescript
  // --- Edge operations ---

  createEdge(input: EdgeCreateInput): MemoryEdge {
    const id = randomUUID();
    const now = Date.now();
    this._db.prepare(`
      INSERT INTO memory_edges (id, source_id, target_id, relation_type, weight, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.sourceId, input.targetId, input.relationType, input.weight ?? 1.0, now, JSON.stringify(input.metadata ?? {}));

    return this.getEdge(id)!;
  }

  getEdge(id: string): MemoryEdge | null {
    const row = this._db.prepare('SELECT * FROM memory_edges WHERE id = ?').get(id) as any;
    return row ? this._rowToEdge(row) : null;
  }

  getEdges(memoryId: string): MemoryEdge[] {
    const rows = this._db.prepare(
      'SELECT * FROM memory_edges WHERE source_id = ? OR target_id = ? ORDER BY created_at DESC'
    ).all(memoryId, memoryId) as any[];
    return rows.map(r => this._rowToEdge(r));
  }

  getEdgesByType(memoryId: string, relationType: string): MemoryEdge[] {
    const rows = this._db.prepare(
      'SELECT * FROM memory_edges WHERE (source_id = ? OR target_id = ?) AND relation_type = ? ORDER BY created_at DESC'
    ).all(memoryId, memoryId, relationType) as any[];
    return rows.map(r => this._rowToEdge(r));
  }

  deleteEdge(id: string): boolean {
    const result = this._db.prepare('DELETE FROM memory_edges WHERE id = ?').run(id);
    return result.changes > 0;
  }

  edgeCount(): number {
    const row = this._db.prepare('SELECT COUNT(*) as cnt FROM memory_edges').get() as any;
    return row.cnt;
  }

  getSubgraph(memoryId: string, hops: number): { nodes: Memory[]; edges: MemoryEdge[] } {
    const visitedIds = new Set<string>();
    const allEdges: MemoryEdge[] = [];
    let frontier = [memoryId];

    for (let hop = 0; hop < hops && frontier.length > 0; hop++) {
      const nextFrontier: string[] = [];
      for (const nodeId of frontier) {
        if (visitedIds.has(nodeId)) continue;
        visitedIds.add(nodeId);
        const edges = this.getEdges(nodeId);
        for (const edge of edges) {
          if (!allEdges.some(e => e.id === edge.id)) {
            allEdges.push(edge);
          }
          const neighbor = edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
          if (!visitedIds.has(neighbor)) {
            nextFrontier.push(neighbor);
          }
        }
      }
      frontier = nextFrontier;
    }

    // Add final frontier nodes (visited but not expanded)
    for (const nodeId of frontier) visitedIds.add(nodeId);

    const nodes = [...visitedIds].map(id => this.get(id)).filter((m): m is Memory => m !== null);
    return { nodes, edges: allEdges };
  }

  supersede(oldId: string, newId: string): void {
    const now = Date.now();
    this._db.prepare('UPDATE memories SET superseded_by = ?, superseded_at = ? WHERE id = ?').run(newId, now, oldId);
    this._db.prepare('UPDATE memories SET valid_from = ? WHERE id = ?').run(now, newId);
    this.createEdge({ sourceId: newId, targetId: oldId, relationType: 'supersedes' });
  }

  getSupersessionChain(memoryId: string): Memory[] {
    const chain: Memory[] = [];
    let currentId: string | undefined = memoryId;
    const seen = new Set<string>();

    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const mem = this.get(currentId);
      if (!mem) break;
      chain.push(mem);
      const supersededEdge = this._db.prepare(
        "SELECT target_id FROM memory_edges WHERE source_id = ? AND relation_type = 'supersedes'"
      ).get(currentId) as any;
      currentId = supersededEdge?.target_id;
    }

    return chain;
  }

  // --- Artifact operations ---

  promote(memoryId: string): Memory | null {
    const mem = this.get(memoryId);
    if (!mem) return null;
    this._db.prepare("UPDATE memories SET memory_type = 'artifact', readiness = 0 WHERE id = ?").run(memoryId);
    return this.get(memoryId);
  }

  getArtifactMemories(): Memory[] {
    const rows = this._db.prepare(
      "SELECT * FROM memories WHERE memory_type = 'artifact' ORDER BY created_at DESC"
    ).all() as any[];
    return rows.map(r => this._rowToMemory(r));
  }

  setReadiness(memoryId: string, readiness: number): void {
    this._db.prepare('UPDATE memories SET readiness = ? WHERE id = ?').run(Math.max(0, Math.min(1, readiness)), memoryId);
  }

  shipArtifact(memoryId: string): Memory | null {
    const mem = this.get(memoryId);
    if (!mem || mem.memoryType !== 'artifact') return null;
    this._db.prepare('UPDATE memories SET readiness = 1.0 WHERE id = ?').run(memoryId);
    const meta = { ...mem.metadata, shipped: true, shippedAt: Date.now() };
    this._db.prepare('UPDATE memories SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), memoryId);
    return this.get(memoryId);
  }

  // --- Guardian signal queries ---

  orphanCount(): number {
    const row = this._db.prepare(`
      SELECT COUNT(*) as cnt FROM memories
      WHERE id NOT IN (SELECT source_id FROM memory_edges)
      AND id NOT IN (SELECT target_id FROM memory_edges)
    `).get() as any;
    return row.cnt;
  }

  contradictionCount(): number {
    const row = this._db.prepare(
      "SELECT COUNT(*) as cnt FROM memory_edges WHERE relation_type = 'contradicts'"
    ).get() as any;
    return row.cnt;
  }

  recentDecayCount(sinceMs: number): number {
    const cutoff = Date.now() - sinceMs;
    const row = this._db.prepare(
      'SELECT COUNT(*) as cnt FROM memories WHERE last_decay_at > ? AND strength < 0.5'
    ).get(cutoff) as any;
    return row.cnt;
  }

  lastShippedAt(): number | null {
    const row = this._db.prepare(
      "SELECT metadata FROM memories WHERE memory_type = 'artifact' AND metadata LIKE '%shipped%' ORDER BY created_at DESC LIMIT 1"
    ).get() as any;
    if (!row) return null;
    const meta = JSON.parse(row.metadata);
    return meta.shippedAt ?? null;
  }

  // --- Auto-linking ---

  autoLink(memoryId: string, maxLinks = 5): number {
    const mem = this.get(memoryId);
    if (!mem) return 0;

    const terms = mem.content
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 3)
      .slice(0, 8);

    if (terms.length === 0) return 0;

    const candidates = this.search(terms.join(' '), maxLinks + 1);
    let created = 0;

    for (const candidate of candidates) {
      if (candidate.id === memoryId) continue;
      if (created >= maxLinks) break;

      const existing = this._db.prepare(
        "SELECT id FROM memory_edges WHERE ((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)) AND relation_type = 'similar'"
      ).get(memoryId, candidate.id, candidate.id, memoryId);

      if (!existing) {
        this.createEdge({
          sourceId: memoryId,
          targetId: candidate.id,
          relationType: 'similar',
          weight: 0.8,
        });
        created++;
      }
    }

    return created;
  }

  private _rowToEdge(row: any): MemoryEdge {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      relationType: row.relation_type,
      weight: row.weight,
      createdAt: row.created_at,
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/edges.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to check no regressions**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add packages/memory/src/store.ts packages/memory/src/edges.test.ts
git commit -m "add edge CRUD, subgraph traversal, supersession, artifact ops, guardian signals, auto-link"
```

### Task 4: Guardian Temperature Computation

**Files:**
- Create: `packages/memory/src/guardian.ts`
- Create: `packages/memory/src/guardian.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/memory/src/guardian.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { GuardianComputer } from './guardian.js';
import type { GuardianSignals } from './types.js';

describe('GuardianComputer', () => {
  const guardian = new GuardianComputer();

  it('returns calm for all-zero signals', () => {
    const signals: GuardianSignals = {
      revisitWithoutAction: 0,
      timeSinceLastArtifactExit: 0,
      contradictionDensity: 0,
      orphanRatio: 0,
      decayVelocity: 0,
      recursionDepth: 0,
    };
    const temp = guardian.compute(signals);
    expect(temp.value).toBeLessThan(0.1);
    expect(temp.state).toBe('calm');
  });

  it('returns trapped for high signals', () => {
    const signals: GuardianSignals = {
      revisitWithoutAction: 10,
      timeSinceLastArtifactExit: 30 * 24 * 60 * 60 * 1000,
      contradictionDensity: 0.5,
      orphanRatio: 0.8,
      decayVelocity: 50,
      recursionDepth: 8,
    };
    const temp = guardian.compute(signals);
    expect(temp.value).toBeGreaterThan(0.6);
    expect(temp.state).toBe('trapped');
  });

  it('returns warm for moderate signals', () => {
    const signals: GuardianSignals = {
      revisitWithoutAction: 3,
      timeSinceLastArtifactExit: 7 * 24 * 60 * 60 * 1000,
      contradictionDensity: 0.1,
      orphanRatio: 0.3,
      decayVelocity: 10,
      recursionDepth: 2,
    };
    const temp = guardian.compute(signals);
    expect(temp.value).toBeGreaterThan(0.3);
    expect(temp.value).toBeLessThan(0.6);
    expect(temp.state).toBe('warm');
  });

  it('clamps value between 0 and 1', () => {
    const extreme: GuardianSignals = {
      revisitWithoutAction: 100,
      timeSinceLastArtifactExit: 365 * 24 * 60 * 60 * 1000,
      contradictionDensity: 1,
      orphanRatio: 1,
      decayVelocity: 500,
      recursionDepth: 50,
    };
    const temp = guardian.compute(extreme);
    expect(temp.value).toBeLessThanOrEqual(1);
    expect(temp.value).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/guardian.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement GuardianComputer**

Create `packages/memory/src/guardian.ts`:

```typescript
import type { GuardianSignals, GuardianTemperature } from './types.js';

export class GuardianComputer {
  /**
   * Compute Guardian temperature from signals.
   * Each signal is normalized to 0-1, then combined via weighted sum.
   * Weights start equal — calibrate empirically after one week of usage.
   */
  compute(signals: GuardianSignals): GuardianTemperature {
    const normalized = {
      revisit: Math.min(signals.revisitWithoutAction / 10, 1),
      timeSinceShip: Math.min(signals.timeSinceLastArtifactExit / (14 * 24 * 60 * 60 * 1000), 1),
      contradictions: Math.min(signals.contradictionDensity, 1),
      orphans: Math.min(signals.orphanRatio, 1),
      decay: Math.min(signals.decayVelocity / 30, 1),
      recursion: Math.min(signals.recursionDepth / 5, 1),
    };

    const weight = 1 / 6;
    const raw =
      normalized.revisit * weight +
      normalized.timeSinceShip * weight +
      normalized.contradictions * weight +
      normalized.orphans * weight +
      normalized.decay * weight +
      normalized.recursion * weight;

    const value = Math.max(0, Math.min(1, raw));

    let state: 'calm' | 'warm' | 'trapped';
    if (value < 0.3) state = 'calm';
    else if (value < 0.6) state = 'warm';
    else state = 'trapped';

    return { value, state, signals, computedAt: Date.now() };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/guardian.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/memory/src/guardian.ts packages/memory/src/guardian.test.ts packages/memory/src/index.ts
git commit -m "add Guardian temperature computation"
```

---

## Wave 3: Retrieval Upgrade (depends on Wave 2)

### Task 5: RRF Fusion + Graph Traversal in Retrieval

**Files:**
- Modify: `packages/memory/src/retrieval.ts`
- Create: `packages/memory/src/retrieval.test.ts`

- [ ] **Step 1: Write failing test for RRF retrieval**

Create `packages/memory/src/retrieval.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { MemoryRetriever } from './retrieval.js';
import { unlinkSync } from 'fs';

const TEST_DB = `/tmp/forgeframe-retrieval-test-${Date.now()}.db`;

describe('RRF Retrieval', () => {
  let store: MemoryStore;
  let retriever: MemoryRetriever;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: TEST_DB });
    retriever = new MemoryRetriever(store);
    const m1 = store.create({ content: 'ForgeFrame architecture decisions' });
    const m2 = store.create({ content: 'Guardian temperature computation signals' });
    const m3 = store.create({ content: 'ForgeFrame sovereign memory layer' });
    store.createEdge({ sourceId: m1.id, targetId: m3.id, relationType: 'related' });
  });

  afterEach(() => {
    store.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_DB + '-wal'); } catch {}
    try { unlinkSync(TEST_DB + '-shm'); } catch {}
  });

  it('returns results from FTS', () => {
    const results = retriever.query({ text: 'ForgeFrame', limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('includes graph-connected results via RRF', () => {
    const results = retriever.query({ text: 'architecture', limit: 10 });
    const contents = results.map(r => r.memory.content);
    expect(contents).toContain('ForgeFrame architecture decisions');
  });
});
```

- [ ] **Step 2: Run test to verify baseline**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/retrieval.test.ts`

- [ ] **Step 3: Upgrade query method to RRF fusion with graph walk**

Replace the `query` method in `retrieval.ts`:

```typescript
  query(q: MemoryQuery): MemoryResult[] {
    const limit = q.limit ?? 10;
    const ftsResults = this._store.search(q.text, limit * 3);
    const candidates = new Map<string, { memory: Memory; ftsRank?: number; graphRank?: number }>();

    // Strategy 1: FTS
    ftsResults.forEach((mem, idx) => {
      candidates.set(mem.id, { memory: mem, ftsRank: idx + 1 });
    });

    // Strategy 2: Graph walk from FTS top-3 seeds
    const seeds = ftsResults.slice(0, 3);
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

    // RRF fusion: score = sum(1 / (k + rank))
    const k = 60;
    const scored: MemoryResult[] = [];
    for (const [, { memory, ftsRank, graphRank }] of candidates) {
      if (q.minStrength && memory.strength < q.minStrength) continue;
      if (q.tags?.length && !q.tags.some(t => memory.tags.includes(t))) continue;

      let score = 0;
      if (ftsRank) score += 1 / (k + ftsRank);
      if (graphRank) score += 1 / (k + graphRank);
      score += memory.strength * 0.01;

      scored.push({ memory, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, limit);

    for (const r of results) {
      this._store.recordAccess(r.memory.id);
    }

    if (q.sessionId) {
      const sessionMems = this._store.getBySession(q.sessionId);
      for (const mem of sessionMems) {
        if (!results.some(r => r.memory.id === mem.id)) {
          results.push({ memory: mem, score: mem.strength * 0.2 });
        }
      }
    }

    return results;
  }
```

This requires `getSubgraph` to exist on the store (added in Task 3).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/retrieval.test.ts`
Expected: PASS

- [ ] **Step 5: Run full suite**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add packages/memory/src/retrieval.ts packages/memory/src/retrieval.test.ts
git commit -m "upgrade retrieval to RRF fusion with graph walk strategy"
```

---

## Wave 4: API + MCP Tools (depends on Wave 3)

### Task 6: New HTTP API Endpoints

**Files:**
- Modify: `packages/server/src/http.ts`
- Modify: `packages/server/src/events.ts`

- [ ] **Step 1: Add new event types to events.ts**

Add imports and extend the type map:

```typescript
import type { Memory, MemoryEdge, GuardianTemperature } from '@forgeframe/memory';

export type ServerEventMap = {
  'memory:created':  [memory: Memory];
  'memory:accessed': [memory: Memory];
  'memory:updated':  [memory: Memory];
  'memory:deleted':  [id: string];
  'memory:decayed':  [count: number];
  'memory:promoted': [memory: Memory];
  'edge:created':    [edge: MemoryEdge];
  'edge:deleted':    [edgeId: string];
  'guardian:update':  [temp: GuardianTemperature];
  'session:started': [sessionId: string];
  'session:ended':   [sessionId: string];
};
```

- [ ] **Step 2: Add edge, graph, artifact, guardian endpoints to http.ts**

Add after the existing `GET /api/memories/:id` route. Import `GuardianComputer` and instantiate it. Add these routes:

- `POST /api/memories/:id/edges` — create edge (emits `edge:created`)
- `GET /api/memories/:id/edges` — list edges
- `DELETE /api/memories/edges/:edgeId` — delete edge (emits `edge:deleted`)
- `GET /api/memories/:id/graph?hops=2` — subgraph traversal
- `GET /api/memories/:id/history` — supersession chain
- `POST /api/memories/:id/promote` — promote to artifact (emits `memory:promoted`)
- `GET /api/artifacts` — list artifacts
- `GET /api/guardian/temperature` — compute and return temperature
- `GET /api/graph/full?limit=500` — full graph for Cockpit

See spec section "New API Endpoints" for exact signatures. Each endpoint follows the existing pattern: parse params, call store method, sanitize response, return JSON.

- [ ] **Step 3: Subscribe new events to SSE stream**

In the SSE handler, add listeners for `edge:created`, `edge:deleted`, `memory:promoted`, `guardian:update` and clean them up on abort.

- [ ] **Step 4: Build and verify**

Run: `cd /Users/acamp/repos/ForgeFrame && npm run build`
Expected: Clean compile

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/http.ts packages/server/src/events.ts
git commit -m "add edge, graph, artifact, and guardian HTTP endpoints"
```

### Task 7: New MCP Tools

**Files:**
- Modify: `packages/server/src/tools.ts`

- [ ] **Step 1: Add four new MCP tools**

After existing `memory_delete` tool registration, add:

- `memory_link` — create typed edge between memories (params: sourceId, targetId, relationType, optional weight)
- `memory_graph` — retrieve N-hop subgraph (params: memoryId, optional hops default 2)
- `memory_promote` — promote memory to artifact (params: memoryId)
- `guardian_temp` — compute and return current Guardian temperature (no params)

Each follows the existing pattern: `server.tool(name, description, zodSchema, asyncHandler)` returning `{ content: [{ type: 'text', text: JSON.stringify(data) }] }`.

Import `GuardianComputer` from `@forgeframe/memory` and instantiate at module scope.

- [ ] **Step 2: Build and verify**

Run: `cd /Users/acamp/repos/ForgeFrame && npm run build`
Expected: Clean compile

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/tools.ts
git commit -m "add memory_link, memory_graph, memory_promote, guardian_temp MCP tools"
```

---

## Wave 5: Cockpit Frontend (depends on Wave 4)

### Task 8: Cockpit HTML — Layout + Theme + Shader

**Files:**
- Create: `cockpit/web/index.html`

Single-file vanilla HTML/CSS/JS with WebGL2. Design reference: `.superpowers/brainstorm/86116-1775788246/content/cockpit-olive-v2.html`

- [ ] **Step 1: Create the complete HTML file**

Build the full single-file Cockpit with these sections in order:

**Head:** Google Fonts (Inter + JetBrains Mono), viewport meta, title.

**CSS:** All `:root` custom properties from brainstorm wireframe (canvas, panel, text tiers t1-t6, accents gold/sage/earth/terra/danger/cream, typography vars). Theme variants via `[data-theme]` for ink, linen, slate, void. Grid layout `.cockpit` (210px | 1fr | 280px / 1fr | 36px). Glass recipe (blur+saturate+inset shadow). All component styles: sidebar nav, search pill, graph canvas, inspector, status bar, context menu, memory cards, tag badges, strength bars, guardian eye animation, grain overlay. Responsive breakpoints.

**Body structure:**
- `<canvas id="thermal">` — WebGL background (full viewport, z-index: 0)
- `.grain` — SVG noise overlay
- `.cockpit` — CSS Grid container
  - `.sidebar` — brand, nav (views: graph/memories/sessions), tag list, agent strip, guardian eye + temp slider
  - `.main-area` — search pill, `<canvas id="graph-canvas">`, zoom controls, view toggle, context menu
  - `.inspector` — header with close, tabs (Memory/Edges/History), scrollable memory list, markdown preview zone, artifacts zone
  - `.statusbar` — memory/session/strength/edge counters, guardian status

**Script:** All JS in a single `<script>` block at end of body:

1. **Thermal shader init** — WebGL2 setup, compile vertex+fragment shaders (fBm noise with temperature-driven palette from brainstorm), create fullscreen quad, return uniform locations
2. **Force graph** — `graphState` object (nodes, edges, selected, camera, dragging). `layoutGraph()` with repulsion + attraction + center gravity + damping. `renderGraph()` on Canvas 2D with camera transform, edge drawing (colored by relation type, dashed for similar), node drawing (sized by strength, colored by type/state, selected glow), labels at zoom threshold.
3. **Mouse interaction** — `canvasToWorld()` transform, `nodeAt()` hit test, mousedown (select/drag), mousemove (drag/hover), mouseup, contextmenu (show menu), wheel (zoom).
4. **API client** — `api(path, opts)` using bearer token from localStorage. `loadGraph()` fetches `/api/graph/full`, populates graphState. `loadStatus()`, `loadGuardian()`, `loadArtifacts()`.
5. **SSE** — `connectSSE()` listens for memory:created/updated/deleted, edge:created/deleted, guardian:update, memory:promoted. Updates graphState and UI live.
6. **Inspector** — `showInspector(node)` renders selected memory card with tags, strength bar, and loads edges via API. `renderArtifacts()` shows artifact list with state dots.
7. **Guardian** — `updateGuardian(temp)` sets eye state classes, updates labels, sets shader temperature.
8. **Context menu** — show/hide at click position, action handlers for open/edit/promote.
9. **Keyboard shortcuts** — Cmd+K (search focus), Escape (dismiss), Cmd+\\ (toggle sidebar), Cmd+Shift+\\ (toggle inspector), Cmd+P (promote selected), Cmd+, (settings).
10. **Search** — debounced input handler, filters/dims graph nodes by FTS results.
11. **Auth gate** — if no token in localStorage, show overlay with token input before loading data.
12. **Theme** — apply saved theme from localStorage, settings panel with theme swatches.
13. **Main loop** — `frame()` calls thermal shader draw + layoutGraph + renderGraph via requestAnimationFrame.
14. **Init** — resize canvases, check auth, load data, connect SSE, start frame loop.

Use `textContent` for all user-generated content (memory text, tags). Only use safe DOM construction (createElement + textContent) — no raw string interpolation into HTML.

- [ ] **Step 2: Verify it renders**

Open `cockpit/web/index.html` directly in a browser (without server). Should show:
- Olive glass thermal background animating
- Three-column layout with glass panels
- Empty graph canvas
- Sidebar with nav items and guardian eye
- Auth overlay (no token set)

- [ ] **Step 3: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add Cockpit web UI: olive glass theme, WebGL shader, force graph, live data, SSE"
```

---

## Wave 6: Integration (depends on Wave 5)

### Task 9: Serve Cockpit at GET /

**Files:**
- Modify: `packages/server/src/http.ts`

- [ ] **Step 1: Update static file serving**

Replace the existing `GET /` handler to serve Cockpit first, falling back to swarm viewer:

```typescript
import { existsSync, readFileSync } from 'fs';
```

Check `FORGEFRAME_COCKPIT_PATH` env var, then `../../cockpit/web/index.html` relative to http.ts, then fall back to swarm viewer. Serve with CSP header allowing `'unsafe-inline'` for script/style and Google Fonts for font-src.

- [ ] **Step 2: Build and verify**

Run: `cd /Users/acamp/repos/ForgeFrame && npm run build`
Expected: Clean compile

- [ ] **Step 3: Manual smoke test**

Start server: `FORGEFRAME_TOKEN=test npx forgeframe`
Open `http://localhost:3001`
Verify: thermal shader, graph with real data, inspector works, SSE live updates.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/http.ts
git commit -m "serve Cockpit at GET / replacing swarm viewer"
```

---

## Wave 7: Polish + Verification (depends on Wave 6)

### Task 10: Error States

**Files:**
- Modify: `cockpit/web/index.html`

- [ ] **Step 1: Add disconnected banner and error states**

Add banner component (pill-shaped, themed) that shows when SSE disconnects or API fails. Auto-hide on reconnect. Gray guardian eye when disconnected.

- [ ] **Step 2: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add error states and disconnected banner"
```

### Task 11: Full Verification

- [ ] **Step 1: Run all tests**

```bash
cd /Users/acamp/repos/ForgeFrame && npx vitest run
```
Expected: All tests pass.

- [ ] **Step 2: Build all packages**

```bash
cd /Users/acamp/repos/ForgeFrame && npm run build
```
Expected: Zero errors.

- [ ] **Step 3: Manual smoke test checklist**

Start server with real ForgeFrame data:
- [ ] Thermal shader animates smoothly
- [ ] Graph populates with real memories
- [ ] Click node opens inspector with content + tags + strength
- [ ] Right-click shows context menu
- [ ] Promote action works (node changes color)
- [ ] Search filters graph
- [ ] Cmd+K focuses search
- [ ] Cmd+, opens settings
- [ ] Theme switch is instant (all 5 themes)
- [ ] Status bar shows correct counts
- [ ] Guardian eye breathes
- [ ] SSE updates appear live (save a memory via MCP tool)
- [ ] Disconnected banner shows when server stops

---

## Summary

| Wave | Tasks | Produces |
|---|---|---|
| 1 | 1-2 | Types + Schema migration 5 |
| 2 | 3-4 | Edge CRUD, subgraph traversal, Guardian temperature |
| 3 | 5 | RRF retrieval with graph walk |
| 4 | 6-7 | 7 new HTTP endpoints, 4 new MCP tools |
| 5 | 8 | Cockpit frontend (the screenshot) |
| 6 | 9 | Live data integration at GET / |
| 7 | 10-11 | Error states, full verification |

Total: 11 tasks, ~35 steps. Backend waves (1-4) are TDD. Frontend (5-6) is build-then-verify. Each wave is sequential; tasks within a wave can parallelize.
