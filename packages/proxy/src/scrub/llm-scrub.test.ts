import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrubWithLlm, checkOllamaHealth } from './llm-scrub.js';
import { TokenMapImpl } from '../token-map.js';
import type { Logger } from '@forgeframe/core';

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('scrubWithLlm', () => {
  it('returns original text when LLM returns empty array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: '[]' } }),
    }));

    const map = new TokenMapImpl();
    const result = await scrubWithLlm('Hello world', map, new Set(), 'http://localhost:11434', 'test', 2000, logger);
    expect(result.text).toBe('Hello world');
    expect(result.redactions).toHaveLength(0);
  });

  it('scrubs PII detected by LLM', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify([{ text: 'John Doe', category: 'PERSON' }]),
        },
      }),
    }));

    const map = new TokenMapImpl();
    const result = await scrubWithLlm('Contact John Doe please', map, new Set(), 'http://localhost:11434', 'test', 2000, logger);
    expect(result.text).not.toContain('John Doe');
    expect(result.text).toContain('[FF:PERSON_1]');
    expect(result.redactions).toHaveLength(1);
    expect(result.redactions[0]!.tier).toBe(3);
  });

  it('respects allowlist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify([{ text: 'React', category: 'PROJECT' }]),
        },
      }),
    }));

    const map = new TokenMapImpl();
    const allow = new Set(['react']);
    const result = await scrubWithLlm('Built with React', map, allow, 'http://localhost:11434', 'test', 2000, logger);
    expect(result.text).toBe('Built with React');
    expect(result.redactions).toHaveLength(0);
  });

  it('fails open on timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));

    const map = new TokenMapImpl();
    const result = await scrubWithLlm('Some text', map, new Set(), 'http://localhost:11434', 'test', 1, logger);
    expect(result.text).toBe('Some text');
    expect(result.redactions).toHaveLength(0);
  });

  it('fails open on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const map = new TokenMapImpl();
    const result = await scrubWithLlm('Some text', map, new Set(), 'http://localhost:11434', 'test', 2000, logger);
    expect(result.text).toBe('Some text');
    expect(result.redactions).toHaveLength(0);
  });

  it('handles markdown-wrapped JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: '```json\n[{"text": "Alice Smith", "category": "PERSON"}]\n```',
        },
      }),
    }));

    const map = new TokenMapImpl();
    const result = await scrubWithLlm('Email Alice Smith', map, new Set(), 'http://localhost:11434', 'test', 2000, logger);
    expect(result.text).toContain('[FF:PERSON_1]');
    expect(result.redactions).toHaveLength(1);
  });

  it('maps unknown categories to CUSTOM', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify([{ text: 'FooBar', category: 'UNKNOWN_TYPE' }]),
        },
      }),
    }));

    const map = new TokenMapImpl();
    const result = await scrubWithLlm('See FooBar', map, new Set(), 'http://localhost:11434', 'test', 2000, logger);
    expect(result.redactions[0]!.category).toBe('CUSTOM');
  });
});

describe('checkOllamaHealth', () => {
  it('returns true when server responds ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const result = await checkOllamaHealth('http://localhost:11434');
    expect(result).toBe(true);
  });

  it('returns false when server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const result = await checkOllamaHealth('http://localhost:11434');
    expect(result).toBe(false);
  });
});
