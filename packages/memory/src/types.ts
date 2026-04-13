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

export const MEMORY_TYPES = ['semantic', 'episodic', 'principle', 'artifact'] as const;
export type MemoryType = typeof MEMORY_TYPES[number];

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
}

export interface MemoryCreateInput {
  content: string;
  embedding?: number[];
  sessionId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface MemoryUpdateInput {
  content?: string;
  embedding?: number[];
  tags?: string[];
  metadata?: Record<string, unknown>;
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

// --- Guardian types ---

export interface GuardianSignals {
  revisitWithoutAction: number;
  timeSinceLastArtifactExit: number;
  contradictionDensity: number;
  orphanRatio: number;
  decayVelocity: number;
  recursionDepth: number;
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
