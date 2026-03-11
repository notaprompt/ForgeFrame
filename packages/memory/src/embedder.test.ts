import { describe, it, expect, vi } from 'vitest';
import { OllamaEmbedder } from './embedder.js';

describe('OllamaEmbedder', () => {
  it('returns embedding array on success', async () => {
    const mockEmbedding = [0.1, 0.2, 0.3];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [mockEmbedding] }),
    });

    const embedder = new OllamaEmbedder({
      ollamaUrl: 'http://localhost:11434',
      model: 'nomic-embed-text',
    });

    const result = await embedder.embed('test text');
    expect(result).toEqual(mockEmbedding);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/embed',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns null on HTTP error', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });

    const embedder = new OllamaEmbedder({
      ollamaUrl: 'http://localhost:11434',
      model: 'nomic-embed-text',
    });

    const result = await embedder.embed('test text');
    expect(result).toBeNull();
  });

  it('returns null on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const embedder = new OllamaEmbedder({
      ollamaUrl: 'http://localhost:11434',
      model: 'nomic-embed-text',
    });

    const result = await embedder.embed('test text');
    expect(result).toBeNull();
  });

  it('truncates input longer than 8000 chars', async () => {
    let capturedBody = '';
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      capturedBody = opts.body;
      return { ok: true, json: async () => ({ embeddings: [[0.1]] }) };
    });

    const embedder = new OllamaEmbedder({
      ollamaUrl: 'http://localhost:11434',
      model: 'nomic-embed-text',
    });

    const longText = 'x'.repeat(10000);
    await embedder.embed(longText);

    const parsed = JSON.parse(capturedBody);
    expect(parsed.input.length).toBe(8000);
  });

  it('returns null when embeddings array is empty', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [] }),
    });

    const embedder = new OllamaEmbedder({
      ollamaUrl: 'http://localhost:11434',
      model: 'nomic-embed-text',
    });

    const result = await embedder.embed('test');
    expect(result).toBeNull();
  });
});
