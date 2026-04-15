/**
 * @forgeframe/memory — Dream Journal
 *
 * Writes a narrative memory after each dream cycle. The journal is saved as a
 * ForgeFrame memory with tags ['dream-journal', phase, YYYY-MM-DD]. It includes
 * graph health stats and a summary of what happened during the dream.
 *
 * Journal generation is the LAST step — if the cycle crashes, whatever completed
 * still gets journaled. Journal generation failure does not block the dream cycle.
 */

import type { MemoryStore } from './store.js';
import type { Memory } from './types.js';
import type { Generator } from './generator.js';
import type { SourceCalibrationEntry } from './dream-nrem.js';
import type { SilenceEntry } from './silence.js';
import type { DriftEntry } from './drift.js';

export interface DreamJournalInput {
  phase: 'nrem' | 'rem' | 'full';
  duration: number;
  sleepPressureBefore: number;
  sleepPressureAfter: number;
  edgesPruned: number;
  decayApplied: boolean;
  clustersFound: number;
  dedupProposals: number;
  valenceBackfilled: number;
  sourceCalibration?: SourceCalibrationEntry[];
  silence?: SilenceEntry[];
  drift?: DriftEntry[];
  errors: string[];
}

export interface GraphHealthStats {
  totalMemories: number;
  totalEdges: number;
  avgEdgeWeight: number;
  orphanCount: number;
}

const MAX_JOURNAL_CHARS = 8000; // conservative proxy for 2000 tokens

function toDateString(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD
}

function computeAvgWeight(store: MemoryStore): number {
  const weights = store.getAllEdgeWeights();
  if (weights.length === 0) return 0;
  const sum = weights.reduce((acc, w) => acc + w, 0);
  return Math.round((sum / weights.length) * 100) / 100;
}

function buildGraphHealth(store: MemoryStore): GraphHealthStats {
  return {
    totalMemories: store.count(),
    totalEdges: store.edgeCount(),
    avgEdgeWeight: computeAvgWeight(store),
    orphanCount: store.orphanCount(),
  };
}

function buildTemplateFrontmatter(
  input: DreamJournalInput,
  timestamp: string,
): string {
  return `---
type: dream-journal
phase: ${input.phase}
timestamp: ${timestamp}
duration_ms: ${input.duration}
sleep_pressure_before: ${input.sleepPressureBefore}
sleep_pressure_after: ${input.sleepPressureAfter}
---`;
}

function buildTemplateBody(
  input: DreamJournalInput,
  health: GraphHealthStats,
): string {
  const lines: string[] = [];

  lines.push('## What changed');
  if (input.edgesPruned > 0) {
    lines.push(`- Pruned ${input.edgesPruned} edge${input.edgesPruned === 1 ? '' : 's'} below threshold`);
  }
  if (input.decayApplied) {
    lines.push('- Applied strength decay to non-constitutional memories');
  }
  if (input.clustersFound > 0) {
    lines.push(`- Detected ${input.clustersFound} cluster${input.clustersFound === 1 ? '' : 's'} during scan`);
  }
  if (input.valenceBackfilled > 0) {
    lines.push(`- Backfilled valence on ${input.valenceBackfilled} previously neutral ${input.valenceBackfilled === 1 ? 'memory' : 'memories'}`);
  }
  if (lines.length === 1) {
    lines.push('- No structural changes this cycle');
  }

  lines.push('');
  lines.push('## What I\'m proposing');
  if (input.dedupProposals > 0) {
    lines.push(`- ${input.dedupProposals} deduplication ${input.dedupProposals === 1 ? 'proposal' : 'proposals'} queued for review`);
  } else {
    lines.push('- No deduplication proposals this cycle');
  }

  if (input.errors.length > 0) {
    lines.push('');
    lines.push('## Errors');
    for (const err of input.errors) {
      lines.push(`- ${err}`);
    }
  }

  lines.push('');
  lines.push('## Graph health');
  lines.push(`- Total memories: ${health.totalMemories}`);
  lines.push(`- Total edges: ${health.totalEdges}`);
  lines.push(`- Avg edge weight: ${health.avgEdgeWeight}`);
  lines.push(`- Orphan memories: ${health.orphanCount}`);

  if (input.sourceCalibration && input.sourceCalibration.length > 0) {
    lines.push('');
    lines.push('## Source calibration');
    for (const entry of input.sourceCalibration) {
      const pct = Math.round(entry.survivalRate * 100);
      const flagLabel = entry.flag === 'low'
        ? ' — threshold may be too permissive'
        : entry.flag === 'high'
          ? ' — threshold may be too conservative'
          : entry.flag === 'ok'
            ? ''
            : ' — sample too small';
      lines.push(`- ${entry.source}: ${entry.survived}/${entry.total} survived (${pct}%)${flagLabel}`);
    }
  }

  if (input.silence && input.silence.length > 0) {
    lines.push('');
    lines.push('## Gone quiet');
    for (const entry of input.silence) {
      lines.push(`- ${entry.tag}: silent for ${entry.silentDays} days (was accessed ${entry.priorAccessCount} times before)`);
    }
  }

  if (input.drift && input.drift.length > 0) {
    lines.push('');
    lines.push('## Drift');
    for (const entry of input.drift) {
      const pct = Math.round(Math.abs(entry.magnitude) * 100);
      const arrow = entry.direction === 'strengthening' ? '+' : '-';
      lines.push(`- ${entry.tag}: ${entry.direction} (${arrow}${pct}%, avg weight ${entry.priorAvgWeight.toFixed(2)} -> ${entry.currentAvgWeight.toFixed(2)}, ${entry.memoryCount} memories)`);
    }
  }

  return lines.join('\n');
}

function buildTemplateJournal(
  input: DreamJournalInput,
  health: GraphHealthStats,
  timestamp: string,
): string {
  const frontmatter = buildTemplateFrontmatter(input, timestamp);
  const body = buildTemplateBody(input, health);
  return `${frontmatter}\n\n${body}`;
}

async function buildLlmJournal(
  input: DreamJournalInput,
  health: GraphHealthStats,
  timestamp: string,
  generator: Generator,
): Promise<string | null> {
  const context = [
    `Phase: ${input.phase}`,
    `Duration: ${input.duration}ms`,
    `Sleep pressure: ${input.sleepPressureBefore} -> ${input.sleepPressureAfter}`,
    `Edges pruned: ${input.edgesPruned}`,
    `Decay applied: ${input.decayApplied}`,
    `Clusters found: ${input.clustersFound}`,
    `Dedup proposals: ${input.dedupProposals}`,
    `Valence backfilled: ${input.valenceBackfilled}`,
    `Errors: ${input.errors.length > 0 ? input.errors.join('; ') : 'none'}`,
    `Graph — memories: ${health.totalMemories}, edges: ${health.totalEdges}, avg weight: ${health.avgEdgeWeight}, orphans: ${health.orphanCount}`,
  ].join('\n');

  const prompt = `You are a memory system writing a brief dream journal entry after a ${input.phase.toUpperCase()} sleep cycle.

Cycle stats:
${context}

Write a concise journal entry in this exact format (max 2000 tokens):

${buildTemplateFrontmatter(input, timestamp)}

## What changed
[2-4 bullet points summarizing structural changes]

## What I'm proposing
[1-2 bullet points about dedup or merge proposals]

## Graph health
- Total memories: ${health.totalMemories}
- Total edges: ${health.totalEdges}
- Avg edge weight: ${health.avgEdgeWeight}
- Orphan memories: ${health.orphanCount}

Keep it factual and brief. No speculation beyond what the stats show.`;

  const response = await generator.generate(prompt);
  return response;
}

/**
 * Write a dream journal entry after a sleep cycle.
 *
 * - Computes graph health stats from the store
 * - Generates journal content via LLM if a generator is provided, else template
 * - Saves the journal as a memory with tags ['dream-journal', phase, YYYY-MM-DD]
 * - Returns the created memory, or null if saving fails
 *
 * Journal generation failure is non-fatal — callers should catch and log.
 */
export async function writeDreamJournal(
  store: MemoryStore,
  input: DreamJournalInput,
  generator: Generator | null = null,
): Promise<Memory | null> {
  const timestamp = new Date().toISOString();
  const date = toDateString(Date.now());
  const tags = ['dream-journal', input.phase, date];

  let content: string;

  try {
    const health = buildGraphHealth(store);

    if (generator !== null) {
      const llmContent = await buildLlmJournal(input, health, timestamp, generator);
      content = llmContent
        ? llmContent.slice(0, MAX_JOURNAL_CHARS)
        : buildTemplateJournal(input, health, timestamp);
    } else {
      content = buildTemplateJournal(input, health, timestamp);
    }
  } catch {
    // Graph stats or journal generation failed — fall back to minimal entry
    const fallbackHealth: GraphHealthStats = {
      totalMemories: 0,
      totalEdges: 0,
      avgEdgeWeight: 0,
      orphanCount: 0,
    };
    content = buildTemplateJournal(input, fallbackHealth, timestamp);
  }

  try {
    const memory = store.create({ content, tags });
    return memory;
  } catch {
    return null;
  }
}
