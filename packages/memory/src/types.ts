/**
 * @forgeframe/memory — Types
 */

/**
 * TRIM-mapped taxonomy: tags across 3 cognitive layers + cross-layer.
 *
 * Object Layer (observation):  observation, entity, milestone
 * Observer Layer (evaluation): pattern, evaluation
 * Interpreter Layer (identity): principle, voice
 * Cross-layer:                 decision, thread, skill
 */
export const TRIM_TAGS = [
  'observation',
  'entity',
  'milestone',
  'pattern',
  'evaluation',
  'principle',
  'voice',
  'decision',
  'thread',
  'skill',
] as const;

export type TrimTag = (typeof TRIM_TAGS)[number];

/** Constitutional tags are exempt from decay (identity kernel). */
export const CONSTITUTIONAL_TAGS: readonly TrimTag[] = ['principle', 'voice'] as const;

/** Tags eligible for memory transformation (LoRA fine-tuning). Classification ceiling. */
export const LORA_ELIGIBLE_TAGS: readonly TrimTag[] = ['principle', 'voice', 'pattern', 'skill'] as const;

export const VALENCE_STATES = ['charged', 'neutral', 'grounding'] as const;
export type Valence = (typeof VALENCE_STATES)[number];

export const MEMORY_TYPES = ['semantic', 'episodic', 'principle', 'artifact'] as const;
export type MemoryType = typeof MEMORY_TYPES[number];

/**
 * Sensitivity levels (sovereignty layer — Wave 2 Phase 4 enforcement).
 *
 * - `public` (default): memory can be sent to frontier model providers without restriction.
 * - `sensitive`: memory must be anonymized/abstracted before crossing the frontier boundary.
 * - `local-only`: memory never crosses the frontier boundary. Local inference only.
 *
 * v1 is TAGGING + OBSERVABILITY ONLY. No enforcement is applied; `sovereigntyCheck()`
 * in @forgeframe/server logs a warning when sensitive/local-only memories are bound
 * for a frontier destination but does NOT block the call. Enforcement arrives with
 * the Phase 4 routing work.
 */
export const SENSITIVITY_LEVELS = ['public', 'sensitive', 'local-only'] as const;
export type Sensitivity = typeof SENSITIVITY_LEVELS[number];

export const MEMORY_TYPE_STABILITY_MULTIPLIER: Record<string, number> = {
  semantic: 2.0,      // general knowledge decays slower
  episodic: 1.0,      // events decay at base rate
  principle: Infinity, // never decays (also protected by constitutional tags)
  artifact: 1.5,      // artifacts decay slower than episodes
};

export interface Memory {
  id: string;
  content: string;
  embedding: Float32Array | null;
  strength: number;
  accessCount: number;
  retrievalCount: number;
  createdAt: number;
  lastAccessedAt: number;
  lastDecayAt: number;
  sessionId: string | null;
  tags: string[];
  associations: string[];
  metadata: Record<string, unknown>;
  validFrom?: number;
  supersededBy?: string;
  supersededAt?: number;
  memoryType: MemoryType;
  readiness: number;
  valence: Valence;
  lastHindsightReview: number | null;
  sensitivity: Sensitivity;
}

export interface MemoryCreateInput {
  content: string;
  embedding?: number[];
  sessionId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  valence?: Valence;
  sensitivity?: Sensitivity;
}

export interface MemoryUpdateInput {
  content?: string;
  embedding?: number[];
  tags?: string[];
  metadata?: Record<string, unknown>;
  sensitivity?: Sensitivity;
}

export interface MemoryQuery {
  text?: string;
  embedding?: number[];
  tags?: string[];
  sessionId?: string;
  limit?: number;
  minStrength?: number;
}

export interface MemoryResult {
  memory: Memory;
  score: number;
  /**
   * Binary validity signal for v1.
   *
   * - 1 when the memory has NOT been superseded by another memory.
   * - 0 when at least one inbound supersession edge points at this memory
   *   (a newer memory has explicitly superseded / corrected this one).
   *
   * v1 semantic (per 2026-04-21 team meeting): look ONLY at inbound
   * `supersedes` edges. The binding decision calls this a `corrects` edge;
   * in the ForgeFrame schema the same relation is named `supersedes`
   * (see EDGE_RELATION_TYPES). Either `supersedes` OR `contradicts` with
   * a resolution would express this, but we stick to `supersedes` — that's
   * how `store.supersede()` records it.
   *
   * DEFERRED to v2: composite scoring (contradiction weight, validUntil
   * timestamps, half-life decay). Do not overload this field.
   */
  validity: 0 | 1;
  /**
   * Ids of memories connected to this result via any edge (inbound or
   * outbound), deduped. Capped at `MAX_NEIGHBORS` (10) to keep search
   * payloads bounded. Ordered by edge weight descending (strongest first).
   *
   * Clients that need full neighbor rows should fetch them separately
   * via `memory_search` or `memory_graph`.
   */
  neighbors: string[];
}

export interface ReconsolidationOptions {
  relevanceScore: number;
  query?: string;
  coRetrievedIds?: string[];
}

export interface MemoryConfig {
  dbPath: string;
  decayFloor: number;      // minimum strength after decay (prevents total loss)
  baseStability: number;   // days until 50% retention (default 7)
  accessMultiplier: number; // stability boost per access (default 0.5)
  consolidationThreshold: number; // min memories before consolidation runs
  embeddingDimension: number;
  reconsolidation: boolean; // enable retrieval-modifies-memory (default true)
}

export interface Session {
  id: string;
  startedAt: number;
  endedAt: number | null;
  metadata: Record<string, unknown>;
}

export interface SessionCreateInput {
  metadata?: Record<string, unknown>;
}

export interface SessionListOptions {
  status?: 'active' | 'ended' | 'all';
  limit?: number;
}

export const DEFAULT_CONFIG: MemoryConfig = {
  dbPath: './forgeframe.db',
  decayFloor: 0.1,
  baseStability: 7,
  accessMultiplier: 0.5,
  consolidationThreshold: 100,
  embeddingDimension: 768,
  reconsolidation: true,
};

// -- Distilled Artifacts --

export interface DistilledArtifact {
  id: string;
  sourceUrl: string | null;
  sourceType: string;
  rawHash: string;
  distilled: string | null;
  refined: string | null;
  organChain: Array<{ organId: string; version: string; durationMs: number }>;
  memoryId: string | null;
  tags: string[];
  createdAt: number;
  fedToMemory: number | null;
}

export interface DistilledArtifactInput {
  sourceUrl?: string;
  sourceType: string;
  rawHash: string;
  distilled?: string;
  refined?: string;
  organChain?: Array<{ organId: string; version: string; durationMs: number }>;
  tags?: string[];
}

// --- Edge types ---

export const EDGE_RELATION_TYPES = [
  'led-to', 'contradicts', 'supersedes', 'implements',
  'similar', 'derived-from', 'related',
] as const;
export type EdgeRelationType = typeof EDGE_RELATION_TYPES[number];

export interface MemoryEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: EdgeRelationType;
  weight: number;
  createdAt: number;
  lastHebbianAt: number | null;
  metadata: Record<string, unknown>;
}

export interface EdgeCreateInput {
  sourceId: string;
  targetId: string;
  relationType: EdgeRelationType;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export interface HebbianBatchUpdate {
  strengthened: Array<{ edgeId: string; weight: number }>;
  weakened: Array<{ edgeId: string; weight: number }>;
  pruned: string[];
  created: Array<{ edgeId: string; sourceId: string; targetId: string; weight: number }>;
}

// --- Consolidation types ---

export interface ConsolidationCluster {
  memoryIds: string[];
  avgWeight: number;
  edgeCount: number;
}

export interface ConsolidationProposal {
  id: string;
  cluster: ConsolidationCluster;
  title: string;
  summary: string;
  suggestedTags: string[];
  status: 'pending' | 'approved' | 'rejected';
  depth: number;
  createdAt: number;
  resolvedAt: number | null;
  rejectedUntil: number | null;
}

export interface ConsolidationResult {
  consolidatedMemoryId: string;
  derivedFromEdges: string[];
  migratedEdges: string[];
  sourcesDecayed: string[];
}

// --- Contradiction types ---

export type ContradictionResolutionAction =
  | 'supersede-a-with-b'
  | 'supersede-b-with-a'
  | 'merge'
  | 'keep-both';

export interface ContradictionProposal {
  id: string;
  memoryAId: string;
  memoryBId: string;
  edgeId: string;
  analysis: string;
  isConstitutionalTension: boolean;
  status: 'pending' | 'resolved';
  resolution: ContradictionResolutionAction | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface ContradictionResult {
  action: ContradictionResolutionAction;
  survivingMemoryId: string | null;   // null for keep-both
  mergedMemoryId: string | null;      // only for merge
  removedEdgeId: string;              // the contradicts edge
}

// --- Sleep pressure types ---

export interface SleepPressure {
  score: number;
  components: {
    unconsolidated: number;
    hoursSinceLastDream: number;
    unscannedContradictions: number;
    pendingDecay: number;
  };
  recommendation: 'sleep' | 'nrem' | 'full';
}

// --- Guardian types ---

export interface DevActiveState {
  idleSeconds: number;
  active: boolean;
}

export interface GuardianSignals {
  revisitWithoutAction: number;
  timeSinceLastArtifactExit: number;
  contradictionDensity: number;
  orphanRatio: number;
  decayVelocity: number;
  recursionDepth: number;
  hebbianImbalance: number;
  /** Informational only -- does not affect temperature. Resolved from idle detection if not supplied. */
  devActive?: boolean;
}

export interface GuardianTemperature {
  value: number;
  state: 'calm' | 'warm' | 'trapped';
  signals: GuardianSignals;
  computedAt: number;
}

// --- Artifact types ---

export const ARTIFACT_STATES = ['draft', 'ready', 'shipped', 'trapped'] as const;
export type ArtifactState = typeof ARTIFACT_STATES[number];

export interface ArtifactStatus {
  memoryId: string;
  state: ArtifactState;
  readiness: number;
  promotedAt: number;
  shippedAt?: number;
}
