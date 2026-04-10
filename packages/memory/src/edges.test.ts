import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { unlinkSync } from 'fs';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { Memory } from './types.js';

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

describe('Edge CRUD', () => {
  let store: MemoryStore;
  let memA: string;
  let memB: string;
  let memC: string;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: TEST_DB });
    memA = store.create({ content: 'memory A' }).id;
    memB = store.create({ content: 'memory B' }).id;
    memC = store.create({ content: 'memory C' }).id;
  });

  afterEach(() => {
    store.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_DB + '-wal'); } catch {}
    try { unlinkSync(TEST_DB + '-shm'); } catch {}
  });

  it('creates an edge', () => {
    const edge = store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    expect(edge.sourceId).toBe(memA);
    expect(edge.targetId).toBe(memB);
    expect(edge.relationType).toBe('led-to');
    expect(edge.weight).toBe(1.0);
  });

  it('enforces unique constraint on source+target+type', () => {
    store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    expect(() => store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' })).toThrow();
  });

  it('allows different relation types between same nodes', () => {
    store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    const e2 = store.createEdge({ sourceId: memA, targetId: memB, relationType: 'similar' });
    expect(e2.relationType).toBe('similar');
  });

  it('lists edges for a memory (both directions)', () => {
    store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    store.createEdge({ sourceId: memC, targetId: memA, relationType: 'similar' });
    expect(store.getEdges(memA)).toHaveLength(2);
  });

  it('deletes an edge', () => {
    const edge = store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    expect(store.deleteEdge(edge.id)).toBe(true);
    expect(store.getEdges(memA)).toHaveLength(0);
  });

  it('cascades edge deletion when memory is deleted', () => {
    store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    store.delete(memA);
    expect(store.getEdges(memB)).toHaveLength(0);
  });

  it('traverses N hops from a node', () => {
    store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    store.createEdge({ sourceId: memB, targetId: memC, relationType: 'led-to' });
    const sub = store.getSubgraph(memA, 2);
    expect(sub.nodes).toHaveLength(3);
    expect(sub.edges).toHaveLength(2);
  });

  it('limits traversal to requested hops', () => {
    store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    store.createEdge({ sourceId: memB, targetId: memC, relationType: 'led-to' });
    const sub = store.getSubgraph(memA, 1);
    expect(sub.nodes).toHaveLength(2);
    expect(sub.edges).toHaveLength(1);
  });

  it('returns edge count', () => {
    store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    store.createEdge({ sourceId: memA, targetId: memC, relationType: 'similar' });
    expect(store.edgeCount()).toBe(2);
  });

  it('supersedes a memory', () => {
    const m2 = store.create({ content: 'updated A' });
    store.supersede(memA, m2.id);
    const chain = store.getSupersessionChain(m2.id);
    expect(chain).toHaveLength(2);
    expect(chain[0].id).toBe(m2.id);
    expect(chain[1].id).toBe(memA);
  });

  it('promotes a memory to artifact', () => {
    const promoted = store.promote(memA);
    expect(promoted!.memoryType).toBe('artifact');
    expect(promoted!.readiness).toBe(0);
  });

  it('lists artifact memories', () => {
    store.promote(memA);
    const artifacts = store.getArtifactMemories();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].id).toBe(memA);
  });

  it('auto-links based on FTS overlap', () => {
    const m1 = store.create({ content: 'ForgeFrame sovereign memory architecture design' });
    const m2 = store.create({ content: 'ForgeFrame memory layer architecture and design patterns' });
    store.create({ content: 'completely unrelated topic about cooking recipes' });
    const count = store.autoLink(m2.id);
    expect(count).toBeGreaterThanOrEqual(1);
    const edges = store.getEdges(m2.id);
    const linkedIds = edges.map(e => e.sourceId === m2.id ? e.targetId : e.sourceId);
    expect(linkedIds).toContain(m1.id);
  });

  it('returns orphan count', () => {
    // memA, memB, memC have no edges = all orphans
    expect(store.orphanCount()).toBe(3);
    store.createEdge({ sourceId: memA, targetId: memB, relationType: 'led-to' });
    expect(store.orphanCount()).toBe(1); // only memC is orphan
  });

  it('returns contradiction count', () => {
    expect(store.contradictionCount()).toBe(0);
    store.createEdge({ sourceId: memA, targetId: memB, relationType: 'contradicts' });
    expect(store.contradictionCount()).toBe(1);
  });
});
