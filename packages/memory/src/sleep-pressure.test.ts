import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from './store.js';
import { computeSleepPressure } from './sleep-pressure.js';

describe('computeSleepPressure', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  it('returns sleep when no memories exist', () => {
    const pressure = computeSleepPressure(store);
    expect(pressure.recommendation).toBe('sleep');
    // No memories and no dream journal: unconsolidated=0, hoursSinceLastDream=0,
    // unscannedContradictions=0, pendingDecay=0 → score=0
    expect(pressure.score).toBeCloseTo(0, 0);
  });

  it('pressure increases with unconsolidated memories', () => {
    for (let i = 0; i < 50; i++) {
      store.create({ content: `memory ${i}` });
    }
    const pressure = computeSleepPressure(store);
    expect(pressure.score).toBeGreaterThan(20);
    expect(pressure.components.unconsolidated).toBe(50);
  });

  it('returns full when pressure is high', () => {
    for (let i = 0; i < 200; i++) {
      store.create({ content: `memory ${i}` });
    }
    const pressure = computeSleepPressure(store);
    expect(pressure.recommendation).toBe('full');
  });

  it('dream-journal memories do not count as unconsolidated', () => {
    // Only dream-journal entries: unconsolidated should be 0 regardless of count
    store.create({ content: 'dream journal A', tags: ['dream-journal'] });
    store.create({ content: 'dream journal B', tags: ['dream-journal'] });
    const pressure = computeSleepPressure(store);
    // Both are dream-journals; none should appear in unconsolidated
    expect(pressure.components.unconsolidated).toBe(0);
  });

  it('returns components object with all required keys', () => {
    const pressure = computeSleepPressure(store);
    expect(pressure).toHaveProperty('score');
    expect(pressure).toHaveProperty('recommendation');
    expect(pressure.components).toHaveProperty('unconsolidated');
    expect(pressure.components).toHaveProperty('hoursSinceLastDream');
    expect(pressure.components).toHaveProperty('unscannedContradictions');
    expect(pressure.components).toHaveProperty('pendingDecay');
  });
});
