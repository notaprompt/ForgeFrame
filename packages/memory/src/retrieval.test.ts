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
});
