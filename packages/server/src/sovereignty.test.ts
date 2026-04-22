import { describe, it, expect, vi } from 'vitest';
import { sovereigntyCheck } from './sovereignty.js';
import type { Memory, Sensitivity } from '@forgeframe/memory';

function mem(id: string, sensitivity: Sensitivity): Memory {
  return {
    id,
    content: 'fake',
    embedding: null,
    strength: 1,
    accessCount: 0,
    retrievalCount: 0,
    createdAt: 0,
    lastAccessedAt: 0,
    lastDecayAt: 0,
    sessionId: null,
    tags: [],
    associations: [],
    metadata: {},
    memoryType: 'semantic',
    readiness: 0,
    valence: 'neutral',
    lastHindsightReview: null,
    sensitivity,
  };
}

function fakeStore(rows: Record<string, Memory | null>) {
  return {
    get: (id: string) => rows[id] ?? null,
  };
}

describe('sovereigntyCheck (skeleton)', () => {
  it('is a no-op (allowed:true) when destination is local', () => {
    const warn = vi.fn();
    const store = fakeStore({
      a: mem('a', 'local-only'),
      b: mem('b', 'sensitive'),
    });
    const result = sovereigntyCheck(
      store,
      { memoryIds: ['a', 'b'], destination: 'local' },
      { warn },
    );
    expect(result).toEqual({ allowed: true, reasons: [] });
    expect(warn).not.toHaveBeenCalled();
  });

  it('is a no-op (allowed:true) when all memories are public, even for frontier', () => {
    const warn = vi.fn();
    const store = fakeStore({
      a: mem('a', 'public'),
      b: mem('b', 'public'),
    });
    const result = sovereigntyCheck(
      store,
      { memoryIds: ['a', 'b'], destination: 'frontier' },
      { warn },
    );
    expect(result).toEqual({ allowed: true, reasons: [] });
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns but still allows when sensitive memory bound for frontier', () => {
    const warn = vi.fn();
    const store = fakeStore({
      'aaaaaaaa-1111': mem('aaaaaaaa-1111', 'sensitive'),
      'bbbbbbbb-2222': mem('bbbbbbbb-2222', 'public'),
    });
    const result = sovereigntyCheck(
      store,
      { memoryIds: ['aaaaaaaa-1111', 'bbbbbbbb-2222'], destination: 'frontier' },
      { warn },
    );
    expect(result).toEqual({ allowed: true, reasons: [] });
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain('[sovereignty] WARN');
    expect(msg).toContain('aaaaaaaa');
    expect(msg).toContain('sensitive');
  });

  it('warns and allows when local-only memory bound for frontier', () => {
    const warn = vi.fn();
    const store = fakeStore({
      'xxxxxxxx-3333': mem('xxxxxxxx-3333', 'local-only'),
    });
    const result = sovereigntyCheck(
      store,
      { memoryIds: ['xxxxxxxx-3333'], destination: 'frontier' },
      { warn },
    );
    expect(result).toEqual({ allowed: true, reasons: [] });
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain('local-only');
  });

  it('silently skips unknown memory ids without throwing', () => {
    const warn = vi.fn();
    const store = fakeStore({ a: mem('a', 'public') });
    const result = sovereigntyCheck(
      store,
      { memoryIds: ['a', 'missing-id'], destination: 'frontier' },
      { warn },
    );
    expect(result).toEqual({ allowed: true, reasons: [] });
    expect(warn).not.toHaveBeenCalled();
  });
});
