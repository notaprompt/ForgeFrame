/**
 * Tests for dream-schedule.ts
 *
 * The module is intentionally DI-heavy so these tests do not need a real
 * SQLite database. We pass a sentinel MemoryStore stand-in (only identity-
 * compared), a stub computePressure, and stub factories.
 */
import { describe, it, expect, vi } from 'vitest';
import type { MemoryStore } from './store.js';
import type { SleepPressure } from './types.js';
import type { NremResult } from './dream-nrem.js';
import type { RemResult } from './dream-rem.js';
import { maybeDream, summarizeDreamResult, type DreamResult } from './dream-schedule.js';

// --- Fixtures ---

function fakeStore(): MemoryStore {
  // A bare object is fine — none of the default factories run when we
  // inject our own, and computePressure is stubbed.
  return {} as unknown as MemoryStore;
}

function pressure(score: number, recommendation: SleepPressure['recommendation'] = 'sleep'): SleepPressure {
  return {
    score,
    components: {
      unconsolidated: 0,
      hoursSinceLastDream: 0,
      unscannedContradictions: 0,
      pendingDecay: 0,
    },
    recommendation,
  };
}

function fakeNremResult(overrides: Partial<NremResult> = {}): NremResult {
  return {
    duration: 12,
    edgesPruned: 3,
    decayApplied: true,
    clustersFound: 2,
    dedupProposals: 1,
    valenceBackfilled: 0,
    sourceCalibration: [],
    silence: [],
    drift: [],
    errors: [],
    ...overrides,
  };
}

function fakeRemResult(overrides: Partial<RemResult> = {}): RemResult {
  return {
    duration: 44,
    seeds: [],
    hindsightCandidates: [],
    tensions: [],
    journalMemoryId: null,
    errors: [],
    ...overrides,
  };
}

// --- Tests ---

describe('maybeDream', () => {
  it('returns phase=awake when pressure is below both thresholds, without invoking either phase', async () => {
    const nremRun = vi.fn();
    const remRun = vi.fn();
    const log = vi.fn();

    const result = await maybeDream({
      store: fakeStore(),
      computePressure: () => pressure(5),
      nremFactory: () => ({ run: nremRun }),
      remFactory: () => ({ run: remRun }),
      log,
    });

    expect(result.phase).toBe('awake');
    expect(result.nremResult).toBeUndefined();
    expect(result.remResult).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.pressure.score).toBe(5);
    expect(nremRun).not.toHaveBeenCalled();
    expect(remRun).not.toHaveBeenCalled();
    // Awake is the common case — no log noise on it.
    expect(log).not.toHaveBeenCalled();
  });

  it('runs NREM when score crosses nremThreshold only', async () => {
    const nremRun = vi.fn(async () => fakeNremResult({ edgesPruned: 7 }));
    const remRun = vi.fn();
    const log = vi.fn();

    const result = await maybeDream({
      store: fakeStore(),
      computePressure: () => pressure(25, 'nrem'),
      nremFactory: () => ({ run: nremRun }),
      remFactory: () => ({ run: remRun }),
      log,
    });

    expect(result.phase).toBe('nrem');
    expect(result.nremResult).toEqual(fakeNremResult({ edgesPruned: 7 }));
    expect(result.remResult).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(nremRun).toHaveBeenCalledTimes(1);
    expect(remRun).not.toHaveBeenCalled();
    // Two log lines: the wake announcement + the complete summary.
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toContain('[dream] wake phase=nrem');
    expect(log.mock.calls[1][0]).toContain('[dream] nrem complete');
  });

  it('runs REM when score crosses remThreshold but nremThreshold is lifted above it', async () => {
    // Without re-ordering thresholds there's no way to force REM — NREM
    // wins ties by design. We raise nremThreshold so only REM crosses.
    const nremRun = vi.fn();
    const remRun = vi.fn(async () => fakeRemResult({ duration: 99 }));

    const result = await maybeDream({
      store: fakeStore(),
      computePressure: () => pressure(60, 'full'),
      nremThreshold: 100, // unreachable
      remThreshold: 50,
      nremFactory: () => ({ run: nremRun }),
      remFactory: () => ({ run: remRun }),
      log: () => {},
    });

    expect(result.phase).toBe('rem');
    expect(result.remResult?.duration).toBe(99);
    expect(result.nremResult).toBeUndefined();
    expect(nremRun).not.toHaveBeenCalled();
    expect(remRun).toHaveBeenCalledTimes(1);
  });

  it('when NremPhase.run throws, returns phase=nrem with error and does not re-throw', async () => {
    const nremRun = vi.fn(async () => {
      throw new Error('nrem blew up');
    });
    const log = vi.fn();

    const result = await maybeDream({
      store: fakeStore(),
      computePressure: () => pressure(30, 'nrem'),
      nremFactory: () => ({ run: nremRun }),
      log,
    });

    expect(result.phase).toBe('nrem');
    expect(result.error).toBe('nrem blew up');
    expect(result.nremResult).toBeUndefined();
    expect(nremRun).toHaveBeenCalledTimes(1);
    // Structured log line for the failure path.
    expect(log.mock.calls.some((c) => c[0].includes('[dream] nrem run threw'))).toBe(true);
  });

  it('when both thresholds are crossed, NREM wins (consolidation before integration)', async () => {
    const nremRun = vi.fn(async () => fakeNremResult());
    const remRun = vi.fn();

    const result = await maybeDream({
      store: fakeStore(),
      computePressure: () => pressure(70, 'full'),
      nremThreshold: 20,
      remThreshold: 50,
      nremFactory: () => ({ run: nremRun }),
      remFactory: () => ({ run: remRun }),
      log: () => {},
    });

    expect(result.phase).toBe('nrem');
    expect(nremRun).toHaveBeenCalledTimes(1);
    expect(remRun).not.toHaveBeenCalled();
  });

  it('when computePressure throws, returns phase=awake with error and stable pressure shape', async () => {
    const log = vi.fn();
    const result = await maybeDream({
      store: fakeStore(),
      computePressure: () => {
        throw new Error('db locked');
      },
      log,
    });

    expect(result.phase).toBe('awake');
    expect(result.error).toBe('pressure: db locked');
    // Shape is still a valid SleepPressure so callers can log it.
    expect(result.pressure.score).toBe(0);
    expect(result.pressure.recommendation).toBe('sleep');
    expect(log.mock.calls.some((c) => c[0].includes('[dream] pressure compute failed'))).toBe(true);
  });

  it('when an NREM factory throws, returns phase=nrem with error and does not invoke run', async () => {
    const nremRun = vi.fn();
    const result = await maybeDream({
      store: fakeStore(),
      computePressure: () => pressure(25, 'nrem'),
      nremFactory: () => {
        throw new Error('factory bad');
      },
      log: () => {},
    });

    expect(result.phase).toBe('nrem');
    expect(result.error).toBe('factory: factory bad');
    expect(nremRun).not.toHaveBeenCalled();
  });

  it('when a REM factory throws, returns phase=rem with error', async () => {
    const result = await maybeDream({
      store: fakeStore(),
      computePressure: () => pressure(60, 'full'),
      nremThreshold: 100,
      remThreshold: 50,
      remFactory: () => {
        throw new Error('rem factory bad');
      },
      log: () => {},
    });

    expect(result.phase).toBe('rem');
    expect(result.error).toBe('factory: rem factory bad');
  });

  it('uses custom thresholds when provided', async () => {
    const nremRun = vi.fn(async () => fakeNremResult());
    const result = await maybeDream({
      store: fakeStore(),
      computePressure: () => pressure(3),
      nremThreshold: 2,
      remThreshold: 10,
      nremFactory: () => ({ run: nremRun }),
      log: () => {},
    });
    expect(result.phase).toBe('nrem');
    expect(nremRun).toHaveBeenCalledTimes(1);
  });
});

describe('summarizeDreamResult', () => {
  it('summarizes an awake result with pressure and recommendation', () => {
    const r: DreamResult = { phase: 'awake', pressure: pressure(3.14) };
    expect(summarizeDreamResult(r)).toBe('awake (pressure 3.1 / sleep)');
  });

  it('summarizes a successful NREM result', () => {
    const r: DreamResult = {
      phase: 'nrem',
      pressure: pressure(25, 'nrem'),
      nremResult: fakeNremResult({ edgesPruned: 4, clustersFound: 2, duration: 120 }),
    };
    expect(summarizeDreamResult(r)).toBe('nrem: 4 edges pruned, 2 clusters, 120ms');
  });

  it('summarizes a successful REM result', () => {
    const r: DreamResult = {
      phase: 'rem',
      pressure: pressure(60, 'full'),
      remResult: fakeRemResult({ duration: 500 }),
    };
    expect(summarizeDreamResult(r)).toBe('rem: 0 seeds, 0 tensions, 500ms');
  });

  it('summarizes an error result regardless of phase', () => {
    const r: DreamResult = {
      phase: 'nrem',
      pressure: pressure(30, 'nrem'),
      error: 'boom',
    };
    expect(summarizeDreamResult(r)).toBe('dream nrem failed: boom (pressure 30.0)');
  });

  it('falls back to phase-only string when nothing else to say', () => {
    const r: DreamResult = { phase: 'nrem', pressure: pressure(30) };
    expect(summarizeDreamResult(r)).toBe('dream nrem');
  });
});
