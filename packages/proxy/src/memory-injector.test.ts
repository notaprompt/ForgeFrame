import { describe, it, expect } from 'vitest';
import { MemoryInjectorImpl } from './memory-injector.js';
import type { MemoryRetriever } from '@forgeframe/memory';

function mockRetriever(results: { content: string; score: number }[]): MemoryRetriever {
  return {
    query: () =>
      results.map((r, i) => ({
        memory: {
          id: `mem-${i}`,
          content: r.content,
          embedding: null,
          strength: 1.0,
          accessCount: 0,
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
          sessionId: null,
          tags: [],
          metadata: {},
        },
        score: r.score,
      })),
  } as unknown as MemoryRetriever;
}

describe('MemoryInjectorImpl', () => {
  it('returns formatted context block', async () => {
    const injector = new MemoryInjectorImpl(
      mockRetriever([
        { content: 'User prefers TypeScript', score: 0.87 },
        { content: 'Project uses SQLite', score: 0.72 },
      ])
    );

    const result = await injector.retrieve('test query');
    expect(result).toContain('[ForgeFrame Context]');
    expect(result).toContain('[End ForgeFrame Context]');
    expect(result).toContain('[0.87] User prefers TypeScript');
    expect(result).toContain('[0.72] Project uses SQLite');
  });

  it('returns empty string when no results', async () => {
    const injector = new MemoryInjectorImpl(mockRetriever([]));
    const result = await injector.retrieve('test query');
    expect(result).toBe('');
  });
});
