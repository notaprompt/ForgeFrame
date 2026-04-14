import { describe, it, expect } from 'vitest';
import { classifyValence } from './valence.js';

describe('classifyValence', () => {
  it('returns grounding for principle-tagged memories without LLM', async () => {
    const result = await classifyValence('some content', null, ['principle']);
    expect(result).toBe('grounding');
  });

  it('returns grounding for voice-tagged memories without LLM', async () => {
    const result = await classifyValence('some content', null, ['voice']);
    expect(result).toBe('grounding');
  });

  it('returns neutral when no generator available', async () => {
    const result = await classifyValence('some operational note', null);
    expect(result).toBe('neutral');
  });
});
