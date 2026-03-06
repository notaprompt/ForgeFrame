/**
 * @forgeframe/proxy -- Rehydrator
 *
 * Replaces [FF:CATEGORY_N] tokens back to real values.
 * StreamRehydrator handles SSE chunks with partial token buffering.
 */

import type { TokenMap } from './types.js';

const TOKEN_PATTERN = /\[FF:[A-Z]+_\d+\]/g;
const PARTIAL_PATTERN = /\[FF:[A-Z_0-9]*$/;
const MAX_HOLD = 64;

/** Batch rehydrate a complete string. */
export function rehydrate(text: string, tokenMap: TokenMap): string {
  return tokenMap.detokenizeAll(text);
}

/**
 * Streaming rehydrator for SSE text deltas.
 *
 * Buffers partial tokens that may be split across chunks.
 * Flushes completed text as soon as possible.
 */
export class StreamRehydrator {
  private _buffer = '';
  private _tokenMap: TokenMap;

  constructor(tokenMap: TokenMap) {
    this._tokenMap = tokenMap;
  }

  /** Process a chunk, return rehydrated text ready to emit. */
  push(chunk: string): string {
    this._buffer += chunk;
    return this._flush(false);
  }

  /** Flush any remaining buffer at end of stream. */
  end(): string {
    return this._flush(true);
  }

  private _flush(final: boolean): string {
    // Replace all complete tokens in the buffer
    const replaced = this._buffer.replace(TOKEN_PATTERN, (match) =>
      this._tokenMap.detokenize(match) ?? match
    );

    if (final) {
      this._buffer = '';
      return replaced;
    }

    // Check for a partial token at the end
    const partialMatch = replaced.match(PARTIAL_PATTERN);
    if (partialMatch) {
      const holdStart = partialMatch.index!;
      // If we've been holding too long, flush as-is (not a real token)
      if (replaced.length - holdStart > MAX_HOLD) {
        this._buffer = '';
        return replaced;
      }
      // Hold the partial, emit everything before it
      this._buffer = replaced.slice(holdStart);
      return replaced.slice(0, holdStart);
    }

    // No partial token, emit everything
    this._buffer = '';
    return replaced;
  }
}
