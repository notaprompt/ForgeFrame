/**
 * @forgeframe/server — Provenance Logger
 *
 * Append-only JSONL audit trail. Foundation for compliance extensions.
 */

import { appendFile } from 'fs/promises';

export interface ProvenanceEntry {
  timestamp: number;
  action: string;
  memoryId?: string;
  query?: string;
  sessionId: string;
  metadata?: Record<string, unknown>;
}

export class ProvenanceLogger {
  private _path: string;

  constructor(path: string) {
    this._path = path;
  }

  log(entry: ProvenanceEntry): Promise<void> {
    return appendFile(this._path, JSON.stringify(entry) + '\n').catch(() => {});
  }
}
