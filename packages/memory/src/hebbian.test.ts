import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';

describe('Hebbian Engine — Schema', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('memory_edges table has last_hebbian_at column', () => {
    const m1 = store.create({ content: 'memory alpha' });
    const m2 = store.create({ content: 'memory beta' });
    const edge = store.createEdge({
      sourceId: m1.id,
      targetId: m2.id,
      relationType: 'similar',
    });

    expect(edge).toHaveProperty('lastHebbianAt');
    expect(edge.lastHebbianAt).toBeNull();
  });
});
