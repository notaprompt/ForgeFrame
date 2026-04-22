/**
 * me:state — the creature's self-model snapshot.
 *
 * Per Daemon-v1 §4.3 and team-meeting decision 2026-04-21, me:state is a
 * TAG convention on regular memories. Not a schema type. The daemon writes
 * one every cycle; older snapshots are superseded (logically) but not
 * deleted — the history is the proprioception trace.
 *
 * Design notes:
 * - Stored as a regular memory; tag `me:state` identifies it.
 * - Content is `[me:state] <json>` so it's visually greppable in the store.
 * - `mutable: true` metadata flags that only the latest snapshot is authoritative;
 *   application-level logic (loadLatestMeState) enforces the "one active" semantic.
 * - No schema changes — removing this file leaves the store unchanged.
 */

import type { Memory, Sensitivity } from './types.js';
import type { MemoryStore } from './store.js';

/** The tag that marks a memory as a me:state snapshot. */
export const ME_STATE_TAG = 'me:state';

/** Content prefix. Parse via `content.slice(ME_STATE_CONTENT_PREFIX.length)`. */
export const ME_STATE_CONTENT_PREFIX = '[me:state] ';

export interface MeStatePayload {
  /** ISO 8601 timestamp of when this snapshot was taken. */
  ts: string;
  /** Session id this snapshot belongs to (optional — global snapshots allowed). */
  sessionId?: string;
  /** Recent activity summary (last N heartbeats / dream cycles / events). */
  recentActivity?: {
    heartbeats?: number;
    dreamCycles?: number;
    lastDream?: { phase: 'nrem' | 'rem'; ts: string };
    errors?: number;
  };
  /** Guardian temperature state at the time of snapshot. */
  guardianState?: 'calm' | 'warm' | 'trapped' | string;
  /** Current active working memories (ids only — full content lives in the store). */
  activeMemoryIds?: string[];
  /** Free-form notes or reflections from the daemon. */
  notes?: string;
}

export interface SaveMeStateOptions {
  store: MemoryStore;
  payload: MeStatePayload;
  /** If provided, tag the memory with `session:<id>` for cheap session-scoped retrieval. */
  sessionId?: string;
  /**
   * Sensitivity classification for the persisted snapshot.
   * Defaults to `'sensitive'` — me:state encodes identity/self-model, which must
   * not leak to frontier models by accident. Callers may override (e.g. `'public'`
   * for a sanitized snapshot, `'local-only'` to lock a snapshot to this machine).
   */
  sensitivity?: Sensitivity;
  /** Override logger for structured events. Defaults to `console.warn`. */
  log?: (line: string) => void;
}

export interface LoadMeStateOptions {
  store: MemoryStore;
  /** If provided, only snapshots tagged `session:<id>` are returned. */
  sessionId?: string;
  /** Max rows to scan/return. Default 10. */
  limit?: number;
  /** Override logger for structured events. Defaults to `console.warn`. */
  log?: (line: string) => void;
}

/** A hydrated me:state row: the underlying memory + the parsed payload. */
export type MeStateRow = Memory & { payload: MeStatePayload };

const DEFAULT_LIMIT = 10;

function defaultLog(line: string): void {
  // structured log line — writes to stderr via console.warn so test runners and
  // production alike see it, but it does not surface as an error.
  // eslint-disable-next-line no-console
  console.warn(line);
}

/**
 * Serialize a payload into the me:state content envelope.
 * Round-trippable: `parseMeStateContent(encodeMeStateContent(p)) === p` structurally.
 */
export function encodeMeStateContent(payload: MeStatePayload): string {
  return ME_STATE_CONTENT_PREFIX + JSON.stringify(payload);
}

/**
 * Parse a me:state content string into a payload.
 * Throws if the prefix is missing or the JSON body is malformed — callers
 * must decide whether to log+skip (loadMeStates) or propagate.
 */
export function parseMeStateContent(content: string): MeStatePayload {
  if (!content.startsWith(ME_STATE_CONTENT_PREFIX)) {
    throw new Error(`missing "${ME_STATE_CONTENT_PREFIX}" prefix`);
  }
  const json = content.slice(ME_STATE_CONTENT_PREFIX.length);
  const parsed = JSON.parse(json) as unknown;
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('payload must be a JSON object');
  }
  const candidate = parsed as Partial<MeStatePayload>;
  if (typeof candidate.ts !== 'string') {
    throw new Error('payload.ts must be an ISO string');
  }
  return candidate as MeStatePayload;
}

/**
 * Save a me:state snapshot as a regular memory with the me:state tag.
 * Returns the new memory id.
 */
export async function saveMeState(opts: SaveMeStateOptions): Promise<string> {
  const { store, payload, sessionId, sensitivity } = opts;

  const tags = [ME_STATE_TAG];
  if (sessionId) tags.push(`session:${sessionId}`);

  // Sovereignty default: identity snapshots are 'sensitive' unless the caller
  // explicitly opts into a different level. Store default is 'public' for
  // generic memories; me:state overrides that because it encodes self-model.
  // Default 'sensitive' — identity never crosses freely. Caller can override with 'public' or 'local-only'.
  const memory = store.create({
    content: encodeMeStateContent(payload),
    sessionId,
    tags,
    sensitivity: sensitivity ?? 'sensitive',
    metadata: {
      mutable: true,
      meState: true,
    },
  });

  return memory.id;
}

/**
 * Load recent me:state snapshots, newest first, parsed from memory content.
 *
 * Corrupted rows are logged with prefix `[me-state]` and skipped — other
 * snapshots are still returned. Retrieval never throws on bad data.
 */
export async function loadMeStates(opts: LoadMeStateOptions): Promise<MeStateRow[]> {
  const { store, sessionId, limit = DEFAULT_LIMIT, log = defaultLog } = opts;

  // listByTag already sorts by created_at DESC and returns Memory[] with
  // tag membership guaranteed by the post-filter in store.ts:252.
  // We oversample a little when session-scoping because session filtering
  // is a second pass; for the non-session case limit is exact.
  const scanLimit = sessionId ? Math.max(limit * 4, limit) : limit;
  const candidates = store.listByTag(ME_STATE_TAG, scanLimit);

  const filtered = sessionId
    ? candidates.filter((m) => m.tags.includes(`session:${sessionId}`))
    : candidates;

  const rows: MeStateRow[] = [];
  for (const memory of filtered) {
    if (rows.length >= limit) break;
    try {
      const payload = parseMeStateContent(memory.content);
      rows.push(Object.assign({}, memory, { payload }));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log(`[me-state] could not parse memory ${memory.id}: ${reason}`);
      // skip — other snapshots remain valid
    }
  }

  return rows;
}

/**
 * Load the single most recent me:state snapshot, optionally session-scoped.
 * Returns null when no snapshot exists for the requested scope.
 */
export async function loadLatestMeState(opts: LoadMeStateOptions): Promise<MeStateRow | null> {
  const rows = await loadMeStates({ ...opts, limit: 1 });
  return rows[0] ?? null;
}
