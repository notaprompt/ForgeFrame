import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from './store.js';
import { findDuplicate } from './dedup.js';

describe('findDuplicate', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  it('returns null when no duplicate exists', () => {
    store.create({ content: 'unique memory about cats' });
    const result = findDuplicate(store, 'completely different topic about cars');
    expect(result).toBeNull();
  });

  it('returns the duplicate when content is near-identical', () => {
    const original = store.create({ content: 'ForgeFrame uses SQLite for storage' });
    const result = findDuplicate(store, 'ForgeFrame uses SQLite for its storage backend');
    expect(result).not.toBeNull();
    expect(result!.id).toBe(original.id);
  });
});
