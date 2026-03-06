/**
 * @forgeframe/proxy -- Proxy Provenance Logger
 *
 * Append-only JSONL audit trail for proxy requests/responses.
 * Never stores raw PII -- only hashes and scrubbed content.
 */

import { appendFileSync } from 'fs';
import { createHash } from 'crypto';
import type { ProxyProvenanceEntry } from './types.js';

export class ProxyProvenanceLogger {
  private _path: string;

  constructor(path: string) {
    this._path = path;
  }

  log(entry: ProxyProvenanceEntry): void {
    appendFileSync(this._path, JSON.stringify(entry) + '\n');
  }

  /** Hash raw text for correlation without storing PII. */
  static hash(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }
}
