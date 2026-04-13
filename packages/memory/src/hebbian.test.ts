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
