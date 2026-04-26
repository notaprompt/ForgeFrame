import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { recordFirstFire, isArmed, getState, COLD_START_WINDOW_MS } from './cold-start.js';

describe('cold-start', () => {
  let dir: string;
  let statePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loom-cs-'));
    statePath = join(dir, 'loom-state.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes first_fire_at on first call and is not armed', () => {
    recordFirstFire(statePath);
    expect(existsSync(statePath)).toBe(true);
    const state = getState(statePath);
    expect(state.firstFireAt).toBeTypeOf('number');
    expect(isArmed(statePath)).toBe(false);
  });

  it('does not overwrite first_fire_at on subsequent calls', () => {
    recordFirstFire(statePath);
    const original = getState(statePath).firstFireAt!;
    recordFirstFire(statePath, original + 1000);
    expect(getState(statePath).firstFireAt).toBe(original);
  });

  it('is armed once 7 days have elapsed (simulated via file content)', () => {
    const longAgo = Date.now() - COLD_START_WINDOW_MS - 1000;
    writeFileSync(statePath, JSON.stringify({ firstFireAt: longAgo }), 'utf8');
    expect(isArmed(statePath)).toBe(true);
  });

  it('returns isArmed false when state file is missing', () => {
    expect(isArmed(statePath)).toBe(false);
  });

  it('survives a corrupt state file (returns false, does not throw)', () => {
    writeFileSync(statePath, 'not json', 'utf8');
    expect(isArmed(statePath)).toBe(false);
    expect(() => recordFirstFire(statePath)).not.toThrow();
    // After recovery, file is valid JSON again.
    const after = readFileSync(statePath, 'utf8');
    expect(() => JSON.parse(after)).not.toThrow();
  });
});
