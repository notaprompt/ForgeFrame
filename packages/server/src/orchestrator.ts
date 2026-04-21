/**
 * Vision Phase 2 Task 2.1 — orchestrator heartbeat.
 *
 * The orchestrator is the daemon's tick loop. Phase 2.1 ships the minimum:
 * a repeating timer that emits 'heartbeat' events onto the event bus at a
 * configured interval. Later phases extend the same tick with:
 *   - evaluateTriggers()   (Task 2.3, every 5 ticks)
 *   - scanDistillery()     (distillery intake poll, every 10 ticks)
 *   - maybeDream()         (Task 2.2, every 30 ticks, NREM/REM via sleep pressure)
 *   - guardianPulse()      (Task 2.2+, every 60 ticks, proprioception)
 *   - dispatchReadyTasks() (Daemon-α)
 *   - drainReviewQueue()   (Daemon-α)
 *
 * This file adds none of those. Task 2.1 is heartbeat only — the simplest
 * possible proof-of-life that the creature's loop is running. Other branches
 * land as their targets exist.
 */

export interface HeartbeatPayload {
  tick: number;
  ts: number;
}

export interface OrchestratorOptions {
  /** Interval between heartbeat ticks in milliseconds. */
  intervalMs: number;
  /** Event bus emitter. Called as emit(kind, payload). */
  emit: (kind: string, payload: unknown) => void;
}

/**
 * Starts the orchestrator tick loop.
 * Returns a stop() function that clears the interval.
 */
export function startOrchestrator(opts: OrchestratorOptions): () => void {
  let tick = 0;
  const handle = setInterval(() => {
    tick++;
    const payload: HeartbeatPayload = { tick, ts: Date.now() };
    try {
      opts.emit('heartbeat', payload);
    } catch (err) {
      // Never let a bad subscriber kill the loop.
      // eslint-disable-next-line no-console
      console.error('[orchestrator] emit threw:', err);
    }
  }, opts.intervalMs);
  return () => clearInterval(handle);
}
