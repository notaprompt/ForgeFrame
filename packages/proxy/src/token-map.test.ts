import { describe, it, expect } from 'vitest';
import { TokenMapImpl } from './token-map.js';

describe('TokenMapImpl', () => {
  it('tokenizes and detokenizes a value', () => {
    const map = new TokenMapImpl();
    const token = map.tokenize('Andrew', 'PERSON');
    expect(token).toBe('[FF:PERSON_1]');
    expect(map.detokenize(token)).toBe('Andrew');
  });

  it('returns the same token for the same value', () => {
    const map = new TokenMapImpl();
    const t1 = map.tokenize('Andrew', 'PERSON');
    const t2 = map.tokenize('Andrew', 'PERSON');
    expect(t1).toBe(t2);
    expect(map.size).toBe(1);
  });

  it('returns different tokens for different values', () => {
    const map = new TokenMapImpl();
    const t1 = map.tokenize('Andrew', 'PERSON');
    const t2 = map.tokenize('Sarah', 'PERSON');
    expect(t1).toBe('[FF:PERSON_1]');
    expect(t2).toBe('[FF:PERSON_2]');
    expect(map.size).toBe(2);
  });

  it('is case insensitive on tokenize, preserves first-seen casing on detokenize', () => {
    const map = new TokenMapImpl();
    const t1 = map.tokenize('Andrew', 'PERSON');
    const t2 = map.tokenize('andrew', 'PERSON');
    const t3 = map.tokenize('ANDREW', 'PERSON');
    expect(t1).toBe(t2);
    expect(t2).toBe(t3);
    expect(map.detokenize(t1)).toBe('Andrew');
  });

  it('increments counters per category', () => {
    const map = new TokenMapImpl();
    const p1 = map.tokenize('Andrew', 'PERSON');
    const e1 = map.tokenize('a@b.com', 'EMAIL');
    const p2 = map.tokenize('Sarah', 'PERSON');
    expect(p1).toBe('[FF:PERSON_1]');
    expect(e1).toBe('[FF:EMAIL_1]');
    expect(p2).toBe('[FF:PERSON_2]');
  });

  it('detokenizeAll replaces all tokens in a string', () => {
    const map = new TokenMapImpl();
    map.tokenize('Andrew', 'PERSON');
    map.tokenize('a@b.com', 'EMAIL');

    const scrubbed = 'Hello [FF:PERSON_1], your email is [FF:EMAIL_1].';
    expect(map.detokenizeAll(scrubbed)).toBe('Hello Andrew, your email is a@b.com.');
  });

  it('detokenizeAll leaves unknown tokens unchanged', () => {
    const map = new TokenMapImpl();
    const text = 'Hello [FF:PERSON_99], unknown token.';
    expect(map.detokenizeAll(text)).toBe(text);
  });

  it('detokenize returns null for unknown tokens', () => {
    const map = new TokenMapImpl();
    expect(map.detokenize('[FF:PERSON_1]')).toBeNull();
  });

  it('serializes and deserializes round trip', () => {
    const map = new TokenMapImpl();
    map.tokenize('Andrew', 'PERSON');
    map.tokenize('a@b.com', 'EMAIL');
    map.tokenize('Sarah', 'PERSON');

    const json = map.serialize();
    const restored = TokenMapImpl.deserialize(json);

    expect(restored.size).toBe(3);
    expect(restored.detokenize('[FF:PERSON_1]')).toBe('Andrew');
    expect(restored.detokenize('[FF:EMAIL_1]')).toBe('a@b.com');
    expect(restored.detokenize('[FF:PERSON_2]')).toBe('Sarah');

    // counters preserved -- next person should be _3
    const t = restored.tokenize('Carlos', 'PERSON');
    expect(t).toBe('[FF:PERSON_3]');
  });
});
