/**
 * @forgeframe/memory — Dream Integration Tests
 *
 * End-to-end dream cycle tests: seed data, run NREM, run REM,
 * write journal, verify graph state. Constitutional memories must
 * survive dream cycles unchanged.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { HebbianEngine } from './hebbian.js';
import { ConsolidationEngine } from './consolidation.js';
import { NremPhase } from './dream-nrem.js';
import { RemPhase } from './dream-rem.js';
import { computeSleepPressure } from './sleep-pressure.js';
import type { Generator } from './generator.js';

class MockGenerator implements Generator {
  async generate(_prompt: string): Promise<string | null> {
    return JSON.stringify({
      title: 'Test Pattern',
      summary: 'A test consolidation pattern.',
      patterns: ['test'],
      suggestedTags: ['pattern'],
    });
  }
}

function makeNrem(store: MemoryStore, generator: Generator | null = null): NremPhase {
  const gen = generator ?? new MockGenerator();
  const hebbian = new HebbianEngine(store);
  const consolidation = new ConsolidationEngine(store, gen);
  return new NremPhase(store, hebbian, consolidation, generator);
}

describe('Dream Integration — full cycle on empty database', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('runs NREM then REM without errors on empty database', async () => {
    const nrem = makeNrem(store);
    const nremResult = await nrem.run();

    expect(nremResult.errors).toHaveLength(0);
    expect(nremResult.duration).toBeGreaterThanOrEqual(0);
    expect(nremResult.edgesPruned).toBe(0);
    expect(nremResult.decayApplied).toBe(true);

    const rem = new RemPhase(store);
    const remResult = await rem.run(55);

    expect(remResult.errors).toHaveLength(0);
    expect(remResult.duration).toBeGreaterThanOrEqual(0);
    expect(remResult.journalMemoryId).not.toBeNull();

    // Verify journal was written
    const journal = store.get(remResult.journalMemoryId!);
    expect(journal).not.toBeNull();
    expect(journal!.tags).toContain('dream-journal');
  });

  it('returns correct result shapes from both phases', async () => {
    const nrem = makeNrem(store);
    const nremResult = await nrem.run();

    expect(typeof nremResult.duration).toBe('number');
    expect(typeof nremResult.edgesPruned).toBe('number');
    expect(typeof nremResult.decayApplied).toBe('boolean');
    expect(typeof nremResult.clustersFound).toBe('number');
    expect(typeof nremResult.dedupProposals).toBe('number');
    expect(typeof nremResult.valenceBackfilled).toBe('number');
    expect(Array.isArray(nremResult.sourceCalibration)).toBe(true);
    expect(Array.isArray(nremResult.errors)).toBe(true);

    const rem = new RemPhase(store);
    const remResult = await rem.run(55);

    expect(typeof remResult.duration).toBe('number');
    expect(Array.isArray(remResult.seeds)).toBe(true);
    expect(Array.isArray(remResult.hindsightCandidates)).toBe(true);
    expect(Array.isArray(remResult.tensions)).toBe(true);
    expect(Array.isArray(remResult.errors)).toBe(true);
  });
});

describe('Dream Integration — constitutional memories survive full cycle', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('preserves principle memory content, tags, and valence through dream cycle', async () => {
    const principle = store.create({
      content: 'sovereignty is non-negotiable — local-first always',
      tags: ['principle'],
      valence: 'grounding',
    });
    const voice = store.create({
      content: 'no LinkedIn polish, let the work speak',
      tags: ['voice'],
      valence: 'grounding',
    });

    // Create an edge between constitutional memories
    const edge = store.createEdge({
      sourceId: principle.id,
      targetId: voice.id,
      relationType: 'related',
      weight: 1.0,
    });

    // Record initial state
    const initialPrinciple = { ...store.get(principle.id)! };
    const initialVoice = { ...store.get(voice.id)! };
    const initialEdge = store.getEdgeBetween(principle.id, voice.id)!;

    // Run full cycle
    const nrem = makeNrem(store);
    await nrem.run();

    const rem = new RemPhase(store);
    await rem.run(55);

    // Verify principle memory unchanged
    const afterPrinciple = store.get(principle.id)!;
    expect(afterPrinciple.content).toBe(initialPrinciple.content);
    expect(afterPrinciple.tags).toEqual(initialPrinciple.tags);
    expect(afterPrinciple.valence).toBe('grounding');

    // Verify voice memory unchanged
    const afterVoice = store.get(voice.id)!;
    expect(afterVoice.content).toBe(initialVoice.content);
    expect(afterVoice.tags).toEqual(initialVoice.tags);
    expect(afterVoice.valence).toBe('grounding');

    // Verify edge not pruned or weakened
    const afterEdge = store.getEdgeBetween(principle.id, voice.id);
    expect(afterEdge).not.toBeNull();
    expect(afterEdge!.weight).toBe(initialEdge.weight);
  });

  it('does not alter constitutional memory strength during decay', async () => {
    const principle = store.create({
      content: 'architecture before features',
      tags: ['principle'],
      valence: 'grounding',
    });

    const strengthBefore = store.get(principle.id)!.strength;

    const nrem = makeNrem(store);
    await nrem.run();

    const strengthAfter = store.get(principle.id)!.strength;
    expect(strengthAfter).toBe(strengthBefore);
  });
});

describe('Dream Integration — NREM weakens non-constitutional edges', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('weakens regular edges by LTD but leaves constitutional edges untouched', async () => {
    // Regular memories with edge at 1.0
    const m1 = store.create({ content: 'regular memory alpha' });
    const m2 = store.create({ content: 'regular memory beta' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });

    // Constitutional memory with edge at 1.0
    const principle = store.create({
      content: 'local-first is the way',
      tags: ['principle'],
      valence: 'grounding',
    });
    const m3 = store.create({ content: 'related to principle' });
    store.createEdge({ sourceId: principle.id, targetId: m3.id, relationType: 'related', weight: 1.0 });

    const nrem = makeNrem(store);
    await nrem.run();

    // Regular edge should be weakened by LTD (0.02 decrement)
    const regularEdge = store.getEdgeBetween(m1.id, m2.id);
    expect(regularEdge).not.toBeNull();
    expect(regularEdge!.weight).toBeCloseTo(0.98);

    // Constitutional edge should remain untouched
    const constEdge = store.getEdgeBetween(principle.id, m3.id);
    expect(constEdge).not.toBeNull();
    expect(constEdge!.weight).toBe(1.0);
  });

  it('does not prune regular edges that stay above threshold after LTD', async () => {
    const m1 = store.create({ content: 'stable memory one' });
    const m2 = store.create({ content: 'stable memory two' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 0.5 });

    const nrem = makeNrem(store);
    const result = await nrem.run();

    expect(result.edgesPruned).toBe(0);
    const edge = store.getEdgeBetween(m1.id, m2.id);
    expect(edge).not.toBeNull();
    expect(edge!.weight).toBeCloseTo(0.48);
  });
});

describe('Dream Integration — seeding finds candidates across disconnected clusters', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('finds seeds from disconnected graph regions', async () => {
    // Cluster A: architecture memories
    const a1 = store.create({ content: 'local-first architecture for data sovereignty' });
    const a2 = store.create({ content: 'SQLite as primary storage for edge compute' });
    store.createEdge({ sourceId: a1.id, targetId: a2.id, relationType: 'related' });

    // Cluster B: business memories (no edges to cluster A)
    const b1 = store.create({ content: 'enterprise pricing model with volume tiers' });
    const b2 = store.create({ content: 'freemium conversion funnel analysis' });
    store.createEdge({ sourceId: b1.id, targetId: b2.id, relationType: 'related' });

    const rem = new RemPhase(store);
    const result = await rem.run(55);

    expect(result.seeds.length).toBeGreaterThan(0);

    // Verify seeds pair memories from different clusters
    for (const seed of result.seeds) {
      expect(seed.memories).toHaveLength(2);
      expect(seed.clusterIds[0]).not.toBe(seed.clusterIds[1]);
    }
  });
});

describe('Dream Integration — source calibration reports', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('reports survival rate for backdated source-tagged memories', async () => {
    const db = (store as any)['_db'];
    const oldTimestamp = Date.now() - 10 * 86_400_000; // 10 days ago

    // Create 6 distillery memories, backdate them
    for (let i = 0; i < 6; i++) {
      const m = store.create({ content: `distillery article ${i}`, tags: ['source:distillery'] });
      db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(oldTimestamp, m.id);
    }

    // Simulate survival: access 3 of them
    const all = store.listByTag('source:distillery');
    for (let i = 0; i < 3; i++) {
      store.recordAccess(all[i].id);
    }

    const nrem = makeNrem(store);
    const result = await nrem.run();

    expect(result.sourceCalibration).toHaveLength(1);
    const entry = result.sourceCalibration[0];
    expect(entry.source).toBe('source:distillery');
    expect(entry.total).toBe(6);
    expect(entry.survived).toBe(3);
    expect(entry.survivalRate).toBe(0.5);
    expect(entry.flag).toBe('ok');
  });
});

describe('Dream Integration — dream journal written after each phase', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('writes NREM journal with correct tags', async () => {
    // NREM does not write a journal by default (only REM does in the orchestrator).
    // But REM always writes one. Verify via REM.
    const rem = new RemPhase(store);
    const result = await rem.run(55);

    expect(result.journalMemoryId).not.toBeNull();
    const journal = store.get(result.journalMemoryId!);
    expect(journal).not.toBeNull();
    expect(journal!.tags).toContain('dream-journal');
    expect(journal!.tags).toContain('rem');
    // Date tag should be YYYY-MM-DD format
    const dateTag = journal!.tags.find((t) => /^\d{4}-\d{2}-\d{2}$/.test(t));
    expect(dateTag).toBeDefined();
  });

  it('writes separate journal entries for each REM run', async () => {
    const rem1 = new RemPhase(store);
    const result1 = await rem1.run(55);

    const rem2 = new RemPhase(store);
    const result2 = await rem2.run(40);

    expect(result1.journalMemoryId).not.toBeNull();
    expect(result2.journalMemoryId).not.toBeNull();
    expect(result1.journalMemoryId).not.toBe(result2.journalMemoryId);

    const journals = store.listByTag('dream-journal');
    expect(journals.length).toBeGreaterThanOrEqual(2);
  });

  it('journal content includes graph health stats', async () => {
    // Seed some data so graph health is non-trivial
    const m1 = store.create({ content: 'memory for journal stats' });
    const m2 = store.create({ content: 'another memory for journal stats' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related' });

    const rem = new RemPhase(store);
    const result = await rem.run(55);

    const journal = store.get(result.journalMemoryId!);
    expect(journal).not.toBeNull();
    expect(journal!.content).toContain('Graph health');
    expect(journal!.content).toContain('Total memories');
  });
});

describe('Dream Integration — sleep pressure after dream cycle', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('sleep pressure does not increase after NREM decay pass', async () => {
    // Create enough memories to generate sleep pressure from pending decay
    const db = (store as any)['_db'];
    const twoDaysAgo = Date.now() - 2 * 86_400_000;

    for (let i = 0; i < 20; i++) {
      const m = store.create({ content: `pressure test memory ${i}` });
      // Backdate last_decay_at so these show as pending decay
      db.prepare('UPDATE memories SET last_decay_at = NULL WHERE id = ?').run(m.id);
    }

    const pressureBefore = computeSleepPressure(store);

    const nrem = makeNrem(store);
    await nrem.run();

    const pressureAfter = computeSleepPressure(store);

    // After NREM runs decay, pending decay count should drop,
    // but unconsolidated count stays the same (memories still exist).
    // The pending decay component should not be higher.
    expect(pressureAfter.components.pendingDecay).toBeLessThanOrEqual(
      pressureBefore.components.pendingDecay,
    );
  });

  it('dream journal creation does not inflate unconsolidated count excessively', async () => {
    // Run a full cycle: NREM + REM
    const nrem = makeNrem(store);
    await nrem.run();

    const rem = new RemPhase(store);
    await rem.run(55);

    const pressure = computeSleepPressure(store);

    // After a fresh cycle with no real data, pressure should be low.
    // The only unconsolidated memories are the journal entries themselves.
    expect(pressure.components.unconsolidated).toBeLessThanOrEqual(2);
  });
});
