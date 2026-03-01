/**
 * @forgeframe/memory — Persistent Semantic Memory
 *
 * Local-first memory layer with weighted retrieval, strength decay,
 * and background consolidation. The sovereign primitive.
 */

export { MemoryStore } from './store.js';
export { MemoryRetriever } from './retrieval.js';
export type {
  Memory,
  MemoryCreateInput,
  MemoryQuery,
  MemoryResult,
  MemoryConfig,
} from './types.js';
