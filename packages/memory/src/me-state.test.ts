/**
 * Tests for me-state.ts
 *
 * Uses an in-memory SQLite store so we exercise the real tag path.
 * Register: beautifully robust — every exported function has a test,
 * corrupted rows are handled gracefully, no silent swallows.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryStore } from './store.js';
import {
  ME_STATE_TAG,
  ME_STATE_CONTENT_PREFIX,
  encodeMeStateContent,
  parseMeStateContent,
  saveMeState,
  loadMeStates,
  loadLatestMeState,
  type MeStatePayload,
} from './me-state.js';

function samplePayload(overrides: Partial<MeStatePayload> = {}): MeStatePayload {
  return {
    ts: '2026-04-21T10:00:00.000Z',
    sessionId: 'sess-a',
    recentActivity: {
      heartbeats: 3,
      dreamCycles: 1,
      lastDream: { phase: 'nrem', ts: '2026-04-21T09:30:00.000Z' },
      errors: 0,
    },
    guardianState: 'calm',
    activeMemoryIds: ['mem-1', 'mem-2'],
    notes: 'warm and composed',
    ...overrides,
  };
}

describe('encodeMeStateContent / parseMeStateContent', () => {
  it('round-trips a payload losslessly', () => {
    const payload = samplePayload();
    const encoded = encodeMeStateContent(payload);
    expect(encoded.startsWith(ME_STATE_CONTENT_PREFIX)).toBe(true);
    expect(parseMeStateContent(encoded)).toEqual(payload);
  });

  it('throws on missing prefix', () => {
    expect(() => parseMeStateContent('{"ts":"2026-04-21T10:00:00.000Z"}')).toThrow(
      /prefix/,
    );
  });

  it('throws on malformed JSON body', () => {
    expect(() => parseMeStateContent(`${ME_STATE_CONTENT_PREFIX}not-json`)).toThrow();
  });

  it('throws when ts is missing from payload', () => {
    expect(() =>
      parseMeStateContent(`${ME_STATE_CONTENT_PREFIX}${JSON.stringify({ notes: 'x' })}`),
    ).toThrow(/ts/);
  });
});

describe('saveMeState', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('persists a memory with me:state tag and parseable content', async () => {
    const id = await saveMeState({ store, payload: samplePayload() });
    const mem = store.get(id);
    expect(mem).not.toBeNull();
    expect(mem!.tags).toContain(ME_STATE_TAG);
    expect(mem!.content.startsWith(ME_STATE_CONTENT_PREFIX)).toBe(true);
    expect(parseMeStateContent(mem!.content).ts).toBe('2026-04-21T10:00:00.000Z');
  });

  it('adds session:<id> tag when sessionId is provided', async () => {
    const id = await saveMeState({
      store,
      payload: samplePayload(),
      sessionId: 'sess-42',
    });
    const mem = store.get(id)!;
    expect(mem.tags).toContain(ME_STATE_TAG);
    expect(mem.tags).toContain('session:sess-42');
    expect(mem.sessionId).toBe('sess-42');
  });

  it('omits the session:<id> tag when sessionId is not provided', async () => {
    const id = await saveMeState({ store, payload: samplePayload() });
    const mem = store.get(id)!;
    expect(mem.tags).toEqual([ME_STATE_TAG]);
    expect(mem.sessionId).toBeNull();
  });

  it('sets mutable:true in metadata', async () => {
    const id = await saveMeState({ store, payload: samplePayload() });
    const mem = store.get(id)!;
    expect(mem.metadata.mutable).toBe(true);
    expect(mem.metadata.meState).toBe(true);
  });

  it("defaults sensitivity to 'sensitive' when not specified", async () => {
    const id = await saveMeState({ store, payload: samplePayload() });
    const mem = store.get(id)!;
    expect(mem.sensitivity).toBe('sensitive');
    const latest = await loadLatestMeState({ store });
    expect(latest!.sensitivity).toBe('sensitive');
  });

  it("honors explicit sensitivity override of 'public'", async () => {
    const id = await saveMeState({
      store,
      payload: samplePayload(),
      sensitivity: 'public',
    });
    const mem = store.get(id)!;
    expect(mem.sensitivity).toBe('public');
  });

  it("honors explicit sensitivity override of 'local-only'", async () => {
    const id = await saveMeState({
      store,
      payload: samplePayload(),
      sensitivity: 'local-only',
    });
    const mem = store.get(id)!;
    expect(mem.sensitivity).toBe('local-only');
  });
});

describe('loadMeStates', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('returns rows newest-first', async () => {
    const firstId = await saveMeState({
      store,
      payload: samplePayload({ notes: 'first' }),
    });
    // SQLite created_at uses Date.now() in ms — ensure strictly increasing timestamps.
    await new Promise((r) => setTimeout(r, 5));
    const secondId = await saveMeState({
      store,
      payload: samplePayload({ notes: 'second' }),
    });
    await new Promise((r) => setTimeout(r, 5));
    const thirdId = await saveMeState({
      store,
      payload: samplePayload({ notes: 'third' }),
    });

    const rows = await loadMeStates({ store });
    expect(rows.map((r) => r.id)).toEqual([thirdId, secondId, firstId]);
    expect(rows.map((r) => r.payload.notes)).toEqual(['third', 'second', 'first']);
  });

  it('filters by sessionId when provided', async () => {
    await saveMeState({
      store,
      payload: samplePayload({ notes: 'a-1' }),
      sessionId: 'sess-A',
    });
    await new Promise((r) => setTimeout(r, 5));
    const bId = await saveMeState({
      store,
      payload: samplePayload({ notes: 'b-1' }),
      sessionId: 'sess-B',
    });
    await new Promise((r) => setTimeout(r, 5));
    await saveMeState({
      store,
      payload: samplePayload({ notes: 'a-2' }),
      sessionId: 'sess-A',
    });

    const onlyB = await loadMeStates({ store, sessionId: 'sess-B' });
    expect(onlyB).toHaveLength(1);
    expect(onlyB[0].id).toBe(bId);
    expect(onlyB[0].payload.notes).toBe('b-1');

    const onlyA = await loadMeStates({ store, sessionId: 'sess-A' });
    expect(onlyA).toHaveLength(2);
    expect(onlyA.map((r) => r.payload.notes)).toEqual(['a-2', 'a-1']);
  });

  it('respects the limit option', async () => {
    for (let i = 0; i < 5; i++) {
      await saveMeState({ store, payload: samplePayload({ notes: `n-${i}` }) });
      await new Promise((r) => setTimeout(r, 2));
    }
    const rows = await loadMeStates({ store, limit: 2 });
    expect(rows).toHaveLength(2);
  });

  it('returns empty array when no snapshots exist', async () => {
    const rows = await loadMeStates({ store });
    expect(rows).toEqual([]);
  });

  it('tolerates corrupted content — parses what it can, skips junk, logs warning', async () => {
    // Save one valid snapshot.
    const goodId = await saveMeState({ store, payload: samplePayload({ notes: 'good' }) });
    await new Promise((r) => setTimeout(r, 5));
    // Now inject a memory carrying the me:state tag but with non-parseable content.
    // This mimics schema drift from a prior version.
    const bad = store.create({
      content: '[me:state] not-valid-json',
      tags: [ME_STATE_TAG],
      metadata: { mutable: true },
    });
    await new Promise((r) => setTimeout(r, 5));
    const newerGoodId = await saveMeState({
      store,
      payload: samplePayload({ notes: 'newer-good' }),
    });

    const log = vi.fn();
    const rows = await loadMeStates({ store, log });

    // Two good snapshots survive; bad row is skipped.
    expect(rows.map((r) => r.id)).toEqual([newerGoodId, goodId]);
    expect(rows.every((r) => r.payload.ts)).toBe(true);

    // Structured log line emitted for the bad row.
    const logged = log.mock.calls.map((c) => c[0] as string);
    expect(logged.some((line) => line.includes('[me-state]') && line.includes(bad.id))).toBe(
      true,
    );
  });
});

describe('loadLatestMeState', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('returns null when no snapshot exists', async () => {
    expect(await loadLatestMeState({ store })).toBeNull();
  });

  it('returns the single newest snapshot', async () => {
    await saveMeState({ store, payload: samplePayload({ notes: 'old' }) });
    await new Promise((r) => setTimeout(r, 5));
    const newestId = await saveMeState({
      store,
      payload: samplePayload({ notes: 'new' }),
    });
    const latest = await loadLatestMeState({ store });
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(newestId);
    expect(latest!.payload.notes).toBe('new');
  });

  it('session-scoped latest ignores other sessions', async () => {
    const aId = await saveMeState({
      store,
      payload: samplePayload({ notes: 'A' }),
      sessionId: 'sess-A',
    });
    await new Promise((r) => setTimeout(r, 5));
    // Newer in a different session — should NOT be returned for sess-A.
    await saveMeState({
      store,
      payload: samplePayload({ notes: 'B-newer' }),
      sessionId: 'sess-B',
    });

    const latestA = await loadLatestMeState({ store, sessionId: 'sess-A' });
    expect(latestA!.id).toBe(aId);
    expect(latestA!.payload.notes).toBe('A');
  });
});

describe('round-trip integration', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('save -> load returns an equal payload', async () => {
    const payload = samplePayload({
      notes: 'integration-roundtrip',
      recentActivity: {
        heartbeats: 42,
        dreamCycles: 7,
        lastDream: { phase: 'rem', ts: '2026-04-21T11:11:11.000Z' },
        errors: 1,
      },
    });
    await saveMeState({ store, payload, sessionId: 'sess-rt' });

    const latest = await loadLatestMeState({ store, sessionId: 'sess-rt' });
    expect(latest).not.toBeNull();
    expect(latest!.payload).toEqual(payload);
  });
});
