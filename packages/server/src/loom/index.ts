/**
 * Loom — organ adapter + barrel exports
 */

import type {
  OrganManifest, OrganLifecycle, OrganInput, OrganOutput,
  OrganHealth, OrganProvenanceRecord,
} from '@forgeframe/core';
import type { MemoryStore } from '@forgeframe/memory';
import { randomUUID, createHash } from 'crypto';
import { isArmed, getState } from './cold-start.js';
import { reflect, type ReflectResult } from './reflector.js';

export * from './types.js';
export { recordDispatch, summarizeAgentInput, summarizeBashInput, projectFromCwd } from './sensor.js';
export { decide, formatDecisionForHook } from './router.js';
export { loadPolicies, matchPolicy } from './policy.js';
export { reflect, signatureOf } from './reflector.js';
export type { ReflectOptions, ReflectResult } from './reflector.js';
export {
  recordFirstFire, recordArmed, isArmed, getState,
  COLD_START_WINDOW_MS, DEFAULT_STATE_PATH,
} from './cold-start.js';

function hashData(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export const LOOM_ORGAN_MANIFEST: OrganManifest = {
  id: 'forgeframe.meta.loom',
  name: 'Loom',
  version: '0.1.0',
  description: 'Meta-organ: senses Claude Code dispatches, derives routing policy from observed patterns.',
  // 'orchestration' is the closest permitted category; ideally 'meta' or 'observation'
  categories: ['orchestration'],
  capabilities: [
    { action: 'sense', quality: 0.9, speed: 'fast', inputModalities: ['structured-data'], outputModalities: ['structured-data'] },
    { action: 'route', quality: 0.7, speed: 'fast', inputModalities: ['structured-data'], outputModalities: ['structured-data'] },
    { action: 'reflect', quality: 0.7, speed: 'moderate', inputModalities: ['structured-data'], outputModalities: ['structured-data'] },
  ],
  resources: { ramMb: 30, vramMb: 0, diskMb: 5, network: false, warmupTime: 'instant', concurrent: true },
  trust: {
    execution: 'local-only',
    dataClassifications: ['public', 'internal'],
    canPersist: true,
    telemetry: false,
  },
  io: {
    inputs: [{ name: 'action', modality: 'text', required: true, classification: 'internal' }],
    outputs: [{ name: 'result', modality: 'structured-data', required: true, classification: 'internal' }],
  },
};

export function createLoomOrganLifecycle(store: MemoryStore): OrganLifecycle {
  return {
    async register(): Promise<boolean> { return true; },
    async activate(): Promise<void> { /* hooks live in ~/.claude/settings.json — nothing to start here */ },

    async execute(input: OrganInput): Promise<OrganOutput> {
      const start = Date.now();
      const action = input.slots.action as string;
      let result: unknown;
      if (action === 'reflect') {
        result = reflect({ store }) as ReflectResult;
      } else if (action === 'status') {
        result = { armed: isArmed(), state: getState() };
      } else {
        throw new Error(`Unknown loom action: ${action}`);
      }

      const outputSlots = { result };
      const provenance: OrganProvenanceRecord = {
        invocationId: randomUUID(),
        requestId: input.requestId,
        organId: LOOM_ORGAN_MANIFEST.id,
        organVersion: LOOM_ORGAN_MANIFEST.version,
        timestamp: start,
        durationMs: Date.now() - start,
        inputHash: hashData(input.slots),
        outputHash: hashData(outputSlots),
        classificationsProcessed: ['internal'],
        trustLevel: 'local-only',
      };
      return { slots: outputSlots, provenance };
    },

    async deactivate(): Promise<void> { /* no-op */ },

    async health(): Promise<OrganHealth> {
      const state = getState();
      const armed = isArmed();
      const message = state.firstFireAt
        ? `cold-start ${armed ? 'complete' : 'in progress'}, first fire at ${new Date(state.firstFireAt).toISOString()}`
        : 'never fired';
      return { status: 'healthy', message };
    },
  };
}
