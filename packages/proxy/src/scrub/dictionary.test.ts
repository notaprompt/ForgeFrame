import { describe, it, expect } from 'vitest';
import { scrubWithDictionary, buildAllowlistSet } from './dictionary.js';
import { TokenMapImpl } from '../token-map.js';
import type { DictionaryEntry } from './dictionary.js';

function scrub(text: string, blocklist: DictionaryEntry[], allowlist: string[] = []) {
  const map = new TokenMapImpl();
  const allow = buildAllowlistSet(allowlist);
  return { ...scrubWithDictionary(text, map, blocklist, allow), map };
}

describe('scrubWithDictionary', () => {
  it('scrubs blocklisted names', () => {
    const blocklist: DictionaryEntry[] = [
      { value: 'Andrew Campos', category: 'PERSON' },
    ];
    const { text, redactions } = scrub('Hello Andrew Campos, how are you?', blocklist);
    expect(text).toBe('Hello [FF:PERSON_1], how are you?');
    expect(redactions).toHaveLength(1);
    expect(redactions[0]!.tier).toBe(2);
  });

  it('is case insensitive', () => {
    const blocklist: DictionaryEntry[] = [
      { value: 'ForgeFrame', category: 'PROJECT' },
    ];
    const { text } = scrub('Working on FORGEFRAME and forgeframe today', blocklist);
    expect(text).not.toContain('FORGEFRAME');
    expect(text).not.toContain('forgeframe');
  });

  it('scrubs multiple blocklist entries', () => {
    const blocklist: DictionaryEntry[] = [
      { value: 'Andrew', category: 'PERSON' },
      { value: 'Acme Corp', category: 'ORG' },
    ];
    const { text } = scrub('Andrew works at Acme Corp', blocklist);
    expect(text).toContain('[FF:PERSON_1]');
    expect(text).toContain('[FF:ORG_1]');
  });

  it('respects allowlist over blocklist', () => {
    const blocklist: DictionaryEntry[] = [
      { value: 'React', category: 'PROJECT' },
    ];
    const { text } = scrub('Built with React', blocklist, ['React']);
    expect(text).toBe('Built with React');
  });

  it('handles text with no matches', () => {
    const blocklist: DictionaryEntry[] = [
      { value: 'Secret Name', category: 'PERSON' },
    ];
    const { text, redactions } = scrub('Nothing to see here', blocklist);
    expect(text).toBe('Nothing to see here');
    expect(redactions).toHaveLength(0);
  });

  it('uses word boundaries', () => {
    const blocklist: DictionaryEntry[] = [
      { value: 'Andrew', category: 'PERSON' },
    ];
    const { text } = scrub('Andrews is different from Andrew', blocklist);
    // "Andrews" should NOT match, "Andrew" should
    expect(text).toContain('Andrews');
    expect(text).toContain('[FF:PERSON_1]');
  });
});
