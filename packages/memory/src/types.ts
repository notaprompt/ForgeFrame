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
