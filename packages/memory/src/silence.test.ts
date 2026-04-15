import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { findGoneQuiet } from './silence.js';

const MS_PER_DAY = 86_400_000;

describe('Silence Detection', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  function setAccess(id: string, lastAccessedAt: number, accessCount: number): void {
    const db = (store as any)['_db'];
    db.prepare('UPDATE memories SET last_accessed_at = ?, access_count = ? WHERE id = ?')
      .run(lastAccessedAt, accessCount, id);
  }

  it('empty database returns no silence entries', () => {
    const result = findGoneQuiet(store);
    expect(result).toEqual([]);
  });

  it('recently accessed tags do not appear', () => {
    const m = store.create({ content: 'active topic', tags: ['observation'] });
    setAccess(m.id, Date.now() - 5 * MS_PER_DAY, 10);

    const result = findGoneQuiet(store);
    expect(result).toEqual([]);
  });

  it('tag with sufficient prior access that exceeded window appears', () => {
    const m1 = store.create({ content: 'old topic A', tags: ['thread'] });
    const m2 = store.create({ content: 'old topic B', tags: ['thread'] });
    const oldTime = Date.now() - 50 * MS_PER_DAY;
    setAccess(m1.id, oldTime, 3);
    setAccess(m2.id, oldTime - MS_PER_DAY, 2);

    const result = findGoneQuiet(store);
    expect(result).toHaveLength(1);
    expect(result[0].tag).toBe('thread');
    expect(result[0].priorAccessCount).toBe(5);
    expect(result[0].silentDays).toBeGreaterThanOrEqual(50);
  });

  it('constitutional tags (principle, voice) excluded even if silent', () => {
    const m1 = store.create({ content: 'sovereignty matters', tags: ['principle'] });
    const m2 = store.create({ content: 'speak plainly', tags: ['voice'] });
    const oldTime = Date.now() - 90 * MS_PER_DAY;
    setAccess(m1.id, oldTime, 10);
    setAccess(m2.id, oldTime, 10);

    const result = findGoneQuiet(store);
    expect(result).toEqual([]);
  });

  it('dream-journal tags excluded', () => {
    const m = store.create({ content: 'dream entry', tags: ['dream-journal'] });
    const oldTime = Date.now() - 60 * MS_PER_DAY;
    setAccess(m.id, oldTime, 5);

    const result = findGoneQuiet(store);
    expect(result).toEqual([]);
  });

  it('tags with only 1 total access excluded (never truly active)', () => {
    const m = store.create({ content: 'one-off thought', tags: ['skill'] });
    const oldTime = Date.now() - 60 * MS_PER_DAY;
    setAccess(m.id, oldTime, 1);

    const result = findGoneQuiet(store);
    expect(result).toEqual([]);
  });

  it('multiple quiet tags sorted by silentDays descending', () => {
    const m1 = store.create({ content: 'older topic', tags: ['decision'] });
    const m2 = store.create({ content: 'less old topic', tags: ['pattern'] });

    setAccess(m1.id, Date.now() - 90 * MS_PER_DAY, 5);
    setAccess(m2.id, Date.now() - 50 * MS_PER_DAY, 4);

    const result = findGoneQuiet(store);
    expect(result).toHaveLength(2);
    expect(result[0].tag).toBe('decision');
    expect(result[1].tag).toBe('pattern');
    expect(result[0].silentDays).toBeGreaterThan(result[1].silentDays);
  });

  it('custom windowDays parameter respected', () => {
    const m = store.create({ content: 'medium old', tags: ['evaluation'] });
    setAccess(m.id, Date.now() - 20 * MS_PER_DAY, 5);

    // Default window (42 days) -- should NOT appear
    expect(findGoneQuiet(store)).toEqual([]);

    // Custom window (14 days) -- should appear
    const result = findGoneQuiet(store, 14);
    expect(result).toHaveLength(1);
    expect(result[0].tag).toBe('evaluation');
  });

  it('custom minPriorAccess parameter respected', () => {
    const m = store.create({ content: 'low access topic', tags: ['milestone'] });
    setAccess(m.id, Date.now() - 60 * MS_PER_DAY, 2);

    // Default minPriorAccess (3) -- should NOT appear
    expect(findGoneQuiet(store)).toEqual([]);

    // Custom minPriorAccess (2) -- should appear
    const result = findGoneQuiet(store, 42, 2);
    expect(result).toHaveLength(1);
    expect(result[0].tag).toBe('milestone');
  });
});
