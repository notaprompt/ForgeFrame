/**
 * @forgeframe/core — Organ Registry
 *
 * Manages organ lifecycle, trust enforcement, resource budgeting,
 * and capability-based resolution.
 */

import { createHash, randomUUID } from 'crypto';
import type {
  OrganManifest,
  OrganLifecycle,
  OrganRegistry,
  OrganStatus,
  OrganQuery,
  OrganMatch,
  OrganInput,
  OrganOutput,
  OrganProvenanceRecord,
  OrganState,
  ResourceBudget,
  DataClassification,
} from './organ-types.js';
import type { Logger } from './types.js';
import { createConsoleLogger } from './types.js';
import { OrganEvents } from './organ-events.js';

// -- Trust enforcement --

const TRUST_LEVEL_ORDER: Record<string, number> = {
  'local-only': 0,
  'local-preferred': 1,
  'cloud-scrubbed': 2,
  'cloud-raw': 3,
};

const SPEED_SCORE: Record<string, number> = {
  'instant': 1.0,
  'fast': 0.75,
  'moderate': 0.5,
  'slow': 0.25,
};

const STATE_SCORE: Record<string, number> = {
  'active': 1.0,
  'executing': 1.0,
  'dormant': 0.5,
  'registered': 0.25,
  'error': 0.0,
};

const SENSITIVE_CLASSIFICATIONS: DataClassification[] = ['cognitive', 'constitutional'];

// -- Internal state per organ --

interface OrganEntry {
  manifest: OrganManifest;
  lifecycle: OrganLifecycle;
  status: OrganStatus;
}

// -- Registry implementation --

export class OrganRegistryImpl implements OrganRegistry {
  private readonly organs = new Map<string, OrganEntry>();
  private readonly logger: Logger;
  private readonly initialBudget: ResourceBudget;
  readonly events = new OrganEvents();

  constructor(opts: { logger?: Logger; budget: ResourceBudget }) {
    this.logger = opts.logger ?? createConsoleLogger();
    this.initialBudget = { ...opts.budget };
  }

  async register(manifest: OrganManifest, lifecycle: OrganLifecycle): Promise<void> {
    if (!manifest.id || !manifest.name || !manifest.version) {
      throw new Error(`Organ manifest missing required fields (id, name, version)`);
    }
    if (this.organs.has(manifest.id)) {
      throw new Error(`Organ already registered: ${manifest.id}`);
    }
    if (manifest.dependencies) {
      for (const dep of manifest.dependencies) {
        if (!this.organs.has(dep)) {
          throw new Error(`Missing dependency: ${dep} (required by ${manifest.id})`);
        }
      }
    }

    const ok = await lifecycle.register();
    if (!ok) {
      throw new Error(`Organ registration rejected by lifecycle: ${manifest.id}`);
    }

    this.organs.set(manifest.id, {
      manifest,
      lifecycle,
      status: {
        manifest,
        state: 'registered',
        executionCount: 0,
        averageLatencyMs: 0,
        errors: 0,
      },
    });

    this.logger.info(`Organ registered: ${manifest.id}`);
    this.events.emit('organ:registered', manifest.id);
  }

  async unregister(organId: string): Promise<void> {
    const entry = this.getEntry(organId);
    if (entry.status.state === 'active' || entry.status.state === 'executing') {
      await this.deactivate(organId);
    }
    this.organs.delete(organId);
    this.logger.info(`Organ unregistered: ${organId}`);
    this.events.emit('organ:unregistered', organId);
  }

  async activate(organId: string): Promise<void> {
    const entry = this.getEntry(organId);
    const budget = this.budget();
    const res = entry.manifest.resources;

    if (res.ramMb > budget.availableRamMb) {
      throw new Error(`Insufficient RAM for ${organId}: need ${res.ramMb}MB, have ${budget.availableRamMb}MB`);
    }
    if (res.vramMb > budget.availableVramMb) {
      throw new Error(`Insufficient VRAM for ${organId}: need ${res.vramMb}MB, have ${budget.availableVramMb}MB`);
    }

    await entry.lifecycle.activate();
    entry.status.state = 'active';
    entry.status.activeSince = Date.now();
    this.logger.info(`Organ activated: ${organId}`);
    this.events.emit('organ:activated', organId);
  }

  async deactivate(organId: string): Promise<void> {
    const entry = this.getEntry(organId);
    await entry.lifecycle.deactivate();
    entry.status.state = 'dormant';
    this.logger.info(`Organ deactivated: ${organId}`);
    this.events.emit('organ:deactivated', organId);
  }

  async execute(organId: string, input: OrganInput): Promise<OrganOutput> {
    const entry = this.getEntry(organId);

    // Constitutional trust enforcement: block cloud organs from processing sensitive data
    this.enforceTrust(entry, organId);

    const prevState = entry.status.state;
    entry.status.state = 'executing';
    const start = performance.now();

    try {
      const output = await entry.lifecycle.execute(input);
      const durationMs = Math.round(performance.now() - start);

      const provenance: OrganProvenanceRecord = {
        invocationId: randomUUID(),
        requestId: input.requestId,
        organId,
        organVersion: entry.manifest.version,
        timestamp: Date.now(),
        durationMs,
        inputHash: createHash('sha256').update(JSON.stringify(input.slots)).digest('hex'),
        outputHash: createHash('sha256').update(JSON.stringify(output.slots)).digest('hex'),
        classificationsProcessed: entry.manifest.io.inputs
          .map((slot) => slot.classification)
          .filter((c, i, a) => a.indexOf(c) === i),
        trustLevel: entry.manifest.trust.execution,
      };

      output.provenance = provenance;
      entry.status.state = 'active';
      entry.status.lastExecuted = Date.now();
      entry.status.executionCount += 1;
      entry.status.averageLatencyMs =
        (entry.status.averageLatencyMs * (entry.status.executionCount - 1) + durationMs) /
        entry.status.executionCount;

      this.events.emit('organ:executed', organId, durationMs);
      return output;
    } catch (err) {
      entry.status.state = prevState;
      entry.status.errors += 1;
      const error = err instanceof Error ? err : new Error(String(err));
      this.events.emit('organ:error', organId, error);
      throw err;
    }
  }

  resolve(query: OrganQuery): OrganMatch[] {
    const matches: OrganMatch[] = [];
    const budget = this.budget();

    for (const entry of this.organs.values()) {
      const { manifest, status } = entry;

      for (const cap of manifest.capabilities) {
        // 1. Filter by capability: action must match
        if (cap.action !== query.action) continue;

        // 2. Filter by trust
        if (query.dataClassification && SENSITIVE_CLASSIFICATIONS.includes(query.dataClassification)) {
          const exec = manifest.trust.execution;
          if (exec === 'cloud-scrubbed' || exec === 'cloud-raw') continue;
        }
        if (query.maxTrust !== undefined) {
          const maxLevel = TRUST_LEVEL_ORDER[query.maxTrust] ?? 3;
          const organLevel = TRUST_LEVEL_ORDER[manifest.trust.execution] ?? 3;
          if (organLevel > maxLevel) continue;
        }

        // 3. Filter by input modality
        if (query.inputModality && !cap.inputModalities.includes(query.inputModality)) continue;

        // 4. Filter by output modality
        if (query.outputModality && !cap.outputModalities.includes(query.outputModality)) continue;

        // 5. Filter by resources: must fit within current budget
        if (status.state !== 'active' && status.state !== 'executing') {
          if (manifest.resources.ramMb > budget.availableRamMb) continue;
          if (manifest.resources.vramMb > budget.availableVramMb) continue;
        }

        // 6. Score
        let qualityWeight = 0.4;
        let speedWeight = 0.2;
        const stateWeight = 0.2;
        const costWeight = 0.2;

        if (query.preferSpeed) {
          qualityWeight = 0.2;
          speedWeight = 0.4;
        } else if (query.preferQuality) {
          qualityWeight = 0.6;
          speedWeight = 0.2;
        }

        const qualityScore = cap.quality;
        const speedScore = SPEED_SCORE[cap.speed] ?? 0.5;
        const stateScore = STATE_SCORE[status.state] ?? 0;
        const costScore = budget.totalRamMb > 0
          ? 1 - (manifest.resources.ramMb / budget.totalRamMb)
          : 0;

        const score =
          qualityScore * qualityWeight +
          speedScore * speedWeight +
          stateScore * stateWeight +
          costScore * costWeight;

        matches.push({
          organ: manifest,
          capability: cap,
          score,
          state: status.state,
        });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches;
  }

  status(organId: string): OrganStatus | null {
    const entry = this.organs.get(organId);
    return entry ? { ...entry.status } : null;
  }

  list(): OrganStatus[] {
    return Array.from(this.organs.values()).map((e) => ({ ...e.status }));
  }

  budget(): ResourceBudget {
    let usedRamMb = 0;
    let usedVramMb = 0;

    for (const entry of this.organs.values()) {
      if (entry.status.state === 'active' || entry.status.state === 'executing') {
        usedRamMb += entry.manifest.resources.ramMb;
        usedVramMb += entry.manifest.resources.vramMb;
      }
    }

    return {
      ...this.initialBudget,
      availableRamMb: this.initialBudget.availableRamMb - usedRamMb,
      availableVramMb: this.initialBudget.availableVramMb - usedVramMb,
    };
  }

  // -- Private helpers --

  private getEntry(organId: string): OrganEntry {
    const entry = this.organs.get(organId);
    if (!entry) throw new Error(`Organ not found: ${organId}`);
    return entry;
  }

  private enforceTrust(entry: OrganEntry, organId: string): void {
    const exec = entry.manifest.trust.execution;
    if (exec !== 'cloud-scrubbed' && exec !== 'cloud-raw') return;

    const hasSensitiveSlot = entry.manifest.io.inputs.some((slot) =>
      SENSITIVE_CLASSIFICATIONS.includes(slot.classification),
    );

    if (hasSensitiveSlot) {
      const reason = `Cloud organ ${organId} cannot process cognitive/constitutional data`;
      this.events.emit('organ:trust-violation', organId, reason);
      throw new Error(reason);
    }
  }
}
