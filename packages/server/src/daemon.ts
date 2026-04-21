/**
 * @forgeframe/server — Daemon Lifecycle
 *
 * Manages a persistent HTTP server for the swarm viewer and REST API.
 * PID tracked at ~/.forgeframe/daemon.pid, port at ~/.forgeframe/daemon.port.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import type { Tier } from '@forgeframe/core';
import { MemoryStore, OllamaEmbedder, maybeDream, summarizeDreamResult } from '@forgeframe/memory';
import { loadConfig } from './config.js';
import { ServerEvents } from './events.js';
import { startHttpServer } from './http.js';
import { startOrchestrator } from './orchestrator.js';
import { TriggerManager } from './triggers.js';

const FORGEFRAME_DIR = resolve(homedir(), '.forgeframe');

export function pidPath(dir = FORGEFRAME_DIR) { return resolve(dir, 'daemon.pid'); }
export function portPath(dir = FORGEFRAME_DIR) { return resolve(dir, 'daemon.port'); }

const PID_PATH = pidPath();
const PORT_PATH = portPath();

export interface DaemonOptions {
  port: number;
  hostname: string;
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  port?: number;
}

export function isDaemonRunning(dir?: string): DaemonStatus {
  const pid_file = dir ? pidPath(dir) : PID_PATH;
  const port_file = dir ? portPath(dir) : PORT_PATH;

  if (!existsSync(pid_file)) return { running: false };

  let pid: number;
  try {
    pid = parseInt(readFileSync(pid_file, 'utf-8').trim(), 10);
  } catch {
    return { running: false };
  }

  if (isNaN(pid)) return { running: false };

  try {
    process.kill(pid, 0);
  } catch {
    // Process not running — clean up stale files
    try { unlinkSync(pid_file); } catch {}
    try { unlinkSync(port_file); } catch {}
    return { running: false };
  }

  let port: number | undefined;
  try {
    port = parseInt(readFileSync(port_file, 'utf-8').trim(), 10);
    if (isNaN(port)) port = undefined;
  } catch {}

  return { running: true, pid, port };
}

export function stopDaemon(dir?: string): boolean {
  const status = isDaemonRunning(dir);
  if (!status.running || !status.pid) return false;

  try {
    process.kill(status.pid, 'SIGTERM');
  } catch {
    return false;
  }

  const pid_file = dir ? pidPath(dir) : PID_PATH;
  const port_file = dir ? portPath(dir) : PORT_PATH;
  try { unlinkSync(pid_file); } catch {}
  try { unlinkSync(port_file); } catch {}

  return true;
}

export async function serveDaemon(opts: DaemonOptions): Promise<void> {
  const config = loadConfig();
  const store = new MemoryStore({ dbPath: config.dbPath });
  const events = new ServerEvents();

  const server = startHttpServer({
    store,
    events,
    port: opts.port,
    hostname: opts.hostname,
  });

  // Wait for server to bind before writing PID/port
  await new Promise<void>((resolve, reject) => {
    server.on('listening', resolve);
    server.on('error', reject);
  });

  writeFileSync(PID_PATH, String(process.pid), 'utf-8');
  writeFileSync(PORT_PATH, String(opts.port), 'utf-8');

  // Phase 2 Task 2.1 — start orchestrator heartbeat. 5s tick per the
  // Vision master index decision (calmer than 1s, less Feed Tab chatter).
  // Overridable via FORGEFRAME_ORCHESTRATOR_INTERVAL_MS.
  const intervalMs = Number(process.env.FORGEFRAME_ORCHESTRATOR_INTERVAL_MS) || 5000;

  // Phase 2 Task 2.2 — dream-tick callback. Every `dreamTickEvery` heartbeats
  // the orchestrator invokes this, which reads sleep pressure and, if it
  // crosses the NREM or REM threshold, runs the corresponding phase. All
  // errors are swallowed into the DreamResult and surfaced as a structured
  // 'dream:schedule:result' event — the orchestrator's tick loop must not
  // be torn down by a bad dream cycle.
  //
  // Two-way door: remove the three onDreamTick / dreamTickEvery lines and
  // the daemon reverts to Task 2.1 behavior exactly.
  const onDreamTick = async () => {
    try {
      const result = await maybeDream({ store });
      const summary = summarizeDreamResult(result);
      if (result.phase !== 'awake' || result.error) {
        process.stderr.write(`[dream] ${summary}\n`);
      }
      // Emit a compact schedule-result event for Feed Tab. Also emit the
      // phase-specific complete event on success so existing subscribers
      // that already listen for NremResult/RemResult shapes keep working.
      events.emit('dream:schedule:result', {
        phase: result.phase,
        pressureScore: result.pressure.score,
        summary,
        error: result.error,
      });
      if (!result.error && result.phase === 'nrem' && result.nremResult) {
        events.emit('dream:nrem:complete', result.nremResult);
      } else if (!result.error && result.phase === 'rem' && result.remResult) {
        events.emit('dream:rem:complete', result.remResult);
      }
    } catch (err) {
      // maybeDream is defensive and shouldn't throw, but belt-and-suspenders.
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[dream] maybeDream threw: ${message}\n`);
    }
  };

  const stopOrchestrator = startOrchestrator({
    intervalMs,
    emit: (kind, payload) => events.emit(kind as any, payload),
    onDreamTick,
    dreamTickEvery: 6, // every ~30s at the 5s tick interval
  });
  process.stderr.write(`[orchestrator] heartbeat every ${intervalMs}ms, dream every 6 ticks\n`);

  // Phase 2 Task 2.3 — arm triggers at daemon startup.
  //
  // Two-way door: removing this block leaves the daemon functioning exactly
  // as it did before Task 2.3. strict:true makes a malformed triggers.json
  // throw at load time instead of silently booting with an empty list — the
  // class of bug that hides for months.
  const triggerManager = armTriggers({ events });

  process.stderr.write(`ForgeFrame daemon running (pid ${process.pid}, port ${opts.port})\n`);

  function shutdown() {
    stopOrchestrator();
    if (triggerManager) {
      try {
        triggerManager.stop();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[triggers] stop failed: ${message}\n`);
      }
    }
    try { unlinkSync(PID_PATH); } catch {}
    try { unlinkSync(PORT_PATH); } catch {}
    store.close();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
  process.on('SIGPIPE', () => {});

  // Block until signal
  await new Promise(() => {});
}

// -- Phase 2 Task 2.3: trigger wiring -----------------------------------------

/**
 * Default runner used when no real agent is available. Emits a
 * `trigger:fired` event onto the server bus and logs a structured line so
 * downstream tools (forgeframe-doctor, Cockpit Feed Tab) can observe
 * activity. Runtime errors inside this runner are caught upstream by
 * TriggerManager's per-trigger try/catch — they log and continue without
 * tearing down the scheduler.
 */
export function makePlaceholderTriggerRunner(
  events: ServerEvents,
  source: 'cron' | 'watch' | 'unknown' = 'unknown',
): (task: string, cwd: string, tier?: Tier) => Promise<void> {
  return async (task: string, cwd: string, tier?: Tier) => {
    process.stderr.write(
      `[triggers] fired task="${task}" cwd="${cwd}" tier="${tier ?? 'default'}"\n`,
    );
    events.emit('trigger:fired', { task, cwd, tier, source });
  };
}

export interface ArmTriggersOptions {
  events: ServerEvents;
  configDir?: string;
  /** Override default runner (used in tests to avoid placeholder side-effects). */
  runner?: (task: string, cwd: string, tier?: Tier) => Promise<void>;
}

/**
 * Construct a TriggerManager using strict load semantics, attach the
 * runner, start the schedulers/watchers, and emit a single structured
 * summary line.
 *
 * Contract:
 *   - Missing triggers.json → logs `[triggers] none configured` and returns
 *     a started-but-empty manager (still safe to stop()).
 *   - Valid triggers.json  → logs `[triggers] armed N triggers (C cron, W watch)`.
 *   - Malformed triggers.json → throws. Caller (serveDaemon) lets this
 *     propagate so launchd surfaces a non-zero exit.
 */
export function armTriggers(opts: ArmTriggersOptions): TriggerManager {
  const configDir = opts.configDir ?? FORGEFRAME_DIR;
  const triggersPath = resolve(configDir, 'triggers.json');
  const fileExists = existsSync(triggersPath);

  // strict:true only when the file exists — an absent file is a normal
  // first-run state, not a fatal error.
  const manager = new TriggerManager({ configDir, strict: fileExists });

  const runner = opts.runner ?? makePlaceholderTriggerRunner(opts.events);
  manager.setRunner(runner);

  manager.start();

  if (!fileExists) {
    process.stderr.write('[triggers] none configured\n');
  } else {
    const { total, cron, watch } = manager.counts();
    process.stderr.write(
      `[triggers] armed ${total} triggers (${cron} cron, ${watch} watch)\n`,
    );
  }

  return manager;
}
