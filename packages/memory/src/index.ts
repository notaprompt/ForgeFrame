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
export { findDuplicate } from './dedup.js';
export { computeSleepPressure } from './sleep-pressure.js';
export type { SleepPressure } from './types.js';
export { NremPhase } from './dream-nrem.js';
export type { NremResult, SourceCalibrationEntry } from './dream-nrem.js';
export { writeDreamJournal } from './dream-journal.js';
export type { DreamJournalInput, GraphHealthStats } from './dream-journal.js';
export { selectSeeds, applySeedGrade } from './dream-seeding.js';
export type { DreamSeed, SeedGrade, SeedResult } from './dream-seeding.js';
export { findHindsightCandidates, applyHindsightResponse } from './hindsight.js';
export type { HindsightCandidate, HindsightResponse, HindsightResult } from './hindsight.js';
export { findTensionCandidates } from './tensions.js';
export type { TensionCandidate } from './tensions.js';
export { RemPhase } from './dream-rem.js';
export type { RemResult } from './dream-rem.js';
