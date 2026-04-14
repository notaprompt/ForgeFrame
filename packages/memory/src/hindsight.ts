/**
 * @forgeframe/memory — Hindsight Review
 *
 * Anti-Hebbian audit that surfaces entrenched memories for founder review.
 * Catches blind spots: memories that got strong through repetition, not truth.
 *
 * Constitutional invariant 12: never weakens without founder confirmation.
 * The engine only provides candidates and applies responses.
 */

import type { MemoryStore } from './store.js';
import type { Memory } from './types.js';
import { CONSTITUTIONAL_TAGS } from './types.js';

const DAY_MS = 86_400_000;
const MIN_AGE_DAYS = 14;
const REVIEW_COOLDOWN_DAYS = 30;
const AVG_WEIGHT_THRESHOLD = 1.5;
const WEAKEN_AMOUNT = 0.3;
const WEAKEN_FLOOR = 0.05;
const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 3;

export interface HindsightCandidate {
  memory: Memory;
  avgEdgeWeight: number;
  edgeCount: number;
  scrutinyScore: number;
  ageInDays: number;
}

export type HindsightResponse = 'keep' | 'weaken' | 'revise';

export interface HindsightResult {
  memoryId: string;
  response: HindsightResponse;
  previousAvgWeight: number;
  newAvgWeight: number | null;
  revisedContent: string | null;
}

export function findHindsightCandidates(
  store: MemoryStore,
  limit?: number,
): HindsightCandidate[] {
  const now = Date.now();
  const ageCutoff = now - MIN_AGE_DAYS * DAY_MS;
  const reviewCutoff = now - REVIEW_COOLDOWN_DAYS * DAY_MS;
  const effectiveLimit = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  // Get all memories via raw SQL to filter efficiently
  const db = (store as any)['_db'];
  const rowToMemory = (store as any)['_rowToMemory'].bind(store) as (row: any) => Memory;

  const rows = db.prepare(`
    SELECT * FROM memories
    WHERE created_at < ?
      AND tags NOT LIKE '%"principle"%'
      AND tags NOT LIKE '%"voice"%'
      AND (last_hindsight_review IS NULL OR last_hindsight_review < ?)
  `).all(ageCutoff, reviewCutoff) as any[];

  const candidates: HindsightCandidate[] = [];

  for (const row of rows) {
    const mem = rowToMemory(row);

    // Skip grounding valence (constitutional, never reviewed)
    if (mem.valence === 'grounding') continue;

    const edges = store.getEdges(mem.id);
    if (edges.length === 0) continue;

    // Check for contradictions
    const hasContradiction = edges.some(e => e.relationType === 'contradicts');
    if (hasContradiction) continue;

    // Compute average edge weight
    const avgWeight = edges.reduce((sum, e) => sum + e.weight, 0) / edges.length;
    if (avgWeight <= AVG_WEIGHT_THRESHOLD) continue;

    const ageInDays = (now - mem.createdAt) / DAY_MS;
    const valenceMultiplier = mem.valence === 'charged' ? 1.5 : 1.0;
    const scrutinyScore = avgWeight * valenceMultiplier;

    candidates.push({
      memory: mem,
      avgEdgeWeight: avgWeight,
      edgeCount: edges.length,
      scrutinyScore,
      ageInDays,
    });
  }

  // Sort by scrutiny score descending
  candidates.sort((a, b) => b.scrutinyScore - a.scrutinyScore);

  return candidates.slice(0, effectiveLimit);
}

export function applyHindsightResponse(
  store: MemoryStore,
  candidate: HindsightCandidate,
  response: HindsightResponse,
  revisedContent?: string,
): HindsightResult {
  const { memory } = candidate;

  if (response === 'keep') {
    store.setHindsightReviewed(memory.id);
    return {
      memoryId: memory.id,
      response: 'keep',
      previousAvgWeight: candidate.avgEdgeWeight,
      newAvgWeight: null,
      revisedContent: null,
    };
  }

  if (response === 'weaken') {
    const edges = store.getEdges(memory.id);

    for (const edge of edges) {
      // Skip constitutional edges
      const source = store.get(edge.sourceId);
      const target = store.get(edge.targetId);
      const isConstitutional =
        source?.tags.some(t => (CONSTITUTIONAL_TAGS as readonly string[]).includes(t)) ||
        target?.tags.some(t => (CONSTITUTIONAL_TAGS as readonly string[]).includes(t));
      if (isConstitutional) continue;

      const newWeight = Math.max(WEAKEN_FLOOR, edge.weight - WEAKEN_AMOUNT);
      store.updateEdgeWeight(edge.id, newWeight);
    }

    store.setHindsightReviewed(memory.id);

    // Recompute avg weight
    const updatedEdges = store.getEdges(memory.id);
    const newAvg = updatedEdges.length > 0
      ? updatedEdges.reduce((sum, e) => sum + e.weight, 0) / updatedEdges.length
      : 0;

    return {
      memoryId: memory.id,
      response: 'weaken',
      previousAvgWeight: candidate.avgEdgeWeight,
      newAvgWeight: newAvg,
      revisedContent: null,
    };
  }

  // response === 'revise'
  const separator = '\n\n---\n[Hindsight revision]\n';
  const newContent = memory.content + separator + (revisedContent ?? '');
  store.update(memory.id, { content: newContent });
  store.setHindsightReviewed(memory.id);

  return {
    memoryId: memory.id,
    response: 'revise',
    previousAvgWeight: candidate.avgEdgeWeight,
    newAvgWeight: null,
    revisedContent: newContent,
  };
}
