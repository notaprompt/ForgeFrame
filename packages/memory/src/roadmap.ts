/**
 * @forgeframe/memory — Memory Roadmap
 *
 * A roadmap is a 4-bucket view of the creature's memory state:
 *
 *   - active      — recently created; the working surface
 *   - pending     — moderate strength, still settling
 *   - entrenched  — strong and stable (principles/voice always land here)
 *   - drifting    — high drift score; candidates for REM or archival
 *
 * This is a *view*, not a dump. Each bucket is capped (default 25) so the
 * shape of memory remains legible. A memory appears in exactly one bucket:
 * priority is `entrenched > drifting > active > pending` — a principle
 * that is technically "drifting" still belongs in entrenched.
 *
 * Decisions (from team meeting 2026-04-21):
 *   - Active sorts by `createdAt` (NOT lastAccessedAt) — otherwise viewing
 *     the roadmap touches memories, which makes them "active" next view,
 *     and the roadmap becomes a mirror of attention instead of a map.
 *   - `driftScore(memory)` lives in drift.ts as a reusable public export.
 *
 * Register: beautifully robust — graceful on empty stores, deterministic
 * for a given input, structured logs with `[roadmap]` prefix.
 */

import type { Memory } from './types.js';
import type { MemoryStore } from './store.js';
import { driftScore } from './drift.js';

export interface RoadmapBuckets {
  active: Memory[];
  pending: Memory[];
  entrenched: Memory[];
  drifting: Memory[];
}

export interface RoadmapOptions {
  store: MemoryStore;
  /** Hours back to count a memory as "active" (default 24). */
  activeWindowHours?: number;
  /** Strength threshold above which a memory is entrenched (default 0.85). */
  entrenchedStrength?: number;
  /** driftScore threshold above which a memory is drifting (default 0.6). */
  driftingThreshold?: number;
  /** Max memories per bucket (default 25). Roadmap is a view, not a dump. */
  maxPerBucket?: number;
  /** Override time source (primarily for tests). */
  now?: number;
  /**
   * Size of the candidate pool pulled from the store. Defaults to 5000,
   * which covers the current 766-memory corpus with headroom. If the store
   * exceeds this, the roadmap reflects the newest `poolSize` memories — a
   * deliberate soft-ceiling to keep this O(n) in the pool, not the corpus.
   */
  poolSize?: number;
  /** Structured logger. Defaults to console.warn with [roadmap] prefix. */
  log?: (line: string) => void;
}

const DEFAULT_ACTIVE_HOURS = 24;
const DEFAULT_ENTRENCHED_STRENGTH = 0.85;
const DEFAULT_DRIFTING_THRESHOLD = 0.6;
const DEFAULT_MAX_PER_BUCKET = 25;
const DEFAULT_POOL_SIZE = 5000;
const MS_PER_HOUR = 3_600_000;

const ENTRENCHED_TAGS = new Set<string>(['principle', 'voice', 'constitutional']);

function defaultLog(line: string): void {
  // eslint-disable-next-line no-console
  console.warn(line);
}

/**
 * Build a 4-bucket roadmap from the store.
 *
 * Deterministic given an identical memory set + options. Returns empty
 * buckets when the store is empty (never throws). Errors from the store
 * are surfaced to the caller — this function does not silently swallow.
 */
export async function buildRoadmap(opts: RoadmapOptions): Promise<RoadmapBuckets> {
  const {
    store,
    activeWindowHours = DEFAULT_ACTIVE_HOURS,
    entrenchedStrength = DEFAULT_ENTRENCHED_STRENGTH,
    driftingThreshold = DEFAULT_DRIFTING_THRESHOLD,
    maxPerBucket = DEFAULT_MAX_PER_BUCKET,
    now: nowOverride,
    poolSize = DEFAULT_POOL_SIZE,
    log = defaultLog,
  } = opts;

  if (maxPerBucket <= 0) {
    log('[roadmap] maxPerBucket <= 0 — returning empty buckets');
    return { active: [], pending: [], entrenched: [], drifting: [] };
  }

  const now = nowOverride ?? Date.now();
  const activeCutoff = now - activeWindowHours * MS_PER_HOUR;

  // Pull a bounded pool — most recent N memories. Covers current corpus
  // (~766) with 6x headroom. No N+1 queries below; all bucketing is in memory.
  const pool = store.getRecent(poolSize);

  if (pool.length === 0) {
    return { active: [], pending: [], entrenched: [], drifting: [] };
  }

  // Compute mean strength once for driftScore — avoids per-memory recomputation.
  const meanStrength = computeMeanStrength(pool);
  const driftCtx = { meanStrength, now };

  // Classify each memory into exactly one bucket by priority:
  //   entrenched > drifting > active > pending.
  const buckets: RoadmapBuckets = {
    active: [],
    pending: [],
    entrenched: [],
    drifting: [],
  };

  // We need driftScore for both classification and sorting — compute once.
  const scoreCache = new Map<string, number>();
  const scoreOf = (m: Memory): number => {
    let s = scoreCache.get(m.id);
    if (s === undefined) {
      s = driftScore(m, driftCtx);
      scoreCache.set(m.id, s);
    }
    return s;
  };

  for (const m of pool) {
    if (isEntrenched(m, entrenchedStrength)) {
      buckets.entrenched.push(m);
    } else if (scoreOf(m) >= driftingThreshold) {
      buckets.drifting.push(m);
    } else if (m.createdAt >= activeCutoff) {
      buckets.active.push(m);
    } else {
      buckets.pending.push(m);
    }
  }

  // Sort: active by createdAt DESC (newness, NOT lastAccessedAt — see note above);
  // entrenched by strength DESC; drifting by driftScore DESC; pending by strength DESC.
  buckets.active.sort((a, b) => b.createdAt - a.createdAt);
  buckets.entrenched.sort((a, b) => b.strength - a.strength);
  buckets.drifting.sort((a, b) => scoreOf(b) - scoreOf(a));
  buckets.pending.sort((a, b) => b.strength - a.strength);

  // Cap each bucket.
  buckets.active = buckets.active.slice(0, maxPerBucket);
  buckets.pending = buckets.pending.slice(0, maxPerBucket);
  buckets.entrenched = buckets.entrenched.slice(0, maxPerBucket);
  buckets.drifting = buckets.drifting.slice(0, maxPerBucket);

  return buckets;
}

/** Exported for testing: mean strength over a memory set. 0 on empty input. */
export function computeMeanStrength(memories: Memory[]): number {
  if (memories.length === 0) return 0;
  let sum = 0;
  let n = 0;
  for (const m of memories) {
    if (Number.isFinite(m.strength)) {
      sum += m.strength;
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/** Exported for testing: does this memory belong in the entrenched bucket? */
export function isEntrenched(memory: Memory, strengthThreshold: number): boolean {
  if (memory.strength >= strengthThreshold) return true;
  return memory.tags.some((t) => ENTRENCHED_TAGS.has(t));
}
