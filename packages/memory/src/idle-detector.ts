import { execFileSync } from 'node:child_process';
import type { DevActiveState } from './types.js';

const ACTIVE_THRESHOLD_SECONDS = 900; // 15 minutes

export function getIdleState(): DevActiveState {
  try {
    const output = execFileSync(
      '/bin/bash',
      ['-c', "ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000)}'"],
      { encoding: 'utf8', timeout: 5000 },
    );
    const idleSeconds = parseInt(output.trim(), 10) || 0;
    return {
      idleSeconds,
      active: idleSeconds < ACTIVE_THRESHOLD_SECONDS,
    };
  } catch {
    // If we can't detect, assume active (safe default -- don't dream)
    return { idleSeconds: 0, active: true };
  }
}

export function getMemoryPressure(): 'normal' | 'warn' | 'critical' {
  try {
    const output = execFileSync('memory_pressure', [], { encoding: 'utf8', timeout: 5000 });
    if (output.includes('CRITICAL')) return 'critical';
    if (output.includes('WARN')) return 'warn';
    return 'normal';
  } catch {
    return 'normal'; // safe default
  }
}
