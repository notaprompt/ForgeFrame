/**
 * @forgeframe/memory — REM Dream Phase
 *
 * Orchestrates the expensive creative dreaming phase:
 * seeding + hindsight + tension detection + journal.
 *
 * REM runs only when sleep pressure >= 50. Each sub-phase is
 * wrapped in try/catch so one failure cannot abort the cycle.
 * Journal is always the last step — written even if earlier phases fail.
 */

import type { MemoryStore } from './store.js';
import type { Generator } from './generator.js';
import { selectSeeds, type DreamSeed } from './dream-seeding.js';
import { findHindsightCandidates, type HindsightCandidate } from './hindsight.js';
import { findTensionCandidates, type TensionCandidate } from './tensions.js';
import { writeDreamJournal, type DreamJournalInput } from './dream-journal.js';

export interface RemResult {
  duration: number;
  seeds: DreamSeed[];
  hindsightCandidates: HindsightCandidate[];
  tensions: TensionCandidate[];
  journalMemoryId: string | null;
  errors: string[];
}

export class RemPhase {
  constructor(
    private store: MemoryStore,
    private generator: Generator | null = null,
  ) {}

  async run(sleepPressureBefore: number): Promise<RemResult> {
    const start = Date.now();
    const result: RemResult = {
      duration: 0,
      seeds: [],
      hindsightCandidates: [],
      tensions: [],
      journalMemoryId: null,
      errors: [],
    };

    // Step 1: Dream seeding — find candidate pairs from disconnected regions
    try {
      result.seeds = selectSeeds(this.store, 5);
    } catch (e) {
      result.errors.push(`seeding: ${(e as Error).message}`);
    }

    // Step 2: Hindsight review — surface entrenched memories
    try {
      result.hindsightCandidates = findHindsightCandidates(this.store, 1);
    } catch (e) {
      result.errors.push(`hindsight: ${(e as Error).message}`);
    }

    // Step 3: Tension detection — find productive friction
    try {
      result.tensions = findTensionCandidates(this.store, 3);
    } catch (e) {
      result.errors.push(`tensions: ${(e as Error).message}`);
    }

    // Step 4: Dream journal — always the last step, always written
    try {
      const duration = Date.now() - start;
      const journalInput: DreamJournalInput = {
        phase: 'rem',
        duration,
        sleepPressureBefore,
        sleepPressureAfter: sleepPressureBefore * 0.3, // REM drops pressure significantly
        edgesPruned: 0,
        decayApplied: false,
        clustersFound: 0,
        dedupProposals: 0,
        valenceBackfilled: 0,
        errors: result.errors,
      };

      const journal = await writeDreamJournal(this.store, journalInput, this.generator);
      result.journalMemoryId = journal?.id ?? null;
    } catch (e) {
      result.errors.push(`journal: ${(e as Error).message}`);
    }

    result.duration = Date.now() - start;
    return result;
  }
}
