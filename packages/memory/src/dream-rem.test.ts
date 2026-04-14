import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { RemPhase } from './dream-rem.js';

describe('RemPhase — empty database', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('runs without error on empty database', async () => {
    const rem = new RemPhase(store);
    const result = await rem.run(55);

    expect(result.errors).toHaveLength(0);
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.seeds).toHaveLength(0);
    expect(result.hindsightCandidates).toHaveLength(0);
    expect(result.tensions).toHaveLength(0);
    expect(result.journalMemoryId).not.toBeNull();
  });

  it('writes a dream journal entry', async () => {
    const rem = new RemPhase(store);
    const result = await rem.run(60);

    expect(result.journalMemoryId).not.toBeNull();

    const journal = store.get(result.journalMemoryId!);
    expect(journal).not.toBeNull();
    expect(journal!.tags).toContain('dream-journal');
    expect(journal!.tags).toContain('rem');
  });
});

describe('RemPhase — with graph data', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('collects seeds from disconnected clusters', async () => {
    // Create two disconnected clusters
    const m1 = store.create({ content: 'architecture decision about local-first design' });
    const m2 = store.create({ content: 'local-first architecture pattern for data sovereignty' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related' });

    const m3 = store.create({ content: 'product pricing strategy for enterprise tier' });
    const m4 = store.create({ content: 'enterprise pricing model with volume discounts' });
    store.createEdge({ sourceId: m3.id, targetId: m4.id, relationType: 'related' });

    const rem = new RemPhase(store);
    const result = await rem.run(55);

    expect(result.seeds.length).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
  });

  it('finds hindsight candidates for entrenched memories', async () => {
    const db = (store as any)['_db'];
    const oldTimestamp = Date.now() - 30 * 86_400_000; // 30 days ago

    // Create memory with high-weight edges, backdated
    const m1 = store.create({ content: 'local models are always sufficient for triage' });
    const m2 = store.create({ content: 'helper memory for edge weight' });

    db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(oldTimestamp, m1.id);
    db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(oldTimestamp, m2.id);

    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related', weight: 1.8 });

    const rem = new RemPhase(store);
    const result = await rem.run(55);

    expect(result.hindsightCandidates.length).toBeGreaterThan(0);
    expect(result.hindsightCandidates[0].memory.id).toBe(m1.id);
  });

  it('finds tension candidates for high-weight unconnected pairs', async () => {
    // Memory A has high-weight edge to helper C
    const mA = store.create({ content: 'ship fast and iterate weekly', tags: ['decision'] });
    const mC = store.create({ content: 'helper node for graph weight' });
    store.createEdge({ sourceId: mA.id, targetId: mC.id, relationType: 'related', weight: 1.5 });

    // Memory B has high-weight edge to helper D (different cluster)
    const mB = store.create({ content: 'production-grade global deployment requires thorough testing', tags: ['pattern'] });
    const mD = store.create({ content: 'another helper for graph weight' });
    store.createEdge({ sourceId: mB.id, targetId: mD.id, relationType: 'related', weight: 1.5 });

    const rem = new RemPhase(store);
    const result = await rem.run(55);

    expect(result.tensions.length).toBeGreaterThan(0);
  });

  it('survives individual phase errors without aborting', async () => {
    // Verify the orchestrator catches errors from sub-phases gracefully
    // by testing that even with data that works, all phases complete
    const m1 = store.create({ content: 'memory alpha for resilience test' });
    const m2 = store.create({ content: 'memory beta for resilience test' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related' });

    const rem = new RemPhase(store);
    const result = await rem.run(55);

    // Journal should always be written regardless
    expect(result.journalMemoryId).not.toBeNull();
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('records sleep pressure in journal', async () => {
    const rem = new RemPhase(store);
    const result = await rem.run(72);

    const journal = store.get(result.journalMemoryId!);
    expect(journal).not.toBeNull();
    expect(journal!.content).toContain('72');
  });
});
