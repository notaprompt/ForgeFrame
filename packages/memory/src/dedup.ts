import type { MemoryStore } from './store.js';
import type { Memory } from './types.js';

/**
 * Check if a near-duplicate memory exists.
 * Uses FTS5 text search to find candidates, then checks for high overlap.
 * Returns the existing memory if a duplicate is found, null otherwise.
 */
export function findDuplicate(
  store: MemoryStore,
  content: string,
  threshold = 0.7,
): Memory | null {
  // Extract key terms for search
  const terms = content
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 3)
    .slice(0, 5);

  if (terms.length === 0) return null;

  // Use OR semantics: search each term individually and union results
  const seen = new Set<string>();
  const candidates: Memory[] = [];
  for (const term of terms) {
    for (const m of store.search(term, 5)) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        candidates.push(m);
      }
    }
  }
  if (candidates.length === 0) return null;

  // Simple token overlap check
  const contentTokens = new Set(content.toLowerCase().split(/\s+/));

  for (const candidate of candidates) {
    const candidateTokens = new Set(candidate.content.toLowerCase().split(/\s+/));
    const intersection = [...contentTokens].filter(t => candidateTokens.has(t));
    const union = new Set([...contentTokens, ...candidateTokens]);
    const jaccard = intersection.length / union.size;

    if (jaccard >= threshold) {
      return candidate;
    }
  }

  return null;
}
