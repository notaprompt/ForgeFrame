import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { MemoryRetriever } from './retrieval.js';

describe('MemoryRetriever', () => {
  let store: MemoryStore;
  let retriever: MemoryRetriever;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
    retriever = new MemoryRetriever(store);
  });

  afterEach(() => {
    store.close();
  });

  it('query with text returns scored results', () => {
    store.create({ content: 'quantum physics lecture notes' });
    store.create({ content: 'grocery shopping list' });

    const results = retriever.query({ text: 'quantum' });
    expect(results.length).toBe(1);
    expect(results[0].memory.content).toContain('quantum');
    expect(results[0].score).toBeTypeOf('number');
  });

  it('query with tag filter filters by tags', () => {
    store.create({ content: 'tagged item alpha', tags: ['important'] });
    store.create({ content: 'tagged item beta', tags: ['trivial'] });

    const results = retriever.query({ text: 'tagged', tags: ['important'] });
    expect(results.length).toBe(1);
    expect(results[0].memory.tags).toContain('important');
  });

  it('query with minStrength filters weak memories', () => {
    store.create({ content: 'strong memory candidate' });

    // All fresh memories have strength 1.0, so minStrength 0.9 keeps them
    const kept = retriever.query({ text: 'strong', minStrength: 0.9 });
    expect(kept.length).toBe(1);

    // minStrength above 1.0 filters everything
    const filtered = retriever.query({ text: 'strong', minStrength: 1.1 });
    expect(filtered.length).toBe(0);
  });

  it('query with sessionId includes session memories', () => {
    store.create({ content: 'session scoped note', sessionId: 'sess-a' });
    store.create({ content: 'other note', sessionId: 'sess-b' });

    const results = retriever.query({ sessionId: 'sess-a' });
    expect(results.length).toBe(1);
    expect(results[0].memory.sessionId).toBe('sess-a');
  });

  it('query respects limit', () => {
    store.create({ content: 'limit test alpha' });
    store.create({ content: 'limit test beta' });
    store.create({ content: 'limit test gamma' });

    const results = retriever.query({ text: 'limit', limit: 2 });
    expect(results.length).toBe(2);
  });

  it('query records access on returned memories', () => {
    const mem = store.create({ content: 'access tracking test' });
    expect(mem.accessCount).toBe(0);

    retriever.query({ text: 'access' });

    const after = store.get(mem.id)!;
    expect(after.accessCount).toBe(1);
  });

  it('results sorted by score descending', () => {
    store.create({ content: 'sorting result alpha' });
    store.create({ content: 'sorting result beta' });

    const results = retriever.query({ text: 'sorting' });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});
