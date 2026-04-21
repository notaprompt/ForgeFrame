/**
 * Tests for session_start hydration (Phase 3 Task 3.2).
 *
 * session_start now returns a hydration payload composed of the latest
 * me:state snapshot plus roadmap buckets (entrenched, active, drifting).
 * Hydration is a bonus on top of session creation — it must NEVER fail
 * the session_start call.
 *
 * Register: beautifully robust — every new function tested, graceful
 * failure, backwards-compatible response shape.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import {
  MemoryStore,
  MemoryRetriever,
  saveMeState,
  type MemoryStore as MemoryStoreType,
  type Embedder,
  type Generator,
  type Session,
  type MeStatePayload,
} from '@forgeframe/memory';
import { ProvenanceLogger } from './provenance.js';
import { ServerEvents } from './events.js';
import type { ServerConfig } from './config.js';
import { registerTools, buildSessionHydration } from './tools.js';

type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    handlers,
    tool(name: string, _desc: string, _schema: unknown, handler: ToolHandler) {
      handlers.set(name, handler);
    },
  };
}

// Minimal generator stub — session_start doesn't call it, but registerTools
// constructs engines that take it.
function createStubGenerator(): Generator {
  return {
    generate: async () => ({ text: '', model: 'stub', durationMs: 0 }),
  } as unknown as Generator;
}

function createStubEmbedder(): Embedder {
  return {
    embed: async () => null,
  } as unknown as Embedder;
}

function createStubConfig(provPath: string): ServerConfig {
  return {
    dbPath: ':memory:',
    decayOnStartup: false,
    provenancePath: provPath,
    serverName: 'test',
    serverVersion: '0.0.0',
    ollamaUrl: 'http://localhost:11434',
    embeddingModel: 'nomic-embed-text',
  };
}

function setupTools(store: MemoryStoreType, session: Session, provPath: string) {
  const mockServer = createMockServer();
  const embedder = createStubEmbedder();
  const generator = createStubGenerator();
  const retriever = new MemoryRetriever(store, embedder);
  const provenance = new ProvenanceLogger(provPath);
  const events = new ServerEvents();
  const config = createStubConfig(provPath);

  registerTools(
    mockServer as unknown as Parameters<typeof registerTools>[0],
    store,
    retriever,
    embedder,
    generator,
    provenance,
    events,
    config,
    session,
  );

  return mockServer;
}

function samplePayload(overrides: Partial<MeStatePayload> = {}): MeStatePayload {
  return {
    ts: '2026-04-21T10:00:00.000Z',
    sessionId: 'sess-a',
    guardianState: 'calm',
    notes: 'warm and composed',
    ...overrides,
  };
}

describe('buildSessionHydration', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    try { store.close(); } catch { /* ignore */ }
  });

  it('returns an empty payload when store is empty', async () => {
    const hydration = await buildSessionHydration({ store, log: () => {} });

    expect(hydration.me).toBeNull();
    expect(hydration.entrenched).toEqual([]);
    expect(hydration.active).toEqual([]);
    expect(hydration.drifting).toEqual([]);
  });

  it('returns latest me:state when one has been saved', async () => {
    const payload = samplePayload({ notes: 'latest snapshot' });
    await saveMeState({ store, payload });

    const hydration = await buildSessionHydration({ store, log: () => {} });

    expect(hydration.me).not.toBeNull();
    expect(hydration.me?.notes).toBe('latest snapshot');
  });

  it('returns the most recent me:state when several exist', async () => {
    await saveMeState({ store, payload: samplePayload({ ts: '2026-04-20T00:00:00.000Z', notes: 'older' }) });
    // Wait one tick so createdAt differs deterministically.
    await new Promise((r) => setTimeout(r, 5));
    await saveMeState({ store, payload: samplePayload({ ts: '2026-04-21T00:00:00.000Z', notes: 'newer' }) });

    const hydration = await buildSessionHydration({ store, log: () => {} });
    expect(hydration.me?.notes).toBe('newer');
  });

  it('populates entrenched bucket when constitutional memories exist', async () => {
    store.create({ content: 'first principle: sovereignty', tags: ['principle'] });
    store.create({ content: 'voice note', tags: ['voice'] });

    const hydration = await buildSessionHydration({ store, log: () => {} });
    expect(hydration.entrenched.length).toBeGreaterThanOrEqual(2);
    // Shape assertions — compact form only.
    const first = hydration.entrenched[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('content');
    expect(first).toHaveProperty('strength');
    expect(first).toHaveProperty('tags');
    expect(first).toHaveProperty('createdAt');
    expect(first).toHaveProperty('lastAccessedAt');
  });

  it('populates active bucket with recently created non-entrenched memories', async () => {
    // Fresh memories start at strength 1.0 which lands them in entrenched.
    // Decay below the entrenched threshold (0.85) so they land in active.
    const a = store.create({ content: 'working thought A' });
    const b = store.create({ content: 'working thought B' });
    store.resetStrength(a.id, 0.5);
    store.resetStrength(b.id, 0.5);

    const hydration = await buildSessionHydration({ store, log: () => {} });
    expect(hydration.active.length).toBeGreaterThanOrEqual(2);
  });

  it('caps buckets at maxPerBucket', async () => {
    // Exceed the cap with principle-tagged memories so they all land entrenched.
    for (let i = 0; i < 15; i++) {
      store.create({ content: `principle ${i}`, tags: ['principle'] });
    }

    const hydration = await buildSessionHydration({ store, maxPerBucket: 5, log: () => {} });
    expect(hydration.entrenched.length).toBe(5);
  });

  it('returns empty payload when loadLatestMeState throws (graceful failure)', async () => {
    // Simulate a store that throws on listByTag (which loadLatestMeState uses)
    // but still works for getRecent (which buildRoadmap uses).
    const brokenStore = Object.create(store) as MemoryStore;
    (brokenStore as unknown as { listByTag: MemoryStore['listByTag'] }).listByTag = () => {
      throw new Error('simulated me:state failure');
    };

    const logged: string[] = [];
    const hydration = await buildSessionHydration({
      store: brokenStore,
      log: (line) => logged.push(line),
    });

    expect(hydration.me).toBeNull();
    // Roadmap path is untouched, so those buckets still populate/empty normally.
    expect(hydration.entrenched).toEqual([]);
    expect(hydration.active).toEqual([]);
    expect(hydration.drifting).toEqual([]);
    expect(logged.some((l) => l.includes('[session_start]') && l.includes('me:state'))).toBe(true);
  });

  it('returns empty payload when buildRoadmap throws (graceful failure)', async () => {
    const brokenStore = Object.create(store) as MemoryStore;
    (brokenStore as unknown as { getRecent: MemoryStore['getRecent'] }).getRecent = () => {
      throw new Error('simulated roadmap failure');
    };

    const logged: string[] = [];
    const hydration = await buildSessionHydration({
      store: brokenStore,
      log: (line) => logged.push(line),
    });

    expect(hydration.entrenched).toEqual([]);
    expect(hydration.active).toEqual([]);
    expect(hydration.drifting).toEqual([]);
    expect(logged.some((l) => l.includes('[session_start]') && l.includes('roadmap'))).toBe(true);
  });

  it('truncates long content to 200 chars in hydration memories', async () => {
    const long = 'x'.repeat(500);
    store.create({ content: long, tags: ['principle'] });

    const hydration = await buildSessionHydration({ store, log: () => {} });
    const mem = hydration.entrenched.find((m) => m.content.startsWith('x'));
    expect(mem?.content.length).toBe(200);
  });
});

describe('session_start tool (hydration integration)', () => {
  let store: MemoryStore;
  let session: Session;
  let provPath: string;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
    session = store.startSession();
    provPath = join(tmpdir(), `srv-prov-${randomUUID()}.jsonl`);
  });

  afterEach(() => {
    try { store.close(); } catch { /* ignore */ }
    try { unlinkSync(provPath); } catch { /* ignore */ }
  });

  it('returns a session with a hydration field (backwards-compatible addition)', async () => {
    const mock = setupTools(store, session, provPath);
    const handler = mock.handlers.get('session_start')!;
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    // Original session fields must still be present.
    expect(parsed.id).toBeTypeOf('string');
    expect(parsed.startedAt).toBeTypeOf('number');

    // Hydration addition.
    expect(parsed.hydration).toBeDefined();
    expect(parsed.hydration.me).toBeNull();
    expect(parsed.hydration.entrenched).toEqual([]);
    expect(parsed.hydration.active).toEqual([]);
    expect(parsed.hydration.drifting).toEqual([]);
  });

  it('hydration includes latest me:state + roadmap buckets when memories exist', async () => {
    store.create({ content: 'sovereignty is architectural', tags: ['principle'] });
    const working = store.create({ content: 'working note just now' });
    store.resetStrength(working.id, 0.5); // drop below entrenched threshold
    await saveMeState({ store, payload: samplePayload({ notes: 'boot context' }) });

    const mock = setupTools(store, session, provPath);
    const handler = mock.handlers.get('session_start')!;
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.hydration.me).not.toBeNull();
    expect(parsed.hydration.me.notes).toBe('boot context');
    expect(parsed.hydration.entrenched.length).toBeGreaterThanOrEqual(1);
    expect(parsed.hydration.active.length).toBeGreaterThanOrEqual(1);
  });

  it('creates the new session even if hydration helpers throw', async () => {
    // Wrap store so roadmap & me:state paths both fail but startSession works.
    const wrapped: MemoryStore = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === 'getRecent' || prop === 'listByTag') {
          return () => { throw new Error('simulated hydration failure'); };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }) as MemoryStore;

    const mock = setupTools(wrapped, session, provPath);
    const handler = mock.handlers.get('session_start')!;
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    // Session still created — hydration failing must not break session_start.
    expect(parsed.id).toBeTypeOf('string');
    expect(parsed.startedAt).toBeTypeOf('number');
    expect(parsed.hydration).toBeDefined();
    expect(parsed.hydration.me).toBeNull();
    expect(parsed.hydration.entrenched).toEqual([]);
    expect(parsed.hydration.active).toEqual([]);
    expect(parsed.hydration.drifting).toEqual([]);
  });
});
