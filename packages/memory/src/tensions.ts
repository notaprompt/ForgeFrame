/**
 * @forgeframe/memory — Tension Detection
 *
 * Finds memory pairs that pull in different directions without contradicting.
 * These are productive tensions, not logical contradictions.
 *
 * Constitutional: Tensions are NEVER resolved by the system (invariant 13).
 * The system notices and makes visible; the founder holds tensions consciously.
 */

import type { MemoryStore } from './store.js';
import type { Memory } from './types.js';
import { CONSTITUTIONAL_TAGS } from './types.js';

export interface TensionCandidate {
  memoryA: Memory;
  memoryB: Memory;
  avgWeightA: number;
  avgWeightB: number;
  tagOverlap: number;
  tensionScore: number;
}

interface QualifiedMemory {
  memory: Memory;
  avgWeight: number;
}

/** Count of shared tags between two tag arrays. */
function tagOverlap(tagsA: string[], tagsB: string[]): number {
  const setA = new Set(tagsA);
  let shared = 0;
  for (const t of tagsB) if (setA.has(t)) shared++;
  return shared;
}

/** Whether a memory has any constitutional tag (principle/voice). */
function isConstitutional(memory: Memory): boolean {
  return memory.tags.some((t) => (CONSTITUTIONAL_TAGS as readonly string[]).includes(t));
}

/**
 * Find tension candidates: high-weight memory pairs from different tag clusters
 * with no existing edge between them.
 *
 * This is the graph-based pre-filter. LLM classification (productive vs concerning
 * vs compatible) happens in the REM orchestrator.
 */
export function findTensionCandidates(
  store: MemoryStore,
  maxTensions = 3,
): TensionCandidate[] {
  // 1. Get all memories that participate in the graph (have edges)
  const components = store.getConnectedComponents();
  const seenIds = new Set<string>();
  const allGraphMemoryIds: string[] = [];

  for (const cluster of components) {
    for (const id of cluster.memoryIds) {
      if (!seenIds.has(id)) {
        seenIds.add(id);
        allGraphMemoryIds.push(id);
      }
    }
  }

  // 2. For each, compute avg edge weight. Filter to avg > 1.0, exclude grounding + constitutional.
  const qualified: QualifiedMemory[] = [];

  for (const id of allGraphMemoryIds) {
    const memory = store.get(id);
    if (!memory) continue;

    // Exclude grounding valence
    if (memory.valence === 'grounding') continue;

    // Exclude constitutional tags
    if (isConstitutional(memory)) continue;

    const edges = store.getEdges(id);
    if (edges.length === 0) continue;

    const avgWeight = edges.reduce((sum, e) => sum + e.weight, 0) / edges.length;
    if (avgWeight <= 1.0) continue;

    qualified.push({ memory, avgWeight });
  }

  // 3. For each pair of qualifying memories, check tension criteria
  const candidates: TensionCandidate[] = [];

  for (let i = 0; i < qualified.length; i++) {
    for (let j = i + 1; j < qualified.length; j++) {
      const a = qualified[i];
      const b = qualified[j];

      // Must have NO edge between them
      const existingEdge = store.getEdgeBetween(a.memory.id, b.memory.id);
      if (existingEdge) continue;

      // Check tag overlap -- 2+ shared tags means too similar, skip
      const overlap = tagOverlap(a.memory.tags, b.memory.tags);
      if (overlap >= 2) continue;

      // Compute tension score: higher combined weight + lower tag overlap = more tension
      const totalTags = new Set([...a.memory.tags, ...b.memory.tags]).size;
      const overlapRatio = totalTags > 0 ? overlap / totalTags : 0;
      const tensionScore = (a.avgWeight + b.avgWeight) * (1 - overlapRatio);

      candidates.push({
        memoryA: a.memory,
        memoryB: b.memory,
        avgWeightA: a.avgWeight,
        avgWeightB: b.avgWeight,
        tagOverlap: overlap,
        tensionScore,
      });
    }
  }

  // 4. Sort by tension score descending, return top N
  candidates.sort((a, b) => b.tensionScore - a.tensionScore);
  return candidates.slice(0, maxTensions);
}
