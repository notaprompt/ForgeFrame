/**
 * @forgeframe/memory — Dream Seeding
 *
 * Anti-Hebbian recombination: pairs memories from disconnected graph
 * regions to surface novel connections. The founder grades each seed.
 *
 * Constitutional invariant: grounding/principle/voice memories are
 * never included. Grades are always founder-supplied, never auto-graded.
 */

import { randomUUID } from 'crypto';
import type { MemoryStore } from './store.js';
import type { Memory } from './types.js';

export interface DreamSeed {
  id: string;
  memories: Memory[];
  clusterIds: number[];
  hasCharged: boolean;
  createdAt: number;
}

export type SeedGrade = 'fire' | 'shrug' | 'miss';

export interface SeedResult {
  seedId: string;
  grade: SeedGrade;
  edgeCreated?: string;
}

const PROTECTED_TAGS = ['principle', 'voice'];
const RECENT_DAYS = 7;
const OLD_DAYS = 30;
const MS_PER_DAY = 86_400_000;

function isProtected(mem: Memory): boolean {
  return (
    mem.valence === 'grounding' ||
    mem.tags.some((t) => PROTECTED_TAGS.includes(t))
  );
}

interface EligibleCluster {
  index: number;
  memories: Memory[];
}

/**
 * Select dream seeds from disconnected graph regions.
 *
 * 1. Build clusters from connected components + orphan memories
 * 2. Filter out protected memories
 * 3. Pair memories from different clusters
 * 4. Rank by quality (charged + age diversity)
 */
export function selectSeeds(store: MemoryStore, maxSeeds = 5): DreamSeed[] {
  const components = store.getConnectedComponents();

  // Collect all memory IDs that belong to a component
  const inComponent = new Set<string>();
  for (const comp of components) {
    for (const id of comp.memoryIds) {
      inComponent.add(id);
    }
  }

  // Build eligible clusters: components + orphans as individual clusters
  const clusters: EligibleCluster[] = [];

  for (let i = 0; i < components.length; i++) {
    const eligible = components[i].memoryIds
      .map((id) => store.get(id))
      .filter((m): m is Memory => m !== null && !isProtected(m));
    if (eligible.length > 0) {
      clusters.push({ index: clusters.length, memories: eligible });
    }
  }

  // Orphan memories: those with no edges at all
  const allMemories = store.getRecent(10000);
  for (const mem of allMemories) {
    if (inComponent.has(mem.id)) continue;
    if (isProtected(mem)) continue;
    clusters.push({ index: clusters.length, memories: [mem] });
  }

  // Need at least 2 clusters to form seeds
  if (clusters.length < 2) return [];

  const now = Date.now();
  const recentCutoff = now - RECENT_DAYS * MS_PER_DAY;
  const oldCutoff = now - OLD_DAYS * MS_PER_DAY;

  interface Candidate {
    memA: Memory;
    memB: Memory;
    clusterA: number;
    clusterB: number;
    score: number;
  }

  const candidates: Candidate[] = [];

  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      for (const memA of clusters[i].memories) {
        for (const memB of clusters[j].memories) {
          // Exclude pairs that already share an edge
          if (store.getEdgeBetween(memA.id, memB.id)) continue;

          const hasCharged = memA.valence === 'charged' || memB.valence === 'charged';

          // Age diversity: one recent + one old
          const aRecent = memA.createdAt >= recentCutoff;
          const bRecent = memB.createdAt >= recentCutoff;
          const aOld = memA.createdAt < oldCutoff;
          const bOld = memB.createdAt < oldCutoff;
          const hasAgeDiversity = (aRecent && bOld) || (bRecent && aOld);

          let score = 0;
          if (hasCharged) score += 2;
          if (hasAgeDiversity) score += 1;

          candidates.push({
            memA,
            memB,
            clusterA: clusters[i].index,
            clusterB: clusters[j].index,
            score,
          });
        }
      }
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Take top maxSeeds
  const seeds: DreamSeed[] = [];
  for (const c of candidates) {
    if (seeds.length >= maxSeeds) break;
    seeds.push({
      id: randomUUID(),
      memories: [c.memA, c.memB],
      clusterIds: [c.clusterA, c.clusterB],
      hasCharged: c.memA.valence === 'charged' || c.memB.valence === 'charged',
      createdAt: now,
    });
  }

  return seeds;
}

/**
 * Apply a founder-supplied grade to a dream seed.
 *
 * - fire: create a 'related' edge between seed memories (weight 0.5)
 * - shrug: log inconclusive, no graph changes
 * - miss: log rejected, no graph changes
 */
export function applySeedGrade(
  store: MemoryStore,
  seed: DreamSeed,
  grade: SeedGrade,
): SeedResult {
  if (grade === 'fire') {
    const edge = store.createEdge({
      sourceId: seed.memories[0].id,
      targetId: seed.memories[1].id,
      relationType: 'related',
      weight: 0.5,
    });
    return { seedId: seed.id, grade, edgeCreated: edge.id };
  }

  return { seedId: seed.id, grade };
}
