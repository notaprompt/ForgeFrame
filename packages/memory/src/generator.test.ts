import { describe, it, expect } from 'vitest';
import { OllamaGenerator } from './generator.js';
import type { Generator } from './generator.js';

describe('OllamaGenerator', () => {
  it('implements Generator interface', () => {
    const gen: Generator = new OllamaGenerator({
      ollamaUrl: 'http://localhost:11434',
      model: 'qwen3:32b',
    });
    expect(gen).toBeDefined();
    expect(gen.generate).toBeTypeOf('function');
  });

  it('returns null on connection failure (fail-silent)', async () => {
    const gen = new OllamaGenerator({
      ollamaUrl: 'http://localhost:1',
      model: 'qwen3:32b',
    });
    const result = await gen.generate('test prompt');
    expect(result).toBeNull();
  });
});
