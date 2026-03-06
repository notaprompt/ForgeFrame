/**
 * @forgeframe/proxy -- Memory Injector
 *
 * Retrieves relevant context from @forgeframe/memory and formats
 * it for injection into the system prompt.
 */

import type { MemoryRetriever } from '@forgeframe/memory';
import type { MemoryInjector } from './types.js';

const HEADER = '[ForgeFrame Context]';
const FOOTER = '[End ForgeFrame Context]';

export class MemoryInjectorImpl implements MemoryInjector {
  private _retriever: MemoryRetriever;

  constructor(retriever: MemoryRetriever) {
    this._retriever = retriever;
  }

  async retrieve(text: string, limit = 5): Promise<string> {
    const results = this._retriever.query({ text, limit });
    if (results.length === 0) return '';

    const lines = results.map(
      (r) => `- [${r.score.toFixed(2)}] ${r.memory.content}`
    );

    return [
      HEADER,
      'The following context was retrieved from local memory (most relevant first):',
      ...lines,
      FOOTER,
    ].join('\n');
  }
}
