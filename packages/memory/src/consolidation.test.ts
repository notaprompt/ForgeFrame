import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import type { ConsolidationCluster } from './types.js';
import { ConsolidationEngine } from './consolidation.js';
import type { Generator } from './generator.js';

class MockGenerator implements Generator {
  async generate(_prompt: string): Promise<string | null> {
    return JSON.stringify({
      title: 'Sovereignty Architecture',
      summary: 'A pattern connecting sovereignty, architecture, and data ownership.',
      patterns: ['sovereignty requires local-first'],
      suggestedTags: ['pattern'],
    });
  }
}

class FailingGenerator implements Generator {
  async generate(_prompt: string): Promise<string | null> {
    return null;
  }
}

describe('Consolidation — Schema', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('consolidation_proposals table exists', () => {
    const proposal = store.createProposal({
      cluster: { memoryIds: ['a', 'b', 'c'], avgWeight: 1.3, edgeCount: 5 },
      title: 'Test pattern',
      summary: 'A test consolidation',
      suggestedTags: ['pattern'],
      depth: 1,
    });

    expect(proposal.id).toBeTypeOf('string');
    expect(proposal.status).toBe('pending');
    expect(proposal.resolvedAt).toBeNull();
    expect(proposal.rejectedUntil).toBeNull();
  });

  it('listProposals filters by status', () => {
    store.createProposal({
      cluster: { memoryIds: ['a'], avgWeight: 1.3, edgeCount: 1 },
      title: 'A', summary: 'A', suggestedTags: ['pattern'], depth: 1,
    });
    const p2 = store.createProposal({
      cluster: { memoryIds: ['b'], avgWeight: 1.3, edgeCount: 1 },
      title: 'B', summary: 'B', suggestedTags: ['pattern'], depth: 1,
    });
    store.resolveProposal(p2.id, 'rejected');

    expect(store.listProposals('pending')).toHaveLength(1);
    expect(store.listProposals('rejected')).toHaveLength(1);
    expect(store.listProposals()).toHaveLength(2);
  });

  it('resolveProposal sets rejected_until for rejections', () => {
    const p = store.createProposal({
      cluster: { memoryIds: ['a'], avgWeight: 1.3, edgeCount: 1 },
      title: 'A', summary: 'A', suggestedTags: ['pattern'], depth: 1,
    });
    const before = Date.now();
    const rejected = store.resolveProposal(p.id, 'rejected')!;

    expect(rejected.status).toBe('rejected');
    expect(rejected.resolvedAt).not.toBeNull();
    expect(rejected.rejectedUntil).not.toBeNull();
    // 7 days from now
    expect(rejected.rejectedUntil!).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000 - 100);
  });

  it('resolveProposal sets no cooldown for approvals', () => {
    const p = store.createProposal({
      cluster: { memoryIds: ['a'], avgWeight: 1.3, edgeCount: 1 },
      title: 'A', summary: 'A', suggestedTags: ['pattern'], depth: 1,
    });
    const approved = store.resolveProposal(p.id, 'approved')!;
    expect(approved.status).toBe('approved');
    expect(approved.rejectedUntil).toBeNull();
  });
});

describe('Consolidation — Connected components', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('finds connected components from all edges', () => {
    const m1 = store.create({ content: 'a' });
    const m2 = store.create({ content: 'b' });
    const m3 = store.create({ content: 'c' });
    const m4 = store.create({ content: 'd' });
    const m5 = store.create({ content: 'e' });

    // Component 1: m1-m2-m3
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.3 });
    store.createEdge({ sourceId: m2.id, targetId: m3.id, relationType: 'similar', weight: 1.4 });
    store.createEdge({ sourceId: m1.id, targetId: m3.id, relationType: 'similar', weight: 1.2 });

    // Component 2: m4-m5
    store.createEdge({ sourceId: m4.id, targetId: m5.id, relationType: 'related', weight: 0.8 });

    const components = store.getConnectedComponents();
    expect(components).toHaveLength(2);

    const big = components.find((c: ConsolidationCluster) => c.memoryIds.length === 3)!;
    const small = components.find((c: ConsolidationCluster) => c.memoryIds.length === 2)!;

    expect(big.memoryIds.sort()).toEqual([m1.id, m2.id, m3.id].sort());
    expect(big.avgWeight).toBeCloseTo((1.3 + 1.4 + 1.2) / 3);
    expect(big.edgeCount).toBe(3);

    expect(small.memoryIds.sort()).toEqual([m4.id, m5.id].sort());
    expect(small.avgWeight).toBe(0.8);
  });

  it('excludes orphan memories (no edges)', () => {
    store.create({ content: 'orphan' });
    const m1 = store.create({ content: 'a' });
    const m2 = store.create({ content: 'b' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });

    const components = store.getConnectedComponents();
    expect(components).toHaveLength(1);
    expect(components[0].memoryIds).toHaveLength(2);
  });

  it('returns empty array when no edges exist', () => {
    store.create({ content: 'lone memory' });
    const components = store.getConnectedComponents();
    expect(components).toHaveLength(0);
  });
});

describe('ConsolidationEngine — cluster scanning', () => {
  let store: MemoryStore;
  let engine: ConsolidationEngine;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
    engine = new ConsolidationEngine(store, new MockGenerator());
  });

  afterEach(() => {
    store.close();
  });

  it('finds candidate clusters with avg weight > 1.2 and size >= 5', () => {
    const memories = [];
    for (let i = 0; i < 5; i++) {
      memories.push(store.create({ content: `sovereignty topic ${i}` }));
    }
    for (let i = 0; i < 4; i++) {
      store.createEdge({ sourceId: memories[i].id, targetId: memories[i + 1].id, relationType: 'similar', weight: 1.3 });
    }
    store.createEdge({ sourceId: memories[4].id, targetId: memories[0].id, relationType: 'similar', weight: 1.3 });

    const candidates = engine.findCandidateClusters();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].memoryIds).toHaveLength(5);
  });

  it('excludes clusters below weight threshold', () => {
    const memories = [];
    for (let i = 0; i < 5; i++) {
      memories.push(store.create({ content: `weak ${i}` }));
    }
    for (let i = 0; i < 4; i++) {
      store.createEdge({ sourceId: memories[i].id, targetId: memories[i + 1].id, relationType: 'similar', weight: 0.8 });
    }
    expect(engine.findCandidateClusters()).toHaveLength(0);
  });

  it('excludes clusters smaller than 5 nodes', () => {
    const memories = [];
    for (let i = 0; i < 3; i++) {
      memories.push(store.create({ content: `small ${i}` }));
    }
    store.createEdge({ sourceId: memories[0].id, targetId: memories[1].id, relationType: 'similar', weight: 1.5 });
    store.createEdge({ sourceId: memories[1].id, targetId: memories[2].id, relationType: 'similar', weight: 1.5 });
    expect(engine.findCandidateClusters()).toHaveLength(0);
  });

  it('excludes clusters containing constitutional memories', () => {
    const memories = [];
    for (let i = 0; i < 5; i++) {
      memories.push(store.create({ content: `topic ${i}`, tags: i === 0 ? ['principle'] : [] }));
    }
    for (let i = 0; i < 4; i++) {
      store.createEdge({ sourceId: memories[i].id, targetId: memories[i + 1].id, relationType: 'similar', weight: 1.5 });
    }
    expect(engine.findCandidateClusters()).toHaveLength(0);
  });

  it('enforces max depth of 2', () => {
    const memories = [];
    for (let i = 0; i < 5; i++) {
      memories.push(store.create({
        content: `deep ${i}`,
        metadata: i === 0 ? { consolidation: true, depth: 2 } : {},
      }));
    }
    for (let i = 0; i < 4; i++) {
      store.createEdge({ sourceId: memories[i].id, targetId: memories[i + 1].id, relationType: 'similar', weight: 1.5 });
    }
    store.createEdge({ sourceId: memories[4].id, targetId: memories[0].id, relationType: 'similar', weight: 1.5 });
    expect(engine.findCandidateClusters()).toHaveLength(0);
  });
});

describe('ConsolidationEngine — promotion', () => {
  let store: MemoryStore;
  let engine: ConsolidationEngine;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
    engine = new ConsolidationEngine(store, new MockGenerator());
  });

  afterEach(() => {
    store.close();
  });

  it('getPromotionCandidates returns episodic memories with high retrieval count', () => {
    const m1 = store.create({ content: 'event one' });
    const m2 = store.create({ content: 'event two' });
    store.create({ content: 'fact three' });

    // Set m1 and m2 to episodic type via direct SQL
    store['_db'].prepare("UPDATE memories SET memory_type = 'episodic' WHERE id = ?").run(m1.id);
    store['_db'].prepare("UPDATE memories SET memory_type = 'episodic' WHERE id = ?").run(m2.id);

    // Bump retrieval count on m1
    for (let i = 0; i < 10; i++) {
      store.reconsolidate(m1.id, { relevanceScore: 0.8 });
    }

    const candidates = engine.getPromotionCandidates(5);
    expect(candidates.length).toBe(1);
    expect(candidates[0].id).toBe(m1.id);
  });
});

describe('ConsolidationEngine — proposal + approval + rejection', () => {
  let store: MemoryStore;
  let engine: ConsolidationEngine;

  function createDenseCluster(store: MemoryStore) {
    const memories = [];
    for (let i = 0; i < 5; i++) {
      memories.push(store.create({ content: `topic ${i}` }));
    }
    for (let i = 0; i < 4; i++) {
      store.createEdge({ sourceId: memories[i].id, targetId: memories[i + 1].id, relationType: 'similar', weight: 1.3 });
    }
    store.createEdge({ sourceId: memories[4].id, targetId: memories[0].id, relationType: 'similar', weight: 1.3 });
    return memories;
  }

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
    engine = new ConsolidationEngine(store, new MockGenerator());
  });

  afterEach(() => {
    store.close();
  });

  it('generates a proposal from a cluster', async () => {
    createDenseCluster(store);
    const clusters = engine.findCandidateClusters();
    const proposal = await engine.propose(clusters[0]);

    expect(proposal).not.toBeNull();
    expect(proposal!.title).toBe('Sovereignty Architecture');
    expect(proposal!.status).toBe('pending');
    expect(proposal!.depth).toBe(1);
  });

  it('returns null when LLM fails', async () => {
    const failEngine = new ConsolidationEngine(store, new FailingGenerator());
    createDenseCluster(store);
    const clusters = failEngine.findCandidateClusters();
    const proposal = await failEngine.propose(clusters[0]);
    expect(proposal).toBeNull();
  });

  it('approval creates consolidated memory with derived-from edges', async () => {
    const memories = createDenseCluster(store);
    const clusters = engine.findCandidateClusters();
    const proposal = await engine.propose(clusters[0]);
    const result = engine.approve(proposal!.id);

    expect(result).not.toBeNull();
    expect(result!.derivedFromEdges).toHaveLength(5);
    expect(result!.sourcesDecayed).toHaveLength(5);

    const consolidated = store.get(result!.consolidatedMemoryId)!;
    expect(consolidated.content).toContain('Sovereignty Architecture');
    expect(consolidated.tags).toContain('pattern');
    expect(consolidated.metadata.consolidation).toBe(true);
  });

  it('approval migrates external edges with max weight', async () => {
    const memories = createDenseCluster(store);
    // Get the cluster before adding external edges (external node would change component avg weight)
    const clusters = engine.findCandidateClusters();
    expect(clusters).toHaveLength(1);
    const proposal = await engine.propose(clusters[0]);

    // Now add external edges
    const external = store.create({ content: 'external node' });
    store.createEdge({ sourceId: memories[0].id, targetId: external.id, relationType: 'related', weight: 0.5 });
    store.createEdge({ sourceId: memories[2].id, targetId: external.id, relationType: 'related', weight: 0.9 });

    const result = engine.approve(proposal!.id);

    const edge = store.getEdgeBetween(result!.consolidatedMemoryId, external.id);
    expect(edge).not.toBeNull();
    expect(edge!.weight).toBe(0.9);
  });

  it('approval halves strength of source memories', async () => {
    const memories = createDenseCluster(store);
    const clusters = engine.findCandidateClusters();
    const proposal = await engine.propose(clusters[0]);
    engine.approve(proposal!.id);

    for (const mem of memories) {
      const updated = store.get(mem.id)!;
      expect(updated.strength).toBe(0.5);
    }
  });

  it('rejection sets 7-day cooldown', async () => {
    createDenseCluster(store);
    const clusters = engine.findCandidateClusters();
    const proposal = await engine.propose(clusters[0]);
    const rejected = engine.reject(proposal!.id);

    expect(rejected!.status).toBe('rejected');
    expect(rejected!.rejectedUntil).not.toBeNull();

    // Cluster should no longer be a candidate
    expect(engine.findCandidateClusters()).toHaveLength(0);
  });
});
