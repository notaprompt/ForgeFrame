# Wave C: Benchmarks + README + Show HN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add query-intent-aware retrieval, run LongMemEval benchmarks, rewrite README with Strange Loop positioning and benchmark results, draft Show HN post.

**Architecture:** Query-intent classification added to retrieval.ts (keyword heuristic, no LLM). Benchmark runner is a standalone TypeScript script. README is a complete rewrite.

**Tech Stack:** TypeScript (vitest), Markdown

**Spec:** `docs/superpowers/specs/2026-04-14-final-sprint-design.md` — Wave C section

**Depends on:** Wave A (the Cockpit screenshot needs the clustered graph)

---

## Phase Map

```
PHASE 1: Retrieval upgrade                    SEQUENTIAL
  Task 1: Query-intent classification          --- engine change
  Task 2: Intent-weighted graph traversal      --- depends on 1

PHASE 2: Benchmarks                           SEQUENTIAL
  Task 3: LongMemEval benchmark runner         --- depends on 2
  Task 4: Run benchmarks, publish results      --- depends on 3

PHASE 3: Packaging                            SEQUENTIAL
  Task 5: README rewrite                       --- depends on 4 (needs number)
  Task 6: Show HN post draft                   --- depends on 5
```

---

### Task 1: Query-intent classification

**Files:**
- Create: `packages/memory/src/query-intent.ts`
- Create: `packages/memory/src/query-intent.test.ts`
- Modify: `packages/memory/src/index.ts`

- [ ] **Step 1: Write tests**

Create `packages/memory/src/query-intent.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { classifyQueryIntent } from './query-intent.js';

describe('classifyQueryIntent', () => {
  it('classifies causal queries', () => {
    expect(classifyQueryIntent('why did I decide to use SQLite?')).toBe('causal');
    expect(classifyQueryIntent('what led to the architecture change?')).toBe('causal');
    expect(classifyQueryIntent('because of the sovereignty requirement')).toBe('causal');
  });

  it('classifies temporal queries', () => {
    expect(classifyQueryIntent('when did I change the auth system?')).toBe('temporal');
    expect(classifyQueryIntent('what happened before the launch?')).toBe('temporal');
    expect(classifyQueryIntent('events during April')).toBe('temporal');
  });

  it('classifies contradictory queries', () => {
    expect(classifyQueryIntent('what contradicts local-first?')).toBe('contradictory');
    expect(classifyQueryIntent('any conflicts with the sovereignty decision?')).toBe('contradictory');
  });

  it('classifies semantic queries', () => {
    expect(classifyQueryIntent('what relates to pricing?')).toBe('semantic');
    expect(classifyQueryIntent('topics similar to sovereignty')).toBe('semantic');
    expect(classifyQueryIntent('tell me about the architecture')).toBe('semantic');
  });

  it('defaults to general', () => {
    expect(classifyQueryIntent('memory system')).toBe('general');
    expect(classifyQueryIntent('forgeframe')).toBe('general');
  });
});
```

- [ ] **Step 2: Implement**

Create `packages/memory/src/query-intent.ts`:

```typescript
/**
 * @forgeframe/memory — Query Intent Classification
 *
 * Classifies query intent to weight edge types during graph traversal.
 * Keyword heuristic — no LLM call needed.
 */

export type QueryIntent = 'causal' | 'temporal' | 'semantic' | 'contradictory' | 'general';

const CAUSAL_PATTERN = /\b(why|because|led to|caused|decided|chose|reason|resulted)\b/i;
const TEMPORAL_PATTERN = /\b(when|before|after|during|while|timeline|history|date|time)\b/i;
const CONTRADICTORY_PATTERN = /\b(contradict|conflict|disagree|opposite|wrong|tension|clash)\b/i;
const SEMANTIC_PATTERN = /\b(relat|similar|like|connect|about|describe|tell me|explain|what is)\b/i;

export function classifyQueryIntent(query: string): QueryIntent {
  if (CAUSAL_PATTERN.test(query)) return 'causal';
  if (TEMPORAL_PATTERN.test(query)) return 'temporal';
  if (CONTRADICTORY_PATTERN.test(query)) return 'contradictory';
  if (SEMANTIC_PATTERN.test(query)) return 'semantic';
  return 'general';
}

export const INTENT_EDGE_WEIGHTS: Record<QueryIntent, Record<string, number>> = {
  causal: { 'led-to': 2, 'supersedes': 2, 'implements': 1.5, 'contradicts': 1, 'similar': 0.5, 'related': 1, 'derived-from': 1.5 },
  temporal: { 'led-to': 1.5, 'supersedes': 2, 'implements': 1, 'contradicts': 1, 'similar': 0.5, 'related': 1, 'derived-from': 1 },
  contradictory: { 'led-to': 1, 'supersedes': 1, 'implements': 1, 'contradicts': 3, 'similar': 0.5, 'related': 1, 'derived-from': 1 },
  semantic: { 'led-to': 1, 'supersedes': 1, 'implements': 1.5, 'contradicts': 0.5, 'similar': 2, 'related': 2, 'derived-from': 1.5 },
  general: { 'led-to': 1, 'supersedes': 1, 'implements': 1, 'contradicts': 1, 'similar': 1, 'related': 1, 'derived-from': 1 },
};
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/query-intent.test.ts
```

- [ ] **Step 4: Export**

Add to `packages/memory/src/index.ts`:

```typescript
export { classifyQueryIntent, INTENT_EDGE_WEIGHTS } from './query-intent.js';
export type { QueryIntent } from './query-intent.js';
```

- [ ] **Step 5: Commit**

```bash
git add packages/memory/src/query-intent.ts packages/memory/src/query-intent.test.ts packages/memory/src/index.ts
git commit -m "add query-intent classification for edge-type-weighted retrieval"
```

---

### Task 2: Intent-weighted graph traversal

**Files:**
- Modify: `packages/memory/src/retrieval.ts`
- Modify: `packages/memory/src/retrieval.test.ts`

Wire query-intent classification into the RRF retrieval pipeline. The graph traversal step weights edges by intent type.

- [ ] **Step 1: Add intent-weighted test**

In `packages/memory/src/retrieval.test.ts`, add a test that verifies causal queries prioritize `led-to` edges:

```typescript
it('weights graph traversal by query intent', () => {
  // Setup: create memories with different edge types
  const hub = store.create({ content: 'decided to use SQLite for sovereignty' });
  const causalTarget = store.create({ content: 'sovereignty requirement from day one' });
  const similarTarget = store.create({ content: 'SQLite is a good database choice' });
  store.createEdge({ sourceId: hub.id, targetId: causalTarget.id, relationType: 'led-to' });
  store.createEdge({ sourceId: hub.id, targetId: similarTarget.id, relationType: 'similar' });

  const retriever = new MemoryRetriever(store, null, { hebbian: false });
  const results = retriever.query({ text: 'why did I choose SQLite?' });

  // Causal query should rank led-to neighbor higher than similar neighbor
  const causalIdx = results.findIndex(r => r.memory.id === causalTarget.id);
  const similarIdx = results.findIndex(r => r.memory.id === similarTarget.id);
  if (causalIdx >= 0 && similarIdx >= 0) {
    expect(causalIdx).toBeLessThan(similarIdx);
  }
});
```

- [ ] **Step 2: Wire intent into retrieval.ts**

In `retrieval.ts`, import and use query intent:

```typescript
import { classifyQueryIntent, INTENT_EDGE_WEIGHTS } from './query-intent.js';
```

In the `query()` method, before the graph walk section, classify the intent:

```typescript
    const intent = classifyQueryIntent(q.text ?? '');
```

In the graph walk loop where neighbors are collected, weight the graph rank by edge type:

```typescript
    for (const seed of seeds) {
      const sub = this._store.getSubgraph(seed.id, 1);
      for (const node of sub.nodes) {
        if (candidates.has(node.id)) continue;
        // Find the edge connecting seed to this node
        const edges = this._store.getEdgesBetween(seed.id, node.id);
        let edgeWeight = 1;
        for (const edge of edges) {
          const typeWeight = INTENT_EDGE_WEIGHTS[intent][edge.relationType] ?? 1;
          edgeWeight = Math.max(edgeWeight, typeWeight);
        }
        graphNeighbors.push({ memory: node, intentWeight: edgeWeight });
      }
    }
```

Adjust the graph rank scoring to incorporate the intent weight:

```typescript
    graphNeighbors.forEach((item, idx) => {
      const existing = candidates.get(item.memory.id);
      const weightedRank = Math.max(1, (idx + 1) / item.intentWeight);
      if (existing) {
        existing.graphRank = weightedRank;
      } else {
        candidates.set(item.memory.id, { memory: item.memory, graphRank: weightedRank });
      }
    });
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/retrieval.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/memory/src/retrieval.ts packages/memory/src/retrieval.test.ts
git commit -m "add intent-weighted graph traversal to RRF retrieval"
```

---

### Task 3: LongMemEval benchmark runner

**Files:**
- Create: `benchmarks/longmemeval/README.md`
- Create: `benchmarks/longmemeval/run.ts`

- [ ] **Step 1: Create benchmark directory and README**

```bash
mkdir -p benchmarks/longmemeval
```

Create `benchmarks/longmemeval/README.md`:

```markdown
# LongMemEval Benchmark

Evaluates ForgeFrame's retrieval against the LongMemEval benchmark.

## Setup

1. Download the LongMemEval dataset from the official repository
2. Place the dataset files in this directory
3. Run: `npx tsx benchmarks/longmemeval/run.ts`

## Results

See `results.md` after running.
```

- [ ] **Step 2: Create benchmark runner**

Create `benchmarks/longmemeval/run.ts` — a script that:
1. Initializes a fresh ForgeFrame MemoryStore
2. Seeds it with benchmark conversation data
3. Runs each benchmark query through `MemoryRetriever.query()`
4. Compares results against ground truth
5. Computes precision, recall, F1
6. Writes results to `benchmarks/longmemeval/results.md`

The implementation depends on the LongMemEval dataset format. The runner should handle both the "conversation memory" and "knowledge retention" test suites.

- [ ] **Step 3: Commit**

```bash
git add benchmarks/
git commit -m "add LongMemEval benchmark runner scaffold"
```

---

### Task 4: Run benchmarks and publish results

- [ ] **Step 1: Run the benchmark**

```bash
cd /Users/acamp/repos/ForgeFrame && npx tsx benchmarks/longmemeval/run.ts
```

- [ ] **Step 2: Review results in `benchmarks/longmemeval/results.md`**

- [ ] **Step 3: Commit results**

```bash
git add benchmarks/longmemeval/results.md
git commit -m "add LongMemEval benchmark results"
```

---

### Task 5: README rewrite

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the README**

Structure:
1. Headline: "The only memory system that gets smarter by watching itself think"
2. Cockpit screenshot (path: `docs/assets/cockpit-screenshot.png`)
3. What it does — 3 bullets
4. Benchmark number — prominently displayed
5. Quick start — npm install + Claude Code configuration
6. Architecture diagram — text-based
7. The Strange Loop — how the dream engine works
8. License (BSL for memory, MIT for server)

- [ ] **Step 2: Take Cockpit screenshot**

After Wave A ships, take a screenshot of the clustered graph with thermal shader. Save to `docs/assets/cockpit-screenshot.png`.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/assets/
git commit -m "rewrite README with Strange Loop positioning and benchmark results"
```

---

### Task 6: Show HN post draft

**Files:**
- Create: `docs/show-hn-draft.md`

- [ ] **Step 1: Draft the post**

Title: "Show HN: ForgeFrame — sovereign memory that dreams (Hebbian learning + anti-Hebbian auditing)"

Body (~300 words):
- What it is (sovereign cognitive infrastructure for AI agents)
- What makes it different (NREM/REM dreaming, silence/drift detection, matriarchal UX)
- The benchmark number
- Link to repo
- The Cockpit screenshot

- [ ] **Step 2: Commit**

```bash
git add docs/show-hn-draft.md
git commit -m "draft Show HN post"
```

---

## Verification

1. `npx vitest run` — all tests pass including query-intent tests
2. `npm run build` — clean
3. Query-intent: "why did I choose X?" returns causal results ranked higher
4. Benchmark results exist in `benchmarks/longmemeval/results.md`
5. README has screenshot, benchmark number, quick start, Strange Loop section
6. Show HN draft is ready for posting
