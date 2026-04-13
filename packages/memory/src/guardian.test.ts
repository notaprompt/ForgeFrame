import { describe, it, expect } from 'vitest';
import { GuardianComputer } from './guardian.js';
import type { GuardianSignals } from './types.js';

function calmSignals(): GuardianSignals {
  return {
    revisitWithoutAction: 0,
    timeSinceLastArtifactExit: 0,
    contradictionDensity: 0,
    orphanRatio: 0,
    decayVelocity: 0,
    recursionDepth: 0,
    hebbianImbalance: 0,
  };
}

describe('GuardianComputer', () => {
  const guardian = new GuardianComputer();

  it('returns calm state for zero signals', () => {
    const result = guardian.compute(calmSignals());
    expect(result.state).toBe('calm');
    expect(result.value).toBe(0);
  });

  it('uses 7 signals with equal weight (1/7)', () => {
    const signals = calmSignals();
    signals.recursionDepth = 5; // normalizes to 1.0
    const result = guardian.compute(signals);
    expect(result.value).toBeCloseTo(1 / 7, 4);
    expect(result.state).toBe('calm');
  });

  it('hebbianImbalance contributes to temperature', () => {
    const signals = calmSignals();
    signals.hebbianImbalance = 5.0; // normalizes to 1.0 (capped at 5.0)
    const result = guardian.compute(signals);
    expect(result.value).toBeCloseTo(1 / 7, 4);
  });

  it('all signals maxed = trapped', () => {
    const signals: GuardianSignals = {
      revisitWithoutAction: 10,
      timeSinceLastArtifactExit: 14 * 24 * 60 * 60 * 1000,
      contradictionDensity: 1.0,
      orphanRatio: 1.0,
      decayVelocity: 30,
      recursionDepth: 5,
      hebbianImbalance: 5.0,
    };
    const result = guardian.compute(signals);
    expect(result.value).toBeCloseTo(1.0, 1);
    expect(result.state).toBe('trapped');
  });

  it('hebbianMultiplier returns correct values per state', () => {
    expect(GuardianComputer.hebbianMultiplier('calm')).toBe(1.0);
    expect(GuardianComputer.hebbianMultiplier('warm')).toBe(0.5);
    expect(GuardianComputer.hebbianMultiplier('trapped')).toBe(0.0);
  });
});
