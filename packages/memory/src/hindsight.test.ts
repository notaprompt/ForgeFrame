import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { findHindsightCandidates, applyHindsightResponse } from './hindsight.js';
import type { HindsightCandidate } from './hindsight.js';

const DAY_MS = 86_400_000;

/** Backdate a memory's created_at by the given number of days. */
function backdateMemory(store: MemoryStore, id: string, days: number): void {
  const ts = Date.now() - days * DAY_MS;
  (store as any)['_db'].prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(ts, id);
}

/** Create a memory with high-weight edges to make it a hindsight candidate. */
function createCandidateMemory(
  store: MemoryStore,
  content: string,
  opts: { tags?: string[]; valence?: 'charged' | 'neutral'; ageDays?: number } = {},
): string {
  const m = store.create({ content, tags: opts.tags, valence: opts.valence });
  const anchor = store.create({ content: `anchor for ${content}` });

  store.createEdge({ sourceId: m.id, targetId: anchor.id, relationType: 'led-to', weight: 1.8 });

  if (opts.ageDays) {
    backdateMemory(store, m.id, opts.ageDays);
  }

  return m.id;
}

describe('findHindsightCandidates', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('returns empty array for empty database', () => {
    const candidates = findHindsightCandidates(store);
    expect(candidates).toHaveLength(0);
  });

  it('excludes young memories (< 14 days)', () => {
    createCandidateMemory(store, 'recent memory', { ageDays: 7 });
    const candidates = findHindsightCandidates(store, 3);
    expect(candidates).toHaveLength(0);
  });

  it('excludes constitutional memories (principle/voice tags)', () => {
    createCandidateMemory(store, 'core principle', { tags: ['principle'], ageDays: 30 });
    createCandidateMemory(store, 'voice pattern', { tags: ['voice'], ageDays: 30 });
    const candidates = findHindsightCandidates(store, 3);
    expect(candidates).toHaveLength(0);
  });

  it('excludes grounding valence', () => {
    // Create a memory, then force valence to grounding via raw SQL
    const id = createCandidateMemory(store, 'grounded belief', { ageDays: 30 });
    (store as any)['_db'].prepare('UPDATE memories SET valence = ? WHERE id = ?').run('grounding', id);
    const candidates = findHindsightCandidates(store, 3);
    expect(candidates).toHaveLength(0);
  });

  it('excludes memories with low edge weight (< 1.5)', () => {
    const m = store.create({ content: 'weak connections' });
    const anchor = store.create({ content: 'anchor' });
    store.createEdge({ sourceId: m.id, targetId: anchor.id, relationType: 'led-to', weight: 1.2 });
    backdateMemory(store, m.id, 30);
    const candidates = findHindsightCandidates(store, 3);
    expect(candidates).toHaveLength(0);
  });

  it('excludes memories with contradictions', () => {
    const id = createCandidateMemory(store, 'contradicted belief', { ageDays: 30 });
    const other = store.create({ content: 'opposing view' });
    store.createEdge({ sourceId: id, targetId: other.id, relationType: 'contradicts', weight: 1.0 });
    const candidates = findHindsightCandidates(store, 3);
    expect(candidates).toHaveLength(0);
  });

  it('excludes recently reviewed memories (< 30 days)', () => {
    const id = createCandidateMemory(store, 'already reviewed', { ageDays: 60 });
    // Set last_hindsight_review to 10 days ago
    const recentReview = Date.now() - 10 * DAY_MS;
    (store as any)['_db'].prepare('UPDATE memories SET last_hindsight_review = ? WHERE id = ?').run(recentReview, id);
    const candidates = findHindsightCandidates(store, 3);
    expect(candidates).toHaveLength(0);
  });

  it('ranks charged memories higher than neutral (1.5x multiplier)', () => {
    const chargedId = createCandidateMemory(store, 'emotionally charged belief', {
      valence: 'charged',
      ageDays: 30,
    });
    const neutralId = createCandidateMemory(store, 'neutral observation', {
      valence: 'neutral',
      ageDays: 30,
    });

    const candidates = findHindsightCandidates(store, 3);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0].memory.id).toBe(chargedId);
    expect(candidates[0].scrutinyScore).toBeCloseTo(1.8 * 1.5); // weight * charged multiplier
    expect(candidates[1].memory.id).toBe(neutralId);
    expect(candidates[1].scrutinyScore).toBeCloseTo(1.8 * 1.0); // weight * neutral multiplier
  });

  it('respects limit parameter (default 1)', () => {
    createCandidateMemory(store, 'belief A', { ageDays: 30 });
    createCandidateMemory(store, 'belief B', { ageDays: 30 });

    const defaultCandidates = findHindsightCandidates(store);
    expect(defaultCandidates).toHaveLength(1);

    const limited = findHindsightCandidates(store, 2);
    expect(limited).toHaveLength(2);
  });
});

describe('applyHindsightResponse', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  function makeCandidate(): HindsightCandidate {
    const id = createCandidateMemory(store, 'entrenched belief', { ageDays: 30 });
    const candidates = findHindsightCandidates(store, 1);
    expect(candidates).toHaveLength(1);
    return candidates[0];
  }

  it('keep response sets last_hindsight_review', () => {
    const candidate = makeCandidate();
    const before = Date.now();
    const result = applyHindsightResponse(store, candidate, 'keep');

    expect(result.response).toBe('keep');
    expect(result.newAvgWeight).toBeNull();

    const mem = store.get(candidate.memory.id)!;
    expect(mem.lastHindsightReview).toBeGreaterThanOrEqual(before);
  });

  it('weaken response reduces edge weights by 0.3', () => {
    const candidate = makeCandidate();
    const result = applyHindsightResponse(store, candidate, 'weaken');

    expect(result.response).toBe('weaken');
    expect(result.previousAvgWeight).toBeCloseTo(1.8);
    expect(result.newAvgWeight).toBeCloseTo(1.5);

    const edges = store.getEdges(candidate.memory.id);
    for (const edge of edges) {
      expect(edge.weight).toBeCloseTo(1.5);
    }
  });

  it('weaken respects 0.05 minimum edge weight', () => {
    // Create memory with a very low-weight edge
    const m = store.create({ content: 'barely surviving' });
    const anchor = store.create({ content: 'anchor' });
    // Weight of 0.2 minus 0.3 should clamp to 0.05
    // But we also need a high-weight edge to pass the threshold
    store.createEdge({ sourceId: m.id, targetId: anchor.id, relationType: 'led-to', weight: 2.0 });
    const anchor2 = store.create({ content: 'anchor2' });
    store.createEdge({ sourceId: m.id, targetId: anchor2.id, relationType: 'similar', weight: 0.2 });
    backdateMemory(store, m.id, 30);

    // avg = (2.0 + 0.2) / 2 = 1.1 -- below threshold, won't be a candidate
    // Need both edges high enough. Let's just use a single very high edge scenario.
    // Reset: create a proper candidate then manually lower one edge
    store.close();
    store = new MemoryStore({ dbPath: ':memory:' });

    const mem = store.create({ content: 'belief with weak edge' });
    const a1 = store.create({ content: 'strong anchor' });
    const a2 = store.create({ content: 'weak anchor' });
    store.createEdge({ sourceId: mem.id, targetId: a1.id, relationType: 'led-to', weight: 3.0 });
    store.createEdge({ sourceId: mem.id, targetId: a2.id, relationType: 'similar', weight: 0.2 });
    backdateMemory(store, mem.id, 30);

    // avg = (3.0 + 0.2) / 2 = 1.6 > 1.5 threshold
    const candidates = findHindsightCandidates(store, 1);
    expect(candidates).toHaveLength(1);

    const result = applyHindsightResponse(store, candidates[0], 'weaken');

    // Check the weak edge was clamped to 0.05
    const edges = store.getEdges(mem.id);
    const weakEdge = edges.find(e => e.relationType === 'similar')!;
    expect(weakEdge.weight).toBeCloseTo(0.05);

    // Strong edge should be 3.0 - 0.3 = 2.7
    const strongEdge = edges.find(e => e.relationType === 'led-to')!;
    expect(strongEdge.weight).toBeCloseTo(2.7);
  });

  it('revise response appends content', () => {
    const candidate = makeCandidate();
    const revision = 'Actually this only applies in specific contexts.';
    const result = applyHindsightResponse(store, candidate, 'revise', revision);

    expect(result.response).toBe('revise');
    expect(result.revisedContent).toContain('entrenched belief');
    expect(result.revisedContent).toContain('[Hindsight revision]');
    expect(result.revisedContent).toContain(revision);

    const mem = store.get(candidate.memory.id)!;
    expect(mem.content).toContain(revision);
    expect(mem.lastHindsightReview).not.toBeNull();
  });
});
