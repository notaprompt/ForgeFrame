/**
 * Loom — cold-start state management
 *
 * Tracks when the sensor first fired so the router can run in
 * pass-through mode for the first 7 days. State lives in a single
 * JSON file at ~/.forgeframe/loom-state.json (or a caller-supplied
 * path, for tests).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { homedir } from 'os';

export const COLD_START_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const DEFAULT_STATE_PATH = resolve(homedir(), '.forgeframe', 'loom-state.json');

export interface LoomState {
  firstFireAt?: number;
  routerArmedAt?: number;
}

function readSafe(path: string): LoomState {
  try {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, 'utf8')) as LoomState;
  } catch {
    return {};
  }
}

function writeSafe(path: string, state: LoomState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
}

export function getState(path: string = DEFAULT_STATE_PATH): LoomState {
  return readSafe(path);
}

export function recordFirstFire(path: string = DEFAULT_STATE_PATH, now: number = Date.now()): void {
  const state = readSafe(path);
  if (state.firstFireAt) return;
  state.firstFireAt = now;
  writeSafe(path, state);
}

export function isArmed(path: string = DEFAULT_STATE_PATH, now: number = Date.now()): boolean {
  const state = readSafe(path);
  if (!state.firstFireAt) return false;
  return now - state.firstFireAt >= COLD_START_WINDOW_MS;
}

export function recordArmed(path: string = DEFAULT_STATE_PATH, now: number = Date.now()): void {
  const state = readSafe(path);
  state.routerArmedAt = now;
  writeSafe(path, state);
}
