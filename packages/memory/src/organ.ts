/**
 * @forgeframe/memory — Organ Interface Adapter
 *
 * Wraps MemoryStore + MemoryRetriever as a ForgeFrame organ with
 * manifest, lifecycle, and provenance tracking.
 */

import type {
  OrganManifest,
  OrganLifecycle,
  OrganInput,
  OrganOutput,
  OrganHealth,
  OrganProvenanceRecord,
} from '@forgeframe/core';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import type { MemoryStore } from './store.js';
import type { MemoryRetriever } from './retrieval.js';

function hashData(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export const MEMORY_ORGAN_MANIFEST: OrganManifest = {
  id: 'forgeframe.memory.sqlite',
  name: 'SQLite Memory',
  version: '0.1.0',
  description: 'Persistent semantic memory with FTS5 full-text search, strength decay, and embedding-based retrieval.',
  categories: ['memory', 'embedding'],
  capabilities: [
    {
      action: 'store',
      quality: 0.85,
      speed: 'fast',
      inputModalities: ['text', 'structured-data'],
      outputModalities: ['structured-data'],
    },
    {
      action: 'retrieve',
      quality: 0.88,
      speed: 'fast',
      inputModalities: ['text', 'embedding-vector'],
      outputModalities: ['text', 'structured-data'],
    },
    {
      action: 'embed',
      quality: 0.80,
      speed: 'fast',
      inputModalities: ['text'],
      outputModalities: ['embedding-vector'],
    },
  ],
  resources: {
    ramMb: 50,
    vramMb: 0,
    diskMb: 100,
    network: false,
    warmupTime: 'instant',
    concurrent: true,
  },
  trust: {
    execution: 'local-only',
    dataClassifications: ['public', 'internal', 'sensitive', 'cognitive', 'constitutional'],
    canPersist: true,
    telemetry: false,
  },
  io: {
    inputs: [
      { name: 'content', modality: 'text', required: true, classification: 'internal' },
      { name: 'query', modality: 'text', required: false, classification: 'internal' },
    ],
    outputs: [
      { name: 'memories', modality: 'structured-data', required: true, classification: 'internal' },
      { name: 'memory_id', modality: 'structured-data', required: false, classification: 'internal' },
    ],
  },
};

export function createMemoryOrganLifecycle(
  store: MemoryStore,
  retriever: MemoryRetriever,
): OrganLifecycle {
  return {
    async register(): Promise<boolean> {
      return true;
    },

    async activate(): Promise<void> {
      // SQLite is always available — no-op
    },

    async execute(input: OrganInput): Promise<OrganOutput> {
      const start = Date.now();
      const action = input.slots.action as string;
      let outputSlots: Record<string, unknown>;

      if (action === 'store') {
        const memory = store.create({
          content: input.slots.content as string,
          tags: (input.slots.tags as string[]) ?? [],
        });
        outputSlots = { memory_id: memory.id, memory };
      } else if (action === 'retrieve') {
        const results = retriever.query({
          text: input.slots.query as string,
          tags: input.slots.tags as string[] | undefined,
          limit: (input.slots.limit as number) ?? 10,
        });
        outputSlots = { memories: results };
      } else {
        throw new Error(`Unknown memory organ action: ${action}`);
      }

      const durationMs = Date.now() - start;

      const provenance: OrganProvenanceRecord = {
        invocationId: randomUUID(),
        requestId: input.requestId,
        organId: MEMORY_ORGAN_MANIFEST.id,
        organVersion: MEMORY_ORGAN_MANIFEST.version,
        timestamp: start,
        durationMs,
        inputHash: hashData(input.slots),
        outputHash: hashData(outputSlots),
        classificationsProcessed: ['internal'],
        trustLevel: 'local-only',
      };

      return { slots: outputSlots, provenance };
    },

    async deactivate(): Promise<void> {
      // No-op — SQLite handles its own cleanup
    },

    async health(): Promise<OrganHealth> {
      const count = store.count();
      return {
        status: 'healthy',
        message: `SQLite memory store operational. ${count} memories stored.`,
      };
    },
  };
}
