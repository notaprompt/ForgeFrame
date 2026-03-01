/**
 * @forgeframe/server — Provenance Logger
 *
 * Append-only JSONL audit trail. Foundation for L4 compliance.
 */

import { appendFileSync } from 'fs';

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

  log(entry: ProvenanceEntry): void {
    appendFileSync(this._path, JSON.stringify(entry) + '\n');
  }
}
