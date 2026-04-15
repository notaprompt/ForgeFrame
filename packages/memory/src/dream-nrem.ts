/**
 * @forgeframe/memory — NREM Dream Phase
 *
 * Cheap compression pass that runs when sleep pressure >= 20.
 * Orchestrates: Hebbian LTD maintenance, decay, cluster scan + dedup
 * proposals, emotional triage, and valence backfill.
 *
 * Each step is wrapped in try/catch so one failure cannot abort the cycle.
 */

import type { MemoryStore } from './store.js';
import type { HebbianEngine } from './hebbian.js';
import type { ConsolidationEngine } from './consolidation.js';
import type { Generator } from './generator.js';
import type { Memory } from './types.js';
import { findDuplicate } from './dedup.js';
import { classifyValence } from './valence.js';
import { findGoneQuiet, type SilenceEntry } from './silence.js';
import { detectDrift, type DriftEntry } from './drift.js';

const PRUNE_THRESHOLD = 0.05;
const CALIBRATION_AGE_DAYS = 7;
const DECAY_FLOOR = 0.1;

export interface SourceCalibrationEntry {
  source: string;
  total: number;
  survived: number;
  survivalRate: number;
  flag: 'low' | 'high' | 'ok' | null;
}

export interface NremResult {
  duration: number;
  edgesPruned: number;
  decayApplied: boolean;
  clustersFound: number;
  dedupProposals: number;
  valenceBackfilled: number;
  sourceCalibration: SourceCalibrationEntry[];
  silence: SilenceEntry[];
  drift: DriftEntry[];
  errors: string[];
}

export class NremPhase {
  constructor(
    private store: MemoryStore,
    private hebbian: HebbianEngine,
    private consolidation: ConsolidationEngine,
    private generator: Generator | null = null,
  ) {}

  async run(): Promise<NremResult> {
    const start = Date.now();
    const result: NremResult = {
      duration: 0,
      edgesPruned: 0,
      decayApplied: false,
      clustersFound: 0,
      dedupProposals: 0,
      valenceBackfilled: 0,
      sourceCalibration: [],
      silence: [],
      drift: [],
      errors: [],
    };

    // Step 1: Hebbian maintenance — LTD pass + prune weak edges
    try {
      const pruned = this._runLtdMaintenance();
      result.edgesPruned = pruned;
    } catch (e) {
      result.errors.push(`hebbian: ${(e as Error).message}`);
    }

    // Step 2: Decay pass
    try {
      this.store.applyDecay();
      result.decayApplied = true;
    } catch (e) {
      result.errors.push(`decay: ${(e as Error).message}`);
    }

    // Step 3: Cluster scan + dedup proposals
    try {
      const clusters = this.consolidation.findCandidateClusters();
      result.clustersFound = clusters.length;

      let dedupCount = 0;
      for (const cluster of clusters) {
        // Emotional triage: bump priority if any member is charged
        // (reflected in dedupProposals count — charged clusters processed first)
        const hasCharged = cluster.memoryIds.some((id) => {
          const mem = this.store.get(id);
          return mem?.valence === 'charged';
        });

        // Scan within cluster for near-duplicates
        const seen = new Set<string>();
        for (const id of cluster.memoryIds) {
          if (seen.has(id)) continue;
          const mem = this.store.get(id);
          if (!mem) continue;

          const dup = findDuplicate(this.store, mem.content);
          if (dup && dup.id !== mem.id && cluster.memoryIds.includes(dup.id)) {
            seen.add(id);
            seen.add(dup.id);
            dedupCount++;
          }
        }

        // If cluster has charged memories, add an extra proposal slot
        // (priority signal — logged but actual scheduling is external)
        if (hasCharged) {
          dedupCount++;
        }
      }
      result.dedupProposals = dedupCount;
    } catch (e) {
      result.errors.push(`clusters: ${(e as Error).message}`);
    }

    // Step 4: Valence backfill
    try {
      const backfilled = await this._backfillValence();
      result.valenceBackfilled = backfilled;
    } catch (e) {
      result.errors.push(`valence: ${(e as Error).message}`);
    }

    // Step 5: Source calibration — survival audit for external source organs
    try {
      result.sourceCalibration = this._computeSourceCalibration();
    } catch (e) {
      result.errors.push(`calibration: ${(e as Error).message}`);
    }

    // Step 6: Silence detection — tag domains that went dark
    try {
      result.silence = findGoneQuiet(this.store);
    } catch (e) {
      result.errors.push(`silence: ${(e as Error).message}`);
    }

    // Step 7: Drift detection — belief structure shifting over time
    try {
      result.drift = detectDrift(this.store);
    } catch (e) {
      result.errors.push(`drift: ${(e as Error).message}`);
    }

    result.duration = Date.now() - start;
    return result;
  }

  /**
   * Standalone LTD maintenance pass.
   * Weakens all non-constitutional edges by the LTD decrement and prunes
   * those that fall below the threshold.
   * Returns the count of pruned edges.
   */
  private _runLtdMaintenance(): number {
    // Access all edges via internal DB — consistent with consolidation.ts pattern
    const db = (this.store as any)['_db'];
    const rows = db.prepare(
      'SELECT * FROM memory_edges',
    ).all() as Array<{
      id: string;
      source_id: string;
      target_id: string;
      weight: number;
      relation_type: string;
      last_hebbian_at: number | null;
    }>;

    let pruned = 0;
    const LTD_DECREMENT = 0.02;

    for (const row of rows) {
      // Skip constitutional edges (principle/voice on either end)
      const source = this.store.get(row.source_id);
      const target = this.store.get(row.target_id);
      if (!source || !target) continue;

      const isConstitutional =
        source.tags.some((t) => t === 'principle' || t === 'voice') ||
        target.tags.some((t) => t === 'principle' || t === 'voice');
      if (isConstitutional) continue;

      const newWeight = row.weight - LTD_DECREMENT;
      if (newWeight < PRUNE_THRESHOLD) {
        this.store.deleteEdge(row.id);
        pruned++;
      } else {
        this.store.updateEdgeWeight(row.id, newWeight);
      }
    }

    return pruned;
  }

  /**
   * Reclassify memories that were saved with the default 'neutral' valence
   * and may actually carry emotional weight.
   * Only runs when a generator is available.
   * Returns the count of memories reclassified.
   */
  private async _backfillValence(): Promise<number> {
    if (!this.generator) return 0;

    const db = (this.store as any)['_db'];
    const rows = db.prepare(`
      SELECT * FROM memories
      WHERE valence = 'neutral'
      AND tags NOT LIKE '%"principle"%'
      AND tags NOT LIKE '%"voice"%'
      ORDER BY created_at DESC
      LIMIT 50
    `).all() as any[];

    if (rows.length === 0) return 0;

    const rowToMemory = (this.store as any)['_rowToMemory'].bind(this.store) as (row: any) => Memory;

    let backfilled = 0;
    for (const row of rows) {
      try {
        const mem = rowToMemory(row);
        const valence = await classifyValence(mem.content, this.generator, mem.tags);
        if (valence !== 'neutral') {
          db.prepare('UPDATE memories SET valence = ? WHERE id = ?').run(valence, mem.id);
          backfilled++;
        }
      } catch {
        // Skip individual failures — don't abort the batch
      }
    }

    return backfilled;
  }

  /**
   * Compute survival rates for memories from external sources.
   * Queries memories older than 7 days that have a source-identifying tag
   * (e.g. 'source:distillery', 'source:hermes'). A memory "survived" if
   * its strength is above the decay floor AND it has been accessed at least once.
   *
   * Flags:
   *   - 'low' if survival < 30% (source threshold may be too permissive)
   *   - 'high' if survival > 80% (source threshold may be too conservative)
   *   - 'ok' otherwise
   *   - null if sample too small (< 5 memories)
   */
  private _computeSourceCalibration(): SourceCalibrationEntry[] {
    const db = (this.store as any)['_db'];
    const ageCutoff = Date.now() - CALIBRATION_AGE_DAYS * 86_400_000;

    // Find all distinct source:* tags in the database
    const tagRows = db.prepare(`
      SELECT DISTINCT tags FROM memories
      WHERE created_at < ?
      AND tags LIKE '%"source:%'
    `).all(ageCutoff) as Array<{ tags: string }>;

    // Extract unique source tags
    const sourceTags = new Set<string>();
    for (const row of tagRows) {
      const tags: string[] = JSON.parse(row.tags);
      for (const tag of tags) {
        if (tag.startsWith('source:')) sourceTags.add(tag);
      }
    }

    const entries: SourceCalibrationEntry[] = [];

    for (const sourceTag of sourceTags) {
      const pattern = `%${JSON.stringify(sourceTag).slice(1, -1)}%`;

      const total = (db.prepare(`
        SELECT COUNT(*) as cnt FROM memories
        WHERE created_at < ? AND tags LIKE ?
      `).get(ageCutoff, pattern) as { cnt: number }).cnt;

      if (total === 0) continue;

      const survived = (db.prepare(`
        SELECT COUNT(*) as cnt FROM memories
        WHERE created_at < ? AND tags LIKE ?
        AND strength > ? AND access_count > 0
      `).get(ageCutoff, pattern, DECAY_FLOOR) as { cnt: number }).cnt;

      const survivalRate = Math.round((survived / total) * 100) / 100;

      let flag: SourceCalibrationEntry['flag'] = null;
      if (total >= 5) {
        if (survivalRate < 0.3) flag = 'low';
        else if (survivalRate > 0.8) flag = 'high';
        else flag = 'ok';
      }

      entries.push({
        source: sourceTag,
        total,
        survived,
        survivalRate,
        flag,
      });
    }

    return entries;
  }
}
