import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import type { ConsolidationCluster } from './types.js';

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
