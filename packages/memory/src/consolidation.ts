/**
 * @forgeframe/memory — Consolidation Engine
 *
 * Discovers patterns by detecting dense clusters in the Hebbian graph,
 * summarizes them via local LLM, and manages the proposal lifecycle.
 *
 * Constitutional: consolidation always uses local models.
 * Constitutional: principle/voice memories never consolidated.
 * Depth limit: max 2 levels (raw -> pattern -> principle candidate).
 */

import type { MemoryStore } from './store.js';
import type { Generator } from './generator.js';
import type { Memory, ConsolidationCluster, ConsolidationProposal, ConsolidationResult } from './types.js';
import { CONSTITUTIONAL_TAGS } from './types.js';

const MIN_CLUSTER_SIZE = 5;
const MIN_AVG_WEIGHT = 1.2;
const MAX_DEPTH = 2;

export class ConsolidationEngine {
  private _store: MemoryStore;
  private _generator: Generator;

  constructor(store: MemoryStore, generator: Generator) {
    this._store = store;
    this._generator = generator;
  }

  findCandidateClusters(): ConsolidationCluster[] {
    const components = this._store.getConnectedComponents();
    const now = Date.now();

    return components.filter((cluster) => {
      if (cluster.memoryIds.length < MIN_CLUSTER_SIZE) return false;
      if (cluster.avgWeight < MIN_AVG_WEIGHT) return false;

      // Constitutional guard
      for (const id of cluster.memoryIds) {
        const mem = this._store.get(id);
        if (!mem) return false;
        if (this._isConstitutional(mem)) return false;
      }

      // Depth limit
      const depth = this._clusterDepth(cluster);
      if (depth >= MAX_DEPTH) return false;

      // Rejection cooldown
      const rejected = this._store.listProposals('rejected');
      for (const proposal of rejected) {
        if (proposal.rejectedUntil && proposal.rejectedUntil > now) {
          const overlap = proposal.cluster.memoryIds.some((id) =>
            cluster.memoryIds.includes(id)
          );
          if (overlap) return false;
        }
      }

      return true;
    });
  }

  async propose(cluster: ConsolidationCluster): Promise<ConsolidationProposal | null> {
    const memories: Memory[] = [];
    for (const id of cluster.memoryIds) {
      const mem = this._store.get(id);
      if (!mem) return null;
      memories.push(mem);
    }

    const prompt = this._buildSummaryPrompt(memories);
    const response = await this._generator.generate(prompt);
    if (!response) return null;

    const parsed = this._parseLLMResponse(response);
    if (!parsed) return null;

    const depth = this._clusterDepth(cluster) + 1;

    return this._store.createProposal({
      cluster,
      title: parsed.title,
      summary: parsed.summary,
      suggestedTags: parsed.suggestedTags,
      depth,
    });
  }

  approve(proposalId: string): ConsolidationResult | null {
    const proposal = this._store.getProposal(proposalId);
    if (!proposal || proposal.status !== 'pending') return null;

    const consolidated = this._store.create({
      content: `[Title]: ${proposal.title}\n[Insight]: ${proposal.summary}`,
      tags: proposal.suggestedTags,
      metadata: {
        consolidation: true,
        sourceIds: proposal.cluster.memoryIds,
        depth: proposal.depth,
      },
    });

    const result: ConsolidationResult = {
      consolidatedMemoryId: consolidated.id,
      derivedFromEdges: [],
      migratedEdges: [],
      sourcesDecayed: [],
    };

    const sourceIds = new Set(proposal.cluster.memoryIds);

    // derived-from edges
    for (const sourceId of sourceIds) {
      try {
        const edge = this._store.createEdge({
          sourceId: consolidated.id,
          targetId: sourceId,
          relationType: 'derived-from',
        });
        result.derivedFromEdges.push(edge.id);
      } catch { /* skip duplicates */ }
    }

    // Migrate external edges
    for (const sourceId of sourceIds) {
      const edges = this._store.getEdges(sourceId);
      for (const edge of edges) {
        const neighborId = edge.sourceId === sourceId ? edge.targetId : edge.sourceId;
        if (sourceIds.has(neighborId)) continue; // internal edge
        if (neighborId === consolidated.id) continue; // derived-from edge

        const existing = this._store.getEdgeBetween(consolidated.id, neighborId);
        if (existing) {
          if (edge.weight > existing.weight) {
            this._store.updateEdgeWeight(existing.id, edge.weight);
          }
        } else {
          try {
            const migrated = this._store.createEdge({
              sourceId: consolidated.id,
              targetId: neighborId,
              relationType: edge.relationType,
              weight: edge.weight,
            });
            result.migratedEdges.push(migrated.id);
          } catch { /* skip duplicates */ }
        }
      }
    }

    // Halve source strength
    for (const sourceId of sourceIds) {
      const mem = this._store.get(sourceId);
      if (mem) {
        this._store.resetStrength(sourceId, mem.strength * 0.5);
        result.sourcesDecayed.push(sourceId);
      }
    }

    this._store.resolveProposal(proposalId, 'approved');
    return result;
  }

  reject(proposalId: string): ConsolidationProposal | null {
    return this._store.resolveProposal(proposalId, 'rejected');
  }

  private _isConstitutional(memory: Memory): boolean {
    return memory.tags.some((t) =>
      (CONSTITUTIONAL_TAGS as readonly string[]).includes(t)
    );
  }

  private _clusterDepth(cluster: ConsolidationCluster): number {
    let maxDepth = 0;
    for (const id of cluster.memoryIds) {
      const mem = this._store.get(id);
      if (mem?.metadata.consolidation && typeof mem.metadata.depth === 'number') {
        maxDepth = Math.max(maxDepth, mem.metadata.depth as number);
      }
    }
    return maxDepth;
  }

  private _buildSummaryPrompt(memories: Memory[]): string {
    const contents = memories
      .map((m, i) => `Memory ${i + 1}:\n${m.content}`)
      .join('\n\n---\n\n');

    return `You are summarizing a cluster of related memories into a single pattern.

Here are the memories:

${contents}

Respond with a JSON object (no markdown fencing):
{
  "title": "short title for the pattern (under 80 chars)",
  "summary": "2-3 sentence summary capturing the core insight",
  "patterns": ["list of extracted patterns"],
  "suggestedTags": ["pattern"]
}`;
  }

  private _parseLLMResponse(response: string): {
    title: string;
    summary: string;
    suggestedTags: string[];
  } | null {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.title || !parsed.summary) return null;

      return {
        title: String(parsed.title),
        summary: String(parsed.summary),
        suggestedTags: Array.isArray(parsed.suggestedTags)
          ? parsed.suggestedTags.map(String)
          : ['pattern'],
      };
    } catch {
      return null;
    }
  }
}
