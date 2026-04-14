import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { HebbianEngine } from './hebbian.js';
import { ConsolidationEngine } from './consolidation.js';
import type { Generator } from './generator.js';
import { NremPhase } from './dream-nrem.js';

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
  const hebbian = new HebbianEngine(store);
  const consolidation = new ConsolidationEngine(store, generator ?? new MockGenerator());
  return new NremPhase(store, hebbian, consolidation, null);
}

describe('NremPhase — empty database', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('runs without error on empty database', async () => {
    const nrem = makeNrem(store);
    const result = await nrem.run();

    expect(result.errors).toHaveLength(0);
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.edgesPruned).toBe(0);
    expect(result.decayApplied).toBe(true);
    expect(result.clustersFound).toBe(0);
    expect(result.dedupProposals).toBe(0);
    expect(result.valenceBackfilled).toBe(0);
  });
});

describe('NremPhase — decay', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('applies decay during NREM', async () => {
    // Create memories with full strength (1.0 by default)
    const m1 = store.create({ content: 'alpha memory for decay test' });
    const m2 = store.create({ content: 'beta memory for decay test' });

    expect(m1.strength).toBe(1.0);
    expect(m2.strength).toBe(1.0);

    const nrem = makeNrem(store);
    const result = await nrem.run();

    expect(result.decayApplied).toBe(true);
    expect(result.errors.filter((e) => e.startsWith('decay:'))).toHaveLength(0);
  });
});

describe('NremPhase — Hebbian LTD maintenance', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('runs Hebbian LTD pass without error', async () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });

    const nrem = makeNrem(store);
    const result = await nrem.run();

    expect(result.errors.filter((e) => e.startsWith('hebbian:'))).toHaveLength(0);
    // Edge should be weakened by LTD decrement (1.0 - 0.02 = 0.98)
    const edge = store.getEdgeBetween(m1.id, m2.id);
    expect(edge).not.toBeNull();
    expect(edge!.weight).toBeCloseTo(0.98);
  });

  it('prunes weak edges below 0.05 threshold', async () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    // Edge just above prune threshold — will fall below after LTD
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 0.06 });

    const nrem = makeNrem(store);
    const result = await nrem.run();

    expect(result.errors.filter((e) => e.startsWith('hebbian:'))).toHaveLength(0);
    expect(result.edgesPruned).toBe(1);
    expect(store.getEdgeBetween(m1.id, m2.id)).toBeNull();
  });

  it('does not prune constitutional edges', async () => {
    const principle = store.create({ content: 'sovereignty is non-negotiable', tags: ['principle'] });
    const m2 = store.create({ content: 'related memory' });
    // Weak edge to a constitutional memory — should not be pruned
    store.createEdge({ sourceId: principle.id, targetId: m2.id, relationType: 'related', weight: 0.06 });

    const nrem = makeNrem(store);
    const result = await nrem.run();

    expect(result.edgesPruned).toBe(0);
    expect(store.getEdgeBetween(principle.id, m2.id)).not.toBeNull();
  });
});

describe('NremPhase — cluster scan', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('cluster scan runs without error', async () => {
    // Create a few memories — cluster threshold requires 5+ with avgWeight >= 1.2
    for (let i = 0; i < 3; i++) {
      store.create({ content: `memory ${i}` });
    }

    const nrem = makeNrem(store);
    const result = await nrem.run();

    expect(result.errors.filter((e) => e.startsWith('clusters:'))).toHaveLength(0);
    // Not enough for a cluster — 0 found
    expect(result.clustersFound).toBe(0);
  });
});

describe('NremPhase — result shape', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('returns all required fields in NremResult', async () => {
    const nrem = makeNrem(store);
    const result = await nrem.run();

    expect(typeof result.duration).toBe('number');
    expect(typeof result.edgesPruned).toBe('number');
    expect(typeof result.decayApplied).toBe('boolean');
    expect(typeof result.clustersFound).toBe('number');
    expect(typeof result.dedupProposals).toBe('number');
    expect(typeof result.valenceBackfilled).toBe('number');
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('does not backfill valence without a generator', async () => {
    store.create({ content: 'neutral memory with emotional weight' });

    const nrem = makeNrem(store, null);
    const result = await nrem.run();

    expect(result.valenceBackfilled).toBe(0);
  });
});
