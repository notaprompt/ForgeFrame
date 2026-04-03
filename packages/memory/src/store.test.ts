import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { TRIM_TAGS, CONSTITUTIONAL_TAGS } from './types.js';

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

  describe('exponential decay', () => {
    it('preserves strength on fresh memories', () => {
      store.create({ content: 'fresh memory' });
      store.applyDecay();
      const mem = store.getRecent(1)[0];
      // Freshly created memory has near-zero time delta, so strength stays ~1.0
      expect(mem.strength).toBeGreaterThan(0.99);
    });

    it('frequently accessed memories decay slower than unaccessed ones', () => {
      const unaccessed = store.create({ content: 'unaccessed memory' });
      const accessed = store.create({ content: 'accessed memory' });

      // Access one memory 10 times
      for (let i = 0; i < 10; i++) {
        store.recordAccess(accessed.id);
      }

      const fourteenDaysAgo = Date.now() - 14 * 86400000;

      // Backdate both by 14 days
      (store as any)._db.prepare(
        'UPDATE memories SET last_accessed_at = ?, last_decay_at = NULL WHERE id = ?'
      ).run(fourteenDaysAgo, unaccessed.id);
      (store as any)._db.prepare(
        'UPDATE memories SET last_accessed_at = ?, last_decay_at = NULL WHERE id = ?'
      ).run(fourteenDaysAgo, accessed.id);

      store.applyDecay();

      const unaccessedAfter = store.get(unaccessed.id)!;
      const accessedAfter = store.get(accessed.id)!;

      // Accessed memory should have higher strength
      expect(accessedAfter.strength).toBeGreaterThan(unaccessedAfter.strength);
    });

    it('decay follows exponential curve, not linear', () => {
      // baseStability = 7 means 50% retention after 7 days with no access
      const mem = store.create({ content: 'exponential decay test' });
      const sevenDaysAgo = Date.now() - 7 * 86400000;

      // Backdate by 7 days (= baseStability)
      (store as any)._db.prepare(
        'UPDATE memories SET last_accessed_at = ?, last_decay_at = NULL WHERE id = ?'
      ).run(sevenDaysAgo, mem.id);

      store.applyDecay();
      const after = store.get(mem.id)!;

      // Strength should be ~0.5 (50% retention at stability point)
      // S(t) = e^(-t / (stability * ln(2))) = e^(-7 / (7 * ln(2))) = e^(-1/ln(2)) = 0.5
      expect(after.strength).toBeCloseTo(0.5, 1);
    });

    it('decay is multiplicative (idempotent across multiple applications)', () => {
      // Applying decay for 3 days then 4 days should equal applying once for 7 days
      const memA = store.create({ content: 'split decay test' });
      const memB = store.create({ content: 'single decay test' });

      const sevenDaysAgo = Date.now() - 7 * 86400000;
      const fourDaysAgo = Date.now() - 4 * 86400000;

      // memA: backdate by 7 days, apply once
      (store as any)._db.prepare(
        'UPDATE memories SET last_accessed_at = ?, last_decay_at = NULL WHERE id = ?'
      ).run(sevenDaysAgo, memA.id);

      // memB: backdate by 7 days, then simulate first decay 4 days ago
      (store as any)._db.prepare(
        'UPDATE memories SET last_accessed_at = ?, last_decay_at = NULL WHERE id = ?'
      ).run(sevenDaysAgo, memB.id);

      // First: apply decay for memB with last_decay_at = null (7 days ago)
      // but set last_decay_at to 4 days ago to simulate "3 days of decay happened"
      const stabilityB = 7 * (1 + 0 * 0.5); // accessCount = 0
      const strengthAfter3Days = 1.0 * Math.exp(-3 * Math.LN2 / stabilityB);
      (store as any)._db.prepare(
        'UPDATE memories SET strength = ?, last_decay_at = ? WHERE id = ?'
      ).run(strengthAfter3Days, fourDaysAgo, memB.id);

      // Now apply decay to both
      store.applyDecay();

      const afterA = store.get(memA.id)!;
      const afterB = store.get(memB.id)!;

      // Both should have the same strength (7 days total decay)
      expect(afterB.strength).toBeCloseTo(afterA.strength, 5);
    });

    it('calling applyDecay twice produces the same strength as calling it once', () => {
      const mem = store.create({ content: 'decay idempotency test' });
      const tenDaysAgo = Date.now() - 10 * 86400000;

      // Backdate last_accessed_at and clear last_decay_at
      (store as any)._db.prepare(
        'UPDATE memories SET last_accessed_at = ?, last_decay_at = NULL WHERE id = ?'
      ).run(tenDaysAgo, mem.id);

      store.applyDecay();
      const afterFirst = store.get(mem.id)!;

      store.applyDecay();
      const afterSecond = store.get(mem.id)!;

      // Tiny floating-point drift from milliseconds between calls is acceptable
      expect(afterSecond.strength).toBeCloseTo(afterFirst.strength, 8);
    });

    it('constitutional memories are never decayed', () => {
      const mem = store.create({
        content: 'core principle that must not decay',
        tags: ['principle'],
      });
      const tenDaysAgo = Date.now() - 10 * 86400000;

      // Backdate last_accessed_at
      (store as any)._db.prepare(
        'UPDATE memories SET last_accessed_at = ?, last_decay_at = NULL WHERE id = ?'
      ).run(tenDaysAgo, mem.id);

      store.applyDecay();
      const after = store.get(mem.id)!;

      expect(after.strength).toBe(1.0);
    });
  });

  describe('TRIM tag taxonomy', () => {
    it('accepts all valid TRIM tags', () => {
      for (const tag of TRIM_TAGS) {
        const mem = store.create({ content: `tagged with ${tag}`, tags: [tag] });
        expect(mem.tags).toContain(tag);
      }
    });

    it('accepts custom tags alongside TRIM tags', () => {
      const mem = store.create({
        content: 'mixed tags',
        tags: ['observation', 'my-custom-tag', 'entity'],
      });
      expect(mem.tags).toEqual(['observation', 'my-custom-tag', 'entity']);
    });

    it('accepts purely custom tags', () => {
      const mem = store.create({
        content: 'custom only',
        tags: ['project:forgeframe', 'source:cli'],
      });
      expect(mem.tags).toEqual(['project:forgeframe', 'source:cli']);
    });

    it('rejects misspelled TRIM tags (case mismatch)', () => {
      expect(() =>
        store.create({ content: 'bad tag', tags: ['Observation'] })
      ).toThrow(/Invalid TRIM tag.*did you mean "observation"/);
    });

    it('rejects misspelled TRIM tags on update', () => {
      const mem = store.create({ content: 'will update', tags: ['observation'] });
      expect(() =>
        store.update(mem.id, { tags: ['Principle'] })
      ).toThrow(/Invalid TRIM tag.*did you mean "principle"/);
    });

    it('identifies constitutional tags on memories', () => {
      const principle = store.create({
        content: 'core belief',
        tags: ['principle'],
      });
      const voice = store.create({
        content: 'communication style',
        tags: ['voice'],
      });
      const observation = store.create({
        content: 'just a note',
        tags: ['observation'],
      });

      expect(store.hasConstitutionalTag(principle)).toBe(true);
      expect(store.hasConstitutionalTag(voice)).toBe(true);
      expect(store.hasConstitutionalTag(observation)).toBe(false);
    });

    it('constitutional tags are principle and voice', () => {
      expect(CONSTITUTIONAL_TAGS).toContain('principle');
      expect(CONSTITUTIONAL_TAGS).toContain('voice');
      expect(CONSTITUTIONAL_TAGS).toHaveLength(2);
    });
  });

  describe('duplicate detection', () => {
    it('findDuplicate detects near-identical content', () => {
      store.create({ content: 'The user prefers dark mode in all applications' });
      const dup = store.findDuplicate('The user prefers dark mode in all applications.');
      expect(dup).not.toBeNull();
    });

    it('findDuplicate returns null for distinct content', () => {
      store.create({ content: 'The user prefers dark mode' });
      const dup = store.findDuplicate('Deploy to production using Docker');
      expect(dup).toBeNull();
    });

    it('findDuplicate returns null when store is empty', () => {
      const dup = store.findDuplicate('anything at all');
      expect(dup).toBeNull();
    });

    it('findDuplicate respects custom threshold', () => {
      store.create({ content: 'The user prefers dark mode in all applications' });
      // With a very high threshold, minor rewording should not match
      const dup = store.findDuplicate('The user prefers dark mode in most applications and editors', 0.95);
      expect(dup).toBeNull();
    });

    it('findDuplicate detects content with minor edits', () => {
      const original = 'ForgeFrame uses SQLite with FTS5 for full-text search capabilities';
      store.create({ content: original });
      const dup = store.findDuplicate('ForgeFrame uses SQLite with FTS5 for full-text search capabilities.');
      expect(dup).not.toBeNull();
      expect(dup!.content).toBe(original);
    });

    it('merge combines tags and updates content', () => {
      const mem = store.create({ content: 'old version', tags: ['tag-a'] });
      store.merge(mem.id, 'new version', ['tag-b']);
      const after = store.get(mem.id)!;
      expect(after.content).toBe('new version');
      expect(after.tags).toContain('tag-a');
      expect(after.tags).toContain('tag-b');
    });

    it('merge increments access count', () => {
      const mem = store.create({ content: 'original content' });
      expect(mem.accessCount).toBe(0);
      store.merge(mem.id, 'updated content', []);
      const after = store.get(mem.id)!;
      expect(after.accessCount).toBe(1);
    });

    it('merge boosts strength', () => {
      const mem = store.create({ content: 'original content' });
      store.resetStrength(mem.id, 0.5);
      store.merge(mem.id, 'updated content', []);
      const after = store.get(mem.id)!;
      expect(after.strength).toBeCloseTo(0.6, 1);
    });

    it('merge caps strength at 1.0', () => {
      const mem = store.create({ content: 'original content' });
      store.merge(mem.id, 'updated content', []);
      const after = store.get(mem.id)!;
      expect(after.strength).toBe(1.0);
    });

    it('merge returns null for nonexistent target', () => {
      const result = store.merge('nonexistent-id', 'content', []);
      expect(result).toBeNull();
    });

    it('merge deduplicates tags', () => {
      const mem = store.create({ content: 'content', tags: ['shared', 'tag-a'] });
      store.merge(mem.id, 'new content', ['shared', 'tag-b']);
      const after = store.get(mem.id)!;
      expect(after.tags).toEqual(expect.arrayContaining(['shared', 'tag-a', 'tag-b']));
      expect(after.tags.filter((t: string) => t === 'shared')).toHaveLength(1);
    });

    it('merge validates source tags', () => {
      const mem = store.create({ content: 'content' });
      expect(() => store.merge(mem.id, 'new content', ['Principle'])).toThrow(/did you mean/);
    });

    it('merge updates last_accessed_at', () => {
      const mem = store.create({ content: 'content' });
      const before = mem.lastAccessedAt;
      store.merge(mem.id, 'updated', []);
      const after = store.get(mem.id)!;
      expect(after.lastAccessedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe('reconsolidation', () => {
    it('high-relevance retrieval restores strength by half the gap', () => {
      const mem = store.create({ content: 'important fact' });
      store.resetStrength(mem.id, 0.4);
      store.reconsolidate(mem.id, { relevanceScore: 0.8 });
      const after = store.get(mem.id)!;
      // Expected: 0.4 + (1.0 - 0.4) * 0.5 = 0.7
      expect(after.strength).toBeCloseTo(0.7);
    });

    it('low-relevance retrieval gives smaller strength bump', () => {
      const mem = store.create({ content: 'tangential fact' });
      store.resetStrength(mem.id, 0.4);
      store.reconsolidate(mem.id, { relevanceScore: 0.2 });
      const after = store.get(mem.id)!;
      // Expected: 0.4 + (1.0 - 0.4) * 0.15 = 0.49
      expect(after.strength).toBeCloseTo(0.49);
    });

    it('tracks co-retrieved associations', () => {
      const m1 = store.create({ content: 'memory one' });
      const m2 = store.create({ content: 'memory two' });
      store.reconsolidate(m1.id, {
        relevanceScore: 0.7,
        coRetrievedIds: [m1.id, m2.id],
      });
      const after = store.get(m1.id)!;
      expect(after.associations).toContain(m2.id);
      expect(after.associations).not.toContain(m1.id); // self excluded
    });

    it('increments retrievalCount separately from accessCount', () => {
      const mem = store.create({ content: 'tracked' });
      store.recordAccess(mem.id); // non-retrieval access
      store.reconsolidate(mem.id, { relevanceScore: 0.5 });
      const after = store.get(mem.id)!;
      expect(after.accessCount).toBe(2); // both increment accessCount
      expect(after.retrievalCount).toBe(1); // only reconsolidate increments this
    });

    it('resets last_decay_at on reconsolidation', () => {
      const mem = store.create({ content: 'decay reset test' });
      // Reconsolidate should set last_decay_at to now
      store.reconsolidate(mem.id, { relevanceScore: 0.6 });
      const after = store.get(mem.id)!;
      expect(after.lastDecayAt).toBeGreaterThanOrEqual(mem.createdAt);
    });

    it('stores query context in metadata', () => {
      const mem = store.create({ content: 'query context test' });
      store.reconsolidate(mem.id, {
        relevanceScore: 0.7,
        query: 'test query',
      });
      const after = store.get(mem.id)!;
      expect(after.metadata.lastRetrievalQuery).toBe('test query');
      expect(after.metadata.lastRetrievedAt).toBeTypeOf('number');
    });

    it('caps associations at 20', () => {
      const mem = store.create({ content: 'association cap test' });
      const ids = Array.from({ length: 25 }, (_, i) => `fake-id-${i}`);
      store.reconsolidate(mem.id, {
        relevanceScore: 0.7,
        coRetrievedIds: ids,
      });
      const after = store.get(mem.id)!;
      expect(after.associations.length).toBeLessThanOrEqual(20);
    });

    it('does not crash on nonexistent memory', () => {
      expect(() => {
        store.reconsolidate('nonexistent-id', { relevanceScore: 0.5 });
      }).not.toThrow();
    });

    it('recordAccess does not reset last_decay_at', () => {
      const mem = store.create({ content: 'no decay reset on access' });
      const thirtyDaysAgo = Date.now() - 30 * 86400000;

      // Backdate last_decay_at
      (store as any)._db.prepare(
        'UPDATE memories SET last_decay_at = ? WHERE id = ?'
      ).run(thirtyDaysAgo, mem.id);

      store.recordAccess(mem.id);
      const after = store.get(mem.id)!;
      // last_decay_at should still be the old value (not reset by recordAccess)
      expect(after.lastDecayAt).toBe(thirtyDaysAgo);
    });

    it('new memories have retrievalCount 0 and empty associations', () => {
      const mem = store.create({ content: 'fresh memory' });
      expect(mem.retrievalCount).toBe(0);
      expect(mem.associations).toEqual([]);
    });
  });

  describe('close', () => {
    it('does not throw', () => {
      const s = new MemoryStore({ dbPath: ':memory:' });
      expect(() => s.close()).not.toThrow();
    });
  });
});
