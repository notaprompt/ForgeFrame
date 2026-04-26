/**
 * Loom — reflector
 *
 * Walks recent dispatch:* memories, clusters them by signature
 * (tool / subagentType / project), and writes a
 * routing-principle:proposed row for each cluster meeting the
 * minimum frequency threshold.
 *
 * Skips clusters already covered by an approved or proposed
 * routing-principle so reflect() is idempotent across runs.
 *
 * v1: invoked manually via `forgeframe loom reflect`. v1.1 wires
 * into dream-schedule.ts NREM phase.
 */

import type { MemoryStore } from '@forgeframe/memory';
import type { DispatchRecord, Policy } from './types.js';

export interface ReflectOptions {
  store: MemoryStore;
  /** Minimum cluster size to propose a principle. Default 10. */
  minClusterSize?: number;
  /** Lookback window in ms. Default: 30 days. */
  windowMs?: number;
  now?: number;
}

export interface ReflectResult {
  scanned: number;
  clusters: number;
  proposed: number;
  proposalIds: string[];
}

export function signatureOf(rec: DispatchRecord): string {
  const tool = rec.tool.toLowerCase();
  const sub = rec.subagentType ? rec.subagentType.toLowerCase() : '_';
  const project = rec.project ? rec.project : '_';
  return `${tool}:${sub}:${project}`;
}

interface ClusterEntry {
  signature: string;
  tool: 'Agent' | 'Bash';
  subagentType?: string;
  project?: string;
  members: string[];
}

function clusterSignatureFromScope(scope: Policy['scope']): string {
  const tool = scope.tool ? scope.tool.toLowerCase() : '_';
  const sub = scope.subagentType ? scope.subagentType.toLowerCase() : '_';
  const project = scope.project ?? '_';
  return `${tool}:${sub}:${project}`;
}

function existingSignatures(store: MemoryStore): Set<string> {
  const out = new Set<string>();
  for (const m of store.listByTag('routing-principle:approved', 500)) {
    try {
      const p = JSON.parse(m.content) as Policy;
      out.add(clusterSignatureFromScope(p.scope ?? {}));
    } catch { /* skip */ }
  }
  for (const m of store.listByTag('routing-principle:proposed', 500)) {
    try {
      const p = JSON.parse(m.content) as Policy;
      out.add(clusterSignatureFromScope(p.scope ?? {}));
    } catch { /* skip */ }
  }
  return out;
}

// Disk contract uses snake_case; deserialize back to the in-memory
// camelCase DispatchRecord shape so the rest of this module reads as
// idiomatic TypeScript.
function deserializeDispatch(json: string): DispatchRecord | null {
  try {
    const raw = JSON.parse(json);
    if (raw.tool !== 'Agent' && raw.tool !== 'Bash') return null;
    return {
      tool: raw.tool,
      inputSummary: raw.input_summary ?? '',
      subagentType: raw.subagent_type,
      commandHead: raw.command_head,
      startedAt: raw.started_at ?? 0,
      sessionId: raw.session_id,
      exitStatus: raw.exit_status ?? 'unknown',
      routerAction: raw.router_action ?? 'pass',
      project: raw.project,
    };
  } catch {
    return null;
  }
}

export function reflect(opts: ReflectOptions): ReflectResult {
  const minSize = opts.minClusterSize ?? 10;
  const windowMs = opts.windowMs ?? 30 * 24 * 60 * 60 * 1000;
  const now = opts.now ?? Date.now();
  const cutoff = now - windowMs;

  const dispatches = opts.store.listByTag('dispatch', 5000);
  const clusters = new Map<string, ClusterEntry>();
  let scanned = 0;

  for (const m of dispatches) {
    if (m.createdAt < cutoff) continue;
    const rec = deserializeDispatch(m.content);
    if (!rec) continue;
    scanned += 1;
    const sig = signatureOf(rec);
    let entry = clusters.get(sig);
    if (!entry) {
      entry = {
        signature: sig,
        tool: rec.tool,
        subagentType: rec.subagentType,
        project: rec.project,
        members: [],
      };
      clusters.set(sig, entry);
    }
    entry.members.push(m.id);
  }

  const skip = existingSignatures(opts.store);
  const proposalIds: string[] = [];
  let proposed = 0;

  for (const entry of clusters.values()) {
    if (entry.members.length < minSize) continue;
    if (skip.has(entry.signature)) continue;

    const proposalBody = {
      id: `prop-${entry.signature}-${now}`,
      rule: `Cluster of ${entry.members.length} ${entry.tool}${entry.subagentType ? `:${entry.subagentType}` : ''} dispatches${entry.project ? ` in project ${entry.project}` : ''} — review and codify`,
      scope: {
        tool: entry.tool,
        subagentType: entry.subagentType,
        project: entry.project,
      },
      action: { kind: 'pass' as const, reason: 'auto-proposed; founder to set action on approval' },
      derived_from_count: entry.members.length,
      sample_dispatch_ids: entry.members.slice(0, 5),
      proposed_at: now,
    };

    const tags = ['routing-principle', 'routing-principle:proposed'];
    if (entry.project) tags.push(`project:${entry.project}`);

    const m = opts.store.create({
      content: JSON.stringify(proposalBody),
      tags,
      sensitivity: 'public',
      metadata: { kind: 'loom-routing-principle-proposed' },
    });
    proposalIds.push(m.id);
    proposed += 1;

    // Best-effort link from the proposal to each sample dispatch so
    // Cockpit can render the explainability trail. linkMemories may
    // not exist in older builds — guard with a check.
    const linker = (opts.store as unknown as { linkMemories?: (a: string, b: string, kind: string) => void }).linkMemories;
    if (typeof linker === 'function') {
      for (const dispatchId of proposalBody.sample_dispatch_ids) {
        try { linker.call(opts.store, m.id, dispatchId, 'derived-from'); } catch { /* skip */ }
      }
    }
  }

  return { scanned, clusters: clusters.size, proposed, proposalIds };
}
