/**
 * @forgeframe/memory — Valence Classification
 *
 * Classifies memory emotional valence as charged, neutral, or grounding.
 * Constitutional memories (principle/voice tags) always get grounding.
 */

import type { Generator } from './generator.js';
import type { Valence } from './types.js';

const CLASSIFY_PROMPT = `Classify this memory's emotional valence as exactly one word:
- "charged" if it carries emotional weight (decisions under pressure, personal stakes, breakthroughs, conflict)
- "neutral" if it's factual, operational, or informational
- "grounding" if it anchors identity (principles, values, constitutional commitments)

Memory: "{content}"

Respond with exactly one word: charged, neutral, or grounding`;

export async function classifyValence(
  content: string,
  generator: Generator | null,
  tags: string[] = [],
): Promise<Valence> {
  // Constitutional tags always get grounding -- no LLM needed
  if (tags.some(t => t === 'principle' || t === 'voice')) {
    return 'grounding';
  }

  // If no generator available, default to neutral
  if (!generator) return 'neutral';

  try {
    const response = await generator.generate(
      CLASSIFY_PROMPT.replace('{content}', content.slice(0, 500)),
    );
    if (!response) return 'neutral';
    const word = response.trim().toLowerCase();
    if (word === 'charged' || word === 'neutral' || word === 'grounding') {
      return word;
    }
    return 'neutral';
  } catch {
    return 'neutral';
  }
}
