/**
 * @forgeframe/server — Distillery Organ
 *
 * Wraps DistilleryIntake as a ForgeFrame organ with manifest,
 * lifecycle, and provenance tracking.
 */

import type { OrganManifest, OrganLifecycle, OrganInput, OrganOutput, OrganHealth, OrganProvenanceRecord } from '@forgeframe/core';
import type { DistilleryIntake } from './distillery.js';
import { randomUUID, createHash } from 'crypto';

function hashData(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export const DISTILLERY_ORGAN_MANIFEST: OrganManifest = {
  id: 'forgeframe.intake.distillery',
  name: 'Distillery Intake',
  version: '0.1.0',
  description: 'Syncs distilled artifacts from the Distillery into ForgeFrame memory.',
  categories: ['intake'],
  capabilities: [
    {
      action: 'ingest',
      quality: 0.85,
      speed: 'moderate',
      inputModalities: ['text', 'structured-data'],
      outputModalities: ['text', 'structured-data'],
    },
  ],
  resources: {
    ramMb: 30,
    vramMb: 0,
    diskMb: 50,
    network: false,
    warmupTime: 'seconds',
    concurrent: false,
  },
  trust: {
    execution: 'local-only',
    dataClassifications: ['public', 'internal'],
    canPersist: true,
    telemetry: false,
  },
  io: {
    inputs: [
      { name: 'trigger', modality: 'text', required: false, classification: 'internal' },
    ],
    outputs: [
      { name: 'sync_result', modality: 'structured-data', required: true, classification: 'internal' },
    ],
  },
};

export function createDistilleryOrganLifecycle(intake: DistilleryIntake): OrganLifecycle {
  return {
    async register(): Promise<boolean> {
      return true;
    },

    async activate(): Promise<void> {
      // Distillery intake is ready once constructed
    },

    async execute(input: OrganInput): Promise<OrganOutput> {
      const start = Date.now();
      const result = await intake.sync();
      const durationMs = Date.now() - start;

      const outputSlots: Record<string, unknown> = { sync_result: result };

      const provenance: OrganProvenanceRecord = {
        invocationId: randomUUID(),
        requestId: input.requestId,
        organId: DISTILLERY_ORGAN_MANIFEST.id,
        organVersion: DISTILLERY_ORGAN_MANIFEST.version,
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
        message: 'Distillery intake operational.',
      };
    },
  };
}
