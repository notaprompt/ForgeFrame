import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { coerceArray, coerceInt, coerceNumber } from './zod-coerce.js';

describe('coerceArray', () => {
  const schema = coerceArray(z.string());

  it('passes through native arrays unchanged', () => {
    expect(schema.parse(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('parses JSON-stringified arrays', () => {
    expect(schema.parse('["a","b"]')).toEqual(['a', 'b']);
  });

  it('rejects malformed JSON strings', () => {
    expect(() => schema.parse('not-json')).toThrow();
  });

  it('rejects strings that JSON-parse to non-arrays', () => {
    expect(() => schema.parse('"single"')).toThrow();
    expect(() => schema.parse('42')).toThrow();
  });

  it('preserves item validation', () => {
    const numbers = coerceArray(z.number());
    expect(numbers.parse('[1,2,3]')).toEqual([1, 2, 3]);
    expect(() => numbers.parse('["x"]')).toThrow();
  });
});

describe('coerceInt', () => {
  const schema = coerceInt();

  it('passes through native integers', () => {
    expect(schema.parse(42)).toBe(42);
  });

  it('parses integer strings', () => {
    expect(schema.parse('42')).toBe(42);
  });

  it('rejects non-integer strings', () => {
    expect(() => schema.parse('1.5')).toThrow();
    expect(() => schema.parse('abc')).toThrow();
  });

  it('rejects native floats', () => {
    expect(() => schema.parse(1.5)).toThrow();
  });
});

describe('coerceNumber', () => {
  const schema = coerceNumber();

  it('passes through native numbers (int and float)', () => {
    expect(schema.parse(42)).toBe(42);
    expect(schema.parse(0.5)).toBe(0.5);
  });

  it('parses numeric strings', () => {
    expect(schema.parse('1.5')).toBe(1.5);
    expect(schema.parse('42')).toBe(42);
  });

  it('rejects non-numeric strings', () => {
    expect(() => schema.parse('abc')).toThrow();
  });
});
