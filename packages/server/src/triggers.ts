/**
 * @forgeframe/server — Trigger System
 *
 * Cron scheduling and file watch triggers for the Forge Agent.
 * No external dependencies — uses Node.js built-ins only.
 *
 * Triggers persist to ~/.forgeframe/triggers.json and resume on daemon restart.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, watch as fsWatch } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { FSWatcher } from 'fs';
import type { Tier } from '@forgeframe/core';

// -- Interfaces --

export interface CronTrigger {
  id: string;
  type: 'cron';
  schedule: string;
  task: string;
  cwd: string;
  tier?: Tier;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
}

export interface WatchTrigger {
  id: string;
  type: 'watch';
  path: string;
  task: string;
  cwd: string;
  tier?: Tier;
  enabled: boolean;
  debounce?: number;
}

export type Trigger = CronTrigger | WatchTrigger;

interface TriggersFile {
  triggers: Trigger[];
}

// -- Cron Parser --

interface CronField {
  type: 'any' | 'value' | 'step';
  value?: number;
  step?: number;
}

function parseCronField(field: string, min: number, max: number): CronField {
  if (field === '*') {
    return { type: 'any' };
  }
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step < 1) {
      throw new Error(`Invalid cron step: ${field}`);
    }
    return { type: 'step', step };
  }
  const value = parseInt(field, 10);
  if (isNaN(value) || value < min || value > max) {
    throw new Error(`Invalid cron field value: ${field} (expected ${min}-${max})`);
  }
  return { type: 'value', value };
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

function parseCronExpression(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: "${expr}" (expected 5 fields)`);
  }
  return {
    minute: parseCronField(parts[0], 0, 59),
    hour: parseCronField(parts[1], 0, 23),
    dayOfMonth: parseCronField(parts[2], 1, 31),
    month: parseCronField(parts[3], 1, 12),
    dayOfWeek: parseCronField(parts[4], 0, 6),
  };
}

function fieldMatches(field: CronField, value: number): boolean {
  switch (field.type) {
    case 'any':
      return true;
    case 'value':
      return value === field.value;
    case 'step':
      return value % field.step! === 0;
  }
}

function cronMatches(parsed: ParsedCron, date: Date): boolean {
  return (
    fieldMatches(parsed.minute, date.getMinutes()) &&
    fieldMatches(parsed.hour, date.getHours()) &&
    fieldMatches(parsed.dayOfMonth, date.getDate()) &&
    fieldMatches(parsed.month, date.getMonth() + 1) &&
    fieldMatches(parsed.dayOfWeek, date.getDay())
  );
}

/**
 * Calculate the next time a cron expression will fire after `after`.
 * Walks forward minute-by-minute, up to 366 days out.
 */
function nextCronRun(parsed: ParsedCron, after: Date): Date {
  const candidate = new Date(after.getTime());
  // Start from the next minute
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = 366 * 24 * 60; // max iterations (1 year of minutes)
  for (let i = 0; i < limit; i++) {
    if (cronMatches(parsed, candidate)) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  // Fallback: should not happen with valid cron expressions
  return candidate;
}

// -- Cron Scheduler --

type AgentRunner = (task: string, cwd: string, tier?: Tier) => Promise<void>;

class CronScheduler {
  private _timers = new Map<string, ReturnType<typeof setTimeout>>();
  private _running = new Set<string>();
  private _runner: AgentRunner | null = null;
  private _onUpdate: (() => void) | null = null;

  setRunner(runner: AgentRunner): void {
    this._runner = runner;
  }

  setUpdateCallback(cb: () => void): void {
    this._onUpdate = cb;
  }

  schedule(trigger: CronTrigger): void {
    this.cancel(trigger.id);
    if (!trigger.enabled) return;

    const parsed = parseCronExpression(trigger.schedule);
    const now = new Date();
    const next = nextCronRun(parsed, now);

    trigger.nextRun = next.toISOString();
    this._onUpdate?.();

    const delayMs = next.getTime() - now.getTime();
    const timer = setTimeout(() => {
      this._fire(trigger, parsed);
    }, delayMs);

    // Prevent timer from keeping the process alive
    if (timer.unref) timer.unref();
    this._timers.set(trigger.id, timer);
  }

  cancel(id: string): void {
    const timer = this._timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(id);
    }
  }

  isRunning(id: string): boolean {
    return this._running.has(id);
  }

  stopAll(): void {
    for (const [id, timer] of this._timers) {
      clearTimeout(timer);
    }
    this._timers.clear();
  }

  private async _fire(trigger: CronTrigger, parsed: ParsedCron): Promise<void> {
    // Prevent concurrent runs of the same trigger
    if (this._running.has(trigger.id)) {
      process.stderr.write(`[forge-triggers] Skipping cron "${trigger.id}" — previous run still active\n`);
      // Reschedule for next occurrence
      this.schedule(trigger);
      return;
    }

    this._running.add(trigger.id);
    trigger.lastRun = new Date().toISOString();
    this._onUpdate?.();

    process.stderr.write(`[forge-triggers] Firing cron "${trigger.id}": ${trigger.task}\n`);

    try {
      if (this._runner) {
        await this._runner(trigger.task, trigger.cwd, trigger.tier);
      } else {
        process.stderr.write(`[forge-triggers] No agent runner configured — skipping execution\n`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[forge-triggers] Cron "${trigger.id}" failed: ${message}\n`);
    } finally {
      this._running.delete(trigger.id);
    }

    // Schedule next run
    this.schedule(trigger);
  }
}

// -- File Watcher --

const DEFAULT_DEBOUNCE_MS = 5000;

class FileWatcher {
  private _watchers = new Map<string, FSWatcher>();
  private _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _runner: AgentRunner | null = null;
  private _running = new Set<string>();

  setRunner(runner: AgentRunner): void {
    this._runner = runner;
  }

  watch(trigger: WatchTrigger): void {
    this.unwatch(trigger.id);
    if (!trigger.enabled) return;

    if (!existsSync(trigger.path)) {
      process.stderr.write(`[forge-triggers] Watch path does not exist: ${trigger.path}\n`);
      return;
    }

    const debounceMs = trigger.debounce ?? DEFAULT_DEBOUNCE_MS;

    try {
      const watcher = fsWatch(trigger.path, { recursive: true }, () => {
        this._debounce(trigger, debounceMs);
      });

      watcher.on('error', (err) => {
        process.stderr.write(`[forge-triggers] Watch error for "${trigger.id}": ${err.message}\n`);
      });

      this._watchers.set(trigger.id, watcher);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[forge-triggers] Failed to watch "${trigger.path}": ${message}\n`);
    }
  }

  unwatch(id: string): void {
    const watcher = this._watchers.get(id);
    if (watcher) {
      watcher.close();
      this._watchers.delete(id);
    }
    const timer = this._debounceTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this._debounceTimers.delete(id);
    }
  }

  stopAll(): void {
    for (const [id] of this._watchers) {
      this.unwatch(id);
    }
  }

  private _debounce(trigger: WatchTrigger, ms: number): void {
    const existing = this._debounceTimers.get(trigger.id);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this._debounceTimers.delete(trigger.id);
      this._fire(trigger);
    }, ms);

    if (timer.unref) timer.unref();
    this._debounceTimers.set(trigger.id, timer);
  }

  private async _fire(trigger: WatchTrigger): Promise<void> {
    // Prevent concurrent runs
    if (this._running.has(trigger.id)) {
      process.stderr.write(`[forge-triggers] Skipping watch "${trigger.id}" — previous run still active\n`);
      return;
    }

    this._running.add(trigger.id);
    process.stderr.write(`[forge-triggers] File change detected for "${trigger.id}": ${trigger.task}\n`);

    try {
      if (this._runner) {
        await this._runner(trigger.task, trigger.cwd, trigger.tier);
      } else {
        process.stderr.write(`[forge-triggers] No agent runner configured — skipping execution\n`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[forge-triggers] Watch "${trigger.id}" failed: ${message}\n`);
    } finally {
      this._running.delete(trigger.id);
    }
  }
}

// -- Trigger Manager --

export class TriggerManager {
  private _configDir: string;
  private _triggersPath: string;
  private _triggers: Trigger[] = [];
  private _cron: CronScheduler;
  private _watcher: FileWatcher;

  constructor(configDir?: string) {
    this._configDir = configDir ?? resolve(homedir(), '.forgeframe');
    this._triggersPath = resolve(this._configDir, 'triggers.json');
    this._cron = new CronScheduler();
    this._watcher = new FileWatcher();

    this._cron.setUpdateCallback(() => this._save());
    this._load();
  }

  /**
   * Set the function that runs agent tasks when triggers fire.
   * Must be called before start() for triggers to actually execute.
   */
  setRunner(runner: AgentRunner): void {
    this._cron.setRunner(runner);
    this._watcher.setRunner(runner);
  }

  addCron(schedule: string, task: string, cwd: string, opts?: Partial<CronTrigger>): CronTrigger {
    // Validate the expression eagerly
    parseCronExpression(schedule);

    const trigger: CronTrigger = {
      id: opts?.id ?? randomUUID(),
      type: 'cron',
      schedule,
      task,
      cwd,
      tier: opts?.tier,
      enabled: opts?.enabled ?? true,
      lastRun: opts?.lastRun,
      nextRun: opts?.nextRun,
    };

    this._triggers.push(trigger);
    this._save();
    return trigger;
  }

  addWatch(path: string, task: string, cwd: string, opts?: Partial<WatchTrigger>): WatchTrigger {
    const trigger: WatchTrigger = {
      id: opts?.id ?? randomUUID(),
      type: 'watch',
      path,
      task,
      cwd,
      tier: opts?.tier,
      enabled: opts?.enabled ?? true,
      debounce: opts?.debounce,
    };

    this._triggers.push(trigger);
    this._save();
    return trigger;
  }

  remove(id: string): boolean {
    const idx = this._triggers.findIndex((t) => t.id === id);
    if (idx === -1) return false;

    const trigger = this._triggers[idx];
    if (trigger.type === 'cron') {
      this._cron.cancel(id);
    } else {
      this._watcher.unwatch(id);
    }

    this._triggers.splice(idx, 1);
    this._save();
    return true;
  }

  list(): Trigger[] {
    return [...this._triggers];
  }

  /**
   * Start (or resume) all enabled triggers.
   * Call after daemon startup and after setRunner().
   */
  start(): void {
    for (const trigger of this._triggers) {
      if (!trigger.enabled) continue;

      if (trigger.type === 'cron') {
        this._cron.schedule(trigger);
      } else {
        this._watcher.watch(trigger);
      }
    }

    const cronCount = this._triggers.filter((t) => t.type === 'cron' && t.enabled).length;
    const watchCount = this._triggers.filter((t) => t.type === 'watch' && t.enabled).length;

    if (cronCount > 0 || watchCount > 0) {
      process.stderr.write(
        `[forge-triggers] Started ${cronCount} cron trigger(s), ${watchCount} watch trigger(s)\n`,
      );
    }
  }

  /**
   * Stop all active triggers. Does not remove them from the persisted list.
   */
  stop(): void {
    this._cron.stopAll();
    this._watcher.stopAll();
    process.stderr.write('[forge-triggers] All triggers stopped\n');
  }

  // -- Persistence --

  private _load(): void {
    if (!existsSync(this._triggersPath)) {
      this._triggers = [];
      return;
    }

    try {
      const raw = readFileSync(this._triggersPath, 'utf-8');
      const data = JSON.parse(raw) as TriggersFile;
      this._triggers = Array.isArray(data.triggers) ? data.triggers : [];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[forge-triggers] Failed to load triggers.json: ${message}\n`);
      this._triggers = [];
    }
  }

  private _save(): void {
    if (!existsSync(this._configDir)) {
      mkdirSync(this._configDir, { recursive: true });
    }

    const data: TriggersFile = { triggers: this._triggers };
    writeFileSync(this._triggersPath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
