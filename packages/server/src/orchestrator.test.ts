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
});
