import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';

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
