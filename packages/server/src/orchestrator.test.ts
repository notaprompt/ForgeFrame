/**
 * Phase 2 Task 2.1 — orchestrator heartbeat tests.
 *
 * Task 2.1 scope is intentionally narrow: emit a 'heartbeat' event at a
 * configured interval until stop() is called. The %5 / %10 / %60 tick
 * branches (triggers, distillery scan, guardian pulse) arrive in Task 2.2+
 * when their targets exist.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startOrchestrator } from './orchestrator.js';

describe('orchestrator', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fires heartbeat at configured interval', () => {
    const emit = vi.fn();
    const stop = startOrchestrator({ intervalMs: 1000, emit });
    vi.advanceTimersByTime(3500);
    const heartbeats = emit.mock.calls.filter((c) => c[0] === 'heartbeat');
    expect(heartbeats.length).toBe(3);
    expect(heartbeats[0][1]).toMatchObject({ tick: 1, ts: expect.any(Number) });
    expect(heartbeats[2][1]).toMatchObject({ tick: 3 });
    stop();
  });

  it('increments tick monotonically across emissions', () => {
    const emit = vi.fn();
    const stop = startOrchestrator({ intervalMs: 500, emit });
    vi.advanceTimersByTime(2500);
    const ticks = emit.mock.calls
      .filter((c) => c[0] === 'heartbeat')
      .map((c) => c[1].tick);
    expect(ticks).toEqual([1, 2, 3, 4, 5]);
    stop();
  });

  it('stop() prevents future heartbeats', () => {
    const emit = vi.fn();
    const stop = startOrchestrator({ intervalMs: 1000, emit });
    vi.advanceTimersByTime(1500);
    const before = emit.mock.calls.filter((c) => c[0] === 'heartbeat').length;
    stop();
    vi.advanceTimersByTime(5000);
    const after = emit.mock.calls.filter((c) => c[0] === 'heartbeat').length;
    expect(after).toBe(before);
  });

  it('does not emit before the first interval elapses', () => {
    const emit = vi.fn();
    const stop = startOrchestrator({ intervalMs: 1000, emit });
    vi.advanceTimersByTime(999);
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(emit).toHaveBeenCalledOnce();
    stop();
  });

  // --- Phase 2 Task 2.2: optional dream-tick branch ---

  it('does not invoke onDreamTick when it is not provided (Task 2.1 behavior preserved)', () => {
    const emit = vi.fn();
    const stop = startOrchestrator({ intervalMs: 1000, emit });
    vi.advanceTimersByTime(10_000);
    // 10 heartbeats, no dream branch, no errors.
    expect(emit.mock.calls.filter((c) => c[0] === 'heartbeat').length).toBe(10);
    stop();
  });

  it('invokes onDreamTick every dreamTickEvery ticks (3, 6, 9 for every=3)', async () => {
    const emit = vi.fn();
    const onDreamTick = vi.fn(async () => {});
    const stop = startOrchestrator({
      intervalMs: 1000,
      emit,
      onDreamTick,
      dreamTickEvery: 3,
    });
    vi.advanceTimersByTime(10_000);
    // 10 heartbeats total, dream fires on ticks 3, 6, 9.
    expect(onDreamTick).toHaveBeenCalledTimes(3);
    stop();
  });

  it('ignores onDreamTick when dreamTickEvery is zero or missing', () => {
    const onDreamTick = vi.fn(async () => {});
    const stop = startOrchestrator({
      intervalMs: 1000,
      emit: vi.fn(),
      onDreamTick,
      // dreamTickEvery omitted
    });
    vi.advanceTimersByTime(10_000);
    expect(onDreamTick).not.toHaveBeenCalled();
    stop();
  });

  it('does not tear down the loop when onDreamTick rejects', async () => {
    const emit = vi.fn();
    const onDreamTick = vi.fn(async () => {
      throw new Error('simulated dream failure');
    });
    // Silence the expected console.error so the test output stays clean.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const stop = startOrchestrator({
      intervalMs: 1000,
      emit,
      onDreamTick,
      dreamTickEvery: 2,
    });
    vi.advanceTimersByTime(5_000);
    // 5 heartbeats, dream attempted on ticks 2 and 4, loop survived.
    expect(emit.mock.calls.filter((c) => c[0] === 'heartbeat').length).toBe(5);
    expect(onDreamTick).toHaveBeenCalledTimes(2);
    // Drain any microtasks so rejection handler runs before assertion.
    await Promise.resolve();
    await Promise.resolve();
    expect(consoleSpy).toHaveBeenCalled();
    stop();
    consoleSpy.mockRestore();
  });

  it('does not tear down the loop when onDreamTick throws synchronously', () => {
    const emit = vi.fn();
    const onDreamTick = vi.fn(() => {
      throw new Error('sync throw');
    }) as unknown as () => Promise<void>;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const stop = startOrchestrator({
      intervalMs: 1000,
      emit,
      onDreamTick,
      dreamTickEvery: 2,
    });
    vi.advanceTimersByTime(5_000);
    expect(emit.mock.calls.filter((c) => c[0] === 'heartbeat').length).toBe(5);
    expect(consoleSpy).toHaveBeenCalled();
    stop();
    consoleSpy.mockRestore();
  });
});
