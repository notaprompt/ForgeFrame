# Unified Implementation Plan: Signal Engine + Cockpit + Hermes Dreaming

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the ForgeFrame cognitive operating system — finish the engine gaps from the Overhaul PRD, build the Hermes integration and dreaming architecture, and complete the Cockpit control surface. One system, three layers.

**Architecture:** ForgeFrame is four packages (memory, server, core, proxy) in a monorepo. The memory engine (Hebbian, consolidation, contradictions) is built. This plan adds: emotional tagging, sleep pressure, NREM/REM dreaming, dream journal, dream seeding, hindsight review, tension detection, Hermes agent integration, and the Cockpit controls to steer it all. The engine work is TypeScript in packages/memory and packages/server. The Hermes integration is Python (thin layer). The Cockpit is vanilla HTML/CSS/JS with WebGL.

**Tech Stack:** TypeScript (strict, ESM), better-sqlite3, Ollama (local LLM), Python (Hermes MemoryProvider), vanilla JS + WebGL2 (Cockpit), Hono (HTTP server), SSE (real-time events)

**Specs this plan implements:**
- Overhaul PRD (`.claude/plans/overhaul-prd.md`) — unfinished tasks
- Cockpit Design (`docs/superpowers/specs/2026-04-09-cockpit-design.md`) — unfinished features
- Hermes + Dreaming (`docs/superpowers/specs/2026-04-13-hermes-dreaming-design.md`) — full spec

**Current state:** 443 tests passing, schema version 8, branch `feat/hebbian-engine` (linear extension of `feat/cockpit-build`)

---

## Phase Map

```
PHASE 1: Engine Gaps (Overhaul PRD leftovers)          PARALLEL
  Task 1: Wire reconsolidate() into retriever          -+
  Task 2: Memory type decay multipliers                 |
  Task 3: Search scoring (BM25 + OR semantics)          +-- Can all run in parallel
  Task 4: Duplicate detection                           |
  Task 5: Episodic to semantic promotion               -+

PHASE 2: Emotional Tagging + Sleep Pressure            PARALLEL
  Task 6: Valence column + classification              -+
  Task 7: dev_active Guardian signal                    +-- Independent
  Task 8: Sleep pressure metric                        -+

PHASE 3: Dream Engine                                  SEQUENTIAL
  Task 9: NREM phase (compression)                     --- depends on 6, 8
  Task 10: Dream journal                               --- depends on 9
  Task 11: Dream seeding                               --- depends on 10
  Task 12: Hindsight review                            --- depends on 6, 10
  Task 13: Tension detection                           --- depends on 10
  Task 14: REM phase (orchestrator)                    --- depends on 11, 12, 13

PHASE 4: Hermes Integration                           PARALLEL with Phase 3
  Task 15: ForgeFrame MemoryProvider (Python)          -+
  Task 16: Guardian tool for Hermes                     +-- Sequential within phase
  Task 17: Hermes config + model routing               -+

PHASE 5: Cockpit Controls                             AFTER Phase 3 + 4
  Task 18: Dream control endpoints                     -+
  Task 19: Hermes control endpoints                     +-- Can run in parallel
  Task 20: Guardian control endpoints                   |
  Task 21: Hebbian control endpoints                   -+
  Task 22: Dream journal viewer UI                     --- depends on 18
  Task 23: Proposal queue + tension board UI           --- depends on 22
  Task 24: Signal sonar panel (detachable)             --- depends on 22, 23

PHASE 6: SSE Events + Integration                     AFTER Phase 5
  Task 25: New SSE event types                         -+
  Task 26: Cockpit SSE wiring                           +-- Sequential
  Task 27: Integration tests                           -+

PHASE 7: Cockpit Polish (from cockpit spec)           AFTER Phase 6
  Task 28: Theme system (Ink, Linen, Slate, Void)     -+
  Task 29: Settings panel                               +-- Parallel
  Task 30: Semantic zoom / nested clusters              |
  Task 31: Tab system + markdown editor                -+
  Task 32: Artifact state machine                      --- depends on 31
  Task 33: Mobile responsive layout                    --- after all UI work
```

**Subagent estimate:** 8-10 parallel subagents across phases. Phases 1-2 are fully parallelizable (up to 8 agents). Phase 3 is sequential. Phase 4 runs parallel with Phase 3. Phases 5-7 are mix of parallel and sequential.

**Total estimate:** ~25-35 days with parallel execution, ~50+ days sequential.

---

## PHASE 1: Engine Gaps

These are unfinished tasks from the Overhaul PRD. All are independent and can run in parallel.

### Task 1: Wire reconsolidate() into retriever

**Files:**
- Modify: `packages/memory/src/retrieval.ts`
- Modify: `packages/memory/src/retrieval.test.ts`

The `reconsolidate()` method exists on MemoryStore (line 290-334) but is never called. The retriever still calls `recordAccess()` instead. This means strength restoration, association tracking, and retrieval counting are not happening.

- [ ] **Step 1: Write the failing test**

In `packages/memory/src/retrieval.test.ts`:

```typescript
it('query() calls reconsolidate on returned memories', async () => {
  // Create a memory with low strength
  const mem = store.create({ content: 'reconsolidation target' });
  // Manually reduce strength
  store['_db'].prepare('UPDATE memories SET strength = 0.3 WHERE id = ?').run(mem.id);

  // Query and get the memory back
  const results = await retriever.query({ text: 'reconsolidation target' });
  expect(results.length).toBeGreaterThan(0);

  // Verify strength was restored (reconsolidate was called)
  const updated = store.get(results[0].memory.id)!;
  expect(updated.strength).toBeGreaterThan(0.3);
  expect(updated.retrievalCount).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/retrieval.test.ts -t "reconsolidate"`
Expected: FAIL -- retrievalCount is still 0

- [ ] **Step 3: Wire reconsolidate into query()**

In `packages/memory/src/retrieval.ts`, find the `query()` method. After the results are ranked and before returning, call `reconsolidate()` on each result:

```typescript
// After scoring and sorting, before return:
const coRetrievedIds = scoredResults.map(r => r.memory.id);
for (const result of scoredResults) {
  this.store.reconsolidate(result.memory.id, {
    relevanceScore: result.score,
    query: query.text,
    coRetrievedIds,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/retrieval.test.ts -t "reconsolidate"`
Expected: PASS

- [ ] **Step 5: Write association tracking test**

```typescript
it('query() records co-retrieved memory associations', async () => {
  store.create({ content: 'alpha concept for testing' });
  store.create({ content: 'alpha related concept for testing' });

  const results = await retriever.query({ text: 'alpha concept testing' });
  expect(results.length).toBeGreaterThanOrEqual(2);

  // Check that memories now have each other in associations
  const first = store.get(results[0].memory.id)!;
  expect(first.associations).toContain(results[1].memory.id);
});
```

- [ ] **Step 6: Run full retrieval test suite**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/retrieval.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame
git add packages/memory/src/retrieval.ts packages/memory/src/retrieval.test.ts
git commit -m "wire reconsolidate() into retriever query path"
```

---

### Task 2: Memory type decay multipliers

**Files:**
- Modify: `packages/memory/src/store.ts` (applyDecay method, ~line 341)
- Modify: `packages/memory/src/types.ts`
- Test: `packages/memory/src/store.test.ts`

Memory types exist (semantic, episodic, principle, artifact) but do not affect decay rate. The Overhaul PRD specifies type-based stability multipliers.

- [ ] **Step 1: Add type multiplier constant to types.ts**

In `packages/memory/src/types.ts`, add after the MEMORY_TYPES definition:

```typescript
export const MEMORY_TYPE_STABILITY_MULTIPLIER: Record<string, number> = {
  semantic: 2.0,      // general knowledge decays slower
  episodic: 1.0,      // events decay at base rate
  principle: Infinity, // never decays (also protected by constitutional tags)
  artifact: 1.5,      // artifacts decay slower than episodes
};
```

- [ ] **Step 2: Write the failing test**

In `packages/memory/src/store.test.ts`:

```typescript
it('semantic memories decay slower than episodic memories', () => {
  const dayMs = 86400000;
  const fourteenDaysAgo = Date.now() - 14 * dayMs;

  const episodic = store.create({ content: 'episodic event', type: 'episodic' });
  const semantic = store.create({ content: 'semantic fact', type: 'semantic' });

  // Backdate both
  store['_db'].prepare(
    'UPDATE memories SET last_accessed_at = ?, last_decay_at = ?, created_at = ? WHERE id IN (?, ?)'
  ).run(fourteenDaysAgo, fourteenDaysAgo, fourteenDaysAgo, episodic.id, semantic.id);

  store.applyDecay();

  const e = store.get(episodic.id)!;
  const s = store.get(semantic.id)!;
  expect(s.strength).toBeGreaterThan(e.strength);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/store.test.ts -t "semantic memories decay slower"`
Expected: FAIL -- both have same strength

- [ ] **Step 4: Apply multiplier in applyDecay()**

In `packages/memory/src/store.ts`, find the `applyDecay()` method. In the JavaScript loop that computes per-memory decay, apply the type multiplier to the stability calculation:

```typescript
import { MEMORY_TYPE_STABILITY_MULTIPLIER } from './types.js';

// In the loop body, update stability calculation:
const typeMultiplier = MEMORY_TYPE_STABILITY_MULTIPLIER[row.memory_type] ?? 1.0;
const stability = this._config.baseStability
  * (1 + row.access_count * this._config.accessMultiplier)
  * typeMultiplier;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/store.test.ts -t "semantic memories decay slower"`
Expected: PASS

- [ ] **Step 6: Run full store test suite**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/store.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame
git add packages/memory/src/store.ts packages/memory/src/types.ts packages/memory/src/store.test.ts
git commit -m "add memory type decay multipliers"
```

---

### Task 3: Search scoring improvements

**Files:**
- Modify: `packages/memory/src/retrieval.ts`
- Modify: `packages/memory/src/store.ts`
- Test: `packages/memory/src/retrieval.test.ts`

Search currently uses position-based scoring from FTS5 results. Needs BM25 rank exposure and OR semantics for better recall.

- [ ] **Step 1: Write failing test for OR semantics**

```typescript
it('search finds memories matching any term, not just all terms', async () => {
  store.create({ content: 'the quick brown fox' });
  store.create({ content: 'the lazy dog sleeps' });

  const results = await retriever.query({ text: 'quick dog' });
  // Should find both -- OR semantics, not AND
  expect(results.length).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/retrieval.test.ts -t "any term"`
Expected: FAIL -- AND semantics returns 0

- [ ] **Step 3: Implement OR semantics in store.search()**

In `packages/memory/src/store.ts`, find the `search()` method. The FTS5 query currently joins terms with implicit AND. Change to explicit OR:

```typescript
// In the search method, when building the FTS query:
const terms = text.trim().split(/\s+/).filter(Boolean);
const ftsQuery = terms.map(t => `"${t}"`).join(' OR ');
```

- [ ] **Step 4: Expose BM25 rank in search results**

FTS5 provides `rank` which is the BM25 score. Update the search query to include it:

```sql
SELECT *, rank as bm25_rank FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?
```

In `retrieval.ts`, use the BM25 rank in scoring instead of position-based scoring:

```typescript
// Replace position-based scoring with BM25-based scoring
const maxRank = Math.max(...candidates.map(c => Math.abs(c.bm25Rank || 1)));
const bm25Score = Math.abs(candidate.bm25Rank || 0) / maxRank;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/retrieval.test.ts -t "any term"`
Expected: PASS

- [ ] **Step 6: Write prefix matching test**

```typescript
it('search supports prefix matching', async () => {
  store.create({ content: 'consolidation engine architecture' });

  const results = await retriever.query({ text: 'consol' });
  expect(results.length).toBeGreaterThan(0);
});
```

- [ ] **Step 7: Implement prefix matching**

In the FTS5 query builder, append `*` to each term for prefix matching:

```typescript
const ftsQuery = terms.map(t => `"${t}"*`).join(' OR ');
```

- [ ] **Step 8: Run full retrieval test suite**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/retrieval.test.ts`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame
git add packages/memory/src/store.ts packages/memory/src/retrieval.ts packages/memory/src/retrieval.test.ts
git commit -m "improve search: OR semantics, BM25 scoring, prefix matching"
```

---

### Task 4: Duplicate detection

**Files:**
- Create: `packages/memory/src/dedup.ts`
- Test: `packages/memory/src/dedup.test.ts`

No duplicate detection exists. When saving a memory, check if a near-duplicate already exists via token overlap.

- [ ] **Step 1: Write the failing test**

Create `packages/memory/src/dedup.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from './store.js';
import { findDuplicate } from './dedup.js';

describe('findDuplicate', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  it('returns null when no duplicate exists', () => {
    store.create({ content: 'unique memory about cats' });
    const result = findDuplicate(store, 'completely different topic about cars');
    expect(result).toBeNull();
  });

  it('returns the duplicate when content is near-identical', () => {
    const original = store.create({ content: 'ForgeFrame uses SQLite for storage' });
    const result = findDuplicate(store, 'ForgeFrame uses SQLite for its storage backend');
    expect(result).not.toBeNull();
    expect(result!.id).toBe(original.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/dedup.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 3: Implement findDuplicate**

Create `packages/memory/src/dedup.ts`:

```typescript
import type { MemoryStore } from './store.js';
import type { Memory } from './types.js';

/**
 * Check if a near-duplicate memory exists.
 * Uses FTS5 text search to find candidates, then checks for high overlap.
 * Returns the existing memory if a duplicate is found, null otherwise.
 */
export function findDuplicate(
  store: MemoryStore,
  content: string,
  threshold = 0.85,
): Memory | null {
  // Extract key terms for search
  const terms = content
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 3)
    .slice(0, 5);

  if (terms.length === 0) return null;

  const candidates = store.search(terms.join(' '), 5);
  if (candidates.length === 0) return null;

  // Simple token overlap check
  const contentTokens = new Set(content.toLowerCase().split(/\s+/));

  for (const candidate of candidates) {
    const candidateTokens = new Set(candidate.content.toLowerCase().split(/\s+/));
    const intersection = [...contentTokens].filter(t => candidateTokens.has(t));
    const union = new Set([...contentTokens, ...candidateTokens]);
    const jaccard = intersection.length / union.size;

    if (jaccard >= threshold) {
      return candidate;
    }
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/dedup.test.ts`
Expected: PASS

- [ ] **Step 5: Export from index.ts**

Add to `packages/memory/src/index.ts`:

```typescript
export { findDuplicate } from './dedup.js';
```

- [ ] **Step 6: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame
git add packages/memory/src/dedup.ts packages/memory/src/dedup.test.ts packages/memory/src/index.ts
git commit -m "add duplicate detection via token overlap"
```

---

### Task 5: Episodic-to-semantic promotion

**Files:**
- Modify: `packages/memory/src/consolidation.ts`
- Test: `packages/memory/src/consolidation.test.ts`

When consolidation merges a cluster of episodic memories into a summary, the summary should be `semantic` type. Also add a method to find promotion candidates.

- [ ] **Step 1: Write failing test**

In `packages/memory/src/consolidation.test.ts`:

```typescript
it('getPromotionCandidates returns episodic memories with high retrieval count', () => {
  // Create episodic memories with varying retrieval counts
  const m1 = store.create({ content: 'event one', type: 'episodic' });
  const m2 = store.create({ content: 'event two', type: 'episodic' });
  store.create({ content: 'fact three', type: 'semantic' });

  // Bump retrieval count on m1
  for (let i = 0; i < 10; i++) {
    store.reconsolidate(m1.id, { relevanceScore: 0.8 });
  }

  const candidates = engine.getPromotionCandidates(5);
  expect(candidates.length).toBe(1);
  expect(candidates[0].id).toBe(m1.id);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/consolidation.test.ts -t "getPromotionCandidates"`
Expected: FAIL -- method does not exist

- [ ] **Step 3: Implement getPromotionCandidates and promoteToSemantic**

In `packages/memory/src/consolidation.ts`, add methods:

```typescript
getPromotionCandidates(minRetrievalCount = 5): Memory[] {
  const rows = this.store['_db'].prepare(`
    SELECT * FROM memories
    WHERE memory_type = 'episodic'
    AND retrieval_count >= ?
    AND tags NOT LIKE '%"principle"%'
    AND tags NOT LIKE '%"voice"%'
    ORDER BY retrieval_count DESC
    LIMIT 20
  `).all(minRetrievalCount);

  return rows.map((r: any) => this.store['_rowToMemory'](r));
}

promoteToSemantic(id: string): void {
  this.store['_db'].prepare(`
    UPDATE memories SET memory_type = 'semantic' WHERE id = ? AND memory_type = 'episodic'
  `).run(id);
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/consolidation.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame
git add packages/memory/src/consolidation.ts packages/memory/src/consolidation.test.ts
git commit -m "add episodic-to-semantic promotion"
```

---

## PHASE 2: Emotional Tagging + Sleep Pressure

All three tasks are independent.

### Task 6: Valence column + classification

**Files:**
- Modify: `packages/memory/src/store.ts` (migration 9, create/get methods)
- Modify: `packages/memory/src/types.ts`
- Create: `packages/memory/src/valence.ts`
- Test: `packages/memory/src/valence.test.ts`
- Modify: `packages/memory/src/store.test.ts`
- Modify: `packages/server/src/tools.ts`

- [ ] **Step 1: Add valence types**

In `packages/memory/src/types.ts`:

```typescript
export const VALENCE_STATES = ['charged', 'neutral', 'grounding'] as const;
export type Valence = (typeof VALENCE_STATES)[number];
```

Add `valence: Valence` to the `Memory` interface.
Add `valence?: Valence` to `MemoryCreateInput`.

- [ ] **Step 2: Add migration 9**

In `packages/memory/src/store.ts`, increment SCHEMA_VERSION to 9 and add migration:

```typescript
if (version < 9) {
  db.exec(`
    ALTER TABLE memories ADD COLUMN valence TEXT NOT NULL DEFAULT 'neutral';
    UPDATE memories SET valence = 'grounding'
      WHERE tags LIKE '%"principle"%' OR tags LIKE '%"voice"%';
  `);
  db.pragma(`user_version = 9`);
}
```

Note: SQLite CHECK constraints cannot be added via ALTER TABLE. Enforce in application code.

- [ ] **Step 3: Write valence classification module**

Create `packages/memory/src/valence.ts`:

```typescript
import type { OllamaGenerator } from './generator.js';
import type { Valence } from './types.js';

const CLASSIFY_PROMPT = `Classify this memory's emotional valence as exactly one word:
- "charged" if it carries emotional weight (decisions under pressure, personal stakes, breakthroughs, conflict)
- "neutral" if it's factual, operational, or informational
- "grounding" if it anchors identity (principles, values, constitutional commitments)

Memory: "{content}"

Respond with exactly one word: charged, neutral, or grounding`;

export async function classifyValence(
  content: string,
  generator: OllamaGenerator | null,
  tags: string[] = [],
): Promise<Valence> {
  // Constitutional tags always get grounding -- no LLM needed
  if (tags.some(t => t === 'principle' || t === 'voice')) {
    return 'grounding';
  }

  // If no generator available, default to neutral
  if (!generator) return 'neutral';

  try {
    const response = await generator.generate(
      CLASSIFY_PROMPT.replace('{content}', content.slice(0, 500)),
      { maxTokens: 5 },
    );
    const word = response.trim().toLowerCase();
    if (word === 'charged' || word === 'neutral' || word === 'grounding') {
      return word;
    }
    return 'neutral';
  } catch {
    return 'neutral';
  }
}
```

- [ ] **Step 4: Write tests**

Create `packages/memory/src/valence.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { classifyValence } from './valence.js';

describe('classifyValence', () => {
  it('returns grounding for principle-tagged memories without LLM', async () => {
    const result = await classifyValence('some content', null, ['principle']);
    expect(result).toBe('grounding');
  });

  it('returns grounding for voice-tagged memories without LLM', async () => {
    const result = await classifyValence('some content', null, ['voice']);
    expect(result).toBe('grounding');
  });

  it('returns neutral when no generator available', async () => {
    const result = await classifyValence('some operational note', null);
    expect(result).toBe('neutral');
  });
});
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/valence.test.ts`
Expected: PASS

- [ ] **Step 6: Wire valence into store create() and _rowToMemory()**

In `store.ts`:
- `_rowToMemory`: map `row.valence` to Memory.valence
- `create()`: accept and store valence (default 'neutral')
- Enforce constitutional rule: if tags contain 'principle' or 'voice', force valence to 'grounding'

- [ ] **Step 7: Add valence parameter to memory_save MCP tool**

In `packages/server/src/tools.ts`, add to the memory_save schema:

```typescript
valence: z.enum(['charged', 'neutral', 'grounding']).optional()
  .describe('Emotional valence (auto-classified if omitted)'),
```

- [ ] **Step 8: Write store integration tests**

In `packages/memory/src/store.test.ts`:

```typescript
it('stores and retrieves valence', () => {
  const mem = store.create({ content: 'test', valence: 'charged' });
  expect(store.get(mem.id)!.valence).toBe('charged');
});

it('principle-tagged memories always have grounding valence', () => {
  const mem = store.create({ content: 'test', tags: ['principle'], valence: 'charged' });
  expect(store.get(mem.id)!.valence).toBe('grounding');
});
```

- [ ] **Step 9: Run full test suite**

Run: `cd /Users/acamp/repos/ForgeFrame && npm test`
Expected: All tests PASS

- [ ] **Step 10: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame
git add packages/memory/src/store.ts packages/memory/src/types.ts packages/memory/src/valence.ts packages/memory/src/valence.test.ts packages/memory/src/store.test.ts packages/memory/src/index.ts packages/server/src/tools.ts
git commit -m "add emotional valence tagging with constitutional enforcement"
```

---

### Task 7: dev_active Guardian signal

**Files:**
- Create: `packages/memory/src/idle-detector.ts`
- Test: `packages/memory/src/idle-detector.test.ts`
- Modify: `packages/memory/src/guardian.ts`
- Modify: `packages/memory/src/types.ts`

- [ ] **Step 1: Add DevActiveState to types**

In `packages/memory/src/types.ts`, add:

```typescript
export interface DevActiveState {
  idleSeconds: number;
  active: boolean;
}
```

Add `devActive` to `GuardianSignals`:

```typescript
devActive: boolean;
```

- [ ] **Step 2: Create idle detector**

Create `packages/memory/src/idle-detector.ts`:

```typescript
import { execFileSync } from 'node:child_process';
import type { DevActiveState } from './types.js';

const ACTIVE_THRESHOLD_SECONDS = 900; // 15 minutes

export function getIdleState(): DevActiveState {
  try {
    const output = execFileSync(
      '/bin/bash',
      ['-c', "ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000)}'"],
      { encoding: 'utf8', timeout: 5000 },
    );
    const idleSeconds = parseInt(output.trim(), 10) || 0;
    return {
      idleSeconds,
      active: idleSeconds < ACTIVE_THRESHOLD_SECONDS,
    };
  } catch {
    // If we can't detect, assume active (safe default -- don't dream)
    return { idleSeconds: 0, active: true };
  }
}

export function getMemoryPressure(): 'normal' | 'warn' | 'critical' {
  try {
    const output = execFileSync('memory_pressure', [], { encoding: 'utf8', timeout: 5000 });
    if (output.includes('CRITICAL')) return 'critical';
    if (output.includes('WARN')) return 'warn';
    return 'normal';
  } catch {
    return 'normal'; // safe default
  }
}
```

- [ ] **Step 3: Write tests**

Create `packages/memory/src/idle-detector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getIdleState, getMemoryPressure } from './idle-detector.js';

describe('getIdleState', () => {
  it('returns an object with idleSeconds and active', () => {
    const state = getIdleState();
    expect(typeof state.idleSeconds).toBe('number');
    expect(typeof state.active).toBe('boolean');
    expect(state.idleSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('getMemoryPressure', () => {
  it('returns normal, warn, or critical', () => {
    const pressure = getMemoryPressure();
    expect(['normal', 'warn', 'critical']).toContain(pressure);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/idle-detector.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into Guardian**

In `packages/memory/src/guardian.ts`, import `getIdleState` and add `devActive` to the signals computation. The `devActive` signal does not affect temperature calculation (it is not a cognitive signal). It is surfaced for consumers (dream scheduler, Hermes) to check.

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/acamp/repos/ForgeFrame && npm test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame
git add packages/memory/src/idle-detector.ts packages/memory/src/idle-detector.test.ts packages/memory/src/guardian.ts packages/memory/src/types.ts packages/memory/src/index.ts
git commit -m "add dev_active idle detection and memory pressure signals"
```

---

### Task 8: Sleep pressure metric

**Files:**
- Create: `packages/memory/src/sleep-pressure.ts`
- Test: `packages/memory/src/sleep-pressure.test.ts`
- Modify: `packages/memory/src/types.ts`

- [ ] **Step 1: Add SleepPressure type**

In `packages/memory/src/types.ts`:

```typescript
export interface SleepPressure {
  score: number;
  components: {
    unconsolidated: number;
    hoursSinceLastDream: number;
    unscannedContradictions: number;
    pendingDecay: number;
  };
  recommendation: 'sleep' | 'nrem' | 'full';
}
```

- [ ] **Step 2: Create sleep pressure module**

Create `packages/memory/src/sleep-pressure.ts`:

```typescript
import type { MemoryStore } from './store.js';
import type { SleepPressure } from './types.js';

const NREM_THRESHOLD = 20;
const FULL_THRESHOLD = 50;

export function computeSleepPressure(store: MemoryStore): SleepPressure {
  const db = store['_db'];

  // Count memories created since last dream journal
  const lastDream = db.prepare(`
    SELECT MAX(created_at) as ts FROM memories WHERE tags LIKE '%"dream-journal"%'
  `).get() as { ts: number | null };
  const lastDreamAt = lastDream?.ts ?? 0;
  const hoursSinceLastDream = (Date.now() - lastDreamAt) / 3600000;

  // Count memories saved since last dream
  const unconsolidated = db.prepare(`
    SELECT COUNT(*) as count FROM memories WHERE created_at > ?
    AND tags NOT LIKE '%"dream-journal"%'
  `).get(lastDreamAt) as { count: number };

  // Count unscanned contradiction pairs (contradicts edges without proposals)
  const unscanned = db.prepare(`
    SELECT COUNT(*) as count FROM memory_edges
    WHERE relation_type = 'contradicts'
    AND id NOT IN (SELECT edge_id FROM contradiction_proposals)
  `).get() as { count: number };

  // Count memories needing decay (not decayed in 24+ hours)
  const dayAgo = Date.now() - 86400000;
  const pendingDecay = db.prepare(`
    SELECT COUNT(*) as count FROM memories
    WHERE (last_decay_at IS NULL OR last_decay_at < ?)
    AND strength > 0.1
    AND tags NOT LIKE '%"principle"%' AND tags NOT LIKE '%"voice"%'
  `).get(dayAgo) as { count: number };

  const components = {
    unconsolidated: unconsolidated.count,
    hoursSinceLastDream,
    unscannedContradictions: unscanned.count,
    pendingDecay: pendingDecay.count,
  };

  const score =
    components.unconsolidated * 0.4 +
    components.hoursSinceLastDream * 0.3 +
    components.unscannedContradictions * 0.2 +
    components.pendingDecay * 0.1;

  let recommendation: SleepPressure['recommendation'] = 'sleep';
  if (score >= FULL_THRESHOLD) recommendation = 'full';
  else if (score >= NREM_THRESHOLD) recommendation = 'nrem';

  return { score, components, recommendation };
}
```

- [ ] **Step 3: Write tests**

Create `packages/memory/src/sleep-pressure.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from './store.js';
import { computeSleepPressure } from './sleep-pressure.js';

describe('computeSleepPressure', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  it('returns sleep when no memories exist', () => {
    const pressure = computeSleepPressure(store);
    expect(pressure.recommendation).toBe('sleep');
    expect(pressure.score).toBeCloseTo(0, 0);
  });

  it('pressure increases with unconsolidated memories', () => {
    for (let i = 0; i < 50; i++) {
      store.create({ content: `memory ${i}` });
    }
    const pressure = computeSleepPressure(store);
    expect(pressure.score).toBeGreaterThan(20);
    expect(pressure.components.unconsolidated).toBe(50);
  });

  it('returns full when pressure is high', () => {
    for (let i = 0; i < 200; i++) {
      store.create({ content: `memory ${i}` });
    }
    const pressure = computeSleepPressure(store);
    expect(pressure.recommendation).toBe('full');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/sleep-pressure.test.ts`
Expected: PASS

- [ ] **Step 5: Export and commit**

Add to `packages/memory/src/index.ts`:

```typescript
export { computeSleepPressure } from './sleep-pressure.js';
```

```bash
cd /Users/acamp/repos/ForgeFrame
git add packages/memory/src/sleep-pressure.ts packages/memory/src/sleep-pressure.test.ts packages/memory/src/types.ts packages/memory/src/index.ts
git commit -m "add sleep pressure metric for dream scheduling"
```

---

## PHASE 3: Dream Engine

Sequential -- each task builds on the previous.

### Task 9: NREM phase (compression)

**Files:**
- Create: `packages/memory/src/dream-nrem.ts`
- Test: `packages/memory/src/dream-nrem.test.ts`

Orchestrates the cheap compression pass: Hebbian maintenance + cluster scan + dedup + emotional triage + valence backfill. See spec Section 4 for full details.

- [ ] **Step 1: Write failing test**

Create `packages/memory/src/dream-nrem.test.ts` with tests for: runs without error on empty database, prunes weak edges, runs Hebbian LTD pass.

- [ ] **Step 2: Implement NremPhase class**

Create `packages/memory/src/dream-nrem.ts`. The class takes store, HebbianEngine, ConsolidationEngine, and optional OllamaGenerator. The `run()` method executes steps sequentially: Hebbian maintenance, decay pass, cluster scan + dedup proposals, valence backfill. Each step is wrapped in try/catch so one failure does not abort the cycle. Returns `NremResult` with counts and duration.

- [ ] **Step 3: Run tests, commit**

---

### Task 10: Dream journal

**Files:**
- Create: `packages/memory/src/dream-journal.ts`
- Test: `packages/memory/src/dream-journal.test.ts`

Writes a narrative memory after each dream cycle. See spec Section 8 for structure. Saved with tags `['dream-journal', phase, date]`. Includes graph health stats.

- [ ] **Step 1: Write tests for journal creation and tag retrieval**
- [ ] **Step 2: Implement writeDreamJournal function**
- [ ] **Step 3: Run tests, commit**

---

### Task 11: Dream seeding

**Files:**
- Create: `packages/memory/src/dream-seeding.ts`
- Test: `packages/memory/src/dream-seeding.test.ts`

Structured anti-Hebbian recombination. See spec Section 9 for full details. Seeds are selected from disconnected graph regions, pre-filtered by LLM, sent to founder for grading.

- [ ] **Step 1: Write tests for seed selection (different clusters, no shared edges, excludes grounding)**
- [ ] **Step 2: Implement selectSeeds and applySeedGrade functions**
- [ ] **Step 3: Run tests, commit**

---

### Task 12: Hindsight review

**Files:**
- Create: `packages/memory/src/hindsight.ts`
- Test: `packages/memory/src/hindsight.test.ts`
- Modify: `packages/memory/src/store.ts` (add last_hindsight_review column, migration 10)

Anti-Hebbian audit for entrenched memories. See spec Section 10 for full details. Finds memories with high edge weight, old, never contradicted. Charged memories get 1.5x scrutiny multiplier.

- [ ] **Step 1: Add migration 10 for last_hindsight_review column**
- [ ] **Step 2: Write tests for candidate selection (weight threshold, age, constitutional exclusion, valence ranking)**
- [ ] **Step 3: Implement findHindsightCandidates and applyHindsightResponse**
- [ ] **Step 4: Run tests, commit**

---

### Task 13: Tension detection

**Files:**
- Create: `packages/memory/src/tensions.ts`
- Test: `packages/memory/src/tensions.test.ts`

Finds memory pairs that pull in different directions without contradicting. See spec Section 11. Pairs must be high-weight, from different tag clusters, with no existing edge.

- [ ] **Step 1: Write tests for tension candidate selection**
- [ ] **Step 2: Implement findTensionCandidates**
- [ ] **Step 3: Run tests, commit**

---

### Task 14: REM phase orchestrator

**Files:**
- Create: `packages/memory/src/dream-rem.ts`
- Test: `packages/memory/src/dream-rem.test.ts`

Orchestrates expensive creative phase: seeding + hindsight + tension + journal. See spec Section 5.

- [ ] **Step 1: Write test for empty database (no crash)**
- [ ] **Step 2: Implement RemPhase class orchestrating seeding, hindsight, tension detection**
- [ ] **Step 3: Run tests, commit**

---

## PHASE 4: Hermes Integration (PARALLEL with Phase 3)

### Task 15: ForgeFrame MemoryProvider for Hermes

**Files:**
- Create: `integrations/hermes/forgeframe_provider.py`
- Create: `integrations/hermes/requirements.txt`
- Test: `integrations/hermes/test_provider.py`

Python class implementing Hermes' MemoryProvider ABC. Delegates memory operations to ForgeFrame MCP server via stdio subprocess. See spec Section 2 for interface details.

Lifecycle hooks: initialize (connect MCP), prefetch (check Guardian temp, halt if trapped), sync_turn (route saves through ForgeFrame, intercept skill extractions), on_session_end (trigger NREM if idle), on_pre_compress (save context snapshot).

- [ ] **Step 1: Create integrations/hermes/ directory**
- [ ] **Step 2: Write ForgeFrameProvider class with MCP JSON-RPC communication**
- [ ] **Step 3: Write basic tests (instantiation, interface compliance)**
- [ ] **Step 4: Commit**

---

### Task 16: Guardian tool for Hermes

**Files:**
- Create: `integrations/hermes/guardian_tool.py`

Tool that registers in Hermes' tool registry. Exposes Guardian temperature as opaque state (calm/warm/trapped) with human-readable instructions per state.

- [ ] **Step 1: Write guardian_check_handler with tool schema**
- [ ] **Step 2: Commit**

---

### Task 17: Hermes config and model routing

**Files:**
- Create: `integrations/hermes/config.yaml`
- Create: `integrations/hermes/setup.md`

Hermes config pointing at ForgeFrame MCP, model routing (Gemma local for triage, Sonnet for voice, Opus for deep), tool enablement (disable built-in memory, enable guardian_check).

- [ ] **Step 1: Write config.yaml and setup.md**
- [ ] **Step 2: Commit**

---

## PHASE 5: Cockpit Controls

New REST endpoints on the Hono HTTP server for Cockpit to consume. All endpoint tasks can run in parallel.

### Task 18: Dream control endpoints

**Files:**
- Modify: `packages/server/src/http.ts`

Endpoints: `GET /api/dream/pressure`, `POST /api/dream/trigger`, `PUT /api/dream/settings`, `GET /api/dream/journal/latest`, `GET /api/dream/seeds/pending`, `POST /api/dream/seeds/:id/grade`, `GET /api/dream/hindsight/pending`, `POST /api/dream/hindsight/:id/respond`, `GET /api/dream/tensions`.

- [ ] **Step 1: Add dream control routes**
- [ ] **Step 2: Write tests for critical endpoints (pressure, seed grading, hindsight response)**
- [ ] **Step 3: Commit**

---

### Task 19: Hermes control endpoints

**Files:**
- Modify: `packages/server/src/http.ts`

Endpoints: `GET /api/hermes/status`, `POST /api/hermes/pause`, `POST /api/hermes/resume`, `POST /api/hermes/cycle`.

- [ ] **Step 1: Add Hermes control routes**
- [ ] **Step 2: Commit**

---

### Task 20: Guardian control endpoints

**Files:**
- Modify: `packages/server/src/http.ts`

Endpoints: `GET /api/guardian/signals` (all signals with values), `PUT /api/guardian/override` (manually set a signal), `GET /api/guardian/idle` (current idle state + memory pressure).

- [ ] **Step 1: Add Guardian control routes**
- [ ] **Step 2: Commit**

---

### Task 21: Hebbian control endpoints

**Files:**
- Modify: `packages/server/src/http.ts`

Endpoints: `GET /api/hebbian/weights` (distribution stats), `PUT /api/hebbian/freeze` (toggle learning), `PUT /api/hebbian/rates` (adjust LTP/LTD rates).

- [ ] **Step 1: Add Hebbian control routes**
- [ ] **Step 2: Commit**

---

### Task 22: Dream journal viewer UI

**Files:**
- Modify: Cockpit frontend (served from http.ts)

Add dream journal viewer to Cockpit. Shows most recent journal as morning briefing. Includes hindsight reviews embedded in journal. Proposal queue for approving/rejecting consolidation proposals.

- [ ] **Step 1: Build journal feed view (fetches from /api/dream/journal/latest)**
- [ ] **Step 2: Build pending seeds view with emoji grading buttons**
- [ ] **Step 3: Build hindsight review view with keep/nuance/weaken buttons (weaken requires confirm)**
- [ ] **Step 4: Commit**

---

### Task 23: Proposal queue + tension board UI

**Files:**
- Modify: Cockpit frontend

Tension board showing soft tensions. Each entry links to source memories. Dismiss, pin, or annotate. Consolidation proposal queue with approve/reject inline.

- [ ] **Step 1: Build tension board view (fetches from /api/dream/tensions)**
- [ ] **Step 2: Build consolidation proposal queue**
- [ ] **Step 3: Commit**

---

### Task 24: Signal sonar panel (detachable)

**Files:**
- Modify: Cockpit frontend

The Signal entry point. A sonar icon in the status bar that opens the neural pathway view. Shows: sleep pressure gauge, dream activity indicator, Hermes status, Guardian temperature with all signals, Hebbian heatmap. Can be popped out to a separate window.

- [ ] **Step 1: Build sonar icon + panel toggle**
- [ ] **Step 2: Build sleep pressure gauge component**
- [ ] **Step 3: Build Guardian signal display**
- [ ] **Step 4: Build Hermes status indicator**
- [ ] **Step 5: Add popout/detach capability (window.open with panel contents)**
- [ ] **Step 6: Commit**

---

## PHASE 6: SSE Events + Integration

### Task 25: New SSE event types

**Files:**
- Modify: `packages/server/src/events.ts`

Add all new event types from spec Section 12: dream events (started, nrem:complete, rem:complete, journal:written, seed:sent, seed:graded, hindsight:sent, hindsight:responded, tension:detected, triggered, aborted), Hermes events (cycle:started, cycle:complete, task:executing, suppressed, cycle:timeout), Guardian events (dev_active, sleep_pressure), valence events (classified).

- [ ] **Step 1: Add event types to ServerEventMap**
- [ ] **Step 2: Run build to verify types compile**
- [ ] **Step 3: Commit**

---

### Task 26: Cockpit SSE wiring

**Files:**
- Modify: Cockpit frontend

Wire new SSE events into Cockpit UI. Dream activity in status bar, Guardian dev_active display, seed grade notifications, hindsight review alerts.

- [ ] **Step 1: Add SSE event handlers for new event types**
- [ ] **Step 2: Test in browser**
- [ ] **Step 3: Commit**

---

### Task 27: Integration tests

**Files:**
- Create: `packages/memory/src/dream-integration.test.ts`

End-to-end test: seed data, run NREM, run REM, write journal, verify graph state. Test that constitutional memories survive dream cycle unchanged.

- [ ] **Step 1: Write full cycle integration test**
- [ ] **Step 2: Write constitutional protection test**
- [ ] **Step 3: Run full test suite**
- [ ] **Step 4: Commit**

---

## PHASE 7: Cockpit Polish

From the cockpit design spec. Each can run in parallel except where noted.

### Task 28: Theme system (Ink, Linen, Slate, Void)

Implement 5 themes from cockpit spec. All share the same seven-tier opacity system, glass recipe, and typography scale. Theme switch via CSS custom properties -- instant, no reload. Store preference in localStorage.

---

### Task 29: Settings panel

`Cmd+,` opens settings: theme selector with visual previews, font size scaling, reduced motion toggle, graph density preference, Guardian sensitivity slider, dream threshold sliders, dev_active threshold slider.

---

### Task 30: Semantic zoom / nested clusters

Hierarchical nodes. Zoom in to expand clusters, zoom out to collapse. Level-of-detail rendering via instanced quads. Edge bundling for collapsed clusters. Test with 650+ memories and 3000+ edges.

---

### Task 31: Tab system + markdown editor

Tabs above inspector panel. Each tab is an open memory with contenteditable markdown editor. Close, reorder, maximize. Tabs persist across sessions in localStorage.

---

### Task 32: Artifact state machine (depends on Task 31)

Draft to ready to shipped to trapped state machine. Readiness compounds from edits, review, strength, edge count, time-in-draft. Promote action from node context menu.

---

### Task 33: Mobile responsive layout (after all UI work)

Responsive breakpoints: desktop (>1024px) three-column, tablet (768-1024px) icon strip sidebar, mobile (<768px) single-column with bottom tab bar and bottom sheet inspector. Touch events for graph.

---

## Execution Summary

```
Phase  | Tasks  | Parallel agents | Est. days | Dependencies
-------|--------|-----------------|-----------|-------------
1      | 1-5    | 5               | 2-3       | None
2      | 6-8    | 3               | 2-3       | None (parallel with Phase 1)
3      | 9-14   | 1 (sequential)  | 5-7       | Phase 2
4      | 15-17  | 1 (sequential)  | 2-3       | None (parallel with Phase 3)
5      | 18-24  | 4+              | 3-4       | Phases 3 + 4
6      | 25-27  | 1 (sequential)  | 2-3       | Phase 5
7      | 28-33  | 4               | 5-7       | Phase 6
-------|--------|-----------------|-----------|-------------
Total  | 33     | 8-10 peak       | 25-35     |
```

**Critical path:** Phase 2 -> Phase 3 -> Phase 5 -> Phase 6 -> Phase 7

**Max parallelism:** Phase 1 (5 agents) + Phase 2 (3 agents) = 8 agents in the first sprint

**First milestone:** After Phase 3, the dream engine is functional. You can test NREM/REM cycles locally before wiring Hermes.

**Second milestone:** After Phase 5, the Cockpit has full controls. You can steer everything from the browser.

**Ship milestone:** After Phase 7, the full system is complete. Ready for benchmarks (Wave 9) and launch (Wave 10).
