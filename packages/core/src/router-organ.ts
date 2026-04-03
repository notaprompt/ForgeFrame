/**
 * @forgeframe/core — Router Organ Interface Adapter
 *
 * Wraps ForgeFrameRouter as a ForgeFrame organ with manifest,
 * lifecycle, and provenance tracking.
 */

import type {
  OrganManifest,
  OrganLifecycle,
  OrganInput,
  OrganOutput,
  OrganHealth,
  OrganProvenanceRecord,
} from './organ-types.js';
import type { ForgeFrameRouter } from './router.js';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

function hashData(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export const ROUTER_ORGAN_MANIFEST: OrganManifest = {
  id: 'forgeframe.routing.intent',
  name: 'Intent Router',
  version: '0.1.0',
  description: 'Routes user messages to the optimal model based on intent signals and tier-based routing.',
  categories: ['routing'],
  capabilities: [
    {
      action: 'route',
      quality: 0.70,
      speed: 'instant',
      inputModalities: ['text'],
      outputModalities: ['structured-data'],
    },
  ],
  resources: {
    ramMb: 1,
    vramMb: 0,
    diskMb: 0,
    network: false,
    warmupTime: 'instant',
    concurrent: true,
  },
  trust: {
    execution: 'local-only',
    dataClassifications: ['public', 'internal', 'sensitive', 'cognitive', 'constitutional'],
    canPersist: false,
    telemetry: false,
  },
  io: {
    inputs: [
      { name: 'message', modality: 'text', required: true, classification: 'internal' },
    ],
    outputs: [
      { name: 'resolved_model', modality: 'structured-data', required: true, classification: 'internal' },
    ],
  },
};

export function createRouterOrganLifecycle(
  router: ForgeFrameRouter,
): OrganLifecycle {
  return {
    async register(): Promise<boolean> {
      return true;
    },

    async activate(): Promise<void> {
      // Router is stateless — no-op
    },

    async execute(input: OrganInput): Promise<OrganOutput> {
      const start = Date.now();
      const message = input.slots.message as string;
      const resolved = router.resolveModel(message);

      const outputSlots: Record<string, unknown> = { resolved_model: resolved };
      const durationMs = Date.now() - start;

      const provenance: OrganProvenanceRecord = {
        invocationId: randomUUID(),
        requestId: input.requestId,
        organId: ROUTER_ORGAN_MANIFEST.id,
        organVersion: ROUTER_ORGAN_MANIFEST.version,
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
      // No-op
    },

    async health(): Promise<OrganHealth> {
      return {
        status: 'healthy',
        message: 'Intent router operational.',
      };
    },
  };
}
