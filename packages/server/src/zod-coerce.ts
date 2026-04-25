/**
 * Zod coercion helpers for MCP bridges that stringify nested arguments.
 *
 * Some MCP clients JSON-stringify arrays and numbers before serializing
 * tool calls over JSON-RPC. The MCP SDK passes those values straight to
 * zod, which rejects with "expected array, received string" or
 * "expected number, received string". These helpers wrap the underlying
 * schema in a preprocess step that accepts either the native type or
 * its JSON-string form.
 */

import { z } from 'zod';

function tryJsonParse(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function tryNumberParse(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  return value;
}

export function coerceArray<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(tryJsonParse, z.array(item));
}

export function coerceInt() {
  return z.preprocess(tryNumberParse, z.number().int());
}

export function coerceNumber() {
  return z.preprocess(tryNumberParse, z.number());
}
