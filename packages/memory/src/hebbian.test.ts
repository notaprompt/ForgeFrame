import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { HebbianEngine } from './hebbian.js';

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

    expect(edge).toHaveProperty('lastHebbianAt');
    expect(edge.lastHebbianAt).toBeNull();
  });
});

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
    expect(updated.weight).toBe(1.0);
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

    engine.hebbianUpdate([m1, m2]);
    const afterFirst = store.getEdgeBetween(m1.id, m2.id)!;
    expect(afterFirst.weight).toBe(1.05);

    engine.hebbianUpdate([m1, m2]);
    const afterSecond = store.getEdgeBetween(m1.id, m2.id)!;
    expect(afterSecond.weight).toBe(1.05);
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
    expect(store.getEdgeBetween(m1.id, m3.id)!.weight).toBeCloseTo(0.85);
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

    engine.hebbianUpdate([m1, m2]);
    expect(store.getEdgeBetween(m1.id, m2.id)).toBeNull();

    engine.hebbianUpdate([m1, m2]);
    expect(store.getEdgeBetween(m1.id, m2.id)).toBeNull();

    engine.hebbianUpdate([m1, m2]);
    const edge = store.getEdgeBetween(m1.id, m2.id);
    expect(edge).not.toBeNull();
    expect(edge!.weight).toBe(0.3);
    expect(edge!.relationType).toBe('similar');
  });
});

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

    const result = engine.hebbianUpdate([m1, m2]);

    expect(store.getEdgeBetween(m1.id, m2.id)!.weight).toBe(1.05);
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

    expect(store.getEdgeBetween(m1.id, principle.id)!.weight).toBe(0.5);
  });

  it('prunes edges below 0.05 threshold', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    const m3 = store.create({ content: 'gamma — about to be pruned' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });
    store.createEdge({ sourceId: m1.id, targetId: m3.id, relationType: 'related', weight: 0.06 });

    const result = engine.hebbianUpdate([m1, m2]);

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

    const edge = store.getEdgeBetween(m1.id, m3.id)!;
    expect(edge.weight).toBeCloseTo(0.18);
  });

  it('LTD respects refractory period', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    const m3 = store.create({ content: 'gamma' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });
    store.createEdge({ sourceId: m1.id, targetId: m3.id, relationType: 'related', weight: 0.5 });

    engine.hebbianUpdate([m1, m2]);
    expect(store.getEdgeBetween(m1.id, m3.id)!.weight).toBe(0.48);

    engine.hebbianUpdate([m1, m2]);
    expect(store.getEdgeBetween(m1.id, m3.id)!.weight).toBe(0.48);
  });
});

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

    engine.setGuardianMultiplier(0.5);
    engine.hebbianUpdate([m1, m2]);

    expect(store.getEdgeBetween(m1.id, m2.id)!.weight).toBeCloseTo(1.025);
  });

  it('trapped state halts all Hebbian updates', () => {
    const m1 = store.create({ content: 'alpha' });
    const m2 = store.create({ content: 'beta' });
    const m3 = store.create({ content: 'gamma' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });
    store.createEdge({ sourceId: m1.id, targetId: m3.id, relationType: 'related', weight: 0.5 });

    engine.setGuardianMultiplier(0.0);
    const result = engine.hebbianUpdate([m1, m2]);

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

    engine.setGuardianMultiplier(0.5);
    engine.hebbianUpdate([m1, m2]);

    expect(store.getEdgeBetween(m1.id, m3.id)!.weight).toBeCloseTo(0.49);
  });
});
