/**
 * @forgeframe/memory — Graph Clustering
 *
 * Computes cluster assignments for the Cockpit graph view.
 * Uses connected components for grouping, dominant custom tag for labeling.
 */

import type { MemoryStore } from './store.js';
import type { Memory } from './types.js';
import { TRIM_TAGS } from './types.js';

const EDGE_TYPE_WEIGHTS: Record<string, number> = {
  'led-to': 3,
  'contradicts': 2,
  'supersedes': 2,
  'implements': 2,
  'derived-from': 1.5,
  'related': 1,
  'similar': 0.5,
};

const MIN_CLUSTER_SIZE = 3;
const SYSTEM_TAGS = new Set([...TRIM_TAGS, 'dream-journal']);

export interface ClusteredNode {
  id: string;
  content: string;
  tags: string[];
  strength: number;
  valence: string;
  memoryType: string;
  createdAt: number;
  accessCount: number;
  visualWeight: number;
  parent: string | null;
}

export interface ClusterInfo {
  id: string;
  label: string;
  memberCount: number;
  avgStrength: number;
  dominantTrimTag: string;
}

export interface ClusteredGraph {
  nodes: ClusteredNode[];
  clusters: ClusterInfo[];
  edges: Array<{ id: string; source: string; target: string; relationType: string; weight: number }>;
}

function getCustomTags(tags: string[]): string[] {
  return tags.filter(t => !SYSTEM_TAGS.has(t as any));
}

function getDominantTag(memories: Memory[], custom: boolean): string {
  const counts = new Map<string, number>();
  for (const mem of memories) {
    const tags = custom ? getCustomTags(mem.tags) : mem.tags;
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  let best = '';
  let bestCount = 0;
  for (const [tag, count] of counts) {
    if (count > bestCount) { best = tag; bestCount = count; }
  }
  return best || 'uncategorized';
}

function getDominantTrimTag(memories: Memory[]): string {
  const trimSet = new Set<string>(TRIM_TAGS as readonly string[]);
  const counts = new Map<string, number>();
  for (const mem of memories) {
    for (const tag of mem.tags) {
      if (trimSet.has(tag)) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  let best = 'observation';
  let bestCount = 0;
  for (const [tag, count] of counts) {
    if (count > bestCount) { best = tag; bestCount = count; }
  }
  return best;
}

function computeVisualWeight(store: MemoryStore, memoryId: string): number {
  const edges = store.getEdges(memoryId);
  let weight = 0;
  for (const edge of edges) {
    weight += EDGE_TYPE_WEIGHTS[edge.relationType] ?? 1;
  }
  return weight;
}

export function computeClusters(store: MemoryStore): ClusteredGraph {
  const components = store.getConnectedComponents();
  const allMemories = store.getRecent(10000);
  const allEdges: ClusteredGraph['edges'] = [];

  const edgeIds = new Set<string>();
  for (const mem of allMemories) {
    for (const edge of store.getEdges(mem.id)) {
      if (!edgeIds.has(edge.id)) {
        edgeIds.add(edge.id);
        allEdges.push({
          id: edge.id,
          source: edge.sourceId,
          target: edge.targetId,
          relationType: edge.relationType,
          weight: edge.weight,
        });
      }
    }
  }

  const memoryToComponent = new Map<string, number>();
  for (let i = 0; i < components.length; i++) {
    for (const id of components[i].memoryIds) {
      memoryToComponent.set(id, i);
    }
  }

  const clusters: ClusterInfo[] = [];
  const nodeParent = new Map<string, string>();

  // Cluster connected components with 3+ members
  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    if (comp.memoryIds.length < MIN_CLUSTER_SIZE) continue;

    const members = comp.memoryIds.map(id => store.get(id)).filter(Boolean) as Memory[];
    if (members.length < MIN_CLUSTER_SIZE) continue;

    const label = getDominantTag(members, true);
    const trimTag = getDominantTrimTag(members);
    const avgStrength = members.reduce((sum, m) => sum + m.strength, 0) / members.length;
    const clusterId = 'cluster-' + label.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '-' + i;

    clusters.push({
      id: clusterId,
      label,
      memberCount: members.length,
      avgStrength: Math.round(avgStrength * 100) / 100,
      dominantTrimTag: trimTag,
    });

    for (const id of comp.memoryIds) {
      nodeParent.set(id, clusterId);
    }
  }

  // Orphan memories: group by custom tag if 3+ share one
  const orphans = allMemories.filter(m => !memoryToComponent.has(m.id));
  const orphansByTag = new Map<string, Memory[]>();
  for (const mem of orphans) {
    const customTags = getCustomTags(mem.tags);
    for (const tag of customTags) {
      const list = orphansByTag.get(tag) || [];
      list.push(mem);
      orphansByTag.set(tag, list);
    }
  }

  const assignedOrphans = new Set<string>();
  for (const [tag, members] of orphansByTag) {
    const unassigned = members.filter(m => !assignedOrphans.has(m.id));
    if (unassigned.length < MIN_CLUSTER_SIZE) continue;

    const trimTag = getDominantTrimTag(unassigned);
    const avgStrength = unassigned.reduce((sum, m) => sum + m.strength, 0) / unassigned.length;
    const clusterId = 'cluster-orphan-' + tag.replace(/[^a-z0-9]/gi, '-').toLowerCase();

    clusters.push({
      id: clusterId,
      label: tag,
      memberCount: unassigned.length,
      avgStrength: Math.round(avgStrength * 100) / 100,
      dominantTrimTag: trimTag,
    });

    for (const mem of unassigned) {
      nodeParent.set(mem.id, clusterId);
      assignedOrphans.add(mem.id);
    }
  }

  const nodes: ClusteredNode[] = allMemories.map(mem => ({
    id: mem.id,
    content: mem.content,
    tags: mem.tags,
    strength: mem.strength,
    valence: mem.valence,
    memoryType: mem.memoryType,
    createdAt: mem.createdAt,
    accessCount: mem.accessCount,
    visualWeight: computeVisualWeight(store, mem.id),
    parent: nodeParent.get(mem.id) || null,
  }));

  return { nodes, clusters, edges: allEdges };
}
