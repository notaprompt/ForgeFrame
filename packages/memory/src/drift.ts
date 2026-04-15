/**
 * @forgeframe/memory — Drift Detection
 *
 * Compares edge weight distribution by tag cluster across two time windows
 * to detect which belief areas are strengthening and which are weakening.
 *
 * "Your beliefs have shifted toward X over the last month."
 */

import type { MemoryStore } from './store.js';

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
