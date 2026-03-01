import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  describe('create', () => {
    it('returns Memory with all fields when given full input', () => {
      const mem = store.create({
        content: 'full input test',
        tags: ['alpha', 'beta'],
        metadata: { key: 'value' },
        sessionId: 'sess-1',
      });

      expect(mem.id).toBeTypeOf('string');
      expect(mem.content).toBe('full input test');
      expect(mem.tags).toEqual(['alpha', 'beta']);
      expect(mem.metadata).toEqual({ key: 'value' });
      expect(mem.sessionId).toBe('sess-1');
      expect(mem.strength).toBe(1.0);
      expect(mem.accessCount).toBe(0);
      expect(mem.embedding).toBeNull();
      expect(mem.createdAt).toBeTypeOf('number');
      expect(mem.lastAccessedAt).toBeTypeOf('number');
    });

    it('returns Memory with defaults when given minimal input', () => {
      const mem = store.create({ content: 'minimal' });

      expect(mem.content).toBe('minimal');
      expect(mem.tags).toEqual([]);
      expect(mem.metadata).toEqual({});
      expect(mem.sessionId).toBeNull();
      expect(mem.strength).toBe(1.0);
      expect(mem.accessCount).toBe(0);
    });
  });

  describe('get', () => {
    it('returns Memory when found', () => {
      const created = store.create({ content: 'findable' });
      const found = store.get(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.content).toBe('findable');
    });

    it('returns null when not found', () => {
      expect(store.get('nonexistent-id')).toBeNull();
    });
  });

  describe('search', () => {
    it('finds by keyword match', () => {
      store.create({ content: 'the quick brown fox jumps' });
      store.create({ content: 'lazy dog sleeps' });

      const results = store.search('fox');
      expect(results.length).toBe(1);
      expect(results[0].content).toContain('fox');
    });

    it('respects limit', () => {
      store.create({ content: 'search target alpha' });
      store.create({ content: 'search target beta' });
      store.create({ content: 'search target gamma' });

      const results = store.search('search', 2);
      expect(results.length).toBe(2);
    });

    it('returns empty for no match', () => {
      store.create({ content: 'something unrelated' });
      const results = store.search('nonexistentword');
      expect(results).toEqual([]);
    });
  });

  describe('getRecent', () => {
    it('returns newest first', () => {
      store.create({ content: 'older entry' });
      store.create({ content: 'newer entry' });

      const recent = store.getRecent(2);
      expect(recent[0].content).toBe('newer entry');
      expect(recent[1].content).toBe('older entry');
    });

    it('respects limit', () => {
      store.create({ content: 'a' });
      store.create({ content: 'b' });
      store.create({ content: 'c' });

      const recent = store.getRecent(2);
      expect(recent.length).toBe(2);
    });
  });

  describe('getBySession', () => {
    it('returns memories for a session', () => {
      store.create({ content: 'sess memory', sessionId: 'sess-x' });
      store.create({ content: 'other memory', sessionId: 'sess-y' });

      const results = store.getBySession('sess-x');
      expect(results.length).toBe(1);
      expect(results[0].sessionId).toBe('sess-x');
    });
  });

  describe('delete', () => {
    it('returns true when memory exists', () => {
      const mem = store.create({ content: 'to delete' });
      expect(store.delete(mem.id)).toBe(true);
      expect(store.get(mem.id)).toBeNull();
    });

    it('returns false when memory does not exist', () => {
      expect(store.delete('missing-id')).toBe(false);
    });
  });

  describe('count', () => {
    it('returns number of memories', () => {
      expect(store.count()).toBe(0);
      store.create({ content: 'one' });
      store.create({ content: 'two' });
      expect(store.count()).toBe(2);
    });
  });

  describe('recordAccess', () => {
    it('increments accessCount and updates lastAccessedAt', () => {
      const mem = store.create({ content: 'access me' });
      const beforeAccess = mem.lastAccessedAt;

      store.recordAccess(mem.id);
      const after = store.get(mem.id)!;

      expect(after.accessCount).toBe(1);
      expect(after.lastAccessedAt).toBeGreaterThanOrEqual(beforeAccess);
    });
  });

  describe('applyDecay', () => {
    it('preserves strength on fresh memories', () => {
      store.create({ content: 'fresh memory' });
      store.applyDecay();
      const mem = store.getRecent(1)[0];
      // Freshly created memory has near-zero time delta, so strength stays ~1.0
      expect(mem.strength).toBeGreaterThan(0.99);
    });
  });

  describe('close', () => {
    it('does not throw', () => {
      const s = new MemoryStore({ dbPath: ':memory:' });
      expect(() => s.close()).not.toThrow();
    });
  });
});
