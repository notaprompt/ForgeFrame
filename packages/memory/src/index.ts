/**
 * @forgeframe/memory — Persistent Semantic Memory
 *
 * Local-first memory layer with weighted retrieval, strength decay,
 * and background consolidation. The local-first primitive.
 */

export { MemoryStore } from './store.js';
export { MemoryRetriever } from './retrieval.js';
export type {
  Memory,
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryQuery,
  MemoryResult,
  MemoryConfig,
  Session,
  SessionCreateInput,
  SessionListOptions,
} from './types.js';
