/**
 * @forgeframe/memory — Silence Detection
 *
 * Finds tag domains that used to be actively retrieved but have gone dark.
 * Different from decay (mechanical strength loss) — silence is behavioral:
 * a whole domain stops being accessed.
 *
 * "You used to think about X constantly. You haven't touched it in 6 weeks."
 */

import type { MemoryStore } from './store.js';

export interface SilenceEntry {
  tag: string;
  lastAccessedAt: number;
  priorAccessCount: number;
  silentDays: number;
}

const EXCLUDED_TAGS = ['principle', 'voice', 'dream-journal'];
const MS_PER_DAY = 86_400_000;
const DEFAULT_WINDOW_DAYS = 42;
const DEFAULT_MIN_PRIOR_ACCESS = 3;

/**
 * Find tag clusters that have gone quiet — were actively accessed
 * but haven't been touched in `windowDays`.
 */
export function findGoneQuiet(
  store: MemoryStore,
  windowDays = DEFAULT_WINDOW_DAYS,
  minPriorAccess = DEFAULT_MIN_PRIOR_ACCESS,
): SilenceEntry[] {
  const db = (store as any)['_db'];
  const now = Date.now();
  const cutoff = now - windowDays * MS_PER_DAY;

  // Get all distinct tags from the database
  const rows = db.prepare('SELECT DISTINCT tags FROM memories').all() as { tags: string }[];

  const tagSet = new Set<string>();
  for (const row of rows) {
    const parsed: string[] = JSON.parse(row.tags);
    for (const tag of parsed) {
      if (!EXCLUDED_TAGS.includes(tag)) {
        tagSet.add(tag);
      }
    }
  }

  const entries: SilenceEntry[] = [];

  for (const tag of tagSet) {
    const memories = store.listByTag(tag, 10000);
    if (memories.length === 0) continue;

    let lastAccessed = 0;
    let totalAccessCount = 0;

    for (const mem of memories) {
      if (mem.lastAccessedAt > lastAccessed) {
        lastAccessed = mem.lastAccessedAt;
      }
      totalAccessCount += mem.accessCount;
    }

    // Skip if accessed within the window
    if (lastAccessed >= cutoff) continue;

    // Skip if never truly active
    if (totalAccessCount < minPriorAccess) continue;

    entries.push({
      tag,
      lastAccessedAt: lastAccessed,
      priorAccessCount: totalAccessCount,
      silentDays: Math.floor((now - lastAccessed) / MS_PER_DAY),
    });
  }

  // Longest silence first
  entries.sort((a, b) => b.silentDays - a.silentDays);
  return entries;
}
