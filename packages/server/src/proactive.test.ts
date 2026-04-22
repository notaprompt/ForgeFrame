/**
 * Proactive Creature — tests.
 *
 * Covers the six required behaviors from the spec plus a few sharp-edge
 * invariants (first-seen guardian state doesn't push, calm transitions
 * don't push, stop() is idempotent). Push is dependency-injected so we
 * never hit the real ntfy endpoint.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '@forgeframe/memory';
import type { NremResult, RemResult, GuardianTemperature } from '@forgeframe/memory';
import { ServerEvents } from './events.js';
import {
  startProactive,
  nremIsMeaningful,
  remIsMeaningful,
  runMorningDigest,
  runEveningReflection,
} from './proactive.js';

function makeStore(): MemoryStore {
  // in-memory SQLite — no filesystem side effects
  return new MemoryStore({ dbPath: ':memory:' });
}

function makeNrem(partial: Partial<NremResult> = {}): NremResult {
  return {
    duration: 100,
    edgesPruned: 0,
    decayApplied: false,
    clustersFound: 0,
    dedupProposals: 0,
    valenceBackfilled: 0,
    sourceCalibration: [],
    silence: [],
    drift: [],
    errors: [],
    ...partial,
  };
}

function makeRem(partial: Partial<RemResult> = {}): RemResult {
  return {
    duration: 100,
    seeds: [],
    hindsightCandidates: [],
    tensions: [],
    journalMemoryId: null,
    errors: [],
    ...partial,
  };
}

function makeGuardian(state: GuardianTemperature['state'], value = 0.5): GuardianTemperature {
  return {
    value,
    state,
    signals: {
      contradictionPressure: 0,
      entropyDelta: 0,
      pruneRate: 0,
      embeddingFailureRate: 0,
      deadEdgeRatio: 0,
      trappedArtifactRatio: 0,
      skepticSkipRate: 0,
    } as unknown as GuardianTemperature['signals'],
    computedAt: Date.now(),
  };
}

describe('proactive creature', () => {
  let store: MemoryStore;
  let events: ServerEvents;
  let sendPush: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = makeStore();
    events = new ServerEvents();
    sendPush = vi.fn().mockResolvedValue(undefined);
    log = vi.fn();
  });

  afterEach(() => {
    store.close();
  });

  // -- Test 1: stop() fully tears down ---------------------------------

  it('startProactive returns a stop() that releases timers and subscriptions', async () => {
    const stop = startProactive({
      store,
      events,
      config: { sendPush, log, dreamRateLimitMs: 0 },
    });

    // Before stop: a meaningful nrem pushes.
    events.emit('dream:nrem:complete', makeNrem({ edgesPruned: 50 }));
    await new Promise((r) => setImmediate(r));
    expect(sendPush).toHaveBeenCalledTimes(1);

    // After stop: no more pushes, no listeners.
    stop();
    events.emit('dream:nrem:complete', makeNrem({ edgesPruned: 999 }));
    await new Promise((r) => setImmediate(r));
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(events.listenerCount('dream:nrem:complete')).toBe(0);
    expect(events.listenerCount('dream:rem:complete')).toBe(0);
    expect(events.listenerCount('guardian:update')).toBe(0);

    // stop() is idempotent — second call must not throw.
    expect(() => stop()).not.toThrow();
  });

  // -- Test 2: NREM threshold ------------------------------------------

  it('NREM with edgesPruned >= 20 pushes; below threshold does not', async () => {
    const stop = startProactive({
      store,
      events,
      config: { sendPush, log, dreamRateLimitMs: 0 },
    });

    // below threshold, no clusters → no push
    events.emit('dream:nrem:complete', makeNrem({ edgesPruned: 5, clustersFound: 0 }));
    await new Promise((r) => setImmediate(r));
    expect(sendPush).not.toHaveBeenCalled();

    // at threshold → push
    events.emit('dream:nrem:complete', makeNrem({ edgesPruned: 20 }));
    await new Promise((r) => setImmediate(r));
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush.mock.calls[0][0]).toMatchObject({
      title: 'Vision dream · nrem',
      priority: 'low',
    });

    // clusters alone meets bar even without edges
    events.emit('dream:nrem:complete', makeNrem({ edgesPruned: 0, clustersFound: 2 }));
    await new Promise((r) => setImmediate(r));
    expect(sendPush).toHaveBeenCalledTimes(2);

    stop();
  });

  // -- Test 3: dream rate limiting -------------------------------------

  it('rate-limits dream pushes within dreamRateLimitMs', async () => {
    // Inject a clock so the second event is still within the limit window.
    let t = 1_000_000;
    const now = () => t;
    const stop = startProactive({
      store,
      events,
      config: {
        sendPush,
        log,
        dreamRateLimitMs: 60_000, // 60s limit
        now,
      },
    });

    events.emit('dream:nrem:complete', makeNrem({ edgesPruned: 30 }));
    await new Promise((r) => setImmediate(r));
    expect(sendPush).toHaveBeenCalledTimes(1);

    // Advance 10s — still inside window — should be suppressed.
    t += 10_000;
    events.emit('dream:nrem:complete', makeNrem({ edgesPruned: 40 }));
    await new Promise((r) => setImmediate(r));
    expect(sendPush).toHaveBeenCalledTimes(1);

    // Advance past window — should push again.
    t += 60_000;
    events.emit('dream:nrem:complete', makeNrem({ edgesPruned: 40 }));
    await new Promise((r) => setImmediate(r));
    expect(sendPush).toHaveBeenCalledTimes(2);

    stop();
  });

  // -- Test 4: guardian state transitions ------------------------------

  it('pushes on guardian state transitions, not same-state ticks', async () => {
    const stop = startProactive({
      store,
      events,
      config: { sendPush, log, dreamRateLimitMs: 0 },
    });

    // First observation ever: record but do NOT push (first-seen rule).
    events.emit('guardian:update', makeGuardian('warm', 0.6));
    await new Promise((r) => setImmediate(r));
    expect(sendPush).not.toHaveBeenCalled();

    // Same state again: still no push.
    events.emit('guardian:update', makeGuardian('warm', 0.61));
    await new Promise((r) => setImmediate(r));
    expect(sendPush).not.toHaveBeenCalled();

    // warm → trapped: push with high priority.
    events.emit('guardian:update', makeGuardian('trapped', 0.9));
    await new Promise((r) => setImmediate(r));
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush.mock.calls[0][0]).toMatchObject({
      title: 'Vision guardian · trapped',
      priority: 'high',
    });

    // trapped → calm: calm is informational only, no push.
    events.emit('guardian:update', makeGuardian('calm', 0.1));
    await new Promise((r) => setImmediate(r));
    expect(sendPush).toHaveBeenCalledTimes(1);

    // calm → warm: push with default priority.
    events.emit('guardian:update', makeGuardian('warm', 0.55));
    await new Promise((r) => setImmediate(r));
    expect(sendPush).toHaveBeenCalledTimes(2);
    expect(sendPush.mock.calls[1][0]).toMatchObject({
      title: 'Vision guardian · warm',
      priority: 'default',
    });

    stop();
  });

  // -- Test 5: enabled: false is a clean no-op -------------------------

  it('enabled: false installs no timers, no subscriptions, returns working no-op stop', () => {
    const stop = startProactive({
      store,
      events,
      config: { enabled: false, sendPush, log },
    });

    expect(events.listenerCount('dream:nrem:complete')).toBe(0);
    expect(events.listenerCount('dream:rem:complete')).toBe(0);
    expect(events.listenerCount('guardian:update')).toBe(0);

    // Emit events — nothing should happen.
    events.emit('dream:nrem:complete', makeNrem({ edgesPruned: 100 }));
    events.emit('guardian:update', makeGuardian('trapped'));
    expect(sendPush).not.toHaveBeenCalled();

    expect(() => stop()).not.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[proactive] disabled'));
  });

  // -- Test 6: sendPush throwing does not crash the module -------------

  it('sendPush rejections are swallowed; subsequent pushes still work', async () => {
    let calls = 0;
    const flaky = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error('ntfy unreachable');
      // later calls succeed
    });

    const stop = startProactive({
      store,
      events,
      config: { sendPush: flaky, log, dreamRateLimitMs: 0 },
    });

    // First push — rejects. Module must not crash / unsubscribe.
    events.emit('dream:nrem:complete', makeNrem({ edgesPruned: 30 }));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r)); // flush rejection handler

    expect(flaky).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('push failed'));

    // Subscriptions still live → second push succeeds.
    events.emit('dream:nrem:complete', makeNrem({ edgesPruned: 30 }));
    await new Promise((r) => setImmediate(r));

    expect(flaky).toHaveBeenCalledTimes(2);

    stop();
  });

  // -- Test 7: REM meaningful predicate --------------------------------

  it('REM push fires for meaningful results, skips empty ones', async () => {
    const stop = startProactive({
      store,
      events,
      config: { sendPush, log, dreamRateLimitMs: 0 },
    });

    // Empty REM → no push.
    events.emit('dream:rem:complete', makeRem());
    await new Promise((r) => setImmediate(r));
    expect(sendPush).not.toHaveBeenCalled();

    // REM with a journal id → push.
    events.emit('dream:rem:complete', makeRem({ journalMemoryId: 'mem_1' }));
    await new Promise((r) => setImmediate(r));
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush.mock.calls[0][0]).toMatchObject({
      title: 'Vision dream · rem',
      priority: 'low',
    });

    stop();
  });

  // -- Test 8: morning digest composes + pushes ------------------------

  it('runMorningDigest pushes a short body with roadmap counts', async () => {
    await runMorningDigest({ store, log, sendPush });
    expect(sendPush).toHaveBeenCalledTimes(1);
    const call = sendPush.mock.calls[0][0];
    expect(call.title).toMatch(/^Vision morning · /);
    expect(call.priority).toBe('default');
    expect(call.body.length).toBeLessThanOrEqual(300);
    expect(call.body).toContain('roadmap:');
  });

  // -- Test 9: evening reflection composes + pushes --------------------

  it('runEveningReflection pushes a short body with today counts', async () => {
    await runEveningReflection({ store, events, log, sendPush });
    expect(sendPush).toHaveBeenCalledTimes(1);
    const call = sendPush.mock.calls[0][0];
    expect(call.title).toBe('Vision evening · reflection');
    expect(call.priority).toBe('low');
    expect(call.body.length).toBeLessThanOrEqual(300);
    expect(call.body).toContain('new memories:');
  });

  // -- Test 10: digest helpers don't throw when push fails -------------

  it('digest functions swallow sendPush failures', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('network down'));
    await runMorningDigest({ store, log, sendPush: boom });
    await runEveningReflection({ store, events, log, sendPush: boom });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/morning digest failed/));
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/evening reflection failed/));
  });
});

// -- Meaningful-predicate unit tests ------------------------------------

describe('nremIsMeaningful', () => {
  it('false when edges < 20 and clusters < 1', () => {
    expect(
      nremIsMeaningful({
        duration: 0,
        edgesPruned: 19,
        decayApplied: false,
        clustersFound: 0,
        dedupProposals: 0,
        valenceBackfilled: 0,
        sourceCalibration: [],
        silence: [],
        drift: [],
        errors: [],
      }),
    ).toBe(false);
  });

  it('true when edgesPruned >= 20', () => {
    expect(
      nremIsMeaningful({
        duration: 0,
        edgesPruned: 20,
        decayApplied: false,
        clustersFound: 0,
        dedupProposals: 0,
        valenceBackfilled: 0,
        sourceCalibration: [],
        silence: [],
        drift: [],
        errors: [],
      }),
    ).toBe(true);
  });

  it('true when clustersFound >= 1 even with 0 edges', () => {
    expect(
      nremIsMeaningful({
        duration: 0,
        edgesPruned: 0,
        decayApplied: false,
        clustersFound: 1,
        dedupProposals: 0,
        valenceBackfilled: 0,
        sourceCalibration: [],
        silence: [],
        drift: [],
        errors: [],
      }),
    ).toBe(true);
  });
});

describe('remIsMeaningful', () => {
  it('false for an empty REM result', () => {
    expect(
      remIsMeaningful({
        duration: 0,
        seeds: [],
        hindsightCandidates: [],
        tensions: [],
        journalMemoryId: null,
        errors: [],
      }),
    ).toBe(false);
  });

  it('true when a journal was written', () => {
    expect(
      remIsMeaningful({
        duration: 0,
        seeds: [],
        hindsightCandidates: [],
        tensions: [],
        journalMemoryId: 'mem_abc',
        errors: [],
      }),
    ).toBe(true);
  });
});
