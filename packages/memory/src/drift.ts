/**
 * @forgeframe/memory — Drift Detection
 *
 * Compares edge weight distribution by tag cluster across two time windows
 * to detect which belief areas are strengthening and which are weakening.
 *
 * "Your beliefs have shifted toward X over the last month."
 *
 * Also exposes `driftScore(memory)` — a scalar [0, 1] score for a single
 * memory. Used by the roadmap view (drifting bucket), and reusable by dream
 * selection, hindsight weighting, etc.
 */

import type { MemoryStore } from './store.js';
import type { Memory } from './types.js';

export interface DriftEntry {
  tag: string;
  direction: 'strengthening' | 'weakening';
  currentAvgWeight: number;
  priorAvgWeight: number;
  magnitude: number;
  memoryCount: number;
}

const EXCLUDED_TAGS = ['principle', 'voice', 'dream-journal'];
const MS_PER_DAY = 86_400_000;
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_THRESHOLD = 0.2;

/** Age beyond this (in days) contributes maximally to age signal. */
const AGE_HALF_LIFE_DAYS = 60;
/** Access count at or above this dampens the "unused" signal to zero. */
const ACCESS_SATURATION = 10;
/** Strength at or below this contributes maximally to the weakness signal. */
const WEAKNESS_FLOOR = 0.1;

/**
 * Options for driftScore. All fields optional — sensible defaults applied.
 * - `meanStrength`: avg strength across a corpus. When provided, weakness is
 *   computed relative to the corpus mean (Z-style); otherwise an absolute
 *   strength comparison is used.
 * - `now`: override current time for deterministic testing.
 */
export interface DriftScoreContext {
  meanStrength?: number;
  now?: number;
}

/**
 * Compute a scalar drift score for a single memory in [0, 1].
 * Higher = more drift; more likely stale, orphaned, or superseded.
 *
 * Weighting (v1 — simple weighted sum, re-tunable later):
 *   - 0.30 × age ratio (days since createdAt / AGE_HALF_LIFE_DAYS, clamped)
 *   - 0.25 × unused signal (1 - min(accessCount, ACCESS_SATURATION) / SAT)
 *   - 0.25 × weakness signal (relative to meanStrength if provided, else
 *           (1 - strength) clamped to [0, 1])
 *   - 0.20 × superseded flag (1 if `supersededBy` is set, else 0)
 *
 * Constitutional memories (principle, voice) are hard-pinned to 0 — they are
 * exempt from decay by design, so the roadmap must never surface them as
 * "drifting."
 *
 * The exact weights are tuneable; this v1 is intentionally simple. Returns 0
 * for memories that are fresh, accessed, strong, and not-superseded.
 */
export function driftScore(memory: Memory, context: DriftScoreContext = {}): number {
  // Constitutional memories never drift — they are exempt from decay.
  if (memory.tags.some((t) => t === 'principle' || t === 'voice')) return 0;

  const now = context.now ?? Date.now();

  // Age: older memories drift more, capped at 1.0.
  const ageDays = Math.max(0, (now - memory.createdAt) / MS_PER_DAY);
  const ageSignal = Math.min(1, ageDays / AGE_HALF_LIFE_DAYS);

  // Unused: low access count = more drift. Accesses saturate the signal.
  const accessRatio = Math.min(1, (memory.accessCount ?? 0) / ACCESS_SATURATION);
  const unusedSignal = 1 - accessRatio;

  // Weakness: relative to mean if corpus context provided; else absolute.
  const strength = Number.isFinite(memory.strength) ? memory.strength : 0;
  let weaknessSignal: number;
  if (typeof context.meanStrength === 'number' && context.meanStrength > 0) {
    // Below-mean = drift signal; above-mean = no signal. Clamped to [0, 1].
    const deficit = context.meanStrength - strength;
    weaknessSignal = Math.max(0, Math.min(1, deficit / context.meanStrength));
  } else {
    const floor = WEAKNESS_FLOOR;
    weaknessSignal = Math.max(0, Math.min(1, (1 - strength) - floor) / (1 - floor));
  }

  // Superseded: binary flag.
  const supersededSignal = memory.supersededBy ? 1 : 0;

  const score =
    0.30 * ageSignal +
    0.25 * unusedSignal +
    0.25 * weaknessSignal +
    0.20 * supersededSignal;

  // Clamp for safety; weights sum to 1.0 already.
  return Math.max(0, Math.min(1, score));
}

interface WindowEdge {
  weight: number;
  source_tags: string;
  target_tags: string;
  source_id: string;
  target_id: string;
}

export function detectDrift(
  store: MemoryStore,
  windowDays = DEFAULT_WINDOW_DAYS,
  threshold = DEFAULT_THRESHOLD,
): DriftEntry[] {
  const db = (store as any)['_db'];
  const now = Date.now();
  const currentCutoff = now - windowDays * MS_PER_DAY;
  const priorCutoff = now - 2 * windowDays * MS_PER_DAY;

  // Fetch edges with their connected memories' tags in one query per window.
  // Use COALESCE(last_hebbian_at, created_at) as the effective timestamp.
  const edgeQuery = `
    SELECT
      e.weight,
      e.source_id,
      e.target_id,
      src.tags AS source_tags,
      tgt.tags AS target_tags
    FROM memory_edges e
    JOIN memories src ON src.id = e.source_id
    JOIN memories tgt ON tgt.id = e.target_id
    WHERE COALESCE(e.last_hebbian_at, e.created_at) >= ?
      AND COALESCE(e.last_hebbian_at, e.created_at) < ?
  `;

  const currentEdges = db.prepare(edgeQuery).all(currentCutoff, now) as WindowEdge[];
  const priorEdges = db.prepare(edgeQuery).all(priorCutoff, currentCutoff) as WindowEdge[];

  const currentByTag = groupByTag(currentEdges);
  const priorByTag = groupByTag(priorEdges);

  // Track distinct memory IDs per tag in the current window
  const currentMemoriesByTag = memoryIdsByTag(currentEdges);

  const entries: DriftEntry[] = [];

  for (const tag of Object.keys(currentByTag)) {
    if (!(tag in priorByTag)) continue; // new cluster, skip

    const currentWeights = currentByTag[tag];
    const priorWeights = priorByTag[tag];

    const currentAvg = avg(currentWeights);
    const priorAvg = avg(priorWeights);

    if (priorAvg === 0) continue;

    const magnitude = (currentAvg - priorAvg) / priorAvg;

    if (Math.abs(magnitude) < threshold) continue;

    entries.push({
      tag,
      direction: magnitude > 0 ? 'strengthening' : 'weakening',
      currentAvgWeight: currentAvg,
      priorAvgWeight: priorAvg,
      magnitude,
      memoryCount: currentMemoriesByTag[tag]?.size ?? 0,
    });
  }

  entries.sort((a, b) => Math.abs(b.magnitude) - Math.abs(a.magnitude));
  return entries;
}

function parseTags(raw: string): string[] {
  const tags: string[] = JSON.parse(raw);
  return tags.filter(t => !EXCLUDED_TAGS.includes(t));
}

function groupByTag(edges: WindowEdge[]): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  for (const edge of edges) {
    const tags = new Set([
      ...parseTags(edge.source_tags),
      ...parseTags(edge.target_tags),
    ]);
    for (const tag of tags) {
      (result[tag] ??= []).push(edge.weight);
    }
  }
  return result;
}

function memoryIdsByTag(edges: WindowEdge[]): Record<string, Set<string>> {
  const result: Record<string, Set<string>> = {};
  for (const edge of edges) {
    const srcTags = parseTags(edge.source_tags);
    const tgtTags = parseTags(edge.target_tags);
    const allTags = new Set([...srcTags, ...tgtTags]);
    for (const tag of allTags) {
      const set = (result[tag] ??= new Set());
      if (srcTags.includes(tag)) set.add(edge.source_id);
      if (tgtTags.includes(tag)) set.add(edge.target_id);
    }
  }
  return result;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
