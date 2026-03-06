import { describe, it, expect } from 'vitest';
import { rehydrate, StreamRehydrator } from './rehydrator.js';
import { TokenMapImpl } from './token-map.js';

function makeMap() {
  const map = new TokenMapImpl();
  map.tokenize('Andrew', 'PERSON');
  map.tokenize('a@b.com', 'EMAIL');
  map.tokenize('/home/andrew', 'PATH');
  return map;
}

describe('rehydrate (batch)', () => {
  it('replaces all tokens in a string', () => {
    const map = makeMap();
    const result = rehydrate('Hello [FF:PERSON_1], email is [FF:EMAIL_1]', map);
    expect(result).toBe('Hello Andrew, email is a@b.com');
  });

  it('leaves unknown tokens unchanged', () => {
    const map = makeMap();
    const result = rehydrate('Hello [FF:PERSON_99]', map);
    expect(result).toBe('Hello [FF:PERSON_99]');
  });

  it('handles text with no tokens', () => {
    const map = makeMap();
    const result = rehydrate('No tokens here', map);
    expect(result).toBe('No tokens here');
  });
});

describe('StreamRehydrator', () => {
  it('rehydrates complete tokens in a single chunk', () => {
    const map = makeMap();
    const stream = new StreamRehydrator(map);
    const result = stream.push('Hello [FF:PERSON_1]!');
    expect(result).toBe('Hello Andrew!');
  });

  it('handles tokens split across two chunks', () => {
    const map = makeMap();
    const stream = new StreamRehydrator(map);

    const r1 = stream.push('Hello [FF:PER');
    expect(r1).toBe('Hello ');

    const r2 = stream.push('SON_1] world');
    expect(r2).toBe('Andrew world');
  });

  it('handles tokens split across three chunks', () => {
    const map = makeMap();
    const stream = new StreamRehydrator(map);

    const r1 = stream.push('Hi [FF:');
    expect(r1).toBe('Hi ');

    const r2 = stream.push('EMAIL_');
    expect(r2).toBe('');

    const r3 = stream.push('1] ok');
    expect(r3).toBe('a@b.com ok');
  });

  it('flushes held buffer on end()', () => {
    const map = makeMap();
    const stream = new StreamRehydrator(map);

    const r1 = stream.push('text [FF:PERS');
    expect(r1).toBe('text ');

    const r2 = stream.end();
    expect(r2).toBe('[FF:PERS');
  });

  it('flushes partial that exceeds max hold as-is', () => {
    const map = makeMap();
    const stream = new StreamRehydrator(map);

    // Push a fake partial followed by enough chars to exceed MAX_HOLD (64)
    const filler = 'x'.repeat(70);
    const r1 = stream.push('[FF:NOT_A_REAL_TOKEN_' + filler);
    // Should flush everything since it exceeded hold limit
    expect(r1).toContain('[FF:NOT_A_REAL_TOKEN_');
  });

  it('handles multiple tokens in one chunk', () => {
    const map = makeMap();
    const stream = new StreamRehydrator(map);
    const result = stream.push('[FF:PERSON_1] at [FF:EMAIL_1]');
    expect(result).toBe('Andrew at a@b.com');
  });

  it('handles chunks with no tokens', () => {
    const map = makeMap();
    const stream = new StreamRehydrator(map);
    const result = stream.push('just plain text');
    expect(result).toBe('just plain text');
  });

  it('handles empty chunks', () => {
    const map = makeMap();
    const stream = new StreamRehydrator(map);
    const result = stream.push('');
    expect(result).toBe('');
  });
});
