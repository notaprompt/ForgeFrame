/**
 * @forgeframe/memory — Contradiction Engine
 *
 * Scans for contradictions in the memory graph, generates LLM analysis,
 * and manages resolution proposals.
 *
 * Constitutional: principle/voice contradictions surfaced as tensions only — no auto-resolution.
 * Constitutional: analysis always runs on local LLM.
 */

import type { MemoryStore } from './store.js';
import type { Generator } from './generator.js';
import type { Memory, ContradictionProposal, ContradictionResult, ContradictionResolutionAction } from './types.js';
import { CONSTITUTIONAL_TAGS } from './types.js';

export class ContradictionEngine {
  private _store: MemoryStore;
  private _generator: Generator;

  constructor(store: MemoryStore, generator: Generator) {
    this._store = store;
    this._generator = generator;
  }

  /**
   * Scan for all contradicts edges, generate analysis proposals.
   * Constitutional pairs become tensions (surfaced but not auto-resolvable).
   */
  async scan(): Promise<ContradictionProposal[]> {
    // Find all contradicts edges
    const allEdges = this._store.getEdgesByType_global('contradicts');
    const proposals: ContradictionProposal[] = [];

    // Skip pairs that already have a pending proposal
    const existing = this._store.listContradictionProposals('pending');
    const existingPairs = new Set(existing.map((p) => [p.memoryAId, p.memoryBId].sort().join(':')));

    for (const edge of allEdges) {
      const pairKey = [edge.sourceId, edge.targetId].sort().join(':');
      if (existingPairs.has(pairKey)) continue;

      const memA = this._store.get(edge.sourceId);
      const memB = this._store.get(edge.targetId);
      if (!memA || !memB) continue;

      const isConstitutional = this._isConstitutional(memA) || this._isConstitutional(memB);

      // Generate LLM analysis
      const analysis = await this._analyze(memA, memB);
      if (!analysis) continue;

      const proposal = this._store.createContradictionProposal({
        memoryAId: memA.id,
        memoryBId: memB.id,
        edgeId: edge.id,
        analysis,
        isConstitutionalTension: isConstitutional,
      });
      proposals.push(proposal);
    }

    return proposals;
  }

  /**
   * Resolve a contradiction proposal with a chosen action.
   * Constitutional tensions cannot be resolved — only surfaced.
   */
  resolve(proposalId: string, action: ContradictionResolutionAction): ContradictionResult | null {
    const proposal = this._store.getContradictionProposal(proposalId);
    if (!proposal || proposal.status !== 'pending') return null;
    if (proposal.isConstitutionalTension) return null; // cannot resolve constitutional tensions

    const memA = this._store.get(proposal.memoryAId);
    const memB = this._store.get(proposal.memoryBId);
    if (!memA || !memB) return null;

    const result: ContradictionResult = {
      action,
      survivingMemoryId: null,
      mergedMemoryId: null,
      removedEdgeId: proposal.edgeId,
    };

    switch (action) {
      case 'supersede-a-with-b':
        this._store.supersede(proposal.memoryAId, proposal.memoryBId);
        result.survivingMemoryId = proposal.memoryBId;
        break;

      case 'supersede-b-with-a':
        this._store.supersede(proposal.memoryBId, proposal.memoryAId);
        result.survivingMemoryId = proposal.memoryAId;
        break;

      case 'merge': {
        const merged = this._store.create({
          content: `[Merged from contradiction]\n\nFrom A: ${memA.content}\n\nFrom B: ${memB.content}`,
          tags: [...new Set([...memA.tags, ...memB.tags])],
          metadata: {
            mergedFrom: [proposal.memoryAId, proposal.memoryBId],
          },
        });
        // Supersede both originals with the merged memory
        this._store.supersede(proposal.memoryAId, merged.id);
        this._store.supersede(proposal.memoryBId, merged.id);
        result.mergedMemoryId = merged.id;
        break;
      }

      case 'keep-both':
        // Remove contradicts edge, add related edge
        this._store.deleteEdge(proposal.edgeId);
        try {
          this._store.createEdge({
            sourceId: proposal.memoryAId,
            targetId: proposal.memoryBId,
            relationType: 'related',
          });
        } catch { /* skip if related edge already exists */ }
        break;
    }

    // Remove the contradicts edge (for supersede/merge cases — keep-both already handled)
    if (action !== 'keep-both') {
      this._store.deleteEdge(proposal.edgeId);
    }

    this._store.resolveContradictionProposal(proposalId, action);
    return result;
  }

  private _isConstitutional(memory: Memory): boolean {
    return memory.tags.some((t) =>
      (CONSTITUTIONAL_TAGS as readonly string[]).includes(t)
    );
  }

  private async _analyze(memA: Memory, memB: Memory): Promise<string | null> {
    const prompt = `You are analyzing a contradiction between two memories.

Memory A: ${memA.content}

Memory B: ${memB.content}

Explain in 2-3 sentences how these memories contradict each other. Be specific about what claims conflict.`;

    return this._generator.generate(prompt);
  }
}
