/**
 * Tests for roadmap.ts — the 4-bucket memory view.
 *
 * Register: beautifully robust — every exported function has a test,
 * empty stores don't throw, classifications are deterministic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { buildRoadmap, computeMeanStrength, isEntrenched } from './roadmap.js';
import type { Memory } from './types.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * Backdate a memory's createdAt (and associated clocks) for test setup.
 * Test-only helper that reaches into the store's underlying db.
 */
function backdateMemory(store: MemoryStore, id: string, createdAt: number): void {
  const db = (store as unknown as { _db: any })._db;
  db.prepare(
    'UPDATE memories SET created_at = ?, last_accessed_at = ?, last_decay_at = ? WHERE id = ?',
  ).run(createdAt, createdAt, createdAt, id);
}

/** Set strength directly, bypassing decay. */
function setStrength(store: MemoryStore, id: string, strength: number): void {
  const db = (store as unknown as { _db: any })._db;
  db.prepare('UPDATE memories SET strength = ? WHERE id = ?').run(strength, id);
}

/** Set access count directly. */
function setAccessCount(store: MemoryStore, id: string, count: number): void {
  const db = (store as unknown as { _db: any })._db;
  db.prepare('UPDATE memories SET access_count = ? WHERE id = ?').run(count, id);
}

describe('buildRoadmap', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('returns all four buckets empty for an empty store', async () => {
    const buckets = await buildRoadmap({ store });
    expect(buckets.active).toEqual([]);
    expect(buckets.pending).toEqual([]);
    expect(buckets.entrenched).toEqual([]);
    expect(buckets.drifting).toEqual([]);
  });

  it('places only fresh memories in the active bucket (nothing else)', async () => {
    const m1 = store.create({ content: 'fresh 1', tags: ['observation'] });
    const m2 = store.create({ content: 'fresh 2', tags: ['observation'] });
    // Both strengths are 1.0 by default — would qualify for entrenched at the
    // 0.85 threshold. Use a threshold that keeps them out of entrenched.
    const buckets = await buildRoadmap({
      store,
      entrenchedStrength: 1.01,
      activeWindowHours: 24,
    });
    expect(buckets.active.map((m) => m.id).sort()).toEqual([m1.id, m2.id].sort());
    expect(buckets.pending).toEqual([]);
    expect(buckets.entrenched).toEqual([]);
    expect(buckets.drifting).toEqual([]);
  });

  it('places principle-tagged memories in entrenched regardless of strength', async () => {
    const m = store.create({ content: 'identity core', tags: ['principle'] });
    setStrength(store, m.id, 0.1); // would otherwise be pending/drifting
    const buckets = await buildRoadmap({ store });
    expect(buckets.entrenched.map((x) => x.id)).toContain(m.id);
    expect(buckets.drifting.map((x) => x.id)).not.toContain(m.id);
    expect(buckets.pending.map((x) => x.id)).not.toContain(m.id);
  });

  it('places high-strength memories (>= 0.85) in entrenched', async () => {
    const m = store.create({ content: 'strong', tags: ['observation'] });
    setStrength(store, m.id, 0.9);
    const buckets = await buildRoadmap({ store, entrenchedStrength: 0.85 });
    expect(buckets.entrenched.map((x) => x.id)).toContain(m.id);
  });

  it('places weak, old, unused memories in drifting', async () => {
    const m = store.create({ content: 'faded', tags: ['observation'] });
    const oldTs = Date.now() - 120 * DAY;
    backdateMemory(store, m.id, oldTs);
    setStrength(store, m.id, 0.15);
    setAccessCount(store, m.id, 0);
    const buckets = await buildRoadmap({
      store,
      entrenchedStrength: 0.85,
      driftingThreshold: 0.5,
    });
    expect(buckets.drifting.map((x) => x.id)).toContain(m.id);
    expect(buckets.entrenched.map((x) => x.id)).not.toContain(m.id);
  });

  it('places mid-strength, not-fresh, not-drifting memories in pending', async () => {
    const m = store.create({ content: 'settling', tags: ['observation'] });
    // 3 days old — outside default 24h active window
    const ts = Date.now() - 3 * DAY;
    backdateMemory(store, m.id, ts);
    setStrength(store, m.id, 0.5);
    setAccessCount(store, m.id, 5);
    const buckets = await buildRoadmap({
      store,
      activeWindowHours: 24,
      entrenchedStrength: 0.85,
      driftingThreshold: 0.7,
    });
    expect(buckets.pending.map((x) => x.id)).toContain(m.id);
    expect(buckets.active.map((x) => x.id)).not.toContain(m.id);
    expect(buckets.drifting.map((x) => x.id)).not.toContain(m.id);
    expect(buckets.entrenched.map((x) => x.id)).not.toContain(m.id);
  });

  it('prioritises entrenched over drifting for a principle that would score high', async () => {
    const m = store.create({ content: 'old principle', tags: ['principle'] });
    const oldTs = Date.now() - 200 * DAY;
    backdateMemory(store, m.id, oldTs);
    setStrength(store, m.id, 0.1);
    setAccessCount(store, m.id, 0);
    const buckets = await buildRoadmap({ store, driftingThreshold: 0.2 });
    expect(buckets.entrenched.map((x) => x.id)).toContain(m.id);
    expect(buckets.drifting.map((x) => x.id)).not.toContain(m.id);
  });

  it('caps each bucket at maxPerBucket', async () => {
    // Create 30 fresh principle-tagged memories — all qualify for entrenched.
    for (let i = 0; i < 30; i++) {
      store.create({ content: `principle ${i}`, tags: ['principle'] });
    }
    const buckets = await buildRoadmap({ store, maxPerBucket: 5 });
    expect(buckets.entrenched.length).toBe(5);
  });

  it('sorts active bucket by createdAt DESC (newest first)', async () => {
    const now = Date.now();
    const m1 = store.create({ content: 'old', tags: ['observation'] });
    backdateMemory(store, m1.id, now - 20 * HOUR);
    const m2 = store.create({ content: 'mid', tags: ['observation'] });
    backdateMemory(store, m2.id, now - 10 * HOUR);
    const m3 = store.create({ content: 'new', tags: ['observation'] });
    backdateMemory(store, m3.id, now - 1 * HOUR);

    const buckets = await buildRoadmap({
      store,
      activeWindowHours: 24,
      entrenchedStrength: 1.01, // keep everything out of entrenched
      now: now + 1, // stable clock for test
    });
    expect(buckets.active.map((m) => m.id)).toEqual([m3.id, m2.id, m1.id]);
  });

  it('a memory never appears in more than one bucket', async () => {
    // Create a mixed bag
    store.create({ content: 'p1', tags: ['principle'] });
    const m2 = store.create({ content: 'fresh', tags: ['observation'] });
    setStrength(store, m2.id, 0.4);
    const m3 = store.create({ content: 'old weak', tags: ['observation'] });
    backdateMemory(store, m3.id, Date.now() - 200 * DAY);
    setStrength(store, m3.id, 0.1);
    setAccessCount(store, m3.id, 0);

    const buckets = await buildRoadmap({ store });
    const allIds = [
      ...buckets.active.map((x) => x.id),
      ...buckets.pending.map((x) => x.id),
      ...buckets.entrenched.map((x) => x.id),
      ...buckets.drifting.map((x) => x.id),
    ];
    const unique = new Set(allIds);
    expect(unique.size).toBe(allIds.length);
  });

  it('handles maxPerBucket <= 0 by returning empty buckets without throwing', async () => {
    store.create({ content: 'x', tags: ['principle'] });
    const buckets = await buildRoadmap({ store, maxPerBucket: 0 });
    expect(buckets.active).toEqual([]);
    expect(buckets.pending).toEqual([]);
    expect(buckets.entrenched).toEqual([]);
    expect(buckets.drifting).toEqual([]);
  });
});

describe('computeMeanStrength', () => {
  it('returns 0 for an empty array', () => {
    expect(computeMeanStrength([])).toBe(0);
  });

  it('averages strength across memories', () => {
    const ms = [
      { strength: 0.2 } as Memory,
      { strength: 0.8 } as Memory,
    ];
    expect(computeMeanStrength(ms)).toBeCloseTo(0.5);
  });

  it('ignores NaN/Infinity strengths', () => {
    const ms = [
      { strength: 0.5 } as Memory,
      { strength: NaN } as Memory,
      { strength: Infinity } as Memory,
    ];
    expect(computeMeanStrength(ms)).toBeCloseTo(0.5);
  });
});

describe('isEntrenched', () => {
  const base: Memory = {
    id: 'x',
    content: '',
    embedding: null,
    strength: 0.5,
    accessCount: 0,
    retrievalCount: 0,
    createdAt: 0,
    lastAccessedAt: 0,
    lastDecayAt: 0,
    sessionId: null,
    tags: [],
    associations: [],
    metadata: {},
    memoryType: 'semantic',
    readiness: 0,
    valence: 'neutral',
    lastHindsightReview: null,
  };

  it('returns true for strength >= threshold', () => {
    expect(isEntrenched({ ...base, strength: 0.9 }, 0.85)).toBe(true);
  });

  it('returns true for principle/voice/constitutional tags', () => {
    expect(isEntrenched({ ...base, tags: ['principle'] }, 0.85)).toBe(true);
    expect(isEntrenched({ ...base, tags: ['voice'] }, 0.85)).toBe(true);
    expect(isEntrenched({ ...base, tags: ['constitutional'] }, 0.85)).toBe(true);
  });

  it('returns false for weak, non-constitutional memories', () => {
    expect(isEntrenched({ ...base, strength: 0.3, tags: ['observation'] }, 0.85)).toBe(false);
  });
});
