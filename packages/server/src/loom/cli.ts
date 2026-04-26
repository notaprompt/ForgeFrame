/**
 * Loom — CLI subcommands
 *
 * Wired into the main `forgeframe` CLI as the `loom` subcommand.
 */

import { MemoryStore } from '@forgeframe/memory';
import { resolve } from 'path';
import { homedir } from 'os';
import { reflect } from './reflector.js';
import { isArmed, getState, COLD_START_WINDOW_MS } from './cold-start.js';

function openStore(): MemoryStore {
  const dbPath = process.env.FORGEFRAME_DB_PATH ?? resolve(homedir(), '.forgeframe', 'memory.db');
  return new MemoryStore({ dbPath });
}

export function runLoomReflect(args: string[]): void {
  const minIdx = args.indexOf('--min-cluster-size');
  const minClusterSize = minIdx >= 0 ? parseInt(args[minIdx + 1] ?? '10', 10) : 10;

  const store = openStore();
  try {
    const result = reflect({ store, minClusterSize });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    store.close();
  }
}

export function runLoomStatus(): void {
  const armed = isArmed();
  const state = getState();
  const remainingMs = state.firstFireAt
    ? Math.max(0, COLD_START_WINDOW_MS - (Date.now() - state.firstFireAt))
    : COLD_START_WINDOW_MS;
  const remainingDays = Math.round(remainingMs / (24 * 60 * 60 * 1000) * 10) / 10;
  const out = {
    armed,
    firstFireAt: state.firstFireAt ?? null,
    remainingDays: armed ? 0 : remainingDays,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

export function runLoomProposals(args: string[]): void {
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] ?? '20', 10) : 20;
  const store = openStore();
  try {
    const proposals = store.listByTag('routing-principle:proposed', limit);
    const formatted = proposals.map((m) => ({ id: m.id, createdAt: m.createdAt, body: JSON.parse(m.content) }));
    process.stdout.write(JSON.stringify(formatted, null, 2) + '\n');
  } finally {
    store.close();
  }
}
