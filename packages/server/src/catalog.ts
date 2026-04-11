/**
 * @forgeframe/server — Memory Catalog Pipeline
 *
 * Enriches memories with LLM-derived memorandums (title, insight, pattern tags)
 * using the local Ollama instance. Non-destructive — original content preserved
 * below a --- divider.
 */

import type { MemoryStore } from '@forgeframe/memory';

const OLLAMA_URL = process.env.FORGEFRAME_OLLAMA_URL || 'http://localhost:11434';
const CATALOG_MODEL = process.env.FORGEFRAME_CATALOG_MODEL || 'qwen3.5:9b';

interface Memorandum {
  title: string;
  insight: string;
  patterns: string[];
}

/**
 * Check if a memory already has a memorandum (starts with [Title]:)
 */
export function hasMemorandum(content: string): boolean {
  return content.trimStart().startsWith('[Title]:');
}

/**
 * Extract memorandum from Ollama response
 */
function parseMemorandum(response: string): Memorandum | null {
  try {
    const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const obj = JSON.parse(cleaned);
    return {
      title: String(obj.title || '').slice(0, 120),
      insight: String(obj.insight || '').slice(0, 300),
      patterns: Array.isArray(obj.patterns) ? obj.patterns.map(String).slice(0, 5) : [],
    };
  } catch {
    return null;
  }
}

/**
 * Build the memorandum block to prepend
 */
function formatMemorandum(memo: Memorandum): string {
  const lines = [
    `[Title]: ${memo.title}`,
    `[Insight]: ${memo.insight}`,
    `[Patterns]: ${memo.patterns.join(', ')}`,
    '',
    '---',
    '',
  ];
  return lines.join('\n');
}

const CATALOG_PROMPT = `Read this memory content. Return a JSON object with exactly these fields:
- "title": 5-10 word summary of what this is about
- "insight": one sentence — the key thesis, decision, or friction point
- "patterns": array of 3-5 conceptual pattern tags (not topic words — think about what kind of thinking this represents)

Return ONLY valid JSON, no markdown fences, no explanation.

Memory content:
`;

/**
 * Catalog a single memory via Ollama. Returns the memorandum or null on failure.
 */
export async function catalogMemory(content: string): Promise<Memorandum | null> {
  const truncated = content.length > 1500 ? content.slice(0, 1500) + '\n[truncated]' : content;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CATALOG_MODEL,
        prompt: CATALOG_PROMPT + truncated,
        stream: false,
        options: { temperature: 0.1, num_predict: 256 },
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    return parseMemorandum(data.response || '');
  } catch {
    return null;
  }
}

/**
 * Run catalog on all uncataloged memories. Calls onProgress for each completed memory.
 * Returns { cataloged, skipped, failed }.
 */
export async function catalogAll(
  store: MemoryStore,
  onProgress?: (done: number, total: number, memoryId: string) => void,
): Promise<{ cataloged: number; skipped: number; failed: number }> {
  const all = store.getRecent(5000);
  const total = all.length;
  let cataloged = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < all.length; i++) {
    const mem = all[i];

    if (hasMemorandum(mem.content)) {
      skipped++;
      continue;
    }

    const memo = await catalogMemory(mem.content);

    if (memo) {
      const newContent = formatMemorandum(memo) + mem.content;
      store.update(mem.id, { content: newContent });
      cataloged++;
    } else {
      failed++;
    }

    onProgress?.(cataloged + skipped + failed, total, mem.id);
  }

  return { cataloged, skipped, failed };
}
