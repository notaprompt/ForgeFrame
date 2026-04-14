import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { MemoryRetriever } from './retrieval.js';
import { unlinkSync } from 'fs';

const TEST_DB = `/tmp/forgeframe-retrieval-test-${Date.now()}.db`;

describe('RRF Retrieval', () => {
  let store: MemoryStore;
  let retriever: MemoryRetriever;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: TEST_DB });
    retriever = new MemoryRetriever(store);
    const m1 = store.create({ content: 'ForgeFrame architecture decisions for the platform' });
    const m2 = store.create({ content: 'Guardian temperature computation and signal processing' });
    const m3 = store.create({ content: 'ForgeFrame sovereign memory layer design' });
    store.createEdge({ sourceId: m1.id, targetId: m3.id, relationType: 'related' });
  });

  afterEach(() => {
    store.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_DB + '-wal'); } catch {}
    try { unlinkSync(TEST_DB + '-shm'); } catch {}
  });

  it('returns results from FTS', () => {
    const results = retriever.query({ text: 'ForgeFrame', limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('includes direct FTS matches', () => {
    const results = retriever.query({ text: 'architecture', limit: 10 });
    const contents = results.map(r => r.memory.content);
    expect(contents).toContain('ForgeFrame architecture decisions for the platform');
  });

  it('filters by minStrength', () => {
    const results = retriever.query({ text: 'ForgeFrame', limit: 10, minStrength: 2.0 });
    expect(results).toHaveLength(0);
  });

  it('filters by tags', () => {
    const results = retriever.query({ text: 'ForgeFrame', limit: 10, tags: ['nonexistent'] });
    expect(results).toHaveLength(0);
  });

  it('returns results sorted by score descending', () => {
    const results = retriever.query({ text: 'ForgeFrame', limit: 10 });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('query() calls reconsolidate on returned memories', async () => {
    // Create a memory with low strength
    const mem = store.create({ content: 'reconsolidation target' });
    // Manually reduce strength
    store['_db'].prepare('UPDATE memories SET strength = 0.3 WHERE id = ?').run(mem.id);

    // Query and get the memory back
    const results = retriever.query({ text: 'reconsolidation target' });
    expect(results.length).toBeGreaterThan(0);

    // Verify strength was restored (reconsolidate was called)
    const updated = store.get(results[0].memory.id)!;
    expect(updated.strength).toBeGreaterThan(0.3);
    expect(updated.retrievalCount).toBe(1);
  });

  it('query() records co-retrieved memory associations', async () => {
    store.create({ content: 'alpha concept for testing' });
    store.create({ content: 'alpha related concept for testing' });

    const results = retriever.query({ text: 'alpha concept testing' });
    expect(results.length).toBeGreaterThanOrEqual(2);

    // Check that memories now have each other in associations
    const first = store.get(results[0].memory.id)!;
    expect(first.associations).toContain(results[1].memory.id);
  });
});
