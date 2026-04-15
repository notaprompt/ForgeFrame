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

  it('includes sourceCalibration in result', async () => {
    const nrem = makeNrem(store);
    const result = await nrem.run();

    expect(Array.isArray(result.sourceCalibration)).toBe(true);
  });
});

describe('NremPhase — source calibration', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('returns empty calibration with no source-tagged memories', async () => {
    store.create({ content: 'regular memory without source tag' });

    const nrem = makeNrem(store);
    const result = await nrem.run();

    expect(result.sourceCalibration).toHaveLength(0);
  });

  it('computes survival rate for source-tagged memories older than 7 days', async () => {
    const db = (store as any)['_db'];
    const oldTimestamp = Date.now() - 10 * 86_400_000; // 10 days ago

    // Create 5 distillery memories, backdate them
    for (let i = 0; i < 5; i++) {
      const m = store.create({ content: `distillery item ${i}`, tags: ['source:distillery'] });
      db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(oldTimestamp, m.id);
    }

    // Make 2 of them "survive" — accessed and above floor strength
    const all = store.listByTag('source:distillery');
    for (let i = 0; i < 2; i++) {
      store.recordAccess(all[i].id);
    }

    const nrem = makeNrem(store);
    const result = await nrem.run();

    expect(result.sourceCalibration).toHaveLength(1);
    const entry = result.sourceCalibration[0];
    expect(entry.source).toBe('source:distillery');
    expect(entry.total).toBe(5);
    expect(entry.survived).toBe(2);
    expect(entry.survivalRate).toBe(0.4);
    expect(entry.flag).toBe('ok');
  });

  it('flags low survival rate when below 30%', async () => {
    const db = (store as any)['_db'];
    const oldTimestamp = Date.now() - 10 * 86_400_000;

    // Create 10 distillery memories, none accessed (all will have 0% survival)
    for (let i = 0; i < 10; i++) {
      const m = store.create({ content: `distillery noise ${i}`, tags: ['source:distillery'] });
      db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(oldTimestamp, m.id);
    }

    const nrem = makeNrem(store);
    const result = await nrem.run();

    expect(result.sourceCalibration).toHaveLength(1);
    expect(result.sourceCalibration[0].flag).toBe('low');
  });

  it('flags high survival rate when above 80%', async () => {
    const db = (store as any)['_db'];
    const oldTimestamp = Date.now() - 10 * 86_400_000;

    // Create 5 distillery memories, all accessed
    for (let i = 0; i < 5; i++) {
      const m = store.create({ content: `distillery gold ${i}`, tags: ['source:distillery'] });
      db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(oldTimestamp, m.id);
      store.recordAccess(m.id);
    }

    const nrem = makeNrem(store);
    const result = await nrem.run();

    expect(result.sourceCalibration).toHaveLength(1);
    expect(result.sourceCalibration[0].flag).toBe('high');
  });

  it('returns null flag when sample is too small', async () => {
    const db = (store as any)['_db'];
    const oldTimestamp = Date.now() - 10 * 86_400_000;

    // Only 3 memories — below the 5-memory threshold for flagging
    for (let i = 0; i < 3; i++) {
      const m = store.create({ content: `distillery sparse ${i}`, tags: ['source:distillery'] });
      db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(oldTimestamp, m.id);
    }

    const nrem = makeNrem(store);
    const result = await nrem.run();

    expect(result.sourceCalibration).toHaveLength(1);
    expect(result.sourceCalibration[0].flag).toBeNull();
  });

  it('ignores memories younger than 7 days', async () => {
    // Create recent distillery memories — should not appear in calibration
    for (let i = 0; i < 5; i++) {
      store.create({ content: `distillery recent ${i}`, tags: ['source:distillery'] });
    }

    const nrem = makeNrem(store);
    const result = await nrem.run();

    expect(result.sourceCalibration).toHaveLength(0);
  });

  it('tracks multiple sources independently', async () => {
    const db = (store as any)['_db'];
    const oldTimestamp = Date.now() - 10 * 86_400_000;

    for (let i = 0; i < 5; i++) {
      const m = store.create({ content: `distillery item ${i}`, tags: ['source:distillery'] });
      db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(oldTimestamp, m.id);
    }
    for (let i = 0; i < 5; i++) {
      const m = store.create({ content: `hermes item ${i}`, tags: ['source:hermes'] });
      db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(oldTimestamp, m.id);
      store.recordAccess(m.id); // hermes memories all accessed
    }

    const nrem = makeNrem(store);
    const result = await nrem.run();

    expect(result.sourceCalibration).toHaveLength(2);
    const distillery = result.sourceCalibration.find(e => e.source === 'source:distillery');
    const hermes = result.sourceCalibration.find(e => e.source === 'source:hermes');
    expect(distillery).toBeDefined();
    expect(hermes).toBeDefined();
    expect(distillery!.survivalRate).toBe(0);
    expect(hermes!.survivalRate).toBe(1);
  });
});
