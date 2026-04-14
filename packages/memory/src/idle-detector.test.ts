import { describe, it, expect } from 'vitest';
import { getIdleState, getMemoryPressure } from './idle-detector.js';

describe('getIdleState', () => {
  it('returns an object with idleSeconds and active', () => {
    const state = getIdleState();
    expect(typeof state.idleSeconds).toBe('number');
    expect(typeof state.active).toBe('boolean');
    expect(state.idleSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('getMemoryPressure', () => {
  it('returns normal, warn, or critical', () => {
    const pressure = getMemoryPressure();
    expect(['normal', 'warn', 'critical']).toContain(pressure);
  });
});
