/**
 * Vision Phase 2 — orchestrator.
 *
 * The orchestrator is the daemon's tick loop. Task 2.1 shipped the minimum:
 * a repeating timer that emits 'heartbeat' events onto the event bus at a
 * configured interval. Task 2.2 layers on an optional `onDreamTick` branch
 * that fires every N heartbeats — the first load-bearing use of the loop
 * instead of ceremonial proof-of-life.
 *
 * Later phases extend the same tick with:
 *   - evaluateTriggers()   (Task 2.3, every 5 ticks)    — shipped via daemon
 *   - scanDistillery()     (distillery intake poll, every 10 ticks)
 *   - guardianPulse()      (Task 2.2+, every 60 ticks, proprioception)
 *   - dispatchReadyTasks() (Daemon-α)
 *   - drainReviewQueue()   (Daemon-α)
 *
 * Invariant: existing callers that do not pass onDreamTick / dreamTickEvery
 * get exactly the Task 2.1 behavior. The old tests pass unchanged.
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
  /**
   * Optional dream tick callback. If provided and dreamTickEvery is set
   * to a positive integer, this is invoked on every Nth heartbeat. Any
   * rejected promise is caught locally so a misbehaving dream cycle
   * cannot tear down the tick loop.
   */
  onDreamTick?: () => Promise<void>;
  /**
   * How many heartbeats between dream ticks. Default 6 — at the 5s tick
   * interval configured in daemon.ts, that's ~30s between dream checks.
   * Values ≤ 0 disable the dream branch even when onDreamTick is set.
   */
  dreamTickEvery?: number;
}

/**
 * Starts the orchestrator tick loop.
 * Returns a stop() function that clears the interval.
 */
export function startOrchestrator(opts: OrchestratorOptions): () => void {
  let tick = 0;
  const dreamEvery = opts.dreamTickEvery ?? 0;
  const dreamEnabled = !!opts.onDreamTick && dreamEvery > 0;

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

    if (dreamEnabled && tick % dreamEvery === 0) {
      // Fire-and-forget, but catch rejections so an unhandled promise
      // does not take down the daemon. The callback itself is expected
      // to log its own successes/failures; this is the backstop.
      try {
        const maybePromise = opts.onDreamTick!();
        if (maybePromise && typeof maybePromise.catch === 'function') {
          maybePromise.catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.error('[orchestrator] onDreamTick rejected:', err);
          });
        }
      } catch (err) {
        // Synchronous throws from the callback (rare — it's declared
        // async — but guard anyway).
        // eslint-disable-next-line no-console
        console.error('[orchestrator] onDreamTick threw:', err);
      }
    }
  }, opts.intervalMs);
  return () => clearInterval(handle);
}
