/**
 * @forgeframe/server — Distillery Intake
 *
 * Syncs distilled artifacts from the Distillery SQLite DB into ForgeFrame
 * memory. Opens the Distillery DB read-only; never writes to it.
 */

import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import type { MemoryStore } from '@forgeframe/memory';
import type { Embedder } from '@forgeframe/memory';
import type { Logger } from '@forgeframe/core';
import { createConsoleLogger } from '@forgeframe/core';

export interface DistilleryConfig {
  distilleryDbPath: string;
  pollIntervalMs: number; // 0 = manual only
}

export interface SyncResult {
  imported: number;
  skipped: number;
  errors: string[];
}

interface DistilleryRow {
  id: number;
  source_url: string | null;
  source_type: string | null;
  raw_input: string | null;
  extracted_content: string | null;
  distilled_at: string | null;
  resonance: number | null;
  reframed: string | null;
  connections: string | null;
  action_surface: string | null;
}

const SYNC_QUERY = `
  SELECT i.id, i.source_url, i.source_type, i.raw_input, i.extracted_content, i.distilled_at,
         d.resonance, d.reframed, d.connections, d.action_surface
  FROM items i
  LEFT JOIN distillations d ON d.item_id = i.id
  WHERE i.status = 'done' AND d.id IS NOT NULL
  ORDER BY i.distilled_at ASC
`;

export class DistilleryIntake {
  private _store: MemoryStore;
  private _embedder: Embedder | null;
  private _config: DistilleryConfig;
  private _logger: Logger;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    store: MemoryStore,
    embedder: Embedder | null,
    config: DistilleryConfig,
    logger?: Logger,
  ) {
    this._store = store;
    this._embedder = embedder;
    this._config = config;
    this._logger = logger ?? createConsoleLogger();
  }

  async sync(): Promise<SyncResult> {
    const result: SyncResult = { imported: 0, skipped: 0, errors: [] };

    let distilleryDb: Database.Database;
    try {
      distilleryDb = new Database(this._config.distilleryDbPath, {
        readonly: true,
        fileMustExist: true,
      });
    } catch (err) {
      const msg = `Failed to open Distillery DB: ${(err as Error).message}`;
      this._logger.error(msg);
      result.errors.push(msg);
      return result;
    }

    try {
      const rows = distilleryDb.prepare(SYNC_QUERY).all() as DistilleryRow[];

      for (const row of rows) {
        try {
          this._processRow(row, result);
        } catch (err) {
          const msg = `Error processing item ${row.id}: ${(err as Error).message}`;
          this._logger.error(msg);
          result.errors.push(msg);
        }
      }
    } finally {
      distilleryDb.close();
    }

    return result;
  }

  private _processRow(row: DistilleryRow, result: SyncResult): void {
    const rawHash = createHash('sha256')
      .update(row.raw_input ?? row.source_url ?? '')
      .digest('hex');

    // Idempotency: skip if already imported
    const existing = this._store.getArtifactByHash(rawHash);
    if (existing) {
      result.skipped++;
      return;
    }

    // Derive tags
    const tags: string[] = ['source:distillery'];

    if (row.source_type) {
      tags.push(`source-type:${row.source_type}`);
    }

    let hasSkillOrPattern = false;

    if (row.action_surface && row.action_surface.trim().length > 0) {
      tags.push('skill');
      hasSkillOrPattern = true;
    }

    if (row.resonance != null && row.resonance > 0.8) {
      tags.push('pattern');
      hasSkillOrPattern = true;
    }

    if (!hasSkillOrPattern) {
      tags.push('observation');
    }

    // Parse connections and add short strings as tags
    if (row.connections) {
      try {
        const connections = JSON.parse(row.connections) as unknown[];
        for (const conn of connections) {
          if (typeof conn === 'string' && conn.length < 50) {
            tags.push(conn);
          }
        }
      } catch {
        // Malformed connections JSON — skip silently
      }
    }

    // Create distilled artifact
    const artifact = this._store.createArtifact({
      sourceUrl: row.source_url ?? undefined,
      sourceType: row.source_type ?? 'unknown',
      rawHash,
      distilled: row.reframed ?? undefined,
      tags,
    });

    // Create memory from distilled content
    const memory = this._store.create({
      content: row.reframed ?? row.extracted_content ?? '',
      tags,
      metadata: {
        source: 'distillery',
        sourceUrl: row.source_url ?? null,
        sourceType: row.source_type ?? null,
        resonance: row.resonance ?? null,
        actionSurface: row.action_surface || null,
        distilledArtifactId: artifact.id,
      },
    });

    // Link artifact to memory
    this._store.markArtifactFed(artifact.id, memory.id);

    // Fire-and-forget embedding if embedder is available
    if (this._embedder && memory.content) {
      this._embedder.embed(memory.content).then((vec) => {
        if (vec) {
          this._store.update(memory.id, { embedding: vec });
        }
      }).catch((err) => {
        this._logger.warn(`Embedding failed for memory ${memory.id}: ${(err as Error).message}`);
      });
    }

    result.imported++;
    this._logger.debug(`Imported distillery item ${row.id} as artifact ${artifact.id}`);
  }

  startPolling(): void {
    if (this._config.pollIntervalMs <= 0) return;
    if (this._pollTimer) return;

    this._pollTimer = setInterval(() => {
      this.sync().catch((err) => {
        this._logger.error(`Polling sync failed: ${(err as Error).message}`);
      });
    }, this._config.pollIntervalMs);

    this._logger.info(`Distillery polling started (interval: ${this._config.pollIntervalMs}ms)`);
  }

  stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
      this._logger.info('Distillery polling stopped');
    }
  }
}
