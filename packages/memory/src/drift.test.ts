import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { detectDrift, driftScore } from './drift.js';
import type { Memory } from './types.js';

const DAY = 86_400_000;

describe('detectDrift', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  function db() {
    return (store as any)['_db'];
  }

  function setEdgeTime(edgeId: string, timestamp: number) {
    db().prepare(
      'UPDATE memory_edges SET last_hebbian_at = ?, created_at = ? WHERE id = ?',
    ).run(timestamp, timestamp, edgeId);
  }

  it('returns empty array for empty database', () => {
    expect(detectDrift(store)).toEqual([]);
  });

  it('returns no drift when weights are unchanged across windows', () => {
    const m1 = store.create({ content: 'alpha', tags: ['observation'] });
    const m2 = store.create({ content: 'beta', tags: ['observation'] });
    const m3 = store.create({ content: 'gamma', tags: ['observation'] });
    const m4 = store.create({ content: 'delta', tags: ['observation'] });

    const e1 = store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related', weight: 1.0 });
    const e2 = store.createEdge({ sourceId: m3.id, targetId: m4.id, relationType: 'related', weight: 1.0 });

    // Same weight in both windows
    setEdgeTime(e1.id, Date.now() - 10 * DAY);  // current window
    setEdgeTime(e2.id, Date.now() - 45 * DAY);  // prior window

    const drift = detectDrift(store);
    expect(drift).toEqual([]);
  });

  it('detects strengthening when weight increases 25%+', () => {
    const m1 = store.create({ content: 'sovereignty thinking', tags: ['observation', 'sovereignty'] });
    const m2 = store.create({ content: 'sovereignty patterns', tags: ['observation', 'sovereignty'] });
    const m3 = store.create({ content: 'sovereignty roots', tags: ['observation', 'sovereignty'] });
    const m4 = store.create({ content: 'sovereignty base', tags: ['observation', 'sovereignty'] });

    // Prior window: weight 1.0
    const ePrior = store.createEdge({ sourceId: m3.id, targetId: m4.id, relationType: 'related', weight: 1.0 });
    setEdgeTime(ePrior.id, Date.now() - 45 * DAY);

    // Current window: weight 1.5 (50% increase)
    const eCurrent = store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related', weight: 1.5 });
    setEdgeTime(eCurrent.id, Date.now() - 10 * DAY);

    const drift = detectDrift(store);
    const sov = drift.find(d => d.tag === 'sovereignty');

    expect(sov).toBeDefined();
    expect(sov!.direction).toBe('strengthening');
    expect(sov!.magnitude).toBeCloseTo(0.5);
  });

  it('detects weakening when weight decreases 25%+', () => {
    const m1 = store.create({ content: 'fading idea', tags: ['pattern', 'architecture'] });
    const m2 = store.create({ content: 'fading link', tags: ['pattern', 'architecture'] });
    const m3 = store.create({ content: 'old idea', tags: ['pattern', 'architecture'] });
    const m4 = store.create({ content: 'old link', tags: ['pattern', 'architecture'] });

    // Prior window: weight 2.0
    const ePrior = store.createEdge({ sourceId: m3.id, targetId: m4.id, relationType: 'related', weight: 2.0 });
    setEdgeTime(ePrior.id, Date.now() - 45 * DAY);

    // Current window: weight 1.0 (50% decrease)
    const eCurrent = store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related', weight: 1.0 });
    setEdgeTime(eCurrent.id, Date.now() - 10 * DAY);

    const drift = detectDrift(store);
    const arch = drift.find(d => d.tag === 'architecture');

    expect(arch).toBeDefined();
    expect(arch!.direction).toBe('weakening');
    expect(arch!.magnitude).toBeCloseTo(-0.5);
  });

  it('excludes constitutional tags (principle/voice)', () => {
    const m1 = store.create({ content: 'identity core', tags: ['principle'] });
    const m2 = store.create({ content: 'voice calibration', tags: ['voice'] });
    const m3 = store.create({ content: 'identity old', tags: ['principle'] });
    const m4 = store.create({ content: 'voice old', tags: ['voice'] });

    // Prior window: weight 1.0
    const ePrior = store.createEdge({ sourceId: m3.id, targetId: m4.id, relationType: 'related', weight: 1.0 });
    setEdgeTime(ePrior.id, Date.now() - 45 * DAY);

    // Current window: weight 2.0 (would be 100% increase if not excluded)
    const eCurrent = store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related', weight: 2.0 });
    setEdgeTime(eCurrent.id, Date.now() - 10 * DAY);

    const drift = detectDrift(store);
    expect(drift).toEqual([]);
  });

  it('skips tags that only appear in one window', () => {
    const m1 = store.create({ content: 'new topic', tags: ['observation', 'quantum'] });
    const m2 = store.create({ content: 'new topic link', tags: ['observation', 'quantum'] });

    // Only in current window — new cluster, not drift
    const e = store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related', weight: 1.5 });
    setEdgeTime(e.id, Date.now() - 10 * DAY);

    const m3 = store.create({ content: 'old only', tags: ['observation', 'forgotten'] });
    const m4 = store.create({ content: 'old only link', tags: ['observation', 'forgotten'] });

    // Only in prior window — gone quiet, handled by silence detection
    const e2 = store.createEdge({ sourceId: m3.id, targetId: m4.id, relationType: 'related', weight: 0.5 });
    setEdgeTime(e2.id, Date.now() - 45 * DAY);

    const drift = detectDrift(store);

    expect(drift.find(d => d.tag === 'quantum')).toBeUndefined();
    expect(drift.find(d => d.tag === 'forgotten')).toBeUndefined();
  });

  it('respects custom threshold parameter', () => {
    const m1 = store.create({ content: 'subtle shift', tags: ['observation', 'ethics'] });
    const m2 = store.create({ content: 'subtle shift link', tags: ['observation', 'ethics'] });
    const m3 = store.create({ content: 'subtle old', tags: ['observation', 'ethics'] });
    const m4 = store.create({ content: 'subtle old link', tags: ['observation', 'ethics'] });

    // Prior: 1.0, Current: 1.15 => 15% increase
    const ePrior = store.createEdge({ sourceId: m3.id, targetId: m4.id, relationType: 'related', weight: 1.0 });
    setEdgeTime(ePrior.id, Date.now() - 45 * DAY);

    const eCurrent = store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related', weight: 1.15 });
    setEdgeTime(eCurrent.id, Date.now() - 10 * DAY);

    // Default threshold (0.2) should miss it
    expect(detectDrift(store).find(d => d.tag === 'ethics')).toBeUndefined();

    // Lower threshold (0.1) should catch it
    const drift = detectDrift(store, 30, 0.1);
    const ethics = drift.find(d => d.tag === 'ethics');
    expect(ethics).toBeDefined();
    expect(ethics!.direction).toBe('strengthening');
  });

  it('sorts results by magnitude descending', () => {
    // Tag A: 50% increase
    const a1 = store.create({ content: 'a1', tags: ['observation', 'alpha'] });
    const a2 = store.create({ content: 'a2', tags: ['observation', 'alpha'] });
    const a3 = store.create({ content: 'a3', tags: ['observation', 'alpha'] });
    const a4 = store.create({ content: 'a4', tags: ['observation', 'alpha'] });

    const eaPrior = store.createEdge({ sourceId: a3.id, targetId: a4.id, relationType: 'related', weight: 1.0 });
    setEdgeTime(eaPrior.id, Date.now() - 45 * DAY);
    const eaCurrent = store.createEdge({ sourceId: a1.id, targetId: a2.id, relationType: 'related', weight: 1.5 });
    setEdgeTime(eaCurrent.id, Date.now() - 10 * DAY);

    // Tag B: 100% increase (bigger shift)
    const b1 = store.create({ content: 'b1', tags: ['entity', 'beta'] });
    const b2 = store.create({ content: 'b2', tags: ['entity', 'beta'] });
    const b3 = store.create({ content: 'b3', tags: ['entity', 'beta'] });
    const b4 = store.create({ content: 'b4', tags: ['entity', 'beta'] });

    const ebPrior = store.createEdge({ sourceId: b3.id, targetId: b4.id, relationType: 'related', weight: 1.0 });
    setEdgeTime(ebPrior.id, Date.now() - 45 * DAY);
    const ebCurrent = store.createEdge({ sourceId: b1.id, targetId: b2.id, relationType: 'related', weight: 2.0 });
    setEdgeTime(ebCurrent.id, Date.now() - 10 * DAY);

    const drift = detectDrift(store);

    // Beta (100%) should come before alpha (50%)
    const betaIdx = drift.findIndex(d => d.tag === 'beta');
    const alphaIdx = drift.findIndex(d => d.tag === 'alpha');

    expect(betaIdx).toBeLessThan(alphaIdx);
    expect(betaIdx).not.toBe(-1);
    expect(alphaIdx).not.toBe(-1);
  });

  it('computes drift magnitude correctly', () => {
    const m1 = store.create({ content: 'precise a', tags: ['skill', 'routing'] });
    const m2 = store.create({ content: 'precise b', tags: ['skill', 'routing'] });
    const m3 = store.create({ content: 'precise c', tags: ['skill', 'routing'] });
    const m4 = store.create({ content: 'precise d', tags: ['skill', 'routing'] });

    // Prior: avg weight 0.8
    const ePrior = store.createEdge({ sourceId: m3.id, targetId: m4.id, relationType: 'related', weight: 0.8 });
    setEdgeTime(ePrior.id, Date.now() - 45 * DAY);

    // Current: avg weight 1.2
    const eCurrent = store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related', weight: 1.2 });
    setEdgeTime(eCurrent.id, Date.now() - 10 * DAY);

    const drift = detectDrift(store);
    const routing = drift.find(d => d.tag === 'routing');

    expect(routing).toBeDefined();
    // magnitude = (1.2 - 0.8) / 0.8 = 0.5
    expect(routing!.magnitude).toBeCloseTo(0.5);
    expect(routing!.currentAvgWeight).toBeCloseTo(1.2);
    expect(routing!.priorAvgWeight).toBeCloseTo(0.8);
    expect(routing!.direction).toBe('strengthening');
    expect(routing!.memoryCount).toBeGreaterThan(0);
  });
});

describe('driftScore', () => {
  const now = 1_800_000_000_000; // fixed reference time for determinism

  function mkMemory(overrides: Partial<Memory> = {}): Memory {
    return {
      id: 'm1',
      content: 'content',
      embedding: null,
      strength: 1.0,
      accessCount: 10,
      retrievalCount: 0,
      createdAt: now,
      lastAccessedAt: now,
      lastDecayAt: now,
      sessionId: null,
      tags: [],
      associations: [],
      metadata: {},
      memoryType: 'semantic',
      readiness: 0,
      valence: 'neutral',
      lastHindsightReview: null,
      ...overrides,
    };
  }

  it('returns 0 for a fresh, strong, accessed, not-superseded memory', () => {
    const m = mkMemory();
    expect(driftScore(m, { now })).toBe(0);
  });

  it('returns 0 for constitutional memories regardless of other signals', () => {
    const m = mkMemory({
      tags: ['principle'],
      strength: 0.0,
      accessCount: 0,
      createdAt: now - 365 * 86_400_000, // very old
      supersededBy: 'other-id',
    });
    expect(driftScore(m, { now })).toBe(0);

    const voiceMem = mkMemory({ tags: ['voice'], strength: 0.0 });
    expect(driftScore(voiceMem, { now })).toBe(0);
  });

  it('increases with age', () => {
    const young = mkMemory({ createdAt: now - 5 * 86_400_000 });
    const old = mkMemory({ createdAt: now - 120 * 86_400_000 });
    expect(driftScore(old, { now })).toBeGreaterThan(driftScore(young, { now }));
  });

  it('increases when access count is low', () => {
    const used = mkMemory({ accessCount: 10, createdAt: now - 30 * 86_400_000 });
    const unused = mkMemory({ accessCount: 0, createdAt: now - 30 * 86_400_000 });
    expect(driftScore(unused, { now })).toBeGreaterThan(driftScore(used, { now }));
  });

  it('increases when memory is below mean strength (corpus context)', () => {
    const weak = mkMemory({ strength: 0.2, createdAt: now - 30 * 86_400_000, accessCount: 5 });
    const strong = mkMemory({ strength: 0.9, createdAt: now - 30 * 86_400_000, accessCount: 5 });
    const meanStrength = 0.7;
    expect(driftScore(weak, { now, meanStrength })).toBeGreaterThan(
      driftScore(strong, { now, meanStrength }),
    );
  });

  it('jumps when supersededBy is set', () => {
    const base = mkMemory({ createdAt: now - 5 * 86_400_000, accessCount: 3 });
    const superseded = mkMemory({
      createdAt: now - 5 * 86_400_000,
      accessCount: 3,
      supersededBy: 'newer-id',
    });
    expect(driftScore(superseded, { now })).toBeGreaterThanOrEqual(
      driftScore(base, { now }) + 0.19, // 0.20 weight, allow tiny fp tolerance
    );
  });

  it('is clamped to [0, 1]', () => {
    const max = mkMemory({
      strength: 0,
      accessCount: 0,
      createdAt: now - 365 * 86_400_000,
      supersededBy: 'x',
    });
    const s = driftScore(max, { now });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('handles a NaN strength gracefully by treating it as 0', () => {
    const m = mkMemory({ strength: NaN, createdAt: now - 30 * 86_400_000, accessCount: 0 });
    const s = driftScore(m, { now });
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThan(0);
  });
});
