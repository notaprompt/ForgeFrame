/**
 * Sovereignty boundary — outbound-destination check for memory-bearing requests.
 *
 * Tonight (Wave 1 close, 2026-04-22): LOG-ONLY SKELETON. Always returns
 * `{ allowed: true, reasons: [] }`. When any referenced memory has sensitivity
 * !== 'public' and destination === 'frontier', a structured warning is emitted
 * so operators can observe leakage risk before enforcement lands.
 *
 * Wave 2 Phase 4 adds enforcement: abstract (redact/anonymize) for 'sensitive',
 * block-and-route-local for 'local-only'. The call signature stays stable so
 * callers don't need to change when enforcement flips on — only the `allowed`
 * boolean and `reasons` array become load-bearing.
 *
 * This module intentionally does NOT reuse the name `Guardian` — that concept
 * is already claimed by `@forgeframe/memory` `GuardianComputer` (calm / warm /
 * trapped temperature from revisit + contradiction + orphan signals). Different
 * concern; different layer.
 */

import type { MemoryStore, Sensitivity } from '@forgeframe/memory';

export type SovereigntyDestination = 'local' | 'frontier';

export interface SovereigntyCheckInput {
  memoryIds: string[];
  destination: SovereigntyDestination;
}

export interface SovereigntyCheckResult {
  allowed: boolean;
  reasons: string[];
}

export interface SovereigntyCheckOptions {
  /**
   * Override the default logger. Defaults to console.warn. Tests pass a spy.
   */
  warn?: (message: string) => void;
}

/**
 * Non-enforcing check for v1. Emits a structured warning line when any
 * referenced memory has sensitivity !== 'public' and the outbound destination
 * is 'frontier'. Never blocks; always returns `allowed: true`.
 */
export function sovereigntyCheck(
  store: Pick<MemoryStore, 'get'>,
  input: SovereigntyCheckInput,
  options: SovereigntyCheckOptions = {},
): SovereigntyCheckResult {
  const warn = options.warn ?? ((msg: string) => {
    // eslint-disable-next-line no-console
    console.warn(msg);
  });

  if (input.destination !== 'frontier') {
    return { allowed: true, reasons: [] };
  }

  const risky: Array<{ id: string; sensitivity: Sensitivity }> = [];
  for (const id of input.memoryIds) {
    const row = store.get(id);
    if (!row) continue;
    if (row.sensitivity !== 'public') {
      risky.push({ id, sensitivity: row.sensitivity });
    }
  }

  if (risky.length > 0) {
    const summary = risky
      .map((r) => `${r.id.slice(0, 8)}:${r.sensitivity}`)
      .join(',');
    warn(`[sovereignty] WARN frontier destination with non-public memories [${summary}] — enforcement is Wave 2`);
  }

  return { allowed: true, reasons: [] };
}
