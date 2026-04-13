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
export type { MemoryEdge, EdgeCreateInput, EdgeRelationType, GuardianSignals, GuardianTemperature, ArtifactState, ArtifactStatus, MemoryType, HebbianBatchUpdate, ConsolidationCluster, ConsolidationProposal, ConsolidationResult, ContradictionProposal, ContradictionResult, ContradictionResolutionAction } from './types.js';
export { EDGE_RELATION_TYPES, MEMORY_TYPES, ARTIFACT_STATES } from './types.js';
export { MEMORY_ORGAN_MANIFEST, createMemoryOrganLifecycle } from './organ.js';
export { GuardianComputer } from './guardian.js';
export { HebbianEngine } from './hebbian.js';
export { ConsolidationEngine } from './consolidation.js';
export { ContradictionEngine } from './contradictions.js';
export { OllamaGenerator } from './generator.js';
export type { Generator, GeneratorConfig } from './generator.js';
