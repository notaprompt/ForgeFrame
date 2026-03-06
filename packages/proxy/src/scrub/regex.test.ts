import { describe, it, expect } from 'vitest';
import { scrubWithRegex } from './regex.js';
import { TokenMapImpl } from '../token-map.js';

function scrub(text: string, allowlist: string[] = []) {
  const map = new TokenMapImpl();
  const allow = new Set(allowlist.map((s) => s.toLowerCase()));
  return { ...scrubWithRegex(text, map, allow), map };
}

describe('scrubWithRegex', () => {
  it('scrubs email addresses', () => {
    const { text, redactions } = scrub('Contact me at john@example.com please');
    expect(text).toBe('Contact me at [FF:EMAIL_1] please');
    expect(redactions).toHaveLength(1);
    expect(redactions[0]!.category).toBe('EMAIL');
    expect(redactions[0]!.tier).toBe(1);
  });

  it('scrubs multiple emails', () => {
    const { text } = scrub('From a@b.com to c@d.com');
    expect(text).toBe('From [FF:EMAIL_1] to [FF:EMAIL_2]');
  });

  it('scrubs SSNs', () => {
    const { text } = scrub('SSN: 123-45-6789');
    expect(text).toBe('SSN: [FF:SSN_1]');
  });

  it('scrubs phone numbers', () => {
    const { text } = scrub('Call 555-123-4567 or (555) 987-6543');
    expect(text).toContain('[FF:PHONE_');
    expect(text).not.toContain('555-123-4567');
    expect(text).not.toContain('(555) 987-6543');
  });

  it('scrubs IP addresses', () => {
    const { text } = scrub('Server at 192.168.1.100 and 10.0.0.1');
    expect(text).toBe('Server at [FF:IP_1] and [FF:IP_2]');
  });

  it('scrubs Windows file paths', () => {
    const { text } = scrub('File at C:\\Users\\andrew\\docs\\secret.txt');
    expect(text).toContain('[FF:PATH_');
    expect(text).not.toContain('C:\\Users');
  });

  it('scrubs Unix file paths', () => {
    const { text } = scrub('File at /home/andrew/docs/secret.txt');
    expect(text).toContain('[FF:PATH_');
    expect(text).not.toContain('/home/andrew');
  });

  it('scrubs tilde paths', () => {
    const { text } = scrub('Config at ~/.forgeframe/config.json');
    expect(text).toContain('[FF:PATH_');
  });

  it('respects allowlist', () => {
    const { text } = scrub('Contact john@example.com and admin@test.com', ['john@example.com']);
    expect(text).toContain('john@example.com');
    expect(text).toContain('[FF:EMAIL_');
    expect(text).not.toContain('admin@test.com');
  });

  it('handles text with no PII', () => {
    const { text, redactions } = scrub('Hello world, nothing sensitive here');
    expect(text).toBe('Hello world, nothing sensitive here');
    expect(redactions).toHaveLength(0);
  });

  it('handles mixed PII types', () => {
    const { text, redactions } = scrub(
      'Email john@test.com, SSN 111-22-3333, IP 10.0.0.1'
    );
    expect(redactions.length).toBeGreaterThanOrEqual(3);
    expect(text).not.toContain('john@test.com');
    expect(text).not.toContain('111-22-3333');
    expect(text).not.toContain('10.0.0.1');
  });
});
