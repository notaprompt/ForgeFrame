import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryStore } from './store.js';
import { MemoryRetriever, MAX_NEIGHBORS } from './retrieval.js';
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

  it('search finds memories matching any term, not just all terms', async () => {
    store.create({ content: 'the quick brown fox' });
    store.create({ content: 'the lazy dog sleeps' });

    const results = await retriever.query({ text: 'quick dog' });
    // Should find both -- OR semantics, not AND
    expect(results.length).toBe(2);
  });

  it('search supports prefix matching', async () => {
    store.create({ content: 'consolidation engine architecture' });

    const results = await retriever.query({ text: 'consol' });
    expect(results.length).toBeGreaterThan(0);
  });
});

const ENRICH_DB = `/tmp/forgeframe-retrieval-enrich-test-${Date.now()}.db`;

describe('Search enrichment (validity + neighbors, v1)', () => {
  let store: MemoryStore;
  let retriever: MemoryRetriever;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ENRICH_DB });
    retriever = new MemoryRetriever(store);
  });

  afterEach(() => {
    store.close();
    try { unlinkSync(ENRICH_DB); } catch {}
    try { unlinkSync(ENRICH_DB + '-wal'); } catch {}
    try { unlinkSync(ENRICH_DB + '-shm'); } catch {}
  });

  it('returns validity: 1 when memory has no inbound supersedes edges', () => {
    store.create({ content: 'validity one canonical current memory' });
    const results = retriever.query({ text: 'validity canonical current' });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.validity).toBe(1);
    }
  });

  it('returns validity: 0 when a newer memory supersedes this one', () => {
    const older = store.create({ content: 'older superseded claim about strudel sessions' });
    const newer = store.create({ content: 'newer canonical claim about strudel sessions' });
    // store.supersede creates an edge (source=newer, target=older, type=supersedes)
    store.supersede(older.id, newer.id);

    const results = retriever.query({ text: 'strudel sessions claim' });
    const olderResult = results.find((r) => r.memory.id === older.id);
    const newerResult = results.find((r) => r.memory.id === newer.id);
    expect(olderResult).toBeDefined();
    expect(olderResult!.validity).toBe(0);
    // the newer one has an OUTBOUND supersedes edge, not inbound → still valid
    if (newerResult) {
      expect(newerResult.validity).toBe(1);
    }
  });

  it('returns neighbors: [] for an isolated memory with no edges', () => {
    store.create({ content: 'isolated unicorn memory without any edges' });
    const results = retriever.query({ text: 'isolated unicorn' });
    expect(results.length).toBeGreaterThan(0);
    const hit = results.find((r) => r.memory.content.includes('isolated unicorn'));
    expect(hit).toBeDefined();
    expect(hit!.neighbors).toEqual([]);
  });

  it('returns neighbors with connected memory ids (outbound + inbound)', () => {
    const center = store.create({ content: 'neighbor-test center node alpha' });
    const outTarget = store.create({ content: 'outbound neighbor node beta' });
    const inSource = store.create({ content: 'inbound neighbor node gamma' });

    // Outbound edge: center → outTarget
    store.createEdge({ sourceId: center.id, targetId: outTarget.id, relationType: 'related', weight: 0.5 });
    // Inbound edge: inSource → center
    store.createEdge({ sourceId: inSource.id, targetId: center.id, relationType: 'related', weight: 0.8 });

    const results = retriever.query({ text: 'neighbor-test center alpha' });
    const hit = results.find((r) => r.memory.id === center.id);
    expect(hit).toBeDefined();
    expect(hit!.neighbors).toContain(outTarget.id);
    expect(hit!.neighbors).toContain(inSource.id);
    // Inbound edge has higher weight (0.8 vs 0.5) → should rank first
    expect(hit!.neighbors[0]).toBe(inSource.id);
    expect(hit!.neighbors).toHaveLength(2);
  });

  it('caps neighbors at MAX_NEIGHBORS (10) even when more edges exist', () => {
    const center = store.create({ content: 'highly-connected hub memory for neighbor cap test' });
    const neighborIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const neighbor = store.create({ content: `satellite memory number ${i} for neighbor cap test` });
      neighborIds.push(neighbor.id);
      // Varying weights so ranking matters
      store.createEdge({
        sourceId: center.id,
        targetId: neighbor.id,
        relationType: 'related',
        weight: (i + 1) / 20,
      });
    }

    const results = retriever.query({ text: 'highly-connected hub neighbor cap' });
    const hit = results.find((r) => r.memory.id === center.id);
    expect(hit).toBeDefined();
    expect(hit!.neighbors).toHaveLength(MAX_NEIGHBORS);
    expect(MAX_NEIGHBORS).toBe(10);
    // Highest weight first (neighbor 19 had weight 1.0)
    expect(hit!.neighbors[0]).toBe(neighborIds[19]);
  });

  it('semanticQuery also enriches results with validity + neighbors', async () => {
    const older = store.create({ content: 'semantic older vista obsolete claim' });
    const newer = store.create({ content: 'semantic newer vista replacement claim' });
    store.supersede(older.id, newer.id);

    const results = await retriever.semanticQuery({ text: 'semantic vista claim' });
    const olderResult = results.find((r) => r.memory.id === older.id);
    expect(olderResult).toBeDefined();
    expect(olderResult!.validity).toBe(0);
    // The supersedes edge is itself a neighbor link → newer should appear in older's neighbors
    expect(olderResult!.neighbors).toContain(newer.id);
  });

  it('gracefully handles edge-query failures (returns safe defaults, logs warning)', async () => {
    const mem = store.create({ content: 'graceful failure resilience test memory' });
    // Use semanticQuery for this test — query() also uses getEdges for its
    // graph-walk seed step, so mocking getEdges globally would break the
    // search itself. semanticQuery only touches edges via _enrichResult.
    const originalGetEdges = store.getEdges.bind(store);
    const getEdgesSpy = vi.spyOn(store, 'getEdges').mockImplementation((id: string) => {
      if (id === mem.id) throw new Error('simulated edge index corruption');
      return originalGetEdges(id);
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const results = await retriever.semanticQuery({ text: 'graceful failure resilience' });
    const hit = results.find((r) => r.memory.id === mem.id);
    expect(hit).toBeDefined();
    // Safe defaults on failure
    expect(hit!.validity).toBe(1);
    expect(hit!.neighbors).toEqual([]);
    // Structured warning was logged
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[search] edge query failed for memory ${mem.id}`)
    );

    getEdgesSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
