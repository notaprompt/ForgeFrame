/**
 * @forgeframe/proxy — Organ Interface Adapter
 *
 * Wraps the proxy scrubbing pipeline as a ForgeFrame organ with
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
import type { ScrubEngine, TokenMap } from './types.js';

function hashData(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export const PROXY_ORGAN_MANIFEST: OrganManifest = {
  id: 'forgeframe.scrubbing.proxy',
  name: 'PII Scrubbing Proxy',
  version: '0.1.0',
  description: 'Local PII scrubbing with tiered regex and LLM-based detection, reversible token mapping.',
  categories: ['scrubbing'],
  capabilities: [
    {
      action: 'scrub',
      quality: 0.90,
      speed: 'fast',
      inputModalities: ['text'],
      outputModalities: ['text'],
    },
  ],
  resources: {
    ramMb: 20,
    vramMb: 0,
    diskMb: 5,
    network: false,
    warmupTime: 'instant',
    concurrent: true,
  },
  trust: {
    execution: 'local-only',
    dataClassifications: ['public', 'internal', 'sensitive'],
    canPersist: false,
    telemetry: false,
  },
  io: {
    inputs: [
      { name: 'text', modality: 'text', required: true, classification: 'sensitive' },
    ],
    outputs: [
      { name: 'scrubbed_text', modality: 'text', required: true, classification: 'internal' },
      { name: 'redactions', modality: 'structured-data', required: false, classification: 'internal' },
    ],
  },
};

export function createProxyOrganLifecycle(
  scrubEngine: ScrubEngine,
  tokenMap: TokenMap,
): OrganLifecycle {
  return {
    async register(): Promise<boolean> {
      return true;
    },

    async activate(): Promise<void> {
      // Scrub engine is stateless — no-op
    },

    async execute(input: OrganInput): Promise<OrganOutput> {
      const start = Date.now();
      const text = input.slots.text as string;
      const result = await scrubEngine.scrub(text, tokenMap);

      const outputSlots: Record<string, unknown> = {
        scrubbed_text: result.text,
        redactions: result.redactions,
      };
      const durationMs = Date.now() - start;

      const provenance: OrganProvenanceRecord = {
        invocationId: randomUUID(),
        requestId: input.requestId,
        organId: PROXY_ORGAN_MANIFEST.id,
        organVersion: PROXY_ORGAN_MANIFEST.version,
        timestamp: start,
        durationMs,
        inputHash: hashData(input.slots),
        outputHash: hashData(outputSlots),
        classificationsProcessed: ['sensitive'],
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
        message: 'PII scrubbing engine operational.',
      };
    },
  };
}
