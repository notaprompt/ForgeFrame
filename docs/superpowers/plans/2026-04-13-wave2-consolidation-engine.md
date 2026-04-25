# Wave 2: Consolidation Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the system that discovers its own patterns — detecting dense clusters in the Hebbian-strengthened graph, summarizing them via local LLM, proposing consolidations for human approval, and migrating edges on approval.

**Architecture:** A new `consolidation.ts` module handles cluster detection and the proposal lifecycle. An `OllamaGenerator` (following the existing `OllamaEmbedder` pattern) calls local LLMs for summarization. Proposals are stored in a new `consolidation_proposals` SQLite table (migration 7). The proposal lifecycle is: `pending` -> `approved`/`rejected`. On approval, a consolidated memory is created, `derived-from` edges connect it to sources, external edges migrate, and source memories get accelerated decay. On rejection, the cluster gets a 7-day cooldown. Consolidation depth is capped at 2 levels. Constitutional memories are never consolidated.

**Tech Stack:** TypeScript, better-sqlite3, Ollama `/api/generate` for local LLM summarization, vitest

**Spec reference:** `/Users/acamp/repos/ForgeFrame/docs/superpowers/specs/2026-04-12-signal-system-design.md` — Sections 2.3, 2.4

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/memory/src/consolidation.ts` | CREATE | Cluster detection, proposal generation, approval/rejection, edge migration |
| `packages/memory/src/consolidation.test.ts` | CREATE | All consolidation tests |
| `packages/memory/src/generator.ts` | CREATE | OllamaGenerator — local LLM text generation (follows OllamaEmbedder pattern) |
| `packages/memory/src/generator.test.ts` | CREATE | Generator tests |
| `packages/memory/src/types.ts` | MODIFY | Add `ConsolidationProposal`, `ConsolidationResult`, `ConsolidationCluster` types |
| `packages/memory/src/store.ts` | MODIFY | Migration 7 (proposals table), `getConnectedComponents()`, proposal CRUD |
| `packages/memory/src/index.ts` | MODIFY | Export new types and classes |
| `packages/server/src/tools.ts` | MODIFY | Add `consolidation_scan`, `consolidation_approve`, `consolidation_reject` MCP tools |
| `packages/server/src/http.ts` | MODIFY | Add `/api/consolidation/*` endpoints |
| `packages/server/src/events.ts` | MODIFY | Add `consolidation:proposed`, `consolidation:complete`, `consolidation:rejected` events |

---

## Task 1: Types — ConsolidationProposal, ConsolidationCluster, ConsolidationResult

**Files:**
- Modify: `packages/memory/src/types.ts`

- [ ] **Step 1: Add consolidation types**

In `packages/memory/src/types.ts`, add after the `HebbianBatchUpdate` interface:

```typescript
// --- Consolidation types ---

export interface ConsolidationCluster {
  memoryIds: string[];
  avgWeight: number;
  edgeCount: number;
}

export interface ConsolidationProposal {
  id: string;
  cluster: ConsolidationCluster;
  title: string;
  summary: string;
  suggestedTags: string[];
  status: 'pending' | 'approved' | 'rejected';
  depth: number;             // 0=raw memories, 1=first consolidation, 2=meta-consolidation
  createdAt: number;
  resolvedAt: number | null;
  rejectedUntil: number | null;  // 7-day cooldown after rejection
}

export interface ConsolidationResult {
  consolidatedMemoryId: string;
  derivedFromEdges: string[];     // edge IDs
  migratedEdges: string[];        // edge IDs
  sourcesDecayed: string[];       // memory IDs with halved strength
}
```

- [ ] **Step 2: Verify build compiles**

Run: `cd /Users/acamp/repos/ForgeFrame && npm run build`
Expected: Clean

- [ ] **Step 3: Commit**

```bash
git add packages/memory/src/types.ts
git commit -m "add consolidation types: proposal, cluster, result"
```

---

## Task 2: Migration 7 — consolidation_proposals table

**Files:**
- Modify: `packages/memory/src/store.ts`
- Create: `packages/memory/src/consolidation.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/memory/src/consolidation.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';

describe('Consolidation — Schema', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('consolidation_proposals table exists', () => {
    const proposal = store.createProposal({
      cluster: { memoryIds: ['a', 'b', 'c'], avgWeight: 1.3, edgeCount: 5 },
      title: 'Test pattern',
      summary: 'A test consolidation',
      suggestedTags: ['pattern'],
      depth: 1,
    });

    expect(proposal.id).toBeTypeOf('string');
    expect(proposal.status).toBe('pending');
    expect(proposal.resolvedAt).toBeNull();
    expect(proposal.rejectedUntil).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/consolidation.test.ts`
Expected: FAIL — `createProposal` does not exist

- [ ] **Step 3: Bump SCHEMA_VERSION to 7 and add migration**

In `packages/memory/src/store.ts`:

Change `SCHEMA_VERSION` from `6` to `7`.

Add migration 7 to the MIGRATIONS record:

```typescript
    7: `
      CREATE TABLE IF NOT EXISTS consolidation_proposals (
        id TEXT PRIMARY KEY,
        cluster_memory_ids TEXT NOT NULL,
        cluster_avg_weight REAL NOT NULL,
        cluster_edge_count INTEGER NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        suggested_tags TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        depth INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        rejected_until INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_proposals_status ON consolidation_proposals(status);
    `,
```

- [ ] **Step 4: Add proposal CRUD methods to MemoryStore**

Add after the `autoLink` method in `packages/memory/src/store.ts`:

```typescript
  // -- Consolidation Proposals --

  createProposal(input: {
    cluster: ConsolidationCluster;
    title: string;
    summary: string;
    suggestedTags: string[];
    depth: number;
  }): ConsolidationProposal {
    const id = randomUUID();
    const now = Date.now();
    this._db.prepare(`
      INSERT INTO consolidation_proposals
        (id, cluster_memory_ids, cluster_avg_weight, cluster_edge_count,
         title, summary, suggested_tags, status, depth, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      id,
      JSON.stringify(input.cluster.memoryIds),
      input.cluster.avgWeight,
      input.cluster.edgeCount,
      input.title,
      input.summary,
      JSON.stringify(input.suggestedTags),
      input.depth,
      now,
    );
    return this.getProposal(id)!;
  }

  getProposal(id: string): ConsolidationProposal | null {
    const row = this._db.prepare(
      'SELECT * FROM consolidation_proposals WHERE id = ?'
    ).get(id) as any;
    return row ? this._rowToProposal(row) : null;
  }

  listProposals(status?: 'pending' | 'approved' | 'rejected'): ConsolidationProposal[] {
    let sql = 'SELECT * FROM consolidation_proposals';
    const params: unknown[] = [];
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this._db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this._rowToProposal(r));
  }

  resolveProposal(id: string, status: 'approved' | 'rejected'): ConsolidationProposal | null {
    const now = Date.now();
    const rejectedUntil = status === 'rejected' ? now + 7 * 24 * 60 * 60 * 1000 : null;
    this._db.prepare(`
      UPDATE consolidation_proposals
      SET status = ?, resolved_at = ?, rejected_until = ?
      WHERE id = ?
    `).run(status, now, rejectedUntil, id);
    return this.getProposal(id);
  }

  private _rowToProposal(row: any): ConsolidationProposal {
    return {
      id: row.id,
      cluster: {
        memoryIds: JSON.parse(row.cluster_memory_ids),
        avgWeight: row.cluster_avg_weight,
        edgeCount: row.cluster_edge_count,
      },
      title: row.title,
      summary: row.summary,
      suggestedTags: JSON.parse(row.suggested_tags),
      status: row.status,
      depth: row.depth,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at ?? null,
      rejectedUntil: row.rejected_until ?? null,
    };
  }
```

Add the import for `ConsolidationCluster` and `ConsolidationProposal` at the top of store.ts:

```typescript
import type { Memory, MemoryCreateInput, MemoryUpdateInput, MemoryConfig, ReconsolidationOptions, Session, SessionCreateInput, SessionListOptions, DistilledArtifact, DistilledArtifactInput, MemoryEdge, EdgeCreateInput, ConsolidationCluster, ConsolidationProposal } from './types.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/consolidation.test.ts`
Expected: PASS

- [ ] **Step 6: Run full suite**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/ packages/server/`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add packages/memory/src/store.ts packages/memory/src/consolidation.test.ts
git commit -m "add migration 7: consolidation_proposals table and CRUD"
```

---

## Task 3: Connected component detection — `getConnectedComponents()`

**Files:**
- Modify: `packages/memory/src/store.ts`
- Modify: `packages/memory/src/consolidation.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/memory/src/consolidation.test.ts`:

```typescript
describe('Consolidation — Connected components', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('finds connected components from all edges', () => {
    const m1 = store.create({ content: 'a' });
    const m2 = store.create({ content: 'b' });
    const m3 = store.create({ content: 'c' });
    const m4 = store.create({ content: 'd' });
    const m5 = store.create({ content: 'e' });

    // Component 1: m1-m2-m3 (triangle)
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.3 });
    store.createEdge({ sourceId: m2.id, targetId: m3.id, relationType: 'similar', weight: 1.4 });
    store.createEdge({ sourceId: m1.id, targetId: m3.id, relationType: 'similar', weight: 1.2 });

    // Component 2: m4-m5
    store.createEdge({ sourceId: m4.id, targetId: m5.id, relationType: 'related', weight: 0.8 });

    const components = store.getConnectedComponents();
    expect(components).toHaveLength(2);

    const big = components.find((c) => c.memoryIds.length === 3)!;
    const small = components.find((c) => c.memoryIds.length === 2)!;

    expect(big.memoryIds.sort()).toEqual([m1.id, m2.id, m3.id].sort());
    expect(big.avgWeight).toBeCloseTo((1.3 + 1.4 + 1.2) / 3);
    expect(big.edgeCount).toBe(3);

    expect(small.memoryIds.sort()).toEqual([m4.id, m5.id].sort());
    expect(small.avgWeight).toBe(0.8);
  });

  it('excludes orphan memories (no edges)', () => {
    store.create({ content: 'orphan' });
    const m1 = store.create({ content: 'a' });
    const m2 = store.create({ content: 'b' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });

    const components = store.getConnectedComponents();
    expect(components).toHaveLength(1);
    expect(components[0].memoryIds).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `getConnectedComponents()`**

Add to `packages/memory/src/store.ts` after the `autoLink` method:

```typescript
  getConnectedComponents(): ConsolidationCluster[] {
    // Get all edges
    const allEdges = this._db.prepare('SELECT * FROM memory_edges').all() as any[];
    if (allEdges.length === 0) return [];

    // Build adjacency list
    const adj = new Map<string, Set<string>>();
    const edgeWeights: number[] = [];
    const edgesByNode = new Map<string, any[]>();

    for (const row of allEdges) {
      const s = row.source_id;
      const t = row.target_id;

      if (!adj.has(s)) adj.set(s, new Set());
      if (!adj.has(t)) adj.set(t, new Set());
      adj.get(s)!.add(t);
      adj.get(t)!.add(s);

      if (!edgesByNode.has(s)) edgesByNode.set(s, []);
      if (!edgesByNode.has(t)) edgesByNode.set(t, []);
      edgesByNode.get(s)!.push(row);
      edgesByNode.get(t)!.push(row);
    }

    // BFS to find components
    const visited = new Set<string>();
    const components: ConsolidationCluster[] = [];

    for (const nodeId of adj.keys()) {
      if (visited.has(nodeId)) continue;

      const component: string[] = [];
      const componentEdgeIds = new Set<string>();
      const queue = [nodeId];
      visited.add(nodeId);

      while (queue.length > 0) {
        const current = queue.shift()!;
        component.push(current);

        for (const neighbor of adj.get(current) ?? []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }

        // Collect edges
        for (const edge of edgesByNode.get(current) ?? []) {
          componentEdgeIds.add(edge.id);
        }
      }

      // Compute avg weight for this component's edges
      const componentEdges = allEdges.filter((e) => componentEdgeIds.has(e.id));
      const avgWeight = componentEdges.length > 0
        ? componentEdges.reduce((sum: number, e: any) => sum + e.weight, 0) / componentEdges.length
        : 0;

      components.push({
        memoryIds: component,
        avgWeight,
        edgeCount: componentEdges.length,
      });
    }

    return components;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Run full suite**

- [ ] **Step 6: Commit**

```bash
git add packages/memory/src/store.ts packages/memory/src/consolidation.test.ts
git commit -m "add connected component detection for cluster discovery"
```

---

## Task 4: OllamaGenerator — local LLM text generation

**Files:**
- Create: `packages/memory/src/generator.ts`
- Create: `packages/memory/src/generator.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/memory/src/generator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { OllamaGenerator } from './generator.js';
import type { Generator } from './generator.js';

describe('OllamaGenerator', () => {
  it('implements Generator interface', () => {
    const gen: Generator = new OllamaGenerator({
      ollamaUrl: 'http://localhost:11434',
      model: 'qwen3:32b',
    });
    expect(gen).toBeDefined();
    expect(gen.generate).toBeTypeOf('function');
  });

  it('returns null on connection failure (fail-silent)', async () => {
    const gen = new OllamaGenerator({
      ollamaUrl: 'http://localhost:1', // unreachable
      model: 'qwen3:32b',
    });
    const result = await gen.generate('test prompt');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Create `packages/memory/src/generator.ts`**

```typescript
/**
 * @forgeframe/memory — Generator Interface + Ollama Implementation
 *
 * Provides LLM text generation for consolidation summaries.
 * Follows OllamaEmbedder pattern: fail-silent, never blocks critical paths.
 * Constitutional: consolidation always uses local models (cognitive data never cloud).
 */

export interface Generator {
  generate(prompt: string): Promise<string | null>;
}

export interface GeneratorConfig {
  ollamaUrl: string;
  model: string;
}

const MAX_INPUT_CHARS = 16000;

export class OllamaGenerator implements Generator {
  private _url: string;
  private _model: string;

  constructor(config: GeneratorConfig) {
    this._url = config.ollamaUrl.replace(/\/$/, '');
    this._model = config.model;
  }

  async generate(prompt: string): Promise<string | null> {
    try {
      const input = prompt.length > MAX_INPUT_CHARS
        ? prompt.slice(0, MAX_INPUT_CHARS)
        : prompt;

      const res = await fetch(`${this._url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this._model,
          prompt: input,
          stream: false,
        }),
      });

      if (!res.ok) return null;

      const data = await res.json() as { response?: string };
      return data.response?.trim() || null;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/memory/src/generator.ts packages/memory/src/generator.test.ts
git commit -m "add OllamaGenerator for local LLM text generation"
```

---

## Task 5: ConsolidationEngine — cluster scanning + proposal generation

**Files:**
- Create: `packages/memory/src/consolidation.ts` (not the test file — that already exists)
- Modify: `packages/memory/src/consolidation.test.ts`

This is the core of Wave 2. The engine:
1. Scans for dense clusters (avg weight > 1.2, size >= 5)
2. Filters out clusters containing constitutional memories
3. Filters out clusters in rejection cooldown
4. Enforces depth limit (max 2)
5. Calls local LLM to summarize the cluster
6. Creates a proposal

- [ ] **Step 1: Write failing tests for cluster scanning**

Append to `packages/memory/src/consolidation.test.ts`:

```typescript
import { ConsolidationEngine } from './consolidation.js';
import type { Generator } from './generator.js';

// Mock generator that returns structured JSON
class MockGenerator implements Generator {
  async generate(_prompt: string): Promise<string | null> {
    return JSON.stringify({
      title: 'Sovereignty Architecture',
      summary: 'A pattern connecting sovereignty, architecture, and data ownership.',
      patterns: ['sovereignty requires local-first', 'architecture enforces principles'],
      suggestedTags: ['pattern'],
    });
  }
}

class FailingGenerator implements Generator {
  async generate(_prompt: string): Promise<string | null> {
    return null;
  }
}

describe('ConsolidationEngine — cluster scanning', () => {
  let store: MemoryStore;
  let engine: ConsolidationEngine;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
    engine = new ConsolidationEngine(store, new MockGenerator());
  });

  afterEach(() => {
    store.close();
  });

  it('finds candidate clusters with avg weight > 1.2 and size >= 5', () => {
    const memories = [];
    for (let i = 0; i < 5; i++) {
      memories.push(store.create({ content: `sovereignty topic ${i}` }));
    }
    // Create edges with high weights
    for (let i = 0; i < 4; i++) {
      store.createEdge({
        sourceId: memories[i].id,
        targetId: memories[i + 1].id,
        relationType: 'similar',
        weight: 1.3,
      });
    }
    // Close the loop for higher connectivity
    store.createEdge({
      sourceId: memories[4].id,
      targetId: memories[0].id,
      relationType: 'similar',
      weight: 1.3,
    });

    const candidates = engine.findCandidateClusters();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].memoryIds).toHaveLength(5);
    expect(candidates[0].avgWeight).toBeCloseTo(1.3);
  });

  it('excludes clusters below weight threshold', () => {
    const memories = [];
    for (let i = 0; i < 5; i++) {
      memories.push(store.create({ content: `weak topic ${i}` }));
    }
    for (let i = 0; i < 4; i++) {
      store.createEdge({
        sourceId: memories[i].id,
        targetId: memories[i + 1].id,
        relationType: 'similar',
        weight: 0.8, // below 1.2
      });
    }

    const candidates = engine.findCandidateClusters();
    expect(candidates).toHaveLength(0);
  });

  it('excludes clusters smaller than 5 nodes', () => {
    const memories = [];
    for (let i = 0; i < 3; i++) {
      memories.push(store.create({ content: `small cluster ${i}` }));
    }
    store.createEdge({ sourceId: memories[0].id, targetId: memories[1].id, relationType: 'similar', weight: 1.5 });
    store.createEdge({ sourceId: memories[1].id, targetId: memories[2].id, relationType: 'similar', weight: 1.5 });

    const candidates = engine.findCandidateClusters();
    expect(candidates).toHaveLength(0);
  });

  it('excludes clusters containing constitutional memories', () => {
    const memories = [];
    for (let i = 0; i < 5; i++) {
      const tags = i === 0 ? ['principle'] : [];
      memories.push(store.create({ content: `topic ${i}`, tags }));
    }
    for (let i = 0; i < 4; i++) {
      store.createEdge({
        sourceId: memories[i].id,
        targetId: memories[i + 1].id,
        relationType: 'similar',
        weight: 1.5,
      });
    }

    const candidates = engine.findCandidateClusters();
    expect(candidates).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Create `packages/memory/src/consolidation.ts`**

```typescript
/**
 * @forgeframe/memory — Consolidation Engine
 *
 * Discovers patterns by detecting dense clusters in the Hebbian graph,
 * summarizes them via local LLM, and manages the proposal lifecycle.
 *
 * Constitutional: consolidation always uses local models.
 * Constitutional: principle/voice memories never consolidated.
 * Depth limit: max 2 levels (raw -> pattern -> principle candidate).
 */

import type { MemoryStore } from './store.js';
import type { Generator } from './generator.js';
import type { Memory, ConsolidationCluster, ConsolidationProposal, ConsolidationResult } from './types.js';
import { CONSTITUTIONAL_TAGS } from './types.js';

const MIN_CLUSTER_SIZE = 5;
const MIN_AVG_WEIGHT = 1.2;
const MAX_DEPTH = 2;
const REJECTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class ConsolidationEngine {
  private _store: MemoryStore;
  private _generator: Generator;

  constructor(store: MemoryStore, generator: Generator) {
    this._store = store;
    this._generator = generator;
  }

  /**
   * Find clusters eligible for consolidation.
   * Criteria: avg edge weight > 1.2, size >= 5, no constitutional memories,
   * not in rejection cooldown, depth < MAX_DEPTH.
   */
  findCandidateClusters(): ConsolidationCluster[] {
    const components = this._store.getConnectedComponents();
    const now = Date.now();

    return components.filter((cluster) => {
      // Size and weight thresholds
      if (cluster.memoryIds.length < MIN_CLUSTER_SIZE) return false;
      if (cluster.avgWeight < MIN_AVG_WEIGHT) return false;

      // Constitutional guard
      for (const id of cluster.memoryIds) {
        const mem = this._store.get(id);
        if (!mem) return false;
        if (this._isConstitutional(mem)) return false;
      }

      // Check depth — if any memory in cluster is already a consolidation result,
      // compute the max depth
      const depth = this._clusterDepth(cluster);
      if (depth >= MAX_DEPTH) return false;

      // Check rejection cooldown — look for rejected proposals containing these memories
      const rejected = this._store.listProposals('rejected');
      for (const proposal of rejected) {
        if (proposal.rejectedUntil && proposal.rejectedUntil > now) {
          const overlap = proposal.cluster.memoryIds.some((id) =>
            cluster.memoryIds.includes(id)
          );
          if (overlap) return false;
        }
      }

      return true;
    });
  }

  /**
   * Generate a consolidation proposal for a cluster.
   * Calls local LLM to summarize, creates a pending proposal.
   */
  async propose(cluster: ConsolidationCluster): Promise<ConsolidationProposal | null> {
    // Load all memories in the cluster
    const memories: Memory[] = [];
    for (const id of cluster.memoryIds) {
      const mem = this._store.get(id);
      if (!mem) return null;
      memories.push(mem);
    }

    // Build prompt for local LLM
    const prompt = this._buildSummaryPrompt(memories);
    const response = await this._generator.generate(prompt);

    if (!response) return null;

    // Parse LLM response
    const parsed = this._parseLLMResponse(response);
    if (!parsed) return null;

    const depth = this._clusterDepth(cluster) + 1;

    return this._store.createProposal({
      cluster,
      title: parsed.title,
      summary: parsed.summary,
      suggestedTags: parsed.suggestedTags,
      depth,
    });
  }

  /**
   * Approve a proposal: create consolidated memory, migrate edges, decay sources.
   */
  approve(proposalId: string): ConsolidationResult | null {
    const proposal = this._store.getProposal(proposalId);
    if (!proposal || proposal.status !== 'pending') return null;

    // Create the consolidated memory
    const consolidated = this._store.create({
      content: `[Title]: ${proposal.title}\n[Insight]: ${proposal.summary}`,
      tags: proposal.suggestedTags,
      metadata: {
        consolidation: true,
        sourceIds: proposal.cluster.memoryIds,
        depth: proposal.depth,
      },
    });

    const result: ConsolidationResult = {
      consolidatedMemoryId: consolidated.id,
      derivedFromEdges: [],
      migratedEdges: [],
      sourcesDecayed: [],
    };

    const sourceIds = new Set(proposal.cluster.memoryIds);

    // Create derived-from edges to each source
    for (const sourceId of sourceIds) {
      try {
        const edge = this._store.createEdge({
          sourceId: consolidated.id,
          targetId: sourceId,
          relationType: 'derived-from',
        });
        result.derivedFromEdges.push(edge.id);
      } catch {
        // skip if edge already exists
      }
    }

    // Migrate external edges
    for (const sourceId of sourceIds) {
      const edges = this._store.getEdges(sourceId);
      for (const edge of edges) {
        const neighborId = edge.sourceId === sourceId ? edge.targetId : edge.sourceId;

        // Skip internal edges (both nodes in cluster)
        if (sourceIds.has(neighborId)) continue;

        // Check if consolidated already has an edge to this neighbor
        const existing = this._store.getEdgeBetween(consolidated.id, neighborId);
        if (existing) {
          // Keep higher weight
          if (edge.weight > existing.weight) {
            this._store.updateEdgeWeight(existing.id, edge.weight);
          }
        } else {
          try {
            const migrated = this._store.createEdge({
              sourceId: consolidated.id,
              targetId: neighborId,
              relationType: edge.relationType,
              weight: edge.weight,
            });
            result.migratedEdges.push(migrated.id);
          } catch {
            // skip duplicates
          }
        }
      }
    }

    // Halve strength of source memories (accelerated decay)
    for (const sourceId of sourceIds) {
      const mem = this._store.get(sourceId);
      if (mem) {
        this._store.resetStrength(sourceId, mem.strength * 0.5);
        result.sourcesDecayed.push(sourceId);
      }
    }

    // Mark proposal as approved
    this._store.resolveProposal(proposalId, 'approved');

    return result;
  }

  /**
   * Reject a proposal: mark rejected, set 7-day cooldown.
   */
  reject(proposalId: string): ConsolidationProposal | null {
    return this._store.resolveProposal(proposalId, 'rejected');
  }

  private _isConstitutional(memory: Memory): boolean {
    return memory.tags.some((t) =>
      (CONSTITUTIONAL_TAGS as readonly string[]).includes(t)
    );
  }

  private _clusterDepth(cluster: ConsolidationCluster): number {
    let maxDepth = 0;
    for (const id of cluster.memoryIds) {
      const mem = this._store.get(id);
      if (mem?.metadata.consolidation && typeof mem.metadata.depth === 'number') {
        maxDepth = Math.max(maxDepth, mem.metadata.depth as number);
      }
    }
    return maxDepth;
  }

  private _buildSummaryPrompt(memories: Memory[]): string {
    const contents = memories
      .map((m, i) => `Memory ${i + 1}:\n${m.content}`)
      .join('\n\n---\n\n');

    return `You are summarizing a cluster of related memories into a single pattern.

Here are the memories:

${contents}

Respond with a JSON object (no markdown fencing):
{
  "title": "short title for the pattern (under 80 chars)",
  "summary": "2-3 sentence summary capturing the core insight",
  "patterns": ["list of extracted patterns"],
  "suggestedTags": ["pattern"]
}`;
  }

  private _parseLLMResponse(response: string): {
    title: string;
    summary: string;
    suggestedTags: string[];
  } | null {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.title || !parsed.summary) return null;

      return {
        title: String(parsed.title),
        summary: String(parsed.summary),
        suggestedTags: Array.isArray(parsed.suggestedTags)
          ? parsed.suggestedTags.map(String)
          : ['pattern'],
      };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/memory/src/consolidation.ts packages/memory/src/consolidation.test.ts
git commit -m "add ConsolidationEngine with cluster scanning and filtering"
```

---

## Task 6: Proposal generation + approval + rejection tests

**Files:**
- Modify: `packages/memory/src/consolidation.test.ts`

- [ ] **Step 1: Add proposal lifecycle tests**

Append to `packages/memory/src/consolidation.test.ts`:

```typescript
describe('ConsolidationEngine — proposal generation', () => {
  let store: MemoryStore;
  let engine: ConsolidationEngine;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
    engine = new ConsolidationEngine(store, new MockGenerator());
  });

  afterEach(() => {
    store.close();
  });

  it('generates a proposal from a cluster', async () => {
    const memories = [];
    for (let i = 0; i < 5; i++) {
      memories.push(store.create({ content: `sovereignty topic ${i}` }));
    }
    for (let i = 0; i < 4; i++) {
      store.createEdge({
        sourceId: memories[i].id,
        targetId: memories[i + 1].id,
        relationType: 'similar',
        weight: 1.3,
      });
    }
    store.createEdge({
      sourceId: memories[4].id,
      targetId: memories[0].id,
      relationType: 'similar',
      weight: 1.3,
    });

    const clusters = engine.findCandidateClusters();
    const proposal = await engine.propose(clusters[0]);

    expect(proposal).not.toBeNull();
    expect(proposal!.title).toBe('Sovereignty Architecture');
    expect(proposal!.status).toBe('pending');
    expect(proposal!.depth).toBe(1);
  });

  it('returns null when LLM fails', async () => {
    const failEngine = new ConsolidationEngine(store, new FailingGenerator());
    const cluster: ConsolidationCluster = {
      memoryIds: ['a'],
      avgWeight: 1.5,
      edgeCount: 3,
    };

    const proposal = await failEngine.propose(cluster);
    expect(proposal).toBeNull();
  });
});

describe('ConsolidationEngine — approval', () => {
  let store: MemoryStore;
  let engine: ConsolidationEngine;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
    engine = new ConsolidationEngine(store, new MockGenerator());
  });

  afterEach(() => {
    store.close();
  });

  it('creates consolidated memory with derived-from edges', async () => {
    const memories = [];
    for (let i = 0; i < 5; i++) {
      memories.push(store.create({ content: `topic ${i}` }));
    }
    for (let i = 0; i < 4; i++) {
      store.createEdge({
        sourceId: memories[i].id,
        targetId: memories[i + 1].id,
        relationType: 'similar',
        weight: 1.3,
      });
    }
    store.createEdge({
      sourceId: memories[4].id,
      targetId: memories[0].id,
      relationType: 'similar',
      weight: 1.3,
    });

    const clusters = engine.findCandidateClusters();
    const proposal = await engine.propose(clusters[0]);
    const result = engine.approve(proposal!.id);

    expect(result).not.toBeNull();
    expect(result!.derivedFromEdges).toHaveLength(5);
    expect(result!.sourcesDecayed).toHaveLength(5);

    // Consolidated memory exists
    const consolidated = store.get(result!.consolidatedMemoryId)!;
    expect(consolidated.content).toContain('Sovereignty Architecture');
    expect(consolidated.tags).toContain('pattern');
    expect(consolidated.metadata.consolidation).toBe(true);
  });

  it('migrates external edges with max weight', async () => {
    const memories = [];
    for (let i = 0; i < 5; i++) {
      memories.push(store.create({ content: `topic ${i}` }));
    }
    // Create cluster edges
    for (let i = 0; i < 4; i++) {
      store.createEdge({
        sourceId: memories[i].id,
        targetId: memories[i + 1].id,
        relationType: 'similar',
        weight: 1.3,
      });
    }
    store.createEdge({
      sourceId: memories[4].id,
      targetId: memories[0].id,
      relationType: 'similar',
      weight: 1.3,
    });

    // External node connected to two cluster members
    const external = store.create({ content: 'external node' });
    store.createEdge({
      sourceId: memories[0].id,
      targetId: external.id,
      relationType: 'related',
      weight: 0.5,
    });
    store.createEdge({
      sourceId: memories[2].id,
      targetId: external.id,
      relationType: 'related',
      weight: 0.9,
    });

    const clusters = engine.findCandidateClusters();
    const proposal = await engine.propose(clusters[0]);
    const result = engine.approve(proposal!.id);

    // Consolidated should have edge to external with max weight (0.9)
    const edge = store.getEdgeBetween(result!.consolidatedMemoryId, external.id);
    expect(edge).not.toBeNull();
    expect(edge!.weight).toBe(0.9);
  });

  it('halves strength of source memories', async () => {
    const memories = [];
    for (let i = 0; i < 5; i++) {
      memories.push(store.create({ content: `topic ${i}` }));
    }
    for (let i = 0; i < 4; i++) {
      store.createEdge({
        sourceId: memories[i].id,
        targetId: memories[i + 1].id,
        relationType: 'similar',
        weight: 1.3,
      });
    }
    store.createEdge({
      sourceId: memories[4].id,
      targetId: memories[0].id,
      relationType: 'similar',
      weight: 1.3,
    });

    const clusters = engine.findCandidateClusters();
    const proposal = await engine.propose(clusters[0]);
    engine.approve(proposal!.id);

    // All source memories should have halved strength
    for (const mem of memories) {
      const updated = store.get(mem.id)!;
      expect(updated.strength).toBe(0.5);
    }
  });

  it('marks proposal as approved', async () => {
    const memories = [];
    for (let i = 0; i < 5; i++) {
      memories.push(store.create({ content: `topic ${i}` }));
    }
    for (let i = 0; i < 4; i++) {
      store.createEdge({
        sourceId: memories[i].id,
        targetId: memories[i + 1].id,
        relationType: 'similar',
        weight: 1.3,
      });
    }
    store.createEdge({
      sourceId: memories[4].id,
      targetId: memories[0].id,
      relationType: 'similar',
      weight: 1.3,
    });

    const clusters = engine.findCandidateClusters();
    const proposal = await engine.propose(clusters[0]);
    engine.approve(proposal!.id);

    const updated = store.getProposal(proposal!.id)!;
    expect(updated.status).toBe('approved');
    expect(updated.resolvedAt).not.toBeNull();
  });
});

describe('ConsolidationEngine — rejection', () => {
  let store: MemoryStore;
  let engine: ConsolidationEngine;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
    engine = new ConsolidationEngine(store, new MockGenerator());
  });

  afterEach(() => {
    store.close();
  });

  it('sets 7-day cooldown on rejection', async () => {
    const memories = [];
    for (let i = 0; i < 5; i++) {
      memories.push(store.create({ content: `topic ${i}` }));
    }
    for (let i = 0; i < 4; i++) {
      store.createEdge({
        sourceId: memories[i].id,
        targetId: memories[i + 1].id,
        relationType: 'similar',
        weight: 1.3,
      });
    }
    store.createEdge({
      sourceId: memories[4].id,
      targetId: memories[0].id,
      relationType: 'similar',
      weight: 1.3,
    });

    const clusters = engine.findCandidateClusters();
    const proposal = await engine.propose(clusters[0]);
    const rejected = engine.reject(proposal!.id);

    expect(rejected!.status).toBe('rejected');
    expect(rejected!.rejectedUntil).not.toBeNull();
    expect(rejected!.rejectedUntil!).toBeGreaterThan(Date.now());

    // Should not appear in candidates anymore
    const newCandidates = engine.findCandidateClusters();
    expect(newCandidates).toHaveLength(0);
  });
});

describe('ConsolidationEngine — depth limits', () => {
  let store: MemoryStore;
  let engine: ConsolidationEngine;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
    engine = new ConsolidationEngine(store, new MockGenerator());
  });

  afterEach(() => {
    store.close();
  });

  it('enforces max depth of 2', () => {
    // Create a cluster where one member is already a depth-2 consolidation
    const memories = [];
    for (let i = 0; i < 5; i++) {
      memories.push(store.create({
        content: `deep topic ${i}`,
        metadata: i === 0 ? { consolidation: true, depth: 2 } : {},
      }));
    }
    for (let i = 0; i < 4; i++) {
      store.createEdge({
        sourceId: memories[i].id,
        targetId: memories[i + 1].id,
        relationType: 'similar',
        weight: 1.5,
      });
    }
    store.createEdge({
      sourceId: memories[4].id,
      targetId: memories[0].id,
      relationType: 'similar',
      weight: 1.5,
    });

    const candidates = engine.findCandidateClusters();
    expect(candidates).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/consolidation.test.ts`
Expected: All pass

- [ ] **Step 3: Run full suite**

- [ ] **Step 4: Commit**

```bash
git add packages/memory/src/consolidation.test.ts
git commit -m "add full consolidation lifecycle tests: proposal, approval, rejection, depth"
```

---

## Task 7: SSE events + exports

**Files:**
- Modify: `packages/server/src/events.ts`
- Modify: `packages/memory/src/index.ts`

- [ ] **Step 1: Add consolidation events**

In `packages/server/src/events.ts`, add to the import and `ServerEventMap`:

```typescript
import type { Memory, MemoryEdge, GuardianTemperature, HebbianBatchUpdate, ConsolidationProposal, ConsolidationResult } from '@forgeframe/memory';

// Add to ServerEventMap:
  'consolidation:proposed': [proposal: ConsolidationProposal];
  'consolidation:complete': [result: ConsolidationResult];
  'consolidation:rejected': [proposal: ConsolidationProposal];
```

- [ ] **Step 2: Export new types and classes from index.ts**

In `packages/memory/src/index.ts`:

```typescript
export { ConsolidationEngine } from './consolidation.js';
export { OllamaGenerator } from './generator.js';
export type { Generator, GeneratorConfig } from './generator.js';
```

Add to the type exports line:
```typescript
ConsolidationCluster, ConsolidationProposal, ConsolidationResult
```

- [ ] **Step 3: Build + test**

Run: `npm run build && npx vitest run packages/memory/ packages/server/`

- [ ] **Step 4: Commit**

```bash
git add packages/memory/src/index.ts packages/server/src/events.ts
git commit -m "export consolidation types and add SSE events"
```

---

## Task 8: MCP tools — consolidation_scan, consolidation_approve, consolidation_reject

**Files:**
- Modify: `packages/server/src/tools.ts`

- [ ] **Step 1: Read `packages/server/src/tools.ts` to understand the tool registration pattern**

- [ ] **Step 2: Add three MCP tools**

Follow the existing pattern in tools.ts. Each tool registers with `server.tool()`. Add after the existing tools:

**consolidation_scan:** Scan for consolidation candidates and optionally generate proposals.

```typescript
  server.tool(
    'consolidation_scan',
    'Scan for memory clusters ready for consolidation. Returns candidate clusters (avg weight > 1.2, size >= 5). Pass propose=true to auto-generate proposals via local LLM.',
    { propose: z.boolean().optional().describe('Generate proposals for found clusters') },
    async ({ propose }) => {
      const consolidation = new ConsolidationEngine(store, generator);
      const candidates = consolidation.findCandidateClusters();

      if (!propose || candidates.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ candidates: candidates.length, clusters: candidates }, null, 2),
          }],
        };
      }

      const proposals = [];
      for (const cluster of candidates) {
        const proposal = await consolidation.propose(cluster);
        if (proposal) {
          proposals.push(proposal);
          events.emit('consolidation:proposed', proposal);
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ proposed: proposals.length, proposals }, null, 2),
        }],
      };
    }
  );
```

**consolidation_approve:** Approve a pending proposal.

```typescript
  server.tool(
    'consolidation_approve',
    'Approve a consolidation proposal. Creates consolidated memory, migrates edges, decays sources.',
    { proposalId: z.string().describe('ID of the proposal to approve') },
    async ({ proposalId }) => {
      const consolidation = new ConsolidationEngine(store, generator);
      const result = consolidation.approve(proposalId);

      if (!result) {
        return {
          content: [{ type: 'text' as const, text: 'Proposal not found or not pending.' }],
        };
      }

      events.emit('consolidation:complete', result);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    }
  );
```

**consolidation_reject:** Reject a proposal with 7-day cooldown.

```typescript
  server.tool(
    'consolidation_reject',
    'Reject a consolidation proposal. Sets 7-day cooldown on the cluster.',
    { proposalId: z.string().describe('ID of the proposal to reject') },
    async ({ proposalId }) => {
      const consolidation = new ConsolidationEngine(store, generator);
      const rejected = consolidation.reject(proposalId);

      if (!rejected) {
        return {
          content: [{ type: 'text' as const, text: 'Proposal not found.' }],
        };
      }

      events.emit('consolidation:rejected', rejected);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(rejected, null, 2),
        }],
      };
    }
  );
```

Note: The `generator` variable needs to be available in the tools scope. In `packages/server/src/server.ts`, create an `OllamaGenerator` alongside the existing `OllamaEmbedder` and pass it through. Or instantiate it in tools.ts using config. Check how `embedder` is passed and follow the same pattern.

- [ ] **Step 3: Wire the generator in server.ts**

In `packages/server/src/server.ts`, import `OllamaGenerator` and create an instance:

```typescript
import { OllamaGenerator } from '@forgeframe/memory';
```

Create it after the embedder:

```typescript
  const generator = new OllamaGenerator({
    ollamaUrl: config.ollamaUrl,
    model: config.generatorModel ?? 'qwen3:32b',
  });
```

Pass it to `registerTools()` — update the function signature to accept it.

- [ ] **Step 4: Build + test**

Run: `npm run build && npx vitest run packages/memory/ packages/server/`

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/tools.ts packages/server/src/server.ts
git commit -m "add consolidation MCP tools: scan, approve, reject"
```

---

## Task 9: HTTP endpoints — `/api/consolidation/*`

**Files:**
- Modify: `packages/server/src/http.ts`

- [ ] **Step 1: Add consolidation HTTP endpoints**

In `packages/server/src/http.ts`, add after the existing artifact endpoints:

```typescript
  // -- Consolidation --

  app.get('/api/consolidation/proposals', (c) => {
    const status = c.req.query('status') as 'pending' | 'approved' | 'rejected' | undefined;
    const proposals = store.listProposals(status);
    return c.json(proposals);
  });

  app.get('/api/consolidation/proposals/:id', (c) => {
    const proposal = store.getProposal(c.req.param('id'));
    if (!proposal) return c.json({ error: 'Not found' }, 404);
    return c.json(proposal);
  });

  app.post('/api/consolidation/scan', async (c) => {
    const consolidation = new ConsolidationEngine(store, generator);
    const candidates = consolidation.findCandidateClusters();
    return c.json({ candidates: candidates.length, clusters: candidates });
  });

  app.post('/api/consolidation/proposals/:id/approve', async (c) => {
    const consolidation = new ConsolidationEngine(store, generator);
    const result = consolidation.approve(c.req.param('id'));
    if (!result) return c.json({ error: 'Proposal not found or not pending' }, 404);
    events.emit('consolidation:complete', result);
    return c.json(result);
  });

  app.post('/api/consolidation/proposals/:id/reject', async (c) => {
    const consolidation = new ConsolidationEngine(store, generator);
    const rejected = consolidation.reject(c.req.param('id'));
    if (!rejected) return c.json({ error: 'Proposal not found' }, 404);
    events.emit('consolidation:rejected', rejected);
    return c.json(rejected);
  });
```

Note: `generator` needs to be passed into the HTTP setup function the same way it's passed to tools. Follow whatever pattern was established in Task 8.

- [ ] **Step 2: Build + test**

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/http.ts
git commit -m "add consolidation HTTP endpoints"
```

---

## Task 10: Final verification

- [ ] **Step 1: Full build**

Run: `cd /Users/acamp/repos/ForgeFrame && npm run build`
Expected: Zero TypeScript errors

- [ ] **Step 2: Full test suite**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/ packages/server/ --reporter=verbose`
Expected: All tests pass (250 existing + ~20 new consolidation tests)

- [ ] **Step 3: Verify new test coverage**

Confirm tests cover:
- Dense cluster detection (avg weight > 1.2, size >= 5)
- Clusters below threshold excluded
- Clusters with < 5 nodes excluded
- Constitutional memories excluded from consolidation
- Proposal generation via LLM
- LLM failure returns null (fail-silent)
- Approval creates consolidated memory with derived-from edges
- External edges migrate with max(weights)
- Source memories get halved strength
- Proposal status updated to approved
- Rejection sets 7-day cooldown
- Rejected clusters excluded from candidates
- Depth limit enforced (max 2 levels)
- Connected component detection
- Generator fail-silent behavior
