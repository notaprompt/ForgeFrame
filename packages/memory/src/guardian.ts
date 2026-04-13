import type { GuardianSignals, GuardianTemperature } from './types.js';

export class GuardianComputer {
  compute(signals: GuardianSignals): GuardianTemperature {
    const normalized = {
      revisit: Math.min(signals.revisitWithoutAction / 10, 1),
      timeSinceShip: Math.min(signals.timeSinceLastArtifactExit / (14 * 24 * 60 * 60 * 1000), 1),
      contradictions: Math.min(signals.contradictionDensity, 1),
      orphans: Math.min(signals.orphanRatio, 1),
      decay: Math.min(signals.decayVelocity / 30, 1),
      recursion: Math.min(signals.recursionDepth / 5, 1),
      hebbianImbalance: Math.min(signals.hebbianImbalance / 5.0, 1),
    };

    const weight = 1 / 7;
    const raw =
      normalized.revisit * weight +
      normalized.timeSinceShip * weight +
      normalized.contradictions * weight +
      normalized.orphans * weight +
      normalized.decay * weight +
      normalized.recursion * weight +
      normalized.hebbianImbalance * weight;

    const value = Math.max(0, Math.min(1, raw));

    let state: 'calm' | 'warm' | 'trapped';
    if (value < 0.3) state = 'calm';
    else if (value < 0.6) state = 'warm';
    else state = 'trapped';

    return { value, state, signals, computedAt: Date.now() };
  }

  static hebbianMultiplier(state: 'calm' | 'warm' | 'trapped'): number {
    switch (state) {
      case 'calm': return 1.0;
      case 'warm': return 0.5;
      case 'trapped': return 0.0;
    }
  }
}
