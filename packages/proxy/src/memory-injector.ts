/**
 * @forgeframe/proxy -- Memory Injector
 *
 * Retrieves relevant context from @forgeframe/memory and formats
 * it for injection into the system prompt.
 * Uses semantic search when an embedder is available, falls back to FTS.
 */

import type { MemoryRetriever } from '@forgeframe/memory';
import type { MemoryInjector } from './types.js';

const HEADER = '[ForgeFrame Context]';
const FOOTER = '[End ForgeFrame Context]';
const MIN_RELEVANCE = 0.15;

export class MemoryInjectorImpl implements MemoryInjector {
  private _retriever: MemoryRetriever;
  private _semantic: boolean;

  constructor(retriever: MemoryRetriever, semantic = false) {
    this._retriever = retriever;
    this._semantic = semantic;
  }

  async retrieve(text: string, limit = 5): Promise<string> {
    const results = this._semantic
      ? await this._retriever.semanticQuery({ text, limit, minStrength: 0.05 })
      : this._retriever.query({ text, limit, minStrength: 0.05 });

    // Filter low-relevance results
    const filtered = results.filter((r) => r.score >= MIN_RELEVANCE);
    if (filtered.length === 0) return '';

    const lines = filtered.map((r) => {
      const tags = r.memory.tags.length > 0 ? ` (${r.memory.tags.join(', ')})` : '';
      const truncated = r.memory.content.length > 500
        ? r.memory.content.slice(0, 497) + '...'
        : r.memory.content;
      return `- [${r.score.toFixed(2)}${tags}] ${truncated}`;
    });

    return [
      HEADER,
      'The following context was retrieved from local memory (most relevant first):',
      ...lines,
      FOOTER,
    ].join('\n');
  }
}
