/**
 * @forgeframe/proxy -- Tier 2: Dictionary Scrubber
 *
 * User-maintained blocklist/allowlist for names, orgs, project codenames.
 * Instant lookup (<1ms).
 */

import { readFileSync, existsSync, watchFile, unwatchFile } from 'fs';
import type { TokenCategory, TokenMap, RedactionEntry } from '../types.js';

export interface DictionaryEntry {
  value: string;
  category: TokenCategory;
}

export interface DictionaryConfig {
  blocklist: DictionaryEntry[];
  allowlist: string[];
}

export function loadDictionary(blocklistPath: string | null, allowlistPath: string | null): DictionaryConfig {
  const blocklist: DictionaryEntry[] = [];
  const allowlist: string[] = [];

  if (blocklistPath && existsSync(blocklistPath)) {
    const data = JSON.parse(readFileSync(blocklistPath, 'utf-8'));
    if (Array.isArray(data)) {
      for (const entry of data) {
        if (typeof entry === 'string') {
          blocklist.push({ value: entry, category: 'CUSTOM' });
        } else if (entry.value && entry.category) {
          blocklist.push({ value: entry.value, category: entry.category });
        }
      }
    }
  }

  if (allowlistPath && existsSync(allowlistPath)) {
    const data = JSON.parse(readFileSync(allowlistPath, 'utf-8'));
    if (Array.isArray(data)) {
      for (const entry of data) {
        if (typeof entry === 'string') allowlist.push(entry);
      }
    }
  }

  return { blocklist, allowlist };
}

export function buildAllowlistSet(allowlist: string[]): Set<string> {
  return new Set(allowlist.map((s) => s.toLowerCase()));
}

export function scrubWithDictionary(
  text: string,
  tokenMap: TokenMap,
  blocklist: DictionaryEntry[],
  allowlist: ReadonlySet<string>,
): { text: string; redactions: RedactionEntry[] } {
  const redactions: RedactionEntry[] = [];
  let result = text;

  for (const entry of blocklist) {
    if (allowlist.has(entry.value.toLowerCase())) continue;

    // Word boundary match, case insensitive
    const pattern = new RegExp(`\\b${escapeRegex(entry.value)}\\b`, 'gi');
    const matches = [...result.matchAll(pattern)];

    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i]!;
      const value = match[0];
      const index = match.index!;
      const token = tokenMap.tokenize(value, entry.category);
      result = result.slice(0, index) + token + result.slice(index + value.length);
      redactions.push({ original: value, token, category: entry.category, tier: 2 });
    }
  }

  return { text: result, redactions };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Watch a blocklist or allowlist file for changes. Reloads on modification.
 * Uses fs.watchFile (polling) for cross-platform reliability.
 */
export function watchDictionary(
  blocklistPath: string | null,
  allowlistPath: string | null,
  onChange: (config: DictionaryConfig) => void,
  interval = 5000,
): () => void {
  const reload = () => {
    try {
      onChange(loadDictionary(blocklistPath, allowlistPath));
    } catch (_) { /* ignore reload errors */ }
  };

  const paths: string[] = [];
  if (blocklistPath && existsSync(blocklistPath)) {
    watchFile(blocklistPath, { interval }, reload);
    paths.push(blocklistPath);
  }
  if (allowlistPath && existsSync(allowlistPath)) {
    watchFile(allowlistPath, { interval }, reload);
    paths.push(allowlistPath);
  }

  return () => {
    for (const p of paths) unwatchFile(p);
  };
}
