/**
 * @forgeframe/proxy -- Tier 1: Regex Scrubber
 *
 * Deterministic pattern matching for structured PII.
 * Instant (<1ms), no external dependencies.
 */

import type { TokenCategory, TokenMap, RedactionEntry } from '../types.js';

interface RegexRule {
  pattern: RegExp;
  category: TokenCategory;
}

const RULES: RegexRule[] = [
  // SSN must come before phone (more specific pattern first)
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, category: 'SSN' },
  // Email
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, category: 'EMAIL' },
  // Phone (US formats: +1-xxx-xxx-xxxx, (xxx) xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx)
  { pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, category: 'PHONE' },
  // IP addresses
  { pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g, category: 'IP' },
  // File paths (Windows: C:\... or Unix: /... or ~/...)
  { pattern: /(?:[A-Z]:\\[\w\\.-]+|~?\/[\w/.-]+)/gi, category: 'PATH' },
];

export function scrubWithRegex(
  text: string,
  tokenMap: TokenMap,
  allowlist: ReadonlySet<string>,
): { text: string; redactions: RedactionEntry[] } {
  const redactions: RedactionEntry[] = [];
  let result = text;

  for (const rule of RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    // Collect matches first, then tokenize values in forward order,
    // then replace in reverse order to preserve indices
    const matches = [...result.matchAll(pattern)];
    const tokens: { index: number; length: number; token: string; original: string }[] = [];

    for (const match of matches) {
      const value = match[0];
      if (allowlist.has(value.toLowerCase())) continue;
      const token = tokenMap.tokenize(value, rule.category);
      tokens.push({ index: match.index!, length: value.length, token, original: value });
      redactions.push({ original: value, token, category: rule.category, tier: 1 });
    }

    // Replace in reverse to preserve indices
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i]!;
      result = result.slice(0, t.index) + t.token + result.slice(t.index + t.length);
    }
  }

  return { text: result, redactions };
}
