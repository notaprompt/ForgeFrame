/**
 * Loom — router (PreToolUse decision path)
 *
 * Reads a Claude Code PreToolUse hook payload from stdin, looks up
 * matching approved routing principles, emits a decision.
 *
 * Decision protocol (Claude Code PreToolUse hook spec):
 *  - exit 0, no stdout            → pass through (default permissions)
 *  - stdout JSON with permissionDecision = "deny" + reason → block
 *  - stdout JSON with permissionDecision = "allow" + reason → auto-approve
 *
 * Cold-start (first 7 days from sensor's first fire) always passes
 * through, even when matching policies exist. The router writes a
 * note to its log (~/.creature/logs/loom-router.log) for audit.
 *
 * Latency budget: ≤ 50ms p95.
 */

import { MemoryStore } from '@forgeframe/memory';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { appendFileSync, mkdirSync } from 'fs';
import type { HookPayload, RouterDecision } from './types.js';
import { isArmed, DEFAULT_STATE_PATH } from './cold-start.js';
import { loadPolicies, matchPolicy } from './policy.js';

export interface DecideOptions {
  store: MemoryStore;
  statePath?: string;
  now?: number;
  policies?: ReturnType<typeof loadPolicies>;
}

export function decide(payload: HookPayload, opts: DecideOptions): RouterDecision {
  const statePath = opts.statePath ?? DEFAULT_STATE_PATH;
  const now = opts.now ?? Date.now();

  if (!isArmed(statePath, now)) {
    return { action: 'cold-start' };
  }

  const policies = opts.policies ?? loadPolicies(opts.store);
  return matchPolicy(payload, policies);
}

export function formatDecisionForHook(decision: RouterDecision): string | null {
  if (decision.action === 'pass' || decision.action === 'cold-start') return null;

  const reason = decision.reason ?? `loom: ${decision.action} (policy ${decision.policyId ?? 'unknown'})`;
  const permissionDecision = decision.action === 'deny' ? 'deny' : 'allow';

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason: reason,
    },
  });
}

const LOG_PATH = resolve(homedir(), '.creature', 'logs', 'loom-router.log');

function logDecision(payload: HookPayload, decision: RouterDecision, now: number): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(
      LOG_PATH,
      JSON.stringify({ at: now, tool: payload.tool_name, action: decision.action, policyId: decision.policyId }) + '\n',
      'utf8',
    );
  } catch {
    // log failures must not break the dispatch
  }
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  let payload: HookPayload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    process.exit(0);
  }

  const dbPath = process.env.FORGEFRAME_DB_PATH ?? resolve(homedir(), '.forgeframe', 'memory.db');
  const store = new MemoryStore({ dbPath });
  const now = Date.now();
  let decision: RouterDecision;
  try {
    // exit(0) in the catch above guarantees payload is defined here
    decision = decide(payload!, { store, now });
  } catch (err) {
    process.stderr.write(`[loom] router crashed safely: ${(err as Error).message}\n`);
    process.exit(0);
  } finally {
    store.close();
  }

  // payload guaranteed defined (parse catch exits 0); decision guaranteed
  // assigned because the only non-throwing path through the try is the
  // `decision = decide(...)` assignment.
  logDecision(payload!, decision, now);
  const formatted = formatDecisionForHook(decision);
  if (formatted) process.stdout.write(formatted);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`[loom] router top-level crash: ${(err as Error).message}\n`);
    process.exit(0);
  });
}
