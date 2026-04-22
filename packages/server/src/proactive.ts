/**
 * @forgeframe/server — Proactive Creature
 *
 * The creature reaches OUT, not just maintains itself. Four behaviors:
 *
 *   1. Morning digest (cron ~7am daily)   — me:state + roadmap snapshot
 *   2. Evening reflection (cron ~10pm)    — day's memory + dream + guardian synthesis
 *   3. Dream completion → push            — meaningful NREM / REM results
 *   4. Guardian state change → push       — calm/warm/trapped transitions
 *
 * All behaviors compose existing primitives (buildRoadmap, loadLatestMeState,
 * sendPush, ServerEvents). The module owns zero persistent state beyond its
 * in-memory timers and last-push timestamps — start/stop is symmetrical.
 *
 * Register: beautifully robust. Every function tested. sendPush failure
 * never cascades (caught + logged + continue). Rate-limited dream pushes
 * prevent spam when pressure stays high. `enabled: false` config makes the
 * module a clean no-op so it can be turned off without code edit.
 *
 * Structured logs always prefixed `[proactive]`.
 */

import type { MemoryStore, GuardianTemperature, NremResult, RemResult } from '@forgeframe/memory';
import { buildRoadmap, loadLatestMeState } from '@forgeframe/memory';
import type { ServerEvents } from './events.js';
import { sendPush as realSendPush, type PushOptions } from './push.js';
import {
  sendTelegram as realSendTelegram,
  logTelegramStartupStatus,
  type TelegramOptions,
} from './telegram.js';

// -- Config --------------------------------------------------------------

export interface ProactiveConfig {
  /** Master switch. Default true. Set false to disable the whole module. */
  enabled?: boolean;
  /** Hour of day (0-23, local time) to fire the morning digest. Default 7. */
  morningHour?: number;
  /** Hour of day (0-23, local time) to fire the evening reflection. Default 22. */
  eveningHour?: number;
  /**
   * Minimum ms between consecutive dream pushes. Default 1h. Prevents ntfy
   * spam when sleep pressure stays high and dream cycles fire repeatedly.
   */
  dreamRateLimitMs?: number;
  /** Structured logger. Defaults to stderr with `[proactive]` prefix enforced by caller. */
  log?: (line: string) => void;
  /**
   * Push function. Injected so tests can swap a mock without vi.mock hoisting.
   * Defaults to the real sendPush from push.ts.
   */
  sendPush?: (opts: PushOptions) => Promise<void>;
  /**
   * Telegram send function. Injected so tests can swap a mock.
   * Defaults to the real sendTelegram from telegram.ts (graceful no-op
   * when FORGEFRAME_TELEGRAM_TOKEN / FORGEFRAME_TELEGRAM_CHAT_ID are unset).
   */
  sendTelegram?: (opts: TelegramOptions) => Promise<void>;
  /**
   * Override Date.now(). Primarily for deterministic cron scheduling tests.
   * Never used in production.
   */
  now?: () => number;
}

const DEFAULT_MORNING_HOUR = 7;
const DEFAULT_EVENING_HOUR = 22;
const DEFAULT_DREAM_RATE_LIMIT_MS = 60 * 60 * 1000; // 1h

// -- Startup -------------------------------------------------------------

export interface StartProactiveOptions {
  store: MemoryStore;
  events: ServerEvents;
  config?: ProactiveConfig;
}

/**
 * Wire the four proactive behaviors. Returns a `stop()` function that
 * fully tears down timers + event subscriptions (no dangling handles).
 *
 * When config.enabled is false, no subscriptions/timers are created and
 * stop() is a safe no-op.
 */
export function startProactive(opts: StartProactiveOptions): () => void {
  const { store, events } = opts;
  const config = opts.config ?? {};

  const enabledFromEnv = parseEnabledEnv(process.env.FORGEFRAME_PROACTIVE_ENABLED);
  const enabled = config.enabled ?? enabledFromEnv ?? true;
  const log = config.log ?? defaultLog;
  const sendPush = config.sendPush ?? realSendPush;
  const sendTelegram = config.sendTelegram ?? realSendTelegram;
  const now = config.now ?? (() => Date.now());

  if (!enabled) {
    log('[proactive] disabled (config.enabled=false) — no timers, no subscriptions');
    return () => {};
  }

  // One-shot startup log describing telegram config state. Must not fire on
  // every sendTelegram call — only once per daemon start.
  logTelegramStartupStatus(log);

  const morningHour = config.morningHour ?? DEFAULT_MORNING_HOUR;
  const eveningHour = config.eveningHour ?? DEFAULT_EVENING_HOUR;
  const dreamRateLimitMs = config.dreamRateLimitMs ?? DEFAULT_DREAM_RATE_LIMIT_MS;

  // Daily cron-like timers (self-rescheduling) ---------------------------

  const morningTimer = scheduleDaily({
    hour: morningHour,
    label: 'morning',
    now,
    log,
    run: () => runMorningDigest({ store, log, sendPush, sendTelegram }),
  });
  log(`[proactive] morning digest scheduled for ${morningTimer.nextIso}`);

  const eveningTimer = scheduleDaily({
    hour: eveningHour,
    label: 'evening',
    now,
    log,
    run: () => runEveningReflection({ store, events, log, sendPush, sendTelegram }),
  });
  log(`[proactive] evening reflection scheduled for ${eveningTimer.nextIso}`);

  // Broadcast: fire ntfy + telegram in parallel, best-effort. Failure of
  // one transport must not prevent the other. Never throws.
  const broadcast = (opts: PushOptions, label?: string): void => {
    fireAndLog(sendPush(opts), log, label);
    fireAndLog(sendTelegram({ title: opts.title, body: opts.body }), log, label);
  };

  // Event-driven handlers ------------------------------------------------

  const dreamState = { lastPushAt: 0 };

  const onNrem = (result: NremResult) => {
    if (!nremIsMeaningful(result)) return;
    if (!dreamRateLimitOk(dreamState, dreamRateLimitMs, now)) {
      log('[proactive] dream push rate-limited (nrem)');
      return;
    }
    dreamState.lastPushAt = now();
    const body = formatNremBody(result);
    broadcast(
      {
        title: 'Vision dream · nrem',
        body,
        priority: 'low',
        tags: ['dream', 'nrem'],
      },
      'dream:nrem',
    );
  };

  const onRem = (result: RemResult) => {
    if (!remIsMeaningful(result)) return;
    if (!dreamRateLimitOk(dreamState, dreamRateLimitMs, now)) {
      log('[proactive] dream push rate-limited (rem)');
      return;
    }
    dreamState.lastPushAt = now();
    const body = formatRemBody(result);
    broadcast(
      {
        title: 'Vision dream · rem',
        body,
        priority: 'low',
        tags: ['dream', 'rem'],
      },
      'dream:rem',
    );
  };

  const guardianState = { lastState: null as GuardianTemperature['state'] | null };

  const onGuardianUpdate = (temp: GuardianTemperature) => {
    const prev = guardianState.lastState;
    const next = temp.state;
    guardianState.lastState = next;

    // Only push on state TRANSITIONS. First observation is recorded but not pushed
    // (prevents the first-seen-warm-state spam on daemon restart).
    if (prev === null) return;
    if (prev === next) return;

    // calm is informational only — don't push.
    if (next === 'calm') return;

    const priority: PushOptions['priority'] = next === 'trapped' ? 'high' : 'default';
    const severity = next === 'trapped' ? 'error' : 'warn';
    const reason = summarizeGuardianSignals(temp);
    broadcast(
      {
        title: `Vision guardian · ${next}`,
        body: `temp=${temp.value.toFixed(2)}, reason: ${reason}`,
        priority,
        tags: ['guardian', severity],
      },
      `guardian:${prev}→${next}`,
    );
  };

  events.on('dream:nrem:complete', onNrem);
  events.on('dream:rem:complete', onRem);
  events.on('guardian:update', onGuardianUpdate);

  log('[proactive] armed — 2 timers, 3 subscriptions');

  return () => {
    morningTimer.cancel();
    eveningTimer.cancel();
    events.off('dream:nrem:complete', onNrem);
    events.off('dream:rem:complete', onRem);
    events.off('guardian:update', onGuardianUpdate);
    log('[proactive] stopped — all timers and subscriptions released');
  };
}

// -- Behavior 1: Morning digest ------------------------------------------

interface RunMorningOptions {
  store: MemoryStore;
  log: (line: string) => void;
  sendPush: (opts: PushOptions) => Promise<void>;
  /**
   * Optional telegram sender. When omitted, only ntfy fires — keeps the
   * test surface stable for call sites that don't wire telegram yet.
   */
  sendTelegram?: (opts: TelegramOptions) => Promise<void>;
}

/**
 * Compose the morning digest body and push it. Exported for tests.
 * Never throws — failures are logged and swallowed. Both transports are
 * best-effort: a failure of one must not prevent the other.
 */
export async function runMorningDigest(opts: RunMorningOptions): Promise<void> {
  const { store, log, sendPush, sendTelegram } = opts;
  try {
    const me = await loadLatestMeState({ store, log });
    const roadmap = await buildRoadmap({ store, log });

    const entrenchedTitles = roadmap.entrenched.slice(0, 3).map(titleOf);
    const driftingTitles = roadmap.drifting.slice(0, 3).map(titleOf);

    const meSummary = me
      ? `guardian=${me.payload.guardianState ?? '?'}; ` +
        `dreams=${me.payload.recentActivity?.dreamCycles ?? 0}`
      : 'no me:state yet';

    const body = truncate(
      [
        meSummary,
        `roadmap: A=${roadmap.active.length} P=${roadmap.pending.length} E=${roadmap.entrenched.length} D=${roadmap.drifting.length}`,
        entrenchedTitles.length ? `entrenched: ${entrenchedTitles.join(' | ')}` : '',
        driftingTitles.length ? `drifting: ${driftingTitles.join(' | ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      300,
    );

    const title = `Vision morning · ${formatShortDate(new Date())}`;
    const [pushResult, tgResult] = await Promise.allSettled([
      sendPush({
        title,
        body,
        priority: 'default',
        tags: ['morning', 'digest'],
      }),
      sendTelegram ? sendTelegram({ title, body }) : Promise.resolve(),
    ]);
    if (pushResult.status === 'rejected') {
      log(`[proactive] morning digest failed (push): ${errMsg(pushResult.reason)}`);
    }
    if (tgResult.status === 'rejected') {
      log(`[proactive] morning digest failed (telegram): ${errMsg(tgResult.reason)}`);
    }
    log('[proactive] morning digest sent');
  } catch (err) {
    log(`[proactive] morning digest failed: ${errMsg(err)}`);
  }
}

// -- Behavior 2: Evening reflection --------------------------------------

interface RunEveningOptions {
  store: MemoryStore;
  events: ServerEvents;
  log: (line: string) => void;
  sendPush: (opts: PushOptions) => Promise<void>;
  /**
   * Optional telegram sender. When omitted, only ntfy fires.
   */
  sendTelegram?: (opts: TelegramOptions) => Promise<void>;
}

/**
 * Compose the evening reflection body and push it. Exported for tests.
 * Never throws — failures are logged and swallowed. Both transports are
 * best-effort: a failure of one must not prevent the other.
 */
export async function runEveningReflection(opts: RunEveningOptions): Promise<void> {
  const { store, log, sendPush, sendTelegram } = opts;
  try {
    const todayStart = startOfToday();
    const pool = store.getRecent(500);

    const newToday = pool.filter((m) => m.createdAt >= todayStart);
    const tagCounts = new Map<string, number>();
    for (const m of newToday) {
      for (const t of m.tags) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t, n]) => `${t}:${n}`)
      .join(',');

    // Dream + guardian events since todayStart are computed from me:state
    // history (dream cycles count, last dream) and the me:state tag scan.
    // The creature's self-model is the source of truth.
    const me = await loadLatestMeState({ store, log });
    const dreamCycles = me?.payload.recentActivity?.dreamCycles ?? 0;
    const errors = me?.payload.recentActivity?.errors ?? 0;

    const body = truncate(
      [
        `new memories: ${newToday.length}${topTags ? ` (${topTags})` : ''}`,
        `dream cycles: ${dreamCycles}`,
        `errors: ${errors}`,
        newToday.length === 0 && dreamCycles === 0
          ? 'quiet day — no new memory, no dreaming'
          : newToday.length > 20
            ? 'heavy intake day'
            : '',
      ]
        .filter(Boolean)
        .join('\n'),
      300,
    );

    const title = 'Vision evening · reflection';
    const [pushResult, tgResult] = await Promise.allSettled([
      sendPush({
        title,
        body,
        priority: 'low',
        tags: ['evening', 'reflection'],
      }),
      sendTelegram ? sendTelegram({ title, body }) : Promise.resolve(),
    ]);
    if (pushResult.status === 'rejected') {
      log(`[proactive] evening reflection failed (push): ${errMsg(pushResult.reason)}`);
    }
    if (tgResult.status === 'rejected') {
      log(`[proactive] evening reflection failed (telegram): ${errMsg(tgResult.reason)}`);
    }
    log('[proactive] evening reflection sent');
  } catch (err) {
    log(`[proactive] evening reflection failed: ${errMsg(err)}`);
  }
}

// -- Meaningful-dream predicates (exported for tests) --------------------

export function nremIsMeaningful(result: NremResult): boolean {
  if (!result) return false;
  if ((result.edgesPruned ?? 0) >= 20) return true;
  if ((result.clustersFound ?? 0) >= 1) return true;
  return false;
}

export function remIsMeaningful(result: RemResult): boolean {
  if (!result) return false;
  // RemResult has no connectionSummary field; interpret "non-empty" as
  // "produced something": seeds generated OR journal written OR
  // hindsight/tension candidates surfaced.
  if ((result.seeds?.length ?? 0) > 0) return true;
  if (result.journalMemoryId) return true;
  if ((result.hindsightCandidates?.length ?? 0) > 0) return true;
  if ((result.tensions?.length ?? 0) > 0) return true;
  return false;
}

// -- Internal helpers ----------------------------------------------------

interface DailyTimerHandle {
  cancel: () => void;
  nextIso: string;
}

interface ScheduleDailyOptions {
  hour: number;
  label: string;
  now: () => number;
  log: (line: string) => void;
  run: () => Promise<void>;
}

/**
 * Schedule a task to fire at `hour:00` every day. Self-reschedules after
 * each fire. Timer is unref'd so it never blocks process exit.
 */
function scheduleDaily(opts: ScheduleDailyOptions): DailyTimerHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const computeNext = (): Date => {
    const nowMs = opts.now();
    const d = new Date(nowMs);
    const next = new Date(d);
    next.setHours(opts.hour, 0, 0, 0);
    if (next.getTime() <= nowMs) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  };

  const firstNext = computeNext();

  const schedule = (target: Date) => {
    if (cancelled) return;
    const delay = Math.max(0, target.getTime() - opts.now());
    timer = setTimeout(() => {
      // Fire. Catch any stray throw so the reschedule always happens.
      (async () => {
        try {
          await opts.run();
        } catch (err) {
          opts.log(`[proactive] ${opts.label} run threw: ${errMsg(err)}`);
        } finally {
          // Reschedule for tomorrow at the same hour.
          const nextTarget = computeNext();
          opts.log(`[proactive] ${opts.label} next fire at ${nextTarget.toISOString()}`);
          schedule(nextTarget);
        }
      })();
    }, delay);
    if (timer && typeof timer.unref === 'function') timer.unref();
  };

  schedule(firstNext);

  return {
    nextIso: firstNext.toISOString(),
    cancel: () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

function dreamRateLimitOk(
  state: { lastPushAt: number },
  limitMs: number,
  now: () => number,
): boolean {
  return now() - state.lastPushAt >= limitMs;
}

function formatNremBody(r: NremResult): string {
  return truncate(
    `edges pruned: ${r.edgesPruned ?? 0}; clusters: ${r.clustersFound ?? 0}; ` +
      `dedup: ${r.dedupProposals ?? 0}; dur: ${Math.round((r.duration ?? 0))}ms`,
    300,
  );
}

function formatRemBody(r: RemResult): string {
  return truncate(
    `seeds: ${r.seeds?.length ?? 0}; hindsight: ${r.hindsightCandidates?.length ?? 0}; ` +
      `tensions: ${r.tensions?.length ?? 0}; journal: ${r.journalMemoryId ? 'yes' : 'no'}`,
    300,
  );
}

function summarizeGuardianSignals(temp: GuardianTemperature): string {
  const entries = Object.entries(temp.signals ?? {})
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && (v as number) > 0)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${(v as number).toFixed(2)}`);
  return entries.length ? entries.join(', ') : `state=${temp.state}`;
}

function titleOf(memory: { content: string }): string {
  const firstLine = memory.content.split('\n')[0].trim();
  return firstLine.length > 60 ? firstLine.slice(0, 57) + '...' : firstLine;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function formatShortDate(d: Date): string {
  // "Sat Apr 19" — matches the spec's date '+%a %b %d' example.
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dd = String(d.getDate()).padStart(2, '0');
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${dd}`;
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fireAndLog(p: Promise<void>, log: (s: string) => void, label?: string): void {
  p.then(
    () => log(`[proactive] push sent${label ? ` (${label})` : ''}`),
    (err) => log(`[proactive] push failed: ${errMsg(err)}`),
  );
}

function parseEnabledEnv(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  const s = v.trim().toLowerCase();
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  return undefined;
}

function defaultLog(line: string): void {
  try {
    process.stderr.write(line.endsWith('\n') ? line : line + '\n');
  } catch {
    // never throw from the logger
  }
}
