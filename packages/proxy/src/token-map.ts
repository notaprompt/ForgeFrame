/**
 * @forgeframe/proxy -- TokenMapImpl
 *
 * Bidirectional token map for scrub/rehydrate.
 * Tokens use [FF:CATEGORY_N] format to avoid false positives in code output.
 */

import type { TokenCategory, TokenMap } from './types.js';

const TOKEN_PATTERN = /\[FF:[A-Z]+_\d+\]/g;

interface SerializedTokenMap {
  forward: [string, string][];
  reverse: [string, string][];
  counters: Record<string, number>;
}

export class TokenMapImpl implements TokenMap {
  private _forward = new Map<string, string>();
  private _reverse = new Map<string, string>();
  private _counters: Record<string, number> = {};

  tokenize(value: string, category: TokenCategory): string {
    const key = value.toLowerCase();
    const existing = this._forward.get(key);
    if (existing) return existing;

    const count = (this._counters[category] ?? 0) + 1;
    this._counters[category] = count;
    const token = `[FF:${category}_${count}]`;

    this._forward.set(key, token);
    this._reverse.set(token, value);
    return token;
  }

  detokenize(token: string): string | null {
    return this._reverse.get(token) ?? null;
  }

  detokenizeAll(text: string): string {
    return text.replace(TOKEN_PATTERN, (match) => this._reverse.get(match) ?? match);
  }

  serialize(): string {
    const data: SerializedTokenMap = {
      forward: [...this._forward.entries()],
      reverse: [...this._reverse.entries()],
      counters: { ...this._counters },
    };
    return JSON.stringify(data);
  }

  static deserialize(json: string): TokenMapImpl {
    const data: SerializedTokenMap = JSON.parse(json);
    const map = new TokenMapImpl();
    map._forward = new Map(data.forward);
    map._reverse = new Map(data.reverse);
    map._counters = { ...data.counters };
    return map;
  }

  get size(): number {
    return this._forward.size;
  }
}
