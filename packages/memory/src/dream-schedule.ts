/**
 * @forgeframe/memory — Dream Schedule
 *
 * Vision Phase 2 Task 2.2. Given a MemoryStore, decide whether the
 * orchestrator tick should wake an NREM phase, a REM phase, or remain
 * awake. The decision is driven by sleep pressure computed from the
 * store itself (unconsolidated memories, time since last dream journal,
 * unscanned contradictions, pending decay).
 *
 * Design goals:
 *   - Pure-ish: all inputs (store, generator, thresholds, factories) passed as
 *     parameters. No module-level state. No imports from ../server.
 *   - Graceful failure: a throw inside computeSleepPressure, or inside a
 *     phase's .run(), becomes a returned `error` field rather than a
 *     propagated exception. The orchestrator loop must never be torn down
 *     by a bad dream cycle.
 *   - Testable: phase construction is delegated to optional factory
 *     callbacks so unit tests can inject fakes without needing a real
 *     SQLite store or Hebbian/Consolidation engines.
 *   - NREM-before-REM preference: when both thresholds cross (i.e. the
 *     store reports 'full'), we run NREM. Consolidation comes before
 *     integration; REM piggy-backs on the clean graph NREM produces.
 *     Callers that want REM must either lower the REM threshold below
 *     NREM or inspect the returned pressure and dispatch REM themselves
 *     on a later tick.
 *
 * Structured log lines use the `[dream]` prefix so tail-of-server.log
 * remains greppable.
 */

import type { MemoryStore } from './store.js';
import type { Generator } from './generator.js';
import type { SleepPressure } from './types.js';
import { computeSleepPressure as defaultComputeSleepPressure } from './sleep-pressure.js';
import { HebbianEngine } from './hebbian.js';
import { ConsolidationEngine } from './consolidation.js';
import { NremPhase, type NremResult } from './dream-nrem.js';
import { RemPhase, type RemResult } from './dream-rem.js';

export type DreamPhase = 'nrem' | 'rem' | 'awake';

/**
 * Minimal shape the schedule needs from an NREM-like phase. Keeping this
 * narrow (instead of importing the full NremPhase type) lets tests pass
 * fakes without fabricating hebbian/consolidation engines.
 */
export interface NremRunner {
  run(): Promise<NremResult>;
}

/**
 * Same idea for REM. RemPhase.run takes the pre-dream pressure score; the
 * schedule supplies it when constructing the runner.
 */
export interface RemRunner {
  run(): Promise<RemResult>;
}

export interface DreamResult {
  /** Which phase actually ran (or 'awake' if none). */
  phase: DreamPhase;
  /** Pressure reading at decision time. Useful for log lines + events. */
  pressure: SleepPressure;
  /** Populated iff phase === 'nrem' and .run() succeeded. */
  nremResult?: NremResult;
  /** Populated iff phase === 'rem' and .run() succeeded. */
  remResult?: RemResult;
  /** Populated iff the selected phase threw. phase is still set to the attempt. */
  error?: string;
}

export interface MaybeDreamOptions {
  store: MemoryStore;
  /** Optional LLM. REM and valence backfill use it; NREM runs without. */
  generator?: Generator | null;
  /**
   * Score at which NREM fires. Defaults to 20, matching
   * sleep-pressure.ts's own NREM_THRESHOLD. Scores are absolute
   * (unconsolidated × 0.4 + hoursSinceLastDream × 0.3 + …), not 0–1.
   */
  nremThreshold?: number;
  /**
   * Score at which REM fires. Defaults to 50, matching
   * sleep-pressure.ts's FULL_THRESHOLD. REM implies NREM coverage in
   * the biology; in this system we run NREM first when both cross.
   */
  remThreshold?: number;
  /**
   * Override for computeSleepPressure. Tests inject a stub; production
   * leaves it undefined and the real DB-backed version runs.
   */
  computePressure?: (store: MemoryStore) => SleepPressure;
  /**
   * Factory for the NREM runner. Defaults to constructing a real
   * NremPhase with Hebbian + Consolidation engines.
   */
  nremFactory?: (store: MemoryStore, generator: Generator | null) => NremRunner;
  /**
   * Factory for the REM runner. Defaults to constructing a real
   * RemPhase that closes over the current pressure score.
   */
  remFactory?: (
    store: MemoryStore,
    generator: Generator | null,
    pressureScore: number,
  ) => RemRunner;
  /**
   * Optional logger. Defaults to process.stderr.write. Tests can
   * inject vi.fn() to assert on log lines without capturing stderr.
   */
  log?: (line: string) => void;
}

const DEFAULT_NREM_THRESHOLD = 20;
const DEFAULT_REM_THRESHOLD = 50;

function defaultLog(line: string): void {
  // Mirror the existing [orchestrator]/[triggers] convention so tail -f
  // on server.log stays readable.
  process.stderr.write(line.endsWith('\n') ? line : `${line}\n`);
}

function defaultNremFactory(store: MemoryStore, generator: Generator | null): NremRunner {
  return new NremPhase(
    store,
    new HebbianEngine(store),
    new ConsolidationEngine(store, generator as Generator),
    generator,
  );
}

function defaultRemFactory(
  store: MemoryStore,
  generator: Generator | null,
  pressureScore: number,
): RemRunner {
  const phase = new RemPhase(store, generator);
  // Wrap .run() so the schedule doesn't need to know about the pressure-
  // score argument RemPhase requires. Callers see a uniform `run()` shape.
  return { run: () => phase.run(pressureScore) };
}

/**
 * Decide whether to dream, and if so run the selected phase.
 *
 * Never throws. On any internal failure returns a DreamResult with
 * `error` populated. This is load-bearing: the orchestrator tick loop
 * fire-and-forgets this call, and we do not want an unhandled rejection
 * taking down the daemon.
 */
export async function maybeDream(opts: MaybeDreamOptions): Promise<DreamResult> {
  const {
    store,
    generator = null,
    nremThreshold = DEFAULT_NREM_THRESHOLD,
    remThreshold = DEFAULT_REM_THRESHOLD,
    computePressure = defaultComputeSleepPressure,
    nremFactory = defaultNremFactory,
    remFactory = defaultRemFactory,
    log = defaultLog,
  } = opts;

  // Step 1: read pressure. If this throws, we cannot make a decision;
  // return awake with an error so the caller can still emit something.
  let pressure: SleepPressure;
  try {
    pressure = computePressure(store);
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    log(`[dream] pressure compute failed: ${message}`);
    // Synthesize a zeroed pressure so the shape is stable for callers.
    return {
      phase: 'awake',
      pressure: {
        score: 0,
        components: {
          unconsolidated: 0,
          hoursSinceLastDream: 0,
          unscannedContradictions: 0,
          pendingDecay: 0,
        },
        recommendation: 'sleep',
      },
      error: `pressure: ${message}`,
    };
  }

  const nremCrossed = pressure.score >= nremThreshold;
  const remCrossed = pressure.score >= remThreshold;

  // Step 2: low pressure — nothing to do.
  if (!nremCrossed && !remCrossed) {
    // Deliberately no log line on the common case; avoids Feed Tab noise.
    return { phase: 'awake', pressure };
  }

  // Step 3: choose phase. NREM wins when both cross — consolidate before
  // integrating. The log line is the audit trail.
  const phase: DreamPhase = nremCrossed ? 'nrem' : 'rem';
  log(
    `[dream] wake phase=${phase} score=${pressure.score.toFixed(2)} rec=${pressure.recommendation}`,
  );

  // Step 4: run the chosen phase with graceful failure.
  if (phase === 'nrem') {
    let runner: NremRunner;
    try {
      runner = nremFactory(store, generator);
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      log(`[dream] nrem factory threw: ${message}`);
      return { phase: 'nrem', pressure, error: `factory: ${message}` };
    }

    try {
      const nremResult = await runner.run();
      log(
        `[dream] nrem complete duration=${nremResult.duration}ms ` +
          `edgesPruned=${nremResult.edgesPruned} clusters=${nremResult.clustersFound} ` +
          `errors=${nremResult.errors.length}`,
      );
      return { phase: 'nrem', pressure, nremResult };
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      log(`[dream] nrem run threw: ${message}`);
      return { phase: 'nrem', pressure, error: message };
    }
  }

  // phase === 'rem'
  let runner: RemRunner;
  try {
    runner = remFactory(store, generator, pressure.score);
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    log(`[dream] rem factory threw: ${message}`);
    return { phase: 'rem', pressure, error: `factory: ${message}` };
  }

  try {
    const remResult = await runner.run();
    log(
      `[dream] rem complete duration=${remResult.duration}ms ` +
        `seeds=${remResult.seeds.length} tensions=${remResult.tensions.length} ` +
        `errors=${remResult.errors.length}`,
    );
    return { phase: 'rem', pressure, remResult };
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    log(`[dream] rem run threw: ${message}`);
    return { phase: 'rem', pressure, error: message };
  }
}

/**
 * Build a short human-readable summary line for the DreamResult. Used
 * by the daemon's onDreamTick emitter and by Feed Tab renderers. Kept
 * next to maybeDream so both ends of the pipeline stay in sync.
 */
export function summarizeDreamResult(result: DreamResult): string {
  if (result.error) {
    return `dream ${result.phase} failed: ${result.error} (pressure ${result.pressure.score.toFixed(1)})`;
  }
  if (result.phase === 'awake') {
    return `awake (pressure ${result.pressure.score.toFixed(1)} / ${result.pressure.recommendation})`;
  }
  if (result.phase === 'nrem' && result.nremResult) {
    const r = result.nremResult;
    return `nrem: ${r.edgesPruned} edges pruned, ${r.clustersFound} clusters, ${r.duration}ms`;
  }
  if (result.phase === 'rem' && result.remResult) {
    const r = result.remResult;
    return `rem: ${r.seeds.length} seeds, ${r.tensions.length} tensions, ${r.duration}ms`;
  }
  return `dream ${result.phase}`;
}
