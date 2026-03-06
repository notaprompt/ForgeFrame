/**
 * @forgeframe/proxy -- Tier 3: Local LLM Scrubber
 *
 * Sends ambiguous text to a local LLM (Ollama) for PII detection.
 * Hard timeout, fail-open (skip + log on failure).
 */

import type { Logger } from '@forgeframe/core';
import type { TokenMap, RedactionEntry, TokenCategory } from '../types.js';
import { TOKEN_CATEGORIES } from '../types.js';

interface LlmPiiMatch {
  text: string;
  category: string;
}

const VALID_CATEGORIES = new Set(Object.values(TOKEN_CATEGORIES));

export async function scrubWithLlm(
  text: string,
  tokenMap: TokenMap,
  allowlist: ReadonlySet<string>,
  ollamaUrl: string,
  model: string,
  timeout: number,
  logger: Logger,
): Promise<{ text: string; redactions: RedactionEntry[] }> {
  const redactions: RedactionEntry[] = [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: 'system',
            content: `You are a PII detector. Given text, identify any personally identifiable information that is NOT a common technical term, programming keyword, or public project name. Return ONLY a JSON array of objects with "text" (the exact PII string) and "category" (one of: PERSON, EMAIL, PHONE, SSN, IP, PATH, ORG, PROJECT, CUSTOM). If no PII is found, return an empty array []. No explanation, only JSON.`,
          },
          { role: 'user', content: text },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      logger.warn('LLM scrub: non-200 response', response.status);
      return { text, redactions };
    }

    const data = await response.json() as { message?: { content?: string } };
    const content = data.message?.content?.trim();
    if (!content) return { text, redactions };

    // Extract JSON array from response (handle markdown code blocks)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return { text, redactions };

    const matches: LlmPiiMatch[] = JSON.parse(jsonMatch[0]);
    let result = text;

    for (const match of matches) {
      if (!match.text || !match.category) continue;
      if (allowlist.has(match.text.toLowerCase())) continue;

      const category = VALID_CATEGORIES.has(match.category as TokenCategory)
        ? (match.category as TokenCategory)
        : 'CUSTOM';

      const pattern = new RegExp(escapeRegex(match.text), 'gi');
      const found = [...result.matchAll(pattern)];

      for (let i = found.length - 1; i >= 0; i--) {
        const m = found[i]!;
        const index = m.index!;
        const token = tokenMap.tokenize(m[0], category);
        result = result.slice(0, index) + token + result.slice(index + m[0].length);
        redactions.push({ original: m[0], token, category, tier: 3 });
      }
    }

    return { text: result, redactions };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('LLM scrub: timed out after', timeout, 'ms');
    } else {
      logger.warn('LLM scrub: failed, skipping', err);
    }
    return { text, redactions };
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
