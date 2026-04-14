/**
 * @forgeframe/memory — Sleep pressure metric
 *
 * Computes how urgently the dream engine should run based on
 * unconsolidated memories, time since last dream journal, unscanned
 * contradictions, and pending decay work.
 */

import type { MemoryStore } from './store.js';
import type { SleepPressure } from './types.js';

const NREM_THRESHOLD = 20;
const FULL_THRESHOLD = 50;

export function computeSleepPressure(store: MemoryStore): SleepPressure {
  const db = store['_db'];

  // Timestamp of last dream journal entry (0 if none)
  const lastDream = db.prepare(`
    SELECT MAX(created_at) as ts FROM memories WHERE tags LIKE '%"dream-journal"%'
  `).get() as { ts: number | null };
  const lastDreamAt = lastDream?.ts ?? 0;
  const hoursSinceLastDream = lastDreamAt === 0
    ? 0
    : (Date.now() - lastDreamAt) / 3600000;

  // Memories saved since last dream that are not themselves dream journals
  const unconsolidated = db.prepare(`
    SELECT COUNT(*) as count FROM memories WHERE created_at > ?
    AND tags NOT LIKE '%"dream-journal"%'
  `).get(lastDreamAt) as { count: number };

  // Contradicts edges that have no corresponding contradiction proposal
  const unscanned = db.prepare(`
    SELECT COUNT(*) as count FROM memory_edges
    WHERE relation_type = 'contradicts'
    AND id NOT IN (SELECT edge_id FROM contradiction_proposals)
  `).get() as { count: number };

  // Memories that have not been decayed in the last 24 hours and are above floor
  const dayAgo = Date.now() - 86400000;
  const pendingDecay = db.prepare(`
    SELECT COUNT(*) as count FROM memories
    WHERE (last_decay_at IS NULL OR last_decay_at < ?)
    AND strength > 0.1
    AND tags NOT LIKE '%"principle"%' AND tags NOT LIKE '%"voice"%'
  `).get(dayAgo) as { count: number };

  const components = {
    unconsolidated: unconsolidated.count,
    hoursSinceLastDream,
    unscannedContradictions: unscanned.count,
    pendingDecay: pendingDecay.count,
  };

  const score =
    components.unconsolidated * 0.4 +
    components.hoursSinceLastDream * 0.3 +
    components.unscannedContradictions * 0.2 +
    components.pendingDecay * 0.1;

  let recommendation: SleepPressure['recommendation'] = 'sleep';
  if (score >= FULL_THRESHOLD) recommendation = 'full';
  else if (score >= NREM_THRESHOLD) recommendation = 'nrem';

  return { score, components, recommendation };
}
