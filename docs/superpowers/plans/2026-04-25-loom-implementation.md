# Loom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Loom meta-organ — sensor + router + reflector + policy + cold-start + organ adapter + CLI + hook wrappers + settings.json delta + README docs — per the spec at `docs/superpowers/specs/2026-04-25-loom-design.md`.

**Architecture:** New subdirectory `packages/server/src/loom/` containing pure-TS modules. Two shell wrappers in `~/.claude/hooks/` invoke `npx tsx` against the modules (sensor on PostToolUse, router on PreToolUse, both matching `Agent|Bash`). Sensor writes `dispatch:*` memory rows directly via `MemoryStore.create()` for hot-path latency. Router does a single SQLite policy query + emits decision JSON. Reflector clusters dispatch memories and proposes `routing-principle:proposed` rows for founder review. Cold-start state file gates router behavior for the first 7 days. Single CLI subcommand `forgeframe loom <reflect|status|proposals>`.

**Tech Stack:** TypeScript (strict mode, ESM), Node 20+, vitest, better-sqlite3, `@forgeframe/memory`, `@forgeframe/core` (organ types). No new dependencies.

---

## File Structure

```
packages/server/src/loom/
├── index.ts          ← organ manifest + lifecycle + barrel exports (~150 lines)
├── types.ts          ← shared interfaces (HookPayload, RouterDecision, Policy, Cluster) (~80 lines)
├── cold-start.ts     ← state-file get/set + isArmed() (~60 lines)
├── cold-start.test.ts
├── sensor.ts         ← stdin → parse → write dispatch memory (~120 lines)
├── sensor.test.ts
├── policy.ts         ← match(dispatch) → action; loadPolicies(); precedence (~140 lines)
├── policy.test.ts
├── router.ts         ← stdin → policy.match → decision JSON (~100 lines)
├── router.test.ts
├── reflector.ts      ← cluster dispatch:* → propose routing-principle:proposed (~180 lines)
├── reflector.test.ts
└── cli.ts            ← reflect / status / proposals subcommands (~100 lines)
```

**Outside the loom directory:**
- `packages/server/src/cli.ts` — add `loom` case to switch
- `packages/server/src/index.ts` — re-export Loom organ symbols
- `~/.claude/hooks/loom-sensor.sh` — wrapper, ~10 lines
- `~/.claude/hooks/loom-router.sh` — wrapper, ~10 lines
- `~/.claude/settings.json` — register PostToolUse + PreToolUse hooks under matcher `Agent|Bash`
- `~/repos/ForgeFrame-loom/README.md` — add Loom section with cold-start protocol

---

## Conventions for every task

- Tests live next to source files (`foo.ts` ↔ `foo.test.ts`), matching the existing server package convention.
- Use `MemoryStore` from `@forgeframe/memory` for all DB writes.
- Use vitest fixtures with `tmpdir()` for isolated DBs (pattern: `distillery.test.ts`).
- No `console.log` in hot paths; use `process.stderr.write` for diagnostics, structured `[loom]` log prefix so logs are greppable (matches `[dream]` prefix convention).
- Every commit message follows the project format: `loom: <short description>` then optional body, no links.
- Run `npm test --workspace=@forgeframe/server` after each task; full suite must stay green.

---

## Pre-flight (before Task 1)

- [ ] **Verify worktree state**

```bash
cd ~/repos/ForgeFrame-loom
git status
git branch --show-current
```

Expected: `feat/loom-organ`, clean working tree (or only the F5 PREBUILD_CHECK_SKETCH.md untracked).

- [ ] **Stage F5 sketch as the first commit on this branch**

```bash
cd ~/repos/ForgeFrame-loom
git add PREBUILD_CHECK_SKETCH.md
git commit -m "loom: absorb F5 prebuild_check sketch as future Layer-4 reference"
```

- [ ] **Stage spec + plan as the second commit**

```bash
cd ~/repos/ForgeFrame-loom
git add docs/superpowers/specs/2026-04-25-loom-design.md docs/superpowers/plans/2026-04-25-loom-implementation.md
git commit -m "loom: spec + implementation plan"
```

- [ ] **Run baseline test suite — must be green before changes**

```bash
cd ~/repos/ForgeFrame-loom
npm install
npm run build --workspace=@forgeframe/memory
npm run build --workspace=@forgeframe/core
npm test --workspace=@forgeframe/server
```

Expected: all tests pass. Record the baseline pass count for comparison after each task.

---

## Task 1: Scaffold + shared types + cold-start

Lays the foundation. After this task, the loom subdir exists with shared types and the 7-day cold-start state file working end-to-end.

**Files:**
- Create: `packages/server/src/loom/types.ts`
- Create: `packages/server/src/loom/cold-start.ts`
- Create: `packages/server/src/loom/cold-start.test.ts`

- [ ] **Step 1.1: Create `types.ts` with shared interfaces**

```typescript
// packages/server/src/loom/types.ts
/**
 * Loom — shared types
 *
 * Hook payload shape mirrors what Claude Code passes on stdin to
 * PreToolUse / PostToolUse hooks (tool_name + tool_input + session
 * fields). Router decision shape mirrors what PreToolUse hooks may
 * emit on stdout to influence the dispatch.
 */

export type LoomTool = 'Agent' | 'Bash';

export interface HookPayload {
  tool_name: LoomTool | string;
  tool_input: Record<string, unknown>;
  session_id?: string;
  cwd?: string;
  hook_event_name?: 'PreToolUse' | 'PostToolUse';
  // PostToolUse only:
  tool_response?: { is_error?: boolean; content?: unknown };
}

export type RouterAction = 'pass' | 'allow' | 'deny' | 'cold-start';

export interface RouterDecision {
  action: RouterAction;
  reason?: string;
  policyId?: string;
}

export interface DispatchRecord {
  tool: LoomTool;
  inputSummary: string;
  subagentType?: string;
  commandHead?: string;
  startedAt: number;
  durationMs?: number;
  sessionId?: string;
  exitStatus: 'success' | 'error' | 'denied' | 'unknown';
  routerAction: RouterAction;
  project?: string;
}

export interface Policy {
  id: string;
  rule: string;
  scope: {
    tool?: LoomTool;
    subagentType?: string;
    project?: string;
    matchers?: Record<string, unknown>;
  };
  action: { kind: RouterAction; reason?: string };
  approvedAt: number;
}

export interface Cluster {
  signature: string;
  members: Array<{ id: string; tags: string[]; createdAt: number }>;
  size: number;
}
```

- [ ] **Step 1.2: Write `cold-start.test.ts` — failing test**

```typescript
// packages/server/src/loom/cold-start.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { recordFirstFire, isArmed, getState } from './cold-start.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe('cold-start', () => {
  let dir: string;
  let statePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loom-cs-'));
    statePath = join(dir, 'loom-state.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes first_fire_at on first call and is not armed', () => {
    recordFirstFire(statePath);
    expect(existsSync(statePath)).toBe(true);
    const state = getState(statePath);
    expect(state.firstFireAt).toBeTypeOf('number');
    expect(isArmed(statePath)).toBe(false);
  });

  it('does not overwrite first_fire_at on subsequent calls', () => {
    recordFirstFire(statePath);
    const original = getState(statePath).firstFireAt!;
    // Sleep a tiny bit
    const wait = Date.now() + 5;
    while (Date.now() < wait) { /* spin */ }
    recordFirstFire(statePath);
    expect(getState(statePath).firstFireAt).toBe(original);
  });

  it('is armed once 7 days have elapsed (simulated via file content)', () => {
    const longAgo = Date.now() - SEVEN_DAYS_MS - 1000;
    const fs = require('fs') as typeof import('fs');
    fs.writeFileSync(statePath, JSON.stringify({ firstFireAt: longAgo }), 'utf8');
    expect(isArmed(statePath)).toBe(true);
  });

  it('returns isArmed false when state file is missing', () => {
    expect(isArmed(statePath)).toBe(false);
  });

  it('survives a corrupt state file (returns false, does not throw)', () => {
    const fs = require('fs') as typeof import('fs');
    fs.writeFileSync(statePath, 'not json', 'utf8');
    expect(isArmed(statePath)).toBe(false);
    expect(() => recordFirstFire(statePath)).not.toThrow();
    // After recovery, file is valid JSON again.
    const after = readFileSync(statePath, 'utf8');
    expect(() => JSON.parse(after)).not.toThrow();
  });
});
```

- [ ] **Step 1.3: Run test — confirm fail**

```bash
cd ~/repos/ForgeFrame-loom
npx vitest run packages/server/src/loom/cold-start.test.ts
```

Expected: FAIL — module `./cold-start.js` not found.

- [ ] **Step 1.4: Implement `cold-start.ts`**

```typescript
// packages/server/src/loom/cold-start.ts
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
```

- [ ] **Step 1.5: Run test — confirm pass**

```bash
cd ~/repos/ForgeFrame-loom
npx vitest run packages/server/src/loom/cold-start.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 1.6: Build the package**

```bash
cd ~/repos/ForgeFrame-loom
npm run build --workspace=@forgeframe/server
```

Expected: zero errors.

- [ ] **Step 1.7: Run full server test suite**

```bash
cd ~/repos/ForgeFrame-loom
npm test --workspace=@forgeframe/server
```

Expected: all baseline tests still pass + 5 new cold-start tests.

- [ ] **Step 1.8: Commit**

```bash
cd ~/repos/ForgeFrame-loom
git add packages/server/src/loom/types.ts packages/server/src/loom/cold-start.ts packages/server/src/loom/cold-start.test.ts
git commit -m "loom: shared types + cold-start state file (7-day window)"
```

---

## Task 2: Sensor — PostToolUse write path

Reads a hook JSON payload from stdin, derives a `DispatchRecord`, writes a `dispatch:*` memory row. Hot path: must be cheap. Async-friendly (the wrapper script is `async: true`, so the sensor exiting fast is enough — no daemonization required).

**Files:**
- Create: `packages/server/src/loom/sensor.ts`
- Create: `packages/server/src/loom/sensor.test.ts`

- [ ] **Step 2.1: Write `sensor.test.ts` — failing test**

```typescript
// packages/server/src/loom/sensor.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStore } from '@forgeframe/memory';
import { recordDispatch, summarizeAgentInput, summarizeBashInput, projectFromCwd } from './sensor.js';
import { recordFirstFire, getState } from './cold-start.js';

describe('sensor.recordDispatch', () => {
  let dir: string;
  let dbPath: string;
  let statePath: string;
  let store: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loom-sensor-'));
    dbPath = join(dir, 'memory.db');
    statePath = join(dir, 'loom-state.json');
    store = new MemoryStore({ dbPath });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a dispatch:* memory for an Agent payload and records first fire', () => {
    const payload = {
      tool_name: 'Agent',
      tool_input: { subagent_type: 'Explore', description: 'survey auth code', prompt: 'find every call site of authenticate()' },
      session_id: 'test-session',
      cwd: '/Users/acamp/repos/reframed',
    };
    recordDispatch(payload as any, { store, statePath });

    expect(getState(statePath).firstFireAt).toBeTypeOf('number');
    const memories = store.getRecent(5);
    expect(memories.length).toBe(1);
    const m = memories[0];
    expect(m.tags).toContain('dispatch');
    expect(m.tags).toContain('dispatch:tool:agent');
    expect(m.tags).toContain('dispatch:agent:explore');
    expect(m.tags).toContain('project:reframed');
    expect(m.tags).toContain('dispatch:cold-start');
    const body = JSON.parse(m.content);
    expect(body.tool).toBe('Agent');
    expect(body.subagent_type).toBe('Explore');
    expect(body.input_summary).toMatch(/survey auth code/);
  });

  it('writes a dispatch:* memory for a Bash payload', () => {
    const payload = {
      tool_name: 'Bash',
      tool_input: { command: 'git status --short', description: 'check tree' },
      session_id: 'test-session',
      cwd: '/Users/acamp/repos/ForgeFrame-loom',
    };
    recordDispatch(payload as any, { store, statePath });
    const memories = store.getRecent(5);
    expect(memories.length).toBe(1);
    const m = memories[0];
    expect(m.tags).toContain('dispatch:tool:bash');
    expect(m.tags).toContain('project:forgeframe-loom');
    const body = JSON.parse(m.content);
    expect(body.command_head).toBe('git status --short');
  });

  it('skips non-Agent/Bash tools', () => {
    const payload = { tool_name: 'Read', tool_input: { file_path: '/x' } };
    recordDispatch(payload as any, { store, statePath });
    expect(store.getRecent(5).length).toBe(0);
  });

  it('does not throw on missing fields', () => {
    expect(() => recordDispatch({ tool_name: 'Agent', tool_input: {} } as any, { store, statePath })).not.toThrow();
    expect(store.getRecent(5).length).toBe(1);
  });

  it('does not tag dispatch:cold-start once router is armed', () => {
    // Pre-set state to look like 8 days ago.
    const fs = require('fs') as typeof import('fs');
    fs.writeFileSync(statePath, JSON.stringify({ firstFireAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }), 'utf8');
    const payload = { tool_name: 'Agent', tool_input: { subagent_type: 'Plan', prompt: 'do x' }, cwd: '/Users/acamp/repos/foo' };
    recordDispatch(payload as any, { store, statePath });
    const m = store.getRecent(1)[0];
    expect(m.tags).not.toContain('dispatch:cold-start');
  });
});

describe('sensor helpers', () => {
  it('summarizeAgentInput truncates to 200 chars and prefers description over prompt', () => {
    const long = 'a'.repeat(500);
    expect(summarizeAgentInput({ subagent_type: 'Explore', description: 'short desc', prompt: long })).toBe('short desc');
    expect(summarizeAgentInput({ subagent_type: 'Explore', prompt: long }).length).toBeLessThanOrEqual(200);
  });

  it('summarizeBashInput returns the first 3 tokens of the command', () => {
    expect(summarizeBashInput({ command: 'git status --short -uall' })).toBe('git status --short');
    expect(summarizeBashInput({ command: 'ls' })).toBe('ls');
  });

  it('projectFromCwd extracts the last path segment lowercased', () => {
    expect(projectFromCwd('/Users/acamp/repos/Reframed')).toBe('reframed');
    expect(projectFromCwd('/Users/acamp/repos/ForgeFrame-loom')).toBe('forgeframe-loom');
    expect(projectFromCwd(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2.2: Run test — confirm fail**

```bash
cd ~/repos/ForgeFrame-loom
npx vitest run packages/server/src/loom/sensor.test.ts
```

Expected: FAIL — module `./sensor.js` not found.

- [ ] **Step 2.3: Implement `sensor.ts`**

```typescript
// packages/server/src/loom/sensor.ts
/**
 * Loom — sensor (PostToolUse write path)
 *
 * Reads a Claude Code hook JSON payload from stdin, derives a
 * dispatch record, writes a `dispatch:*` memory row.
 *
 * Hot path: must be cheap. Wrapper script invokes us with
 * `async: true` (Claude Code does not wait for our exit). We still
 * keep the work minimal and avoid network / heavy compute.
 */

import { MemoryStore } from '@forgeframe/memory';
import { resolve } from 'path';
import { homedir } from 'os';
import type { HookPayload, DispatchRecord, LoomTool, RouterAction } from './types.js';
import { recordFirstFire, isArmed, DEFAULT_STATE_PATH } from './cold-start.js';

const SUMMARY_MAX = 200;

export function summarizeAgentInput(input: Record<string, unknown>): string {
  const description = typeof input.description === 'string' ? input.description : undefined;
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const text = (description ?? prompt).slice(0, SUMMARY_MAX);
  return text;
}

export function summarizeBashInput(input: Record<string, unknown>): string {
  const cmd = typeof input.command === 'string' ? input.command : '';
  return cmd.split(/\s+/).slice(0, 3).join(' ');
}

export function projectFromCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const parts = cwd.split('/').filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts[parts.length - 1].toLowerCase();
}

export interface RecordOptions {
  store: MemoryStore;
  statePath?: string;
  now?: number;
}

export function recordDispatch(payload: HookPayload, opts: RecordOptions): void {
  const tool = payload.tool_name as LoomTool;
  if (tool !== 'Agent' && tool !== 'Bash') return;

  const statePath = opts.statePath ?? DEFAULT_STATE_PATH;
  const now = opts.now ?? Date.now();
  recordFirstFire(statePath, now);
  const armed = isArmed(statePath, now);

  const project = projectFromCwd(payload.cwd);
  const subagentType = tool === 'Agent' && typeof payload.tool_input.subagent_type === 'string'
    ? (payload.tool_input.subagent_type as string)
    : undefined;
  const inputSummary = tool === 'Agent'
    ? summarizeAgentInput(payload.tool_input)
    : summarizeBashInput(payload.tool_input);
  const commandHead = tool === 'Bash' ? inputSummary : undefined;

  const exitStatus: DispatchRecord['exitStatus'] = payload.tool_response?.is_error ? 'error' : 'success';
  const routerAction: RouterAction = armed ? 'pass' : 'cold-start';

  const record: DispatchRecord = {
    tool,
    inputSummary,
    subagentType,
    commandHead,
    startedAt: now,
    sessionId: payload.session_id,
    exitStatus,
    routerAction,
    project,
  };

  const tags: string[] = ['dispatch', `dispatch:tool:${tool.toLowerCase()}`];
  if (subagentType) tags.push(`dispatch:agent:${subagentType.toLowerCase()}`);
  if (project) tags.push(`project:${project}`);
  if (!armed) tags.push('dispatch:cold-start');

  try {
    opts.store.create({
      content: JSON.stringify(record),
      tags,
      sensitivity: 'public',
      metadata: { kind: 'loom-dispatch' },
    });
  } catch (err) {
    process.stderr.write(`[loom] sensor write failed: ${(err as Error).message}\n`);
  }
}

// Stdin entry point — invoked by ~/.claude/hooks/loom-sensor.sh
async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  let payload: HookPayload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    process.exit(0); // never block on parse errors
  }

  const dbPath = process.env.FORGEFRAME_DB_PATH ?? resolve(homedir(), '.forgeframe', 'memory.db');
  const store = new MemoryStore({ dbPath });
  try {
    recordDispatch(payload!, { store });
  } finally {
    store.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`[loom] sensor crashed: ${(err as Error).message}\n`);
    process.exit(0); // never block the next dispatch
  });
}
```

- [ ] **Step 2.4: Run test — confirm pass**

```bash
cd ~/repos/ForgeFrame-loom
npx vitest run packages/server/src/loom/sensor.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 2.5: Build + full suite**

```bash
cd ~/repos/ForgeFrame-loom
npm run build --workspace=@forgeframe/server
npm test --workspace=@forgeframe/server
```

Expected: zero build errors, all tests pass.

- [ ] **Step 2.6: Commit**

```bash
cd ~/repos/ForgeFrame-loom
git add packages/server/src/loom/sensor.ts packages/server/src/loom/sensor.test.ts
git commit -m "loom: sensor — PostToolUse writes dispatch:* memory rows"
```

---

## Task 3: Policy + router — PreToolUse decision path

Pure policy module + the router hook entry point. Router must be fast: single SQLite read of approved principles, no embeddings, no graph traversal.

**Files:**
- Create: `packages/server/src/loom/policy.ts`
- Create: `packages/server/src/loom/policy.test.ts`
- Create: `packages/server/src/loom/router.ts`
- Create: `packages/server/src/loom/router.test.ts`

- [ ] **Step 3.1: Write `policy.test.ts` — failing test**

```typescript
// packages/server/src/loom/policy.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStore } from '@forgeframe/memory';
import { loadPolicies, matchPolicy } from './policy.js';
import type { Policy, HookPayload } from './types.js';

describe('policy', () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loom-policy-'));
    store = new MemoryStore({ dbPath: join(dir, 'memory.db') });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function seedPolicy(p: Omit<Policy, 'approvedAt'>): void {
    const body = JSON.stringify({ ...p, approvedAt: Date.now() });
    store.create({
      content: body,
      tags: ['routing-principle', 'principle', 'routing-principle:approved'],
      sensitivity: 'public',
    });
  }

  it('loadPolicies returns only approved principles', () => {
    seedPolicy({ id: 'p1', rule: 'block curl', scope: { tool: 'Bash' }, action: { kind: 'deny', reason: 'no curl' } });
    // A proposed (non-approved) policy must be ignored.
    store.create({
      content: JSON.stringify({ id: 'p2', rule: 'x', scope: {}, action: { kind: 'allow' }, approvedAt: Date.now() }),
      tags: ['routing-principle', 'routing-principle:proposed'],
      sensitivity: 'public',
    });
    const policies = loadPolicies(store);
    expect(policies.length).toBe(1);
    expect(policies[0].id).toBe('p1');
  });

  it('matchPolicy returns pass when no policies match', () => {
    const payload: HookPayload = { tool_name: 'Agent', tool_input: { subagent_type: 'Explore' } };
    const decision = matchPolicy(payload, []);
    expect(decision.action).toBe('pass');
  });

  it('matchPolicy denies when a tool-scoped policy says deny', () => {
    const policies: Policy[] = [{
      id: 'p1', rule: 'no curl', scope: { tool: 'Bash' },
      action: { kind: 'deny', reason: 'curl forbidden' }, approvedAt: 1,
    }];
    const decision = matchPolicy({ tool_name: 'Bash', tool_input: { command: 'curl http://x' } }, policies);
    expect(decision.action).toBe('deny');
    expect(decision.reason).toMatch(/curl/);
    expect(decision.policyId).toBe('p1');
  });

  it('matchPolicy: more specific scope (project + tool) beats broader (tool only)', () => {
    const policies: Policy[] = [
      { id: 'broad', rule: 'allow agent', scope: { tool: 'Agent' }, action: { kind: 'allow' }, approvedAt: 1 },
      { id: 'narrow', rule: 'deny agent in foo', scope: { tool: 'Agent', project: 'foo' }, action: { kind: 'deny', reason: 'no agents in foo' }, approvedAt: 2 },
    ];
    const decision = matchPolicy(
      { tool_name: 'Agent', tool_input: { subagent_type: 'Explore' }, cwd: '/Users/acamp/repos/foo' },
      policies,
    );
    expect(decision.action).toBe('deny');
    expect(decision.policyId).toBe('narrow');
  });

  it('matchPolicy: equal-specificity ties broken by newest approvedAt', () => {
    const policies: Policy[] = [
      { id: 'older', rule: 'allow', scope: { tool: 'Agent' }, action: { kind: 'allow' }, approvedAt: 1 },
      { id: 'newer', rule: 'deny', scope: { tool: 'Agent' }, action: { kind: 'deny', reason: 'r' }, approvedAt: 2 },
    ];
    const d = matchPolicy({ tool_name: 'Agent', tool_input: {} }, policies);
    expect(d.policyId).toBe('newer');
  });

  it('matchPolicy: subagentType scope filters correctly', () => {
    const policies: Policy[] = [{
      id: 'plan-only', rule: 'allow Plan', scope: { tool: 'Agent', subagentType: 'Plan' },
      action: { kind: 'allow' }, approvedAt: 1,
    }];
    const matched = matchPolicy({ tool_name: 'Agent', tool_input: { subagent_type: 'Plan' } }, policies);
    expect(matched.action).toBe('allow');
    const skipped = matchPolicy({ tool_name: 'Agent', tool_input: { subagent_type: 'Explore' } }, policies);
    expect(skipped.action).toBe('pass');
  });
});
```

- [ ] **Step 3.2: Run test — confirm fail**

```bash
cd ~/repos/ForgeFrame-loom
npx vitest run packages/server/src/loom/policy.test.ts
```

Expected: FAIL — module `./policy.js` not found.

- [ ] **Step 3.3: Implement `policy.ts`**

```typescript
// packages/server/src/loom/policy.ts
/**
 * Loom — policy
 *
 * Pure policy lookup. Loads approved routing principles from the
 * memory store (single SQL query via memory_list_by_tag-equivalent),
 * matches them against an incoming hook payload, returns a router
 * decision.
 *
 * Latency budget for the whole loadPolicies + matchPolicy call:
 * ≤ 50ms p95 against ~100 approved principles. Achieved by
 * scanning the approved-list once in JS — no per-payload SQL.
 */

import type { MemoryStore } from '@forgeframe/memory';
import type { HookPayload, Policy, RouterDecision, LoomTool } from './types.js';
import { projectFromCwd } from './sensor.js';

const APPROVED_TAG = 'routing-principle:approved';

export function loadPolicies(store: MemoryStore): Policy[] {
  // listByTag returns memories ordered by created_at desc; we only
  // need the JSON-encoded body which contains the policy fields.
  const rows = store.listByTag(APPROVED_TAG, 500);
  const out: Policy[] = [];
  for (const m of rows) {
    try {
      const parsed = JSON.parse(m.content) as Policy;
      if (!parsed.id || !parsed.action?.kind) continue;
      out.push(parsed);
    } catch {
      // skip corrupt rows; never throw
    }
  }
  return out;
}

interface ScoredPolicy {
  policy: Policy;
  specificity: number;
}

function scopeMatches(payload: HookPayload, policy: Policy): { ok: boolean; specificity: number } {
  const scope = policy.scope ?? {};
  let specificity = 0;

  if (scope.tool) {
    if (scope.tool !== payload.tool_name) return { ok: false, specificity: 0 };
    specificity += 1;
  }

  if (scope.subagentType) {
    if (payload.tool_name !== 'Agent') return { ok: false, specificity: 0 };
    if (scope.subagentType !== payload.tool_input?.subagent_type) return { ok: false, specificity: 0 };
    specificity += 2;
  }

  if (scope.project) {
    const project = projectFromCwd(payload.cwd);
    if (scope.project !== project) return { ok: false, specificity: 0 };
    specificity += 2;
  }

  return { ok: true, specificity };
}

export function matchPolicy(payload: HookPayload, policies: Policy[]): RouterDecision {
  const candidates: ScoredPolicy[] = [];
  for (const policy of policies) {
    const { ok, specificity } = scopeMatches(payload, policy);
    if (ok) candidates.push({ policy, specificity });
  }

  if (candidates.length === 0) {
    return { action: 'pass' };
  }

  // Most specific scope wins; ties broken by newest approvedAt.
  candidates.sort((a, b) => {
    if (b.specificity !== a.specificity) return b.specificity - a.specificity;
    return (b.policy.approvedAt ?? 0) - (a.policy.approvedAt ?? 0);
  });
  const winner = candidates[0].policy;

  return {
    action: winner.action.kind,
    reason: winner.action.reason ?? winner.rule,
    policyId: winner.id,
  };
}

// Re-export for convenience
export type { Policy } from './types.js';
```

- [ ] **Step 3.4: Run policy test — confirm pass**

```bash
cd ~/repos/ForgeFrame-loom
npx vitest run packages/server/src/loom/policy.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 3.5: Write `router.test.ts` — failing test**

```typescript
// packages/server/src/loom/router.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStore } from '@forgeframe/memory';
import { decide, formatDecisionForHook } from './router.js';

describe('router.decide', () => {
  let dir: string;
  let store: MemoryStore;
  let statePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loom-router-'));
    store = new MemoryStore({ dbPath: join(dir, 'memory.db') });
    statePath = join(dir, 'loom-state.json');
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns cold-start when first_fire_at is unset (no fire yet)', () => {
    const d = decide({ tool_name: 'Agent', tool_input: {} } as any, { store, statePath });
    expect(d.action).toBe('cold-start');
  });

  it('returns cold-start when within the 7-day window', () => {
    const fs = require('fs') as typeof import('fs');
    fs.writeFileSync(statePath, JSON.stringify({ firstFireAt: Date.now() - 1000 }), 'utf8');
    const d = decide({ tool_name: 'Bash', tool_input: { command: 'ls' } } as any, { store, statePath });
    expect(d.action).toBe('cold-start');
  });

  it('returns pass when armed and no policies match', () => {
    const fs = require('fs') as typeof import('fs');
    fs.writeFileSync(statePath, JSON.stringify({ firstFireAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }), 'utf8');
    const d = decide({ tool_name: 'Bash', tool_input: { command: 'ls' } } as any, { store, statePath });
    expect(d.action).toBe('pass');
  });

  it('returns the policy decision when armed and a policy matches', () => {
    const fs = require('fs') as typeof import('fs');
    fs.writeFileSync(statePath, JSON.stringify({ firstFireAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }), 'utf8');
    store.create({
      content: JSON.stringify({
        id: 'p1', rule: 'no curl', scope: { tool: 'Bash' },
        action: { kind: 'deny', reason: 'curl forbidden' }, approvedAt: 1,
      }),
      tags: ['routing-principle', 'principle', 'routing-principle:approved'],
      sensitivity: 'public',
    });
    const d = decide({ tool_name: 'Bash', tool_input: { command: 'curl x' } } as any, { store, statePath });
    expect(d.action).toBe('deny');
    expect(d.policyId).toBe('p1');
  });

  it('formatDecisionForHook returns null for pass / cold-start (silent)', () => {
    expect(formatDecisionForHook({ action: 'pass' })).toBeNull();
    expect(formatDecisionForHook({ action: 'cold-start' })).toBeNull();
  });

  it('formatDecisionForHook formats deny per Claude Code PreToolUse schema', () => {
    const out = formatDecisionForHook({ action: 'deny', reason: 'r', policyId: 'p1' });
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out!);
    expect(parsed.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput?.permissionDecisionReason).toMatch(/r/);
  });

  it('formatDecisionForHook formats allow per Claude Code PreToolUse schema', () => {
    const out = formatDecisionForHook({ action: 'allow', reason: 'auto-approved by loom' });
    const parsed = JSON.parse(out!);
    expect(parsed.hookSpecificOutput?.permissionDecision).toBe('allow');
  });
});

describe('router latency', () => {
  it('100 invocations against 100 policies stay under 5 seconds total', () => {
    const dir = mkdtempSync(join(tmpdir(), 'loom-bench-'));
    const store = new MemoryStore({ dbPath: join(dir, 'memory.db') });
    const statePath = join(dir, 'loom-state.json');
    const fs = require('fs') as typeof import('fs');
    fs.writeFileSync(statePath, JSON.stringify({ firstFireAt: 1 }), 'utf8');

    for (let i = 0; i < 100; i++) {
      store.create({
        content: JSON.stringify({
          id: `p${i}`, rule: 'r', scope: { tool: 'Bash' },
          action: { kind: 'pass' }, approvedAt: i,
        }),
        tags: ['routing-principle', 'principle', 'routing-principle:approved'],
        sensitivity: 'public',
      });
    }

    const t0 = Date.now();
    for (let i = 0; i < 100; i++) {
      decide({ tool_name: 'Bash', tool_input: { command: 'ls' } } as any, { store, statePath });
    }
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(5000);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 3.6: Run router test — confirm fail**

```bash
cd ~/repos/ForgeFrame-loom
npx vitest run packages/server/src/loom/router.test.ts
```

Expected: FAIL — module `./router.js` not found.

- [ ] **Step 3.7: Implement `router.ts`**

```typescript
// packages/server/src/loom/router.ts
/**
 * Loom — router (PreToolUse decision path)
 *
 * Reads a Claude Code PreToolUse hook payload from stdin, looks up
 * matching approved routing principles, emits a decision.
 *
 * Decision protocol (Claude Code PreToolUse hook spec):
 *  - exit 0, no stdout            → pass through (default permissions)
 *  - stdout JSON with permissionDecision = "deny" + reason → block
 *  - stdout JSON with permissionDecision = "allow" + reason → auto-approve
 *
 * Cold-start (first 7 days from sensor's first fire) always passes
 * through, even when matching policies exist. The router writes a
 * note to its log (~/.creature/logs/loom-router.log) for audit.
 *
 * Latency budget: ≤ 50ms p95.
 */

import { MemoryStore } from '@forgeframe/memory';
import { resolve } from 'path';
import { homedir } from 'os';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { HookPayload, RouterDecision } from './types.js';
import { isArmed, DEFAULT_STATE_PATH } from './cold-start.js';
import { loadPolicies, matchPolicy } from './policy.js';

export interface DecideOptions {
  store: MemoryStore;
  statePath?: string;
  now?: number;
  policies?: ReturnType<typeof loadPolicies>;
}

export function decide(payload: HookPayload, opts: DecideOptions): RouterDecision {
  const statePath = opts.statePath ?? DEFAULT_STATE_PATH;
  const now = opts.now ?? Date.now();

  if (!isArmed(statePath, now)) {
    return { action: 'cold-start' };
  }

  const policies = opts.policies ?? loadPolicies(opts.store);
  return matchPolicy(payload, policies);
}

export function formatDecisionForHook(decision: RouterDecision): string | null {
  if (decision.action === 'pass' || decision.action === 'cold-start') return null;

  const reason = decision.reason ?? `loom: ${decision.action} (policy ${decision.policyId ?? 'unknown'})`;
  const permissionDecision = decision.action === 'deny' ? 'deny' : 'allow';

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason: reason,
    },
  });
}

const LOG_PATH = resolve(homedir(), '.creature', 'logs', 'loom-router.log');

function logDecision(payload: HookPayload, decision: RouterDecision, now: number): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(
      LOG_PATH,
      JSON.stringify({ at: now, tool: payload.tool_name, action: decision.action, policyId: decision.policyId }) + '\n',
      'utf8',
    );
  } catch {
    // log failures must not break the dispatch
  }
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  let payload: HookPayload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    process.exit(0);
  }

  const dbPath = process.env.FORGEFRAME_DB_PATH ?? resolve(homedir(), '.forgeframe', 'memory.db');
  const store = new MemoryStore({ dbPath });
  const now = Date.now();
  let decision: RouterDecision;
  try {
    decision = decide(payload!, { store, now });
  } catch (err) {
    process.stderr.write(`[loom] router crashed safely: ${(err as Error).message}\n`);
    process.exit(0);
  } finally {
    store.close();
  }

  logDecision(payload!, decision, now);
  const formatted = formatDecisionForHook(decision);
  if (formatted) process.stdout.write(formatted);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`[loom] router top-level crash: ${(err as Error).message}\n`);
    process.exit(0);
  });
}
```

- [ ] **Step 3.8: Run router test — confirm pass**

```bash
cd ~/repos/ForgeFrame-loom
npx vitest run packages/server/src/loom/router.test.ts
```

Expected: 8 tests pass (7 functional + 1 latency benchmark).

- [ ] **Step 3.9: Build + full suite**

```bash
cd ~/repos/ForgeFrame-loom
npm run build --workspace=@forgeframe/server
npm test --workspace=@forgeframe/server
```

Expected: zero build errors, all tests pass.

- [ ] **Step 3.10: Commit**

```bash
cd ~/repos/ForgeFrame-loom
git add packages/server/src/loom/policy.ts packages/server/src/loom/policy.test.ts packages/server/src/loom/router.ts packages/server/src/loom/router.test.ts
git commit -m "loom: policy match + router decision (cold-start gated)"
```

---

## Task 4: Reflector — cluster dispatches → propose principles

Walks recent `dispatch:*` memories, groups them by `(tool, subagentType, project)` signature, and writes a `routing-principle:proposed` row for any cluster with a meaningful frequency. Linked back to source dispatches via the existing `memory_link` (edge) primitive for explainability.

**Files:**
- Create: `packages/server/src/loom/reflector.ts`
- Create: `packages/server/src/loom/reflector.test.ts`

- [ ] **Step 4.1: Write `reflector.test.ts` — failing test**

```typescript
// packages/server/src/loom/reflector.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStore } from '@forgeframe/memory';
import { reflect, signatureOf } from './reflector.js';
import type { DispatchRecord } from './types.js';

describe('reflector.signatureOf', () => {
  it('combines tool + subagentType + project (lowercased)', () => {
    expect(signatureOf({
      tool: 'Agent', inputSummary: '', startedAt: 0, exitStatus: 'success',
      routerAction: 'pass', subagentType: 'Explore', project: 'reframed',
    } as DispatchRecord)).toBe('agent:explore:reframed');
  });

  it('uses _ for missing project', () => {
    expect(signatureOf({
      tool: 'Bash', inputSummary: '', startedAt: 0, exitStatus: 'success', routerAction: 'pass',
    } as DispatchRecord)).toBe('bash:_:_');
  });
});

describe('reflector.reflect', () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loom-reflect-'));
    store = new MemoryStore({ dbPath: join(dir, 'memory.db') });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function seed(rec: Partial<DispatchRecord>): string {
    const full: DispatchRecord = {
      tool: 'Agent', inputSummary: '', startedAt: Date.now(),
      exitStatus: 'success', routerAction: 'pass', ...rec,
    };
    const tags: string[] = ['dispatch', `dispatch:tool:${full.tool.toLowerCase()}`];
    if (full.subagentType) tags.push(`dispatch:agent:${full.subagentType.toLowerCase()}`);
    if (full.project) tags.push(`project:${full.project}`);
    const m = store.create({
      content: JSON.stringify(full),
      tags,
      sensitivity: 'public',
      metadata: { kind: 'loom-dispatch' },
    });
    return m.id;
  }

  it('proposes nothing when no cluster reaches the minimum size', () => {
    seed({ tool: 'Agent', subagentType: 'Explore', project: 'reframed' });
    seed({ tool: 'Agent', subagentType: 'Plan', project: 'forgeframe' });
    const result = reflect({ store, minClusterSize: 5 });
    expect(result.proposed).toBe(0);
  });

  it('proposes one routing-principle for each cluster that hits the minimum', () => {
    for (let i = 0; i < 6; i++) seed({ tool: 'Agent', subagentType: 'Explore', project: 'reframed' });
    for (let i = 0; i < 3; i++) seed({ tool: 'Bash', project: 'forgeframe' });
    const result = reflect({ store, minClusterSize: 5 });
    expect(result.proposed).toBe(1);

    const proposals = store.listByTag('routing-principle:proposed', 10);
    expect(proposals.length).toBe(1);
    const p = JSON.parse(proposals[0].content);
    expect(p.scope.tool).toBe('Agent');
    expect(p.scope.subagentType).toBe('Explore');
    expect(p.scope.project).toBe('reframed');
    expect(p.derived_from_count).toBe(6);
    expect(Array.isArray(p.sample_dispatch_ids)).toBe(true);
    expect(p.sample_dispatch_ids.length).toBeGreaterThan(0);
    expect(p.sample_dispatch_ids.length).toBeLessThanOrEqual(5);
  });

  it('does not re-propose a cluster that already has an approved principle covering it', () => {
    for (let i = 0; i < 6; i++) seed({ tool: 'Agent', subagentType: 'Explore', project: 'reframed' });
    store.create({
      content: JSON.stringify({
        id: 'existing', rule: 'x',
        scope: { tool: 'Agent', subagentType: 'Explore', project: 'reframed' },
        action: { kind: 'pass' }, approvedAt: 1,
      }),
      tags: ['routing-principle', 'principle', 'routing-principle:approved'],
      sensitivity: 'public',
    });
    const result = reflect({ store, minClusterSize: 5 });
    expect(result.proposed).toBe(0);
  });

  it('does not re-propose a cluster that already has a pending proposal covering it', () => {
    for (let i = 0; i < 6; i++) seed({ tool: 'Agent', subagentType: 'Explore', project: 'reframed' });
    reflect({ store, minClusterSize: 5 });
    const second = reflect({ store, minClusterSize: 5 });
    expect(second.proposed).toBe(0);
  });
});
```

- [ ] **Step 4.2: Run test — confirm fail**

```bash
cd ~/repos/ForgeFrame-loom
npx vitest run packages/server/src/loom/reflector.test.ts
```

Expected: FAIL — module `./reflector.js` not found.

- [ ] **Step 4.3: Implement `reflector.ts`**

```typescript
// packages/server/src/loom/reflector.ts
/**
 * Loom — reflector
 *
 * Walks recent dispatch:* memories, clusters them by signature
 * (tool / subagentType / project), and writes a
 * routing-principle:proposed row for each cluster meeting the
 * minimum frequency threshold.
 *
 * Skips clusters already covered by an approved or proposed
 * routing-principle so reflect() is idempotent across runs.
 *
 * v1: invoked manually via `forgeframe loom reflect`. v1.1 wires
 * into dream-schedule.ts NREM phase.
 */

import type { MemoryStore } from '@forgeframe/memory';
import type { DispatchRecord, Policy } from './types.js';

export interface ReflectOptions {
  store: MemoryStore;
  /** Minimum cluster size to propose a principle. Default 10. */
  minClusterSize?: number;
  /** Lookback window in ms. Default: 30 days. */
  windowMs?: number;
  now?: number;
}

export interface ReflectResult {
  scanned: number;
  clusters: number;
  proposed: number;
  proposalIds: string[];
}

export function signatureOf(rec: DispatchRecord): string {
  const tool = rec.tool.toLowerCase();
  const sub = rec.subagentType ? rec.subagentType.toLowerCase() : '_';
  const project = rec.project ? rec.project : '_';
  return `${tool}:${sub}:${project}`;
}

interface ClusterEntry {
  signature: string;
  tool: 'Agent' | 'Bash';
  subagentType?: string;
  project?: string;
  members: string[];
}

function clusterSignatureFromScope(scope: Policy['scope']): string {
  const tool = scope.tool ? scope.tool.toLowerCase() : '_';
  const sub = scope.subagentType ? scope.subagentType.toLowerCase() : '_';
  const project = scope.project ?? '_';
  return `${tool}:${sub}:${project}`;
}

function existingSignatures(store: MemoryStore): Set<string> {
  const out = new Set<string>();
  for (const m of store.listByTag('routing-principle:approved', 500)) {
    try {
      const p = JSON.parse(m.content) as Policy;
      out.add(clusterSignatureFromScope(p.scope ?? {}));
    } catch { /* skip */ }
  }
  for (const m of store.listByTag('routing-principle:proposed', 500)) {
    try {
      const p = JSON.parse(m.content) as Policy;
      out.add(clusterSignatureFromScope(p.scope ?? {}));
    } catch { /* skip */ }
  }
  return out;
}

export function reflect(opts: ReflectOptions): ReflectResult {
  const minSize = opts.minClusterSize ?? 10;
  const windowMs = opts.windowMs ?? 30 * 24 * 60 * 60 * 1000;
  const now = opts.now ?? Date.now();
  const cutoff = now - windowMs;

  const dispatches = opts.store.listByTag('dispatch', 5000);
  const clusters = new Map<string, ClusterEntry>();
  let scanned = 0;

  for (const m of dispatches) {
    if (m.createdAt < cutoff) continue;
    let rec: DispatchRecord;
    try { rec = JSON.parse(m.content) as DispatchRecord; } catch { continue; }
    if (rec.tool !== 'Agent' && rec.tool !== 'Bash') continue;
    scanned += 1;
    const sig = signatureOf(rec);
    let entry = clusters.get(sig);
    if (!entry) {
      entry = {
        signature: sig,
        tool: rec.tool,
        subagentType: rec.subagentType,
        project: rec.project,
        members: [],
      };
      clusters.set(sig, entry);
    }
    entry.members.push(m.id);
  }

  const skip = existingSignatures(opts.store);
  const proposalIds: string[] = [];
  let proposed = 0;

  for (const entry of clusters.values()) {
    if (entry.members.length < minSize) continue;
    if (skip.has(entry.signature)) continue;

    const proposalBody = {
      id: `prop-${entry.signature}-${now}`,
      rule: `Cluster of ${entry.members.length} ${entry.tool}${entry.subagentType ? `:${entry.subagentType}` : ''} dispatches${entry.project ? ` in project ${entry.project}` : ''} — review and codify`,
      scope: {
        tool: entry.tool,
        subagentType: entry.subagentType,
        project: entry.project,
      },
      action: { kind: 'pass' as const, reason: 'auto-proposed; founder to set action on approval' },
      derived_from_count: entry.members.length,
      sample_dispatch_ids: entry.members.slice(0, 5),
      proposed_at: now,
    };

    const tags = ['routing-principle', 'routing-principle:proposed'];
    if (entry.project) tags.push(`project:${entry.project}`);

    const m = opts.store.create({
      content: JSON.stringify(proposalBody),
      tags,
      sensitivity: 'public',
      metadata: { kind: 'loom-routing-principle-proposed' },
    });
    proposalIds.push(m.id);
    proposed += 1;

    // Best-effort link from each sample dispatch to the proposal so
    // Cockpit can render the explainability trail. linkMemories may
    // not exist in older builds — guard with a check.
    const linker = (opts.store as unknown as { linkMemories?: (a: string, b: string, kind: string) => void }).linkMemories;
    if (typeof linker === 'function') {
      for (const dispatchId of proposalBody.sample_dispatch_ids) {
        try { linker.call(opts.store, m.id, dispatchId, 'derived-from'); } catch { /* skip */ }
      }
    }
  }

  return { scanned, clusters: clusters.size, proposed, proposalIds };
}
```

- [ ] **Step 4.4: Run reflector test — confirm pass**

```bash
cd ~/repos/ForgeFrame-loom
npx vitest run packages/server/src/loom/reflector.test.ts
```

Expected: 6 tests pass.

If the test for `does not re-propose a cluster that already has a pending proposal covering it` fails, the proposal scope JSON isn't matching the signature recompute. Inspect the proposal body, ensure `scope.tool` matches the LoomTool case (`Agent`/`Bash`), and re-run.

- [ ] **Step 4.5: Build + full suite**

```bash
cd ~/repos/ForgeFrame-loom
npm run build --workspace=@forgeframe/server
npm test --workspace=@forgeframe/server
```

Expected: zero build errors, all tests pass.

- [ ] **Step 4.6: Commit**

```bash
cd ~/repos/ForgeFrame-loom
git add packages/server/src/loom/reflector.ts packages/server/src/loom/reflector.test.ts
git commit -m "loom: reflector — cluster dispatches, propose routing principles"
```

---

## Task 5: Organ adapter + index barrel + CLI subcommand

Wraps the loom modules as a ForgeFrame organ (manifest + lifecycle), exports the public surface, and adds a `loom` subcommand to the existing `forgeframe` CLI.

**Files:**
- Create: `packages/server/src/loom/index.ts`
- Create: `packages/server/src/loom/cli.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/cli.ts`

- [ ] **Step 5.1: Implement `packages/server/src/loom/index.ts`**

```typescript
// packages/server/src/loom/index.ts
/**
 * Loom — organ adapter + barrel exports
 */

import type {
  OrganManifest, OrganLifecycle, OrganInput, OrganOutput,
  OrganHealth, OrganProvenanceRecord,
} from '@forgeframe/core';
import type { MemoryStore } from '@forgeframe/memory';
import { randomUUID, createHash } from 'crypto';
import { isArmed, getState } from './cold-start.js';
import { reflect, type ReflectResult } from './reflector.js';

export * from './types.js';
export { recordDispatch, summarizeAgentInput, summarizeBashInput, projectFromCwd } from './sensor.js';
export { decide, formatDecisionForHook } from './router.js';
export { loadPolicies, matchPolicy } from './policy.js';
export { reflect, signatureOf } from './reflector.js';
export type { ReflectOptions, ReflectResult } from './reflector.js';
export {
  recordFirstFire, recordArmed, isArmed, getState,
  COLD_START_WINDOW_MS, DEFAULT_STATE_PATH,
} from './cold-start.js';

function hashData(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export const LOOM_ORGAN_MANIFEST: OrganManifest = {
  id: 'forgeframe.meta.loom',
  name: 'Loom',
  version: '0.1.0',
  description: 'Meta-organ: senses Claude Code dispatches, derives routing policy from observed patterns.',
  categories: ['meta', 'observation'],
  capabilities: [
    { action: 'sense', quality: 0.9, speed: 'fast', inputModalities: ['structured-data'], outputModalities: ['structured-data'] },
    { action: 'route', quality: 0.7, speed: 'fast', inputModalities: ['structured-data'], outputModalities: ['structured-data'] },
    { action: 'reflect', quality: 0.7, speed: 'moderate', inputModalities: ['structured-data'], outputModalities: ['structured-data'] },
  ],
  resources: { ramMb: 30, vramMb: 0, diskMb: 5, network: false, warmupTime: 'instant', concurrent: true },
  trust: {
    execution: 'local-only',
    dataClassifications: ['public', 'internal'],
    canPersist: true,
    telemetry: false,
  },
  io: {
    inputs: [{ name: 'action', modality: 'text', required: true, classification: 'internal' }],
    outputs: [{ name: 'result', modality: 'structured-data', required: true, classification: 'internal' }],
  },
};

export function createLoomOrganLifecycle(store: MemoryStore): OrganLifecycle {
  return {
    async register(): Promise<boolean> { return true; },
    async activate(): Promise<void> { /* hooks live in ~/.claude/settings.json — nothing to start here */ },

    async execute(input: OrganInput): Promise<OrganOutput> {
      const start = Date.now();
      const action = input.slots.action as string;
      let result: unknown;
      if (action === 'reflect') {
        result = reflect({ store }) as ReflectResult;
      } else if (action === 'status') {
        result = { armed: isArmed(), state: getState() };
      } else {
        throw new Error(`Unknown loom action: ${action}`);
      }

      const outputSlots = { result };
      const provenance: OrganProvenanceRecord = {
        invocationId: randomUUID(),
        requestId: input.requestId,
        organId: LOOM_ORGAN_MANIFEST.id,
        organVersion: LOOM_ORGAN_MANIFEST.version,
        timestamp: start,
        durationMs: Date.now() - start,
        inputHash: hashData(input.slots),
        outputHash: hashData(outputSlots),
        classificationsProcessed: ['internal'],
        trustLevel: 'local-only',
      };
      return { slots: outputSlots, provenance };
    },

    async deactivate(): Promise<void> { /* no-op */ },

    async health(): Promise<OrganHealth> {
      const state = getState();
      const armed = isArmed();
      const message = state.firstFireAt
        ? `cold-start ${armed ? 'complete' : 'in progress'}, first fire at ${new Date(state.firstFireAt).toISOString()}`
        : 'never fired';
      return { status: 'healthy', message };
    },
  };
}
```

- [ ] **Step 5.2: Implement `packages/server/src/loom/cli.ts`**

```typescript
// packages/server/src/loom/cli.ts
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
```

- [ ] **Step 5.3: Wire `loom` into the main CLI switch**

Edit `packages/server/src/cli.ts`. Find the `switch (command)` block (around line 30). Add an `import` near the other imports at the top:

```typescript
import { runLoomReflect, runLoomStatus, runLoomProposals } from './loom/cli.js';
```

Add this case to the switch (place it next to the other domain cases, before the default):

```typescript
    case 'loom': {
      const sub = args[1];
      const rest = args.slice(2);
      if (sub === 'reflect') {
        runLoomReflect(rest);
      } else if (sub === 'status') {
        runLoomStatus();
      } else if (sub === 'proposals') {
        runLoomProposals(rest);
      } else {
        process.stderr.write('Usage: forgeframe loom <reflect|status|proposals>\n');
        process.exit(1);
      }
      break;
    }
```

Update the usage comment block at the top of the file:

```
 *   forgeframe loom reflect [--min-cluster-size N]
 *   forgeframe loom status
 *   forgeframe loom proposals [--limit N]
```

- [ ] **Step 5.4: Re-export from package index**

Edit `packages/server/src/index.ts`. Add this line below the existing organ exports:

```typescript
export { LOOM_ORGAN_MANIFEST, createLoomOrganLifecycle } from './loom/index.js';
```

- [ ] **Step 5.5: Build + full suite**

```bash
cd ~/repos/ForgeFrame-loom
npm run build --workspace=@forgeframe/server
npm test --workspace=@forgeframe/server
```

Expected: zero build errors, all tests pass.

- [ ] **Step 5.6: Smoke-test the CLI**

```bash
cd ~/repos/ForgeFrame-loom
node packages/server/dist/cli.js loom status
```

Expected: prints JSON `{"armed": false, "firstFireAt": null, "remainingDays": 7}` (or similar; if the user's real `~/.forgeframe/loom-state.json` already exists, values will differ — that's fine).

- [ ] **Step 5.7: Commit**

```bash
cd ~/repos/ForgeFrame-loom
git add packages/server/src/loom/index.ts packages/server/src/loom/cli.ts packages/server/src/index.ts packages/server/src/cli.ts
git commit -m "loom: organ adapter + CLI subcommands (reflect / status / proposals)"
```

---

## Task 6: Hook wrappers + settings.json + README

Connects the modules to Claude Code via shell wrappers and registers them in the user's settings.json. Adds a README section so the founder understands the cold-start window.

**Files:**
- Create: `~/.claude/hooks/loom-sensor.sh`
- Create: `~/.claude/hooks/loom-router.sh`
- Modify: `~/.claude/settings.json`
- Modify: `~/repos/ForgeFrame-loom/README.md`

**Note:** The `~/.claude/settings.json` change affects the user's global Claude Code config — edits to that file go live for every session, not just the loom worktree. Treat it carefully and back up first.

- [ ] **Step 6.1: Create `loom-sensor.sh` wrapper**

```bash
cat > ~/.claude/hooks/loom-sensor.sh <<'EOF'
#!/usr/bin/env bash
# Loom sensor — PostToolUse on Agent + Bash.
# Pipes the hook payload to the loom sensor module. Async via the
# settings.json hook config; we still exit fast so Claude Code can
# move on to the next tool call without waiting on us.

# Opt-out: set LOOM_DISABLE=1 to skip.
if [ "$LOOM_DISABLE" = "1" ]; then
  exit 0
fi

LOOM_TSX="${LOOM_TSX:-/Users/acamp/repos/ForgeFrame-loom/packages/server/src/loom/sensor.ts}"

# Background the work; exit immediately so Claude Code's hook timer
# does not include the SQLite write latency.
( cat | npx --yes tsx "$LOOM_TSX" >/dev/null 2>>"$HOME/.creature/logs/loom-sensor.log" ) &
disown
exit 0
EOF
chmod +x ~/.claude/hooks/loom-sensor.sh
```

- [ ] **Step 6.2: Create `loom-router.sh` wrapper**

```bash
cat > ~/.claude/hooks/loom-router.sh <<'EOF'
#!/usr/bin/env bash
# Loom router — PreToolUse on Agent + Bash.
# Synchronous (PreToolUse hooks must complete before the tool fires).
# The wrapper enforces a hard 2-second timeout via `timeout` so a
# stuck router never blocks the dispatch.

# Opt-out: set LOOM_DISABLE=1 to skip.
if [ "$LOOM_DISABLE" = "1" ]; then
  exit 0
fi

LOOM_TSX="${LOOM_TSX:-/Users/acamp/repos/ForgeFrame-loom/packages/server/src/loom/router.ts}"
LOG="$HOME/.creature/logs/loom-router-errors.log"
mkdir -p "$(dirname "$LOG")"

# Use gtimeout if available (macOS via brew coreutils), else fall back.
TIMEOUT_BIN=""
command -v gtimeout >/dev/null 2>&1 && TIMEOUT_BIN="gtimeout"
[ -z "$TIMEOUT_BIN" ] && command -v timeout >/dev/null 2>&1 && TIMEOUT_BIN="timeout"

if [ -n "$TIMEOUT_BIN" ]; then
  $TIMEOUT_BIN 2 npx --yes tsx "$LOOM_TSX" 2>>"$LOG"
  RC=$?
else
  npx --yes tsx "$LOOM_TSX" 2>>"$LOG"
  RC=$?
fi

# Any non-zero exit (timeout, crash) → pass through silently.
if [ $RC -ne 0 ]; then
  echo "[loom-router] exit=$RC — passing through" >>"$LOG"
  exit 0
fi
exit 0
EOF
chmod +x ~/.claude/hooks/loom-router.sh
```

- [ ] **Step 6.3: Back up settings.json**

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak.$(date +%Y%m%d-%H%M%S)
```

Verify the backup exists:

```bash
ls -la ~/.claude/settings.json.bak.* | tail -1
```

- [ ] **Step 6.4: Add the two Loom hooks to settings.json**

The current file has a single `PostToolUse` entry with matcher `""` (matches all). Loom needs `PostToolUse` with matcher `"Agent|Bash"`. Multiple hook entries per event are supported.

Use a Node script to merge safely (preserves all other settings, idempotent if hook already present):

```bash
node <<'NODE'
const fs = require('fs');
const path = require('path');
const file = path.join(process.env.HOME, '.claude', 'settings.json');
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));

cfg.hooks = cfg.hooks || {};
const ensureMatcher = (eventName, matcher, command, async = false) => {
  cfg.hooks[eventName] = cfg.hooks[eventName] || [];
  const arr = cfg.hooks[eventName];
  // Remove any prior loom entry for this matcher to keep this idempotent.
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i];
    if (e.matcher === matcher && Array.isArray(e.hooks) && e.hooks.some((h) => (h.command || '').includes('loom-'))) {
      arr.splice(i, 1);
    }
  }
  const entry = { matcher, hooks: [{ type: 'command', command, ...(async ? { async: true } : {}) }] };
  arr.push(entry);
};

ensureMatcher('PostToolUse', 'Agent|Bash', '/Users/acamp/.claude/hooks/loom-sensor.sh', true);
ensureMatcher('PreToolUse', 'Agent|Bash', '/Users/acamp/.claude/hooks/loom-router.sh', false);

fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
console.log('settings.json updated. Loom hooks registered.');
NODE
```

Verify:

```bash
node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(process.env.HOME + '/.claude/settings.json','utf8')).hooks, null, 2))"
```

Expected: `PostToolUse` array contains a `loom-sensor.sh` entry with matcher `Agent|Bash`; `PreToolUse` array contains a `loom-router.sh` entry with matcher `Agent|Bash`. The pre-existing `forge-sliding-title.sh` entry is still present.

- [ ] **Step 6.5: Smoke-test the wrappers manually**

```bash
mkdir -p ~/.creature/logs
echo '{"tool_name":"Agent","tool_input":{"subagent_type":"Explore","description":"smoke test"},"cwd":"/Users/acamp/repos/ForgeFrame-loom","session_id":"smoke"}' \
  | ~/.claude/hooks/loom-sensor.sh
sleep 2
echo '{"tool_name":"Bash","tool_input":{"command":"ls"},"cwd":"/Users/acamp/repos/ForgeFrame-loom"}' \
  | ~/.claude/hooks/loom-router.sh
```

Expected: sensor exits 0 immediately. Router exits 0 with empty stdout (cold-start case). Check that a `dispatch:*` row appeared:

```bash
node -e "
const { MemoryStore } = require('/Users/acamp/repos/ForgeFrame-loom/packages/memory/dist/index.js');
const s = new MemoryStore({ dbPath: process.env.HOME + '/.forgeframe/memory.db' });
console.log(JSON.stringify(s.listByTag('dispatch', 3).map(m => ({id: m.id, tags: m.tags, created: m.createdAt})), null, 2));
s.close();
"
```

Expected: at least one `dispatch:*` row with the smoke-test payload visible.

- [ ] **Step 6.6: Add the README cold-start section**

Append to `~/repos/ForgeFrame-loom/README.md`:

```markdown
## Loom — meta-organ for dispatch governance

Loom is the substrate's proprioception over its own dispatches. Every Agent and Bash tool call from a Claude Code session is observed by a sensor hook that writes a `dispatch:*` memory row. A reflector (run via `forgeframe loom reflect` or NREM dream cycle) clusters these into `routing-principle:proposed` rows for founder review. Approved principles drive a router hook that can pass-through, allow, or deny future dispatches.

### Cold-start protocol — 7-day pass-through

The router runs in **observe-only mode for the first 7 days** after the sensor first fires. During this window:

- the sensor writes dispatches with the `dispatch:cold-start` tag for audit,
- the router never blocks or auto-approves anything regardless of which policies exist,
- the reflector still runs so founder gets a backlog of proposals ready for review on day 8.

If you see "router pass-through" behavior in the first week, that's intentional. Check status:

```
forgeframe loom status
```

After 7 days, the router arms automatically and starts honoring approved `routing-principle:approved` rows.

### Disabling Loom for a session

Set `LOOM_DISABLE=1` in your shell environment before starting Claude Code. Both hook wrappers exit early on this flag.

### Hook locations

- `~/.claude/hooks/loom-sensor.sh` — PostToolUse (`Agent|Bash`, async)
- `~/.claude/hooks/loom-router.sh` — PreToolUse (`Agent|Bash`, sync, 2s hard timeout)

### CLI

- `forgeframe loom status` — show cold-start state and remaining window
- `forgeframe loom reflect [--min-cluster-size N]` — run the clustering pass
- `forgeframe loom proposals [--limit N]` — list pending `routing-principle:proposed` rows
```

- [ ] **Step 6.7: Commit code-side changes**

```bash
cd ~/repos/ForgeFrame-loom
git add README.md
git commit -m "loom: README — cold-start protocol + hook locations + CLI usage"
```

Hook scripts and `~/.claude/settings.json` live outside the worktree and are not committed here. They are part of the user's global Claude Code config and are managed separately.

---

## Self-review

After completing all six tasks, walk through this checklist:

- [ ] **Spec coverage check** — open `docs/superpowers/specs/2026-04-25-loom-design.md`. For each section ("In scope (v1)" especially), confirm a task delivered it:
  - 4 source files (sensor / router / reflector / policy) ✓ Tasks 2, 3, 4
  - cold-start.ts + organ index/barrel ✓ Tasks 1, 5
  - 2 hooks registered ✓ Task 6
  - 2 hook wrapper scripts ✓ Task 6
  - Memory schema additions (tag conventions) ✓ Tasks 2, 4 (via constants in code)
  - 7-day cold-start with state file ✓ Task 1
  - TTL on `dispatch:*` 30d ✓ achieved via existing decay engine + lookback window in reflector (no DB change needed)
  - `routing-principle:*` persists ✓ via the `principle` tag on approved rows (constitutional convention in `MemoryStore.create()`)
  - CLI subcommands ✓ Task 5
  - Tests including latency benchmark + cache invariance ✓ Tasks 1-4 (note: full prompt-cache invariance test deferred — see open question below)
  - README cold-start docs ✓ Task 6

- [ ] **Placeholder scan** — search the plan for `TBD`, `TODO`, `implement later`, `add appropriate`, `similar to`. None should remain.

- [ ] **Type consistency** — confirm `RouterAction`, `Policy`, `DispatchRecord` field names match across all files (types.ts, sensor.ts, policy.ts, router.ts, reflector.ts).

- [ ] **Stop signal check** — run a final smoke pass to confirm sensor latency stays under 50ms (latency budget per spec):

```bash
time (echo '{"tool_name":"Bash","tool_input":{"command":"ls"},"cwd":"/Users/acamp/repos/ForgeFrame-loom"}' \
  | ~/.claude/hooks/loom-sensor.sh)
```

Expected: real time ≤ 50ms (the wrapper backgrounds the work).

- [ ] **Final full test run + push**

```bash
cd ~/repos/ForgeFrame-loom
npm test --workspace=@forgeframe/server
git push -u origin feat/loom-organ
```

Expected: all tests green, branch pushed.

---

## Known follow-ups (out of v1 scope, recorded for future work)

These are deliberately deferred — do not extend v1 scope to address them. Tracked here so the next session can pick them up.

1. **Prompt-cache invariance unit test (A7 from meeting)** — current router does not mutate `tool_input`, only blocks/allows. The cache-invariance concern (mutations changing cache keys) is moot until v1.1 introduces actual mutation via `additionalContext` injection. Deferred to v1.1.
2. **Wire reflector into NREM dream phase** — v1 uses CLI/cron only. v1.1 adds `runLoomReflectionPhase()` invoked by `dream-schedule.ts`.
3. **Tool-input mutation via `additionalContext`** — Claude Code PreToolUse hooks can inject context but cannot directly rewrite `tool_input`. v1.1 adds an `action: 'mutate'` path that emits `additionalContext` advising the founder/agent to retry with adjusted parameters.
4. **`dispatch:*` PII scrubbing** — v1 ships `input_summary` truncated to 200 chars but not regex-scrubbed. Reuse `scrub.ts` patterns in v1.0.5.
5. **Cockpit review queue UI** — v1 surfaces proposals via `forgeframe loom proposals` CLI only. Cockpit visual surface lands as part of CREATURE OS Wave 4.
6. **F5 prebuild_check tier as Layer-4 router stage** — sketch lives at `PREBUILD_CHECK_SKETCH.md`. Implementation deferred until v1 has telemetry showing whether founder is being blindsided by missing context.
7. **Fork-subagents env var** — `CLAUDE_CODE_ENABLE_FORK_SUBAGENT=1` deliberately not set in this plan. Founder enables it manually after Loom has 7+ days of telemetry confirming the sensor is stable. Adding it before that defeats the "controlled experiment" framing of decision D7.

---

## Execution handoff

Plan complete. Two execution options:

**1. Subagent-Driven (recommended for this sprint)** — fresh subagent per task, two-stage review between tasks, fast iteration. Matches the way Streams B/D have been working tonight.

**2. Inline Execution** — execute tasks in this session via `superpowers:executing-plans`, batch checkpoints for review. Lower setup overhead but heavier on this session's context window.

Default for Stream A per brief: Subagent-Driven.
