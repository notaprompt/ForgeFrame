/**
 * @forgeframe/memory — Types
 */

export interface Memory {
  id: string;
  content: string;
  embedding: Float32Array | null;
  strength: number;
  accessCount: number;
  createdAt: number;
  lastAccessedAt: number;
  sessionId: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface MemoryCreateInput {
  content: string;
  embedding?: number[];
  sessionId?: string;
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

export interface MemoryConfig {
  dbPath: string;
  decayRate: number;       // strength reduction per day (0.0 - 1.0)
  decayFloor: number;      // minimum strength after decay (prevents total loss)
  consolidationThreshold: number; // min memories before consolidation runs
  embeddingDimension: number;
}

export const DEFAULT_CONFIG: MemoryConfig = {
  dbPath: './forgeframe.db',
  decayRate: 0.02,
  decayFloor: 0.1,
  consolidationThreshold: 100,
  embeddingDimension: 768,
};
