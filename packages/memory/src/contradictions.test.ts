import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { ContradictionEngine } from './contradictions.js';
import type { Generator } from './generator.js';

class MockAnalyzer implements Generator {
  async generate(_prompt: string): Promise<string | null> {
    return 'Memory A claims X while Memory B claims Y. These are directly contradictory positions on the same topic.';
  }
}

class FailingAnalyzer implements Generator {
  async generate(_prompt: string): Promise<string | null> {
    return null;
  }
}

describe('ContradictionEngine — scanning', () => {
  let store: MemoryStore;
  let engine: ContradictionEngine;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
    engine = new ContradictionEngine(store, new MockAnalyzer());
  });

  afterEach(() => {
    store.close();
  });

  it('finds contradiction pairs from contradicts edges', async () => {
    const m1 = store.create({ content: 'The earth is flat' });
    const m2 = store.create({ content: 'The earth is round' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'contradicts' });

    const proposals = await engine.scan();
    expect(proposals).toHaveLength(1);
    expect(proposals[0].memoryAId).toBe(m1.id);
    expect(proposals[0].memoryBId).toBe(m2.id);
    expect(proposals[0].isConstitutionalTension).toBe(false);
    expect(proposals[0].status).toBe('pending');
  });

  it('marks constitutional pairs as tensions', async () => {
    const m1 = store.create({ content: 'sovereignty is absolute', tags: ['principle'] });
    const m2 = store.create({ content: 'sometimes cloud is fine' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'contradicts' });

    const proposals = await engine.scan();
    expect(proposals).toHaveLength(1);
    expect(proposals[0].isConstitutionalTension).toBe(true);
  });

  it('skips pairs with existing pending proposals', async () => {
    const m1 = store.create({ content: 'claim A' });
    const m2 = store.create({ content: 'claim B' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'contradicts' });

    await engine.scan(); // creates proposal
    const second = await engine.scan(); // should skip
    expect(second).toHaveLength(0);
  });

  it('skips when LLM analysis fails', async () => {
    const failEngine = new ContradictionEngine(store, new FailingAnalyzer());
    const m1 = store.create({ content: 'A' });
    const m2 = store.create({ content: 'B' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'contradicts' });

    const proposals = await failEngine.scan();
    expect(proposals).toHaveLength(0);
  });
});

describe('ContradictionEngine — resolution', () => {
  let store: MemoryStore;
  let engine: ContradictionEngine;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
    engine = new ContradictionEngine(store, new MockAnalyzer());
  });

  afterEach(() => {
    store.close();
  });

  it('supersede-a-with-b: A gets superseded by B', async () => {
    const m1 = store.create({ content: 'outdated claim' });
    const m2 = store.create({ content: 'updated claim' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'contradicts' });

    const proposals = await engine.scan();
    const result = engine.resolve(proposals[0].id, 'supersede-a-with-b');

    expect(result).not.toBeNull();
    expect(result!.survivingMemoryId).toBe(m2.id);
    expect(store.get(m1.id)!.supersededBy).toBe(m2.id);
  });

  it('supersede-b-with-a: B gets superseded by A', async () => {
    const m1 = store.create({ content: 'correct claim' });
    const m2 = store.create({ content: 'wrong claim' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'contradicts' });

    const proposals = await engine.scan();
    const result = engine.resolve(proposals[0].id, 'supersede-b-with-a');

    expect(result!.survivingMemoryId).toBe(m1.id);
    expect(store.get(m2.id)!.supersededBy).toBe(m1.id);
  });

  it('merge: creates new memory, supersedes both originals', async () => {
    const m1 = store.create({ content: 'partial truth A' });
    const m2 = store.create({ content: 'partial truth B' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'contradicts' });

    const proposals = await engine.scan();
    const result = engine.resolve(proposals[0].id, 'merge');

    expect(result!.mergedMemoryId).not.toBeNull();
    const merged = store.get(result!.mergedMemoryId!)!;
    expect(merged.content).toContain('partial truth A');
    expect(merged.content).toContain('partial truth B');
    expect(store.get(m1.id)!.supersededBy).toBe(merged.id);
    expect(store.get(m2.id)!.supersededBy).toBe(merged.id);
  });

  it('keep-both: removes contradicts edge, adds related edge', async () => {
    const m1 = store.create({ content: 'perspective A' });
    const m2 = store.create({ content: 'perspective B' });
    const edge = store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'contradicts' });

    const proposals = await engine.scan();
    const result = engine.resolve(proposals[0].id, 'keep-both');

    expect(result!.action).toBe('keep-both');
    // Contradicts edge gone
    expect(store.getEdge(edge.id)).toBeNull();
    // Related edge exists
    const related = store.getEdgesBetween(m1.id, m2.id);
    expect(related.some((e) => e.relationType === 'related')).toBe(true);
  });

  it('cannot resolve constitutional tensions', async () => {
    const m1 = store.create({ content: 'sovereignty principle', tags: ['principle'] });
    const m2 = store.create({ content: 'cloud convenience' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'contradicts' });

    const proposals = await engine.scan();
    expect(proposals[0].isConstitutionalTension).toBe(true);

    const result = engine.resolve(proposals[0].id, 'supersede-a-with-b');
    expect(result).toBeNull(); // blocked
  });

  it('marks proposal as resolved after action', async () => {
    const m1 = store.create({ content: 'A' });
    const m2 = store.create({ content: 'B' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'contradicts' });

    const proposals = await engine.scan();
    engine.resolve(proposals[0].id, 'keep-both');

    const updated = store.getContradictionProposal(proposals[0].id)!;
    expect(updated.status).toBe('resolved');
    expect(updated.resolution).toBe('keep-both');
    expect(updated.resolvedAt).not.toBeNull();
  });
});
