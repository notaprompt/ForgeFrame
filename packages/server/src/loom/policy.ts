/**
 * Loom — policy
 *
 * Pure policy lookup. Loads approved routing principles from the
 * memory store (single SQL query via memory_list_by_tag-equivalent),
 * matches them against an incoming hook payload, returns a router
 * decision.
 *
 * Latency budget for the whole loadPolicies + matchPolicy call:
 * ≤ 50ms p95 against ~100 approved principles. Achieved by
 * scanning the approved-list once in JS — no per-payload SQL.
 */

import type { MemoryStore } from '@forgeframe/memory';
import type { HookPayload, Policy, RouterDecision } from './types.js';
import { projectFromCwd } from './sensor.js';

const APPROVED_TAG = 'routing-principle:approved';

export function loadPolicies(store: MemoryStore): Policy[] {
  // listByTag returns memories ordered by created_at desc; we only
  // need the JSON-encoded body which contains the policy fields.
  const rows = store.listByTag(APPROVED_TAG, 500);
  const out: Policy[] = [];
  for (const m of rows) {
    try {
      const parsed = JSON.parse(m.content) as Policy;
      if (!parsed.id || !parsed.action?.kind) continue;
      out.push(parsed);
    } catch {
      // skip corrupt rows; never throw
    }
  }
  return out;
}

interface ScoredPolicy {
  policy: Policy;
  specificity: number;
}

function scopeMatches(payload: HookPayload, policy: Policy): { ok: boolean; specificity: number } {
  const scope = policy.scope ?? {};
  let specificity = 0;

  if (scope.tool) {
    if (scope.tool !== payload.tool_name) return { ok: false, specificity: 0 };
    specificity += 1;
  }

  if (scope.subagentType) {
    if (payload.tool_name !== 'Agent') return { ok: false, specificity: 0 };
    if (scope.subagentType !== payload.tool_input?.subagent_type) return { ok: false, specificity: 0 };
    specificity += 2;
  }

  if (scope.project) {
    const project = projectFromCwd(payload.cwd);
    if (scope.project !== project) return { ok: false, specificity: 0 };
    specificity += 2;
  }

  return { ok: true, specificity };
}

export function matchPolicy(payload: HookPayload, policies: Policy[]): RouterDecision {
  const candidates: ScoredPolicy[] = [];
  for (const policy of policies) {
    const { ok, specificity } = scopeMatches(payload, policy);
    if (ok) candidates.push({ policy, specificity });
  }

  if (candidates.length === 0) {
    return { action: 'pass' };
  }

  // Most specific scope wins; ties broken by newest approvedAt.
  candidates.sort((a, b) => {
    if (b.specificity !== a.specificity) return b.specificity - a.specificity;
    return (b.policy.approvedAt ?? 0) - (a.policy.approvedAt ?? 0);
  });
  const winner = candidates[0].policy;

  return {
    action: winner.action.kind,
    reason: winner.action.reason ?? winner.rule,
    policyId: winner.id,
  };
}

// Re-export for convenience
export type { Policy } from './types.js';
