import { describe, it, expect } from 'vitest';
import { GuardianComputer } from './guardian.js';
import type { GuardianSignals } from './types.js';

describe('GuardianComputer', () => {
  const guardian = new GuardianComputer();

  it('returns calm for all-zero signals', () => {
    const signals: GuardianSignals = {
      revisitWithoutAction: 0,
      timeSinceLastArtifactExit: 0,
      contradictionDensity: 0,
      orphanRatio: 0,
      decayVelocity: 0,
      recursionDepth: 0,
    };
    const temp = guardian.compute(signals);
    expect(temp.value).toBeLessThan(0.1);
    expect(temp.state).toBe('calm');
  });

  it('returns trapped for high signals', () => {
    const signals: GuardianSignals = {
      revisitWithoutAction: 10,
      timeSinceLastArtifactExit: 30 * 24 * 60 * 60 * 1000,
      contradictionDensity: 0.5,
      orphanRatio: 0.8,
      decayVelocity: 50,
      recursionDepth: 8,
    };
    const temp = guardian.compute(signals);
    expect(temp.value).toBeGreaterThan(0.6);
    expect(temp.state).toBe('trapped');
  });

  it('returns warm for moderate signals', () => {
    const signals: GuardianSignals = {
      revisitWithoutAction: 3,
      timeSinceLastArtifactExit: 7 * 24 * 60 * 60 * 1000,
      contradictionDensity: 0.1,
      orphanRatio: 0.3,
      decayVelocity: 10,
      recursionDepth: 2,
    };
    const temp = guardian.compute(signals);
    expect(temp.value).toBeGreaterThan(0.3);
    expect(temp.value).toBeLessThan(0.6);
    expect(temp.state).toBe('warm');
  });

  it('clamps value between 0 and 1', () => {
    const extreme: GuardianSignals = {
      revisitWithoutAction: 100,
      timeSinceLastArtifactExit: 365 * 24 * 60 * 60 * 1000,
      contradictionDensity: 1,
      orphanRatio: 1,
      decayVelocity: 500,
      recursionDepth: 50,
    };
    const temp = guardian.compute(extreme);
    expect(temp.value).toBeLessThanOrEqual(1);
    expect(temp.value).toBeGreaterThanOrEqual(0);
  });
});
