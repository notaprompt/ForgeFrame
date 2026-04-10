import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { unlinkSync } from 'fs';

const TEST_DB = `/tmp/forgeframe-edges-test-${Date.now()}.db`;

describe('Migration 5: edges + temporal', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: TEST_DB });
  });

  afterEach(() => {
    store.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_DB + '-wal'); } catch {}
    try { unlinkSync(TEST_DB + '-shm'); } catch {}
  });

  it('creates memory_edges table', () => {
    const tables = (store as any)._db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_edges'"
    ).all();
    expect(tables).toHaveLength(1);
  });

  it('adds temporal columns to memories', () => {
    const mem = store.create({ content: 'test temporal' });
    expect(mem.memoryType).toBe('semantic');
    expect(mem.readiness).toBe(0);
  });
});
