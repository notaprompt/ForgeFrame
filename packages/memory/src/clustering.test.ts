import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { computeClusters } from './clustering.js';

describe('computeClusters', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('returns empty clusters for empty database', () => {
    const result = computeClusters(store);
    expect(result.clusters).toHaveLength(0);
    expect(result.nodes).toHaveLength(0);
  });

  it('groups connected memories into clusters', () => {
    const m1 = store.create({ content: 'sovereignty architecture', tags: ['observation', 'sovereignty'] });
    const m2 = store.create({ content: 'sovereignty local-first', tags: ['decision', 'sovereignty'] });
    const m3 = store.create({ content: 'sovereignty data', tags: ['pattern', 'sovereignty'] });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related' });
    store.createEdge({ sourceId: m2.id, targetId: m3.id, relationType: 'related' });

    const m4 = store.create({ content: 'pricing strategy', tags: ['decision', 'business'] });
    const m5 = store.create({ content: 'enterprise tier', tags: ['observation', 'business'] });
    const m6 = store.create({ content: 'revenue model', tags: ['pattern', 'business'] });
    store.createEdge({ sourceId: m4.id, targetId: m5.id, relationType: 'related' });
    store.createEdge({ sourceId: m5.id, targetId: m6.id, relationType: 'related' });

    const result = computeClusters(store);
    expect(result.clusters).toHaveLength(2);
    const labels = result.clusters.map(c => c.label).sort();
    expect(labels).toEqual(['business', 'sovereignty']);
  });

  it('labels cluster by dominant custom tag', () => {
    const m1 = store.create({ content: 'a', tags: ['observation', 'sovereignty'] });
    const m2 = store.create({ content: 'b', tags: ['decision', 'sovereignty'] });
    const m3 = store.create({ content: 'c', tags: ['pattern', 'architecture'] });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related' });
    store.createEdge({ sourceId: m2.id, targetId: m3.id, relationType: 'related' });

    const result = computeClusters(store);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].label).toBe('sovereignty');
  });

  it('does not cluster groups with fewer than 3 members', () => {
    const m1 = store.create({ content: 'lonely a', tags: ['observation'] });
    const m2 = store.create({ content: 'lonely b', tags: ['observation'] });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related' });

    const result = computeClusters(store);
    expect(result.clusters).toHaveLength(0);
    expect(result.nodes.filter(n => n.parent === null)).toHaveLength(2);
  });

  it('assigns orphan memories to tag-based clusters if 3+ share a tag', () => {
    store.create({ content: 'orphan a', tags: ['observation', 'sovereignty'] });
    store.create({ content: 'orphan b', tags: ['decision', 'sovereignty'] });
    store.create({ content: 'orphan c', tags: ['pattern', 'sovereignty'] });

    const result = computeClusters(store);
    const sovCluster = result.clusters.find(c => c.label === 'sovereignty');
    expect(sovCluster).toBeDefined();
    expect(sovCluster!.memberCount).toBe(3);
  });

  it('computes visual weight from edge types', () => {
    const m1 = store.create({ content: 'hub', tags: ['observation'] });
    const m2 = store.create({ content: 'a', tags: ['observation'] });
    const m3 = store.create({ content: 'b', tags: ['observation'] });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'led-to' });
    store.createEdge({ sourceId: m1.id, targetId: m3.id, relationType: 'similar' });

    const result = computeClusters(store);
    const hub = result.nodes.find(n => n.id === m1.id);
    expect(hub).toBeDefined();
    expect(hub!.visualWeight).toBeCloseTo(3.5);
  });

  it('computes cluster avgStrength', () => {
    const m1 = store.create({ content: 'a', tags: ['observation', 'test'] });
    const m2 = store.create({ content: 'b', tags: ['observation', 'test'] });
    const m3 = store.create({ content: 'c', tags: ['observation', 'test'] });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related' });
    store.createEdge({ sourceId: m2.id, targetId: m3.id, relationType: 'related' });

    const result = computeClusters(store);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].avgStrength).toBe(1.0);
  });

  it('includes edges in result', () => {
    const m1 = store.create({ content: 'a', tags: ['observation'] });
    const m2 = store.create({ content: 'b', tags: ['observation'] });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related', weight: 0.8 });

    const result = computeClusters(store);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].source).toBe(m1.id);
    expect(result.edges[0].target).toBe(m2.id);
    expect(result.edges[0].weight).toBe(0.8);
  });
});
