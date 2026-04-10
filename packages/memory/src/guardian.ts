import type { GuardianSignals, GuardianTemperature } from './types.js';

export class GuardianComputer {
  compute(signals: GuardianSignals): GuardianTemperature {
    // Normalize each signal to 0-1
    const normalized = {
      revisit: Math.min(signals.revisitWithoutAction / 10, 1),
      timeSinceShip: Math.min(signals.timeSinceLastArtifactExit / (14 * 24 * 60 * 60 * 1000), 1),
      contradictions: Math.min(signals.contradictionDensity, 1),
      orphans: Math.min(signals.orphanRatio, 1),
      decay: Math.min(signals.decayVelocity / 30, 1),
      recursion: Math.min(signals.recursionDepth / 5, 1),
    };

    // Equal weights — calibrate empirically after usage
    const weight = 1 / 6;
    const raw =
      normalized.revisit * weight +
      normalized.timeSinceShip * weight +
      normalized.contradictions * weight +
      normalized.orphans * weight +
      normalized.decay * weight +
      normalized.recursion * weight;

    const value = Math.max(0, Math.min(1, raw));

    let state: 'calm' | 'warm' | 'trapped';
    if (value < 0.3) state = 'calm';
    else if (value < 0.6) state = 'warm';
    else state = 'trapped';

    return { value, state, signals, computedAt: Date.now() };
  }
}
