import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { findTensionCandidates } from './tensions.js';

describe('Tension Detection', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('empty database returns no tension candidates', () => {
    const result = findTensionCandidates(store);
    expect(result).toEqual([]);
  });

  it('single memory returns no candidates', () => {
    store.create({ content: 'solo memory', tags: ['observation'] });
    expect(findTensionCandidates(store)).toEqual([]);
  });

  it('two high-weight memories with no edge between them produce a candidate', () => {
    const a = store.create({ content: 'move fast', tags: ['decision'] });
    const b = store.create({ content: 'be careful', tags: ['evaluation'] });
    const helper = store.create({ content: 'helper node', tags: ['observation'] });

    // Give both high avg edge weight via helper edges
    store.createEdge({ sourceId: a.id, targetId: helper.id, relationType: 'related', weight: 1.5 });
    store.createEdge({ sourceId: b.id, targetId: helper.id, relationType: 'related', weight: 1.5 });

    const candidates = findTensionCandidates(store);
    // a and b have no edge between them, different tags, high weight
    const found = candidates.find(
      (c) =>
        (c.memoryA.id === a.id && c.memoryB.id === b.id) ||
        (c.memoryA.id === b.id && c.memoryB.id === a.id),
    );
    expect(found).toBeDefined();
    expect(found!.tensionScore).toBeGreaterThan(0);
  });

  it('two memories WITH an existing edge are excluded', () => {
    const a = store.create({ content: 'alpha', tags: ['decision'] });
    const b = store.create({ content: 'beta', tags: ['evaluation'] });
    const helper = store.create({ content: 'helper', tags: ['observation'] });

    store.createEdge({ sourceId: a.id, targetId: helper.id, relationType: 'related', weight: 1.5 });
    store.createEdge({ sourceId: b.id, targetId: helper.id, relationType: 'related', weight: 1.5 });
    // Direct edge between a and b -- should exclude them
    store.createEdge({ sourceId: a.id, targetId: b.id, relationType: 'similar', weight: 1.0 });

    const candidates = findTensionCandidates(store);
    const found = candidates.find(
      (c) =>
        (c.memoryA.id === a.id && c.memoryB.id === b.id) ||
        (c.memoryA.id === b.id && c.memoryB.id === a.id),
    );
    expect(found).toBeUndefined();
  });

  it('low-weight memories (avg edge weight <= 1.0) excluded', () => {
    const a = store.create({ content: 'weak belief A', tags: ['decision'] });
    const b = store.create({ content: 'weak belief B', tags: ['evaluation'] });
    const helper = store.create({ content: 'helper', tags: ['observation'] });

    // Low weight edges
    store.createEdge({ sourceId: a.id, targetId: helper.id, relationType: 'related', weight: 0.5 });
    store.createEdge({ sourceId: b.id, targetId: helper.id, relationType: 'related', weight: 0.8 });

    const candidates = findTensionCandidates(store);
    expect(candidates).toEqual([]);
  });

  it('constitutional memories (principle/voice) excluded', () => {
    const a = store.create({ content: 'sovereignty matters', tags: ['principle'] });
    const b = store.create({ content: 'speed matters', tags: ['decision'] });
    const helper = store.create({ content: 'helper', tags: ['observation'] });

    store.createEdge({ sourceId: a.id, targetId: helper.id, relationType: 'related', weight: 2.0 });
    store.createEdge({ sourceId: b.id, targetId: helper.id, relationType: 'related', weight: 2.0 });

    const candidates = findTensionCandidates(store);
    // a is constitutional, so no pair with a should appear
    const found = candidates.find(
      (c) => c.memoryA.id === a.id || c.memoryB.id === a.id,
    );
    expect(found).toBeUndefined();
  });

  it('voice tag also excluded as constitutional', () => {
    const a = store.create({ content: 'my voice is direct', tags: ['voice'] });
    const b = store.create({ content: 'explore nuance', tags: ['evaluation'] });
    const helper = store.create({ content: 'helper', tags: ['observation'] });

    store.createEdge({ sourceId: a.id, targetId: helper.id, relationType: 'related', weight: 2.0 });
    store.createEdge({ sourceId: b.id, targetId: helper.id, relationType: 'related', weight: 2.0 });

    const candidates = findTensionCandidates(store);
    const found = candidates.find(
      (c) => c.memoryA.id === a.id || c.memoryB.id === a.id,
    );
    expect(found).toBeUndefined();
  });

  it('grounding valence excluded', () => {
    const a = store.create({ content: 'grounded fact', tags: ['observation'], valence: 'grounding' });
    const b = store.create({ content: 'charged opinion', tags: ['evaluation'] });
    const helper = store.create({ content: 'helper', tags: ['observation'] });

    store.createEdge({ sourceId: a.id, targetId: helper.id, relationType: 'related', weight: 2.0 });
    store.createEdge({ sourceId: b.id, targetId: helper.id, relationType: 'related', weight: 2.0 });

    const candidates = findTensionCandidates(store);
    const found = candidates.find(
      (c) => c.memoryA.id === a.id || c.memoryB.id === a.id,
    );
    expect(found).toBeUndefined();
  });

  it('memories with many shared tags get lower tension score', () => {
    // Pair with shared tag
    const a = store.create({ content: 'shared domain A', tags: ['decision'] });
    const b = store.create({ content: 'shared domain B', tags: ['decision'] });
    // Pair with no shared tags
    const c = store.create({ content: 'different domain C', tags: ['evaluation'] });
    const d = store.create({ content: 'different domain D', tags: ['thread'] });

    const helper1 = store.create({ content: 'helper 1', tags: ['observation'] });
    const helper2 = store.create({ content: 'helper 2', tags: ['observation'] });

    // All get the same high weight
    store.createEdge({ sourceId: a.id, targetId: helper1.id, relationType: 'related', weight: 2.0 });
    store.createEdge({ sourceId: b.id, targetId: helper1.id, relationType: 'related', weight: 2.0 });
    store.createEdge({ sourceId: c.id, targetId: helper2.id, relationType: 'related', weight: 2.0 });
    store.createEdge({ sourceId: d.id, targetId: helper2.id, relationType: 'related', weight: 2.0 });

    const candidates = findTensionCandidates(store, 20);

    const sharedPair = candidates.find(
      (t) =>
        (t.memoryA.id === a.id && t.memoryB.id === b.id) ||
        (t.memoryA.id === b.id && t.memoryB.id === a.id),
    );
    const differentPair = candidates.find(
      (t) =>
        (t.memoryA.id === c.id && t.memoryB.id === d.id) ||
        (t.memoryA.id === d.id && t.memoryB.id === c.id),
    );

    expect(sharedPair).toBeDefined();
    expect(differentPair).toBeDefined();
    // Shared tags = lower score
    expect(differentPair!.tensionScore).toBeGreaterThan(sharedPair!.tensionScore);
  });

  it('memories with no shared tags get higher tension score', () => {
    const a = store.create({ content: 'domain X', tags: ['decision'] });
    const b = store.create({ content: 'domain Y', tags: ['evaluation'] });
    const helper = store.create({ content: 'helper', tags: ['observation'] });

    store.createEdge({ sourceId: a.id, targetId: helper.id, relationType: 'related', weight: 2.0 });
    store.createEdge({ sourceId: b.id, targetId: helper.id, relationType: 'related', weight: 2.0 });

    const candidates = findTensionCandidates(store);
    const found = candidates.find(
      (c) =>
        (c.memoryA.id === a.id && c.memoryB.id === b.id) ||
        (c.memoryA.id === b.id && c.memoryB.id === a.id),
    );
    expect(found).toBeDefined();
    expect(found!.tagOverlap).toBe(0);
    // With 0 overlap, tensionScore = (avgWeightA + avgWeightB) * 1
    expect(found!.tensionScore).toBe(found!.avgWeightA + found!.avgWeightB);
  });

  it('max tensions limit respected (default 3)', () => {
    const helpers: ReturnType<typeof store.create>[] = [];
    // Create 5 distinct high-weight pairs
    for (let i = 0; i < 5; i++) {
      const m = store.create({ content: `memory ${i}`, tags: [i % 2 === 0 ? 'decision' : 'evaluation'] });
      const h = store.create({ content: `helper ${i}`, tags: ['observation'] });
      store.createEdge({ sourceId: m.id, targetId: h.id, relationType: 'related', weight: 2.0 });
      helpers.push(m);
    }

    // Default limit is 3
    const candidates = findTensionCandidates(store);
    expect(candidates.length).toBeLessThanOrEqual(3);
  });

  it('custom max tensions limit respected', () => {
    for (let i = 0; i < 5; i++) {
      const m = store.create({ content: `memory ${i}`, tags: [i % 2 === 0 ? 'decision' : 'evaluation'] });
      const h = store.create({ content: `helper ${i}`, tags: ['observation'] });
      store.createEdge({ sourceId: m.id, targetId: h.id, relationType: 'related', weight: 2.0 });
    }

    const candidates = findTensionCandidates(store, 1);
    expect(candidates.length).toBeLessThanOrEqual(1);
  });

  it('tension score is higher when both memories have higher edge weights', () => {
    // Low-weight pair (just above threshold)
    const a = store.create({ content: 'low weight A', tags: ['decision'] });
    const b = store.create({ content: 'low weight B', tags: ['evaluation'] });
    const h1 = store.create({ content: 'helper low', tags: ['observation'] });
    store.createEdge({ sourceId: a.id, targetId: h1.id, relationType: 'related', weight: 1.1 });
    store.createEdge({ sourceId: b.id, targetId: h1.id, relationType: 'related', weight: 1.1 });

    // High-weight pair
    const c = store.create({ content: 'high weight C', tags: ['thread'] });
    const d = store.create({ content: 'high weight D', tags: ['skill'] });
    const h2 = store.create({ content: 'helper high', tags: ['observation'] });
    store.createEdge({ sourceId: c.id, targetId: h2.id, relationType: 'related', weight: 3.0 });
    store.createEdge({ sourceId: d.id, targetId: h2.id, relationType: 'related', weight: 3.0 });

    const candidates = findTensionCandidates(store, 20);

    const lowPair = candidates.find(
      (t) =>
        (t.memoryA.id === a.id && t.memoryB.id === b.id) ||
        (t.memoryA.id === b.id && t.memoryB.id === a.id),
    );
    const highPair = candidates.find(
      (t) =>
        (t.memoryA.id === c.id && t.memoryB.id === d.id) ||
        (t.memoryA.id === d.id && t.memoryB.id === c.id),
    );

    expect(lowPair).toBeDefined();
    expect(highPair).toBeDefined();
    expect(highPair!.tensionScore).toBeGreaterThan(lowPair!.tensionScore);
  });
});
