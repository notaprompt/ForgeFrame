/**
 * @forgeframe/memory — Persistent Semantic Memory
 *
 * Local-first memory layer with weighted retrieval, strength decay,
 * and background consolidation. The local-first primitive.
 */

export { MemoryStore } from './store.js';
export { MemoryRetriever } from './retrieval.js';
export { OllamaEmbedder } from './embedder.js';
export type { Embedder, EmbedderConfig } from './embedder.js';
export type {
  Memory,
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryQuery,
  MemoryResult,
  MemoryConfig,
  ReconsolidationOptions,
  Session,
  SessionCreateInput,
  SessionListOptions,
  TrimTag,
  DistilledArtifact,
  DistilledArtifactInput,
} from './types.js';
export { TRIM_TAGS, CONSTITUTIONAL_TAGS, LORA_ELIGIBLE_TAGS } from './types.js';
export { MEMORY_ORGAN_MANIFEST, createMemoryOrganLifecycle } from './organ.js';
