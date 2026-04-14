import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { selectSeeds, applySeedGrade } from './dream-seeding.js';

describe('Dream Seeding — selectSeeds', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('returns no seeds for empty database', () => {
    const seeds = selectSeeds(store);
    expect(seeds).toHaveLength(0);
  });

  it('returns no seeds when only a single cluster exists', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });

    const seeds = selectSeeds(store);
    expect(seeds).toHaveLength(0);
  });

  it('produces seeds from two disconnected clusters', () => {
    // Cluster A
    const a1 = store.create({ content: 'cluster A first' });
    const a2 = store.create({ content: 'cluster A second' });
    store.createEdge({ sourceId: a1.id, targetId: a2.id, relationType: 'similar', weight: 1.0 });

    // Cluster B
    const b1 = store.create({ content: 'cluster B first' });
    const b2 = store.create({ content: 'cluster B second' });
    store.createEdge({ sourceId: b1.id, targetId: b2.id, relationType: 'similar', weight: 1.0 });

    const seeds = selectSeeds(store);
    expect(seeds.length).toBeGreaterThan(0);

    for (const seed of seeds) {
      expect(seed.memories).toHaveLength(2);
      expect(seed.clusterIds[0]).not.toBe(seed.clusterIds[1]);
      expect(seed.id).toBeTruthy();
      expect(seed.createdAt).toBeGreaterThan(0);
    }
  });

  it('excludes grounding/principle memories from seeds', () => {
    // Principle memory (auto-gets grounding valence)
    const p = store.create({ content: 'sovereignty first', tags: ['principle'] });

    // Two orphan memories in separate "clusters"
    store.create({ content: 'regular memory alpha' });
    store.create({ content: 'regular memory beta' });

    const seeds = selectSeeds(store);

    // Principle memory should never appear in any seed
    for (const seed of seeds) {
      for (const mem of seed.memories) {
        expect(mem.id).not.toBe(p.id);
        expect(mem.valence).not.toBe('grounding');
        expect(mem.tags).not.toContain('principle');
        expect(mem.tags).not.toContain('voice');
      }
    }
  });

  it('excludes memories that already share edges from the same seed', () => {
    // Create two clusters that each have one member, plus an edge between them
    const a = store.create({ content: 'connected alpha' });
    const b = store.create({ content: 'connected beta' });
    store.createEdge({ sourceId: a.id, targetId: b.id, relationType: 'related', weight: 1.0 });

    // No other memories -> they are in the same component, so only 1 cluster
    // Add an orphan so we have 2 clusters
    store.create({ content: 'orphan gamma' });

    const seeds = selectSeeds(store);

    // The connected pair (a, b) are in the same cluster so can't appear as a cross-cluster pair.
    // But even if algorithm changed, verify no seed pairs memories that share an edge.
    for (const seed of seeds) {
      const [m1, m2] = seed.memories;
      const edge = store.getEdgeBetween(m1.id, m2.id);
      expect(edge).toBeNull();
    }
  });

  it('prefers charged memories when available', () => {
    // Cluster A: one charged, one neutral
    const charged = store.create({ content: 'urgent charged memory', valence: 'charged' });
    const neutral1 = store.create({ content: 'neutral in cluster A' });
    store.createEdge({ sourceId: charged.id, targetId: neutral1.id, relationType: 'similar', weight: 1.0 });

    // Cluster B: two neutrals
    const neutral2 = store.create({ content: 'neutral in cluster B first' });
    const neutral3 = store.create({ content: 'neutral in cluster B second' });
    store.createEdge({ sourceId: neutral2.id, targetId: neutral3.id, relationType: 'similar', weight: 1.0 });

    const seeds = selectSeeds(store);
    expect(seeds.length).toBeGreaterThan(0);

    // The top-ranked seed should include the charged memory
    const topSeed = seeds[0];
    expect(topSeed.hasCharged).toBe(true);
    expect(topSeed.memories.some((m) => m.valence === 'charged')).toBe(true);
  });

  it('respects maxSeeds limit', () => {
    // Create many orphan memories (each is its own cluster)
    for (let i = 0; i < 10; i++) {
      store.create({ content: `orphan memory ${i}` });
    }

    const seeds = selectSeeds(store, 3);
    expect(seeds.length).toBeLessThanOrEqual(3);
  });

  it('generates seeds from orphan memories as individual clusters', () => {
    // Two orphan memories with no edges
    store.create({ content: 'orphan alpha' });
    store.create({ content: 'orphan beta' });

    const seeds = selectSeeds(store);
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds[0].memories).toHaveLength(2);
  });
});

describe('Dream Seeding — applySeedGrade', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('fire grade creates a related edge between seed memories', () => {
    const m1 = store.create({ content: 'memory one' });
    const m2 = store.create({ content: 'memory two' });

    const seeds = selectSeeds(store);
    expect(seeds.length).toBeGreaterThan(0);
    const seed = seeds[0];

    const result = applySeedGrade(store, seed, 'fire');

    expect(result.grade).toBe('fire');
    expect(result.seedId).toBe(seed.id);
    expect(result.edgeCreated).toBeTruthy();

    const edge = store.getEdgeBetween(m1.id, m2.id);
    expect(edge).not.toBeNull();
    expect(edge!.relationType).toBe('related');
    expect(edge!.weight).toBe(0.5);
  });

  it('shrug grade creates no edges', () => {
    store.create({ content: 'memory one' });
    store.create({ content: 'memory two' });

    const seeds = selectSeeds(store);
    const seed = seeds[0];
    const edgeCountBefore = store.edgeCount();

    const result = applySeedGrade(store, seed, 'shrug');

    expect(result.grade).toBe('shrug');
    expect(result.edgeCreated).toBeUndefined();
    expect(store.edgeCount()).toBe(edgeCountBefore);
  });

  it('miss grade creates no edges', () => {
    store.create({ content: 'memory one' });
    store.create({ content: 'memory two' });

    const seeds = selectSeeds(store);
    const seed = seeds[0];
    const edgeCountBefore = store.edgeCount();

    const result = applySeedGrade(store, seed, 'miss');

    expect(result.grade).toBe('miss');
    expect(result.edgeCreated).toBeUndefined();
    expect(store.edgeCount()).toBe(edgeCountBefore);
  });
});
