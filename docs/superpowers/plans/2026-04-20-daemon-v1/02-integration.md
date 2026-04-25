# Daemon-v1 — Integration Points Map

**Status:** READ-ONLY exploration. Factual mapping of integration hooks into existing ForgeFrame, Distillery, Guardian, and voice-widget codebase.

**Written:** 2026-04-20  
**Based on code read:** ForgeFrame server/memory/events, Distillery worker, Guardian, voice-widget, launchd config patterns.

---

## Section 1: Where the Daemon Lives

**File locations for Daemon-v1:**

- **Main entry point:** `/Users/acamp/repos/ForgeFrame/packages/server/src/daemon-v1.ts`
  - Will differ from current `daemon.ts` (which only manages HTTP server lifecycle). Daemon-v1 is the orchestrator loop.
  - Imports existing `daemon.ts` utilities (`pidPath`, `portPath`, `isDaemonRunning`).
  
- **Orchestrator heartbeat + tick loop:** `/Users/acamp/repos/ForgeFrame/packages/server/src/orchestrator.ts` (new)
  - ~200–300 lines. Wraps the polling loop that Vision Phase 2 Task 2.1 requires.
  - Calls into `trigger-executor.ts`, sleep-pressure scanner, Guardian gater.

- **Trigger executor:** `/Users/acamp/repos/ForgeFrame/packages/server/src/trigger-executor.ts` (new)
  - Reuses existing `TriggerManager` from `triggers.ts` (already reads from `~/.forgeframe/triggers.json`).
  - Executes cron-scheduled dream cycles and external task hooks.

- **State roadmap:** `/Users/acamp/repos/ForgeFrame/packages/server/src/roadmap.ts` (new)
  - Implements the `memory_roadmap` MCP tool (Phase 3 Task 3.3).
  - Buckets memories: `active` (recent, high-strength), `pending` (queued for action), `entrenched` (deep structure), `drifting` (decaying).

- **Daemon launchd plist:** `/Users/acamp/Library/LaunchAgents/com.forgeframe.daemon-v1.plist` (new)
  - Alongside existing `com.distillery.server`, `com.distillery.worker`, `com.forgeframe.voice-widget`.
  - Pattern: Python `worker.py` uses `POLL_INTERVAL` (seconds) + signal handlers; Node.js `daemon-v1.ts` will follow same shape — event loop with graceful SIGTERM/SIGINT.

---

## Section 2: API Surface Changes Needed on ForgeFrame :3001

### 2.1 New HTTP Routes

**Dream trigger (already exists, refactor for daemon consumption):**
- `POST /api/dream/trigger` — currently manual. Daemon will call this on heartbeat if sleep pressure crosses threshold.
- Daemon watches `POST /api/dream/settings` for tuning (`nremOnly`, `nremThreshold`, `remThreshold`, `suppressDreaming`).

**Hermes cycle endpoint (already exists, stub):**
- `POST /api/hermes/cycle` — currently returns `{ triggered: true }`. Will need wiring to external orchestrator.
- `GET /api/hermes/status` — daemon reads to determine if cycle is suppressed.

**New daemon status endpoints:**
- `GET /api/daemon/heartbeat` — returns `{ tick: number, uptime: seconds, sleepPressure: number, guardianTemp: value, nextWakeMs: number }`.
  - Exists on HTTP server so Feed Tab can poll or listen via SSE.
  
- `GET /api/daemon/health` — returns `{ running: true, pid: number, port: number, triggers: number, nextTrigger: { id, scheduledAt } }`.

### 2.2 New SSE Event Types

Extend `ServerEventMap` in `/Users/acamp/repos/ForgeFrame/packages/server/src/events.ts`:

```typescript
'daemon:heartbeat': [{ tick: number; uptime: number; pressure: number }];
'daemon:tick': [{ trigger?: string; phase?: string }];
'dream:cycle:auto-triggered': [{ reason: 'sleep-pressure' | 'schedule' }];
'hermes:dispatch': [{ taskId: string; model: string }];
```

These fire **without blocking** the HTTP server. Feed Tab listens on `/api/events` (existing SSE stream) for real-time heartbeat visibility.

### 2.3 New MCP Tools

Add to `/Users/acamp/repos/ForgeFrame/packages/server/src/tools.ts`:

- **`memory_roadmap`** (Phase 3 Task 3.3)
  - Input: `{ limit?: number }` (default 50 per bucket)
  - Output: `{ active: Memory[], pending: Memory[], entrenched: Memory[], drifting: Memory[] }`
  - Implementation: calls `Roadmap.bucket(store, limit)` from new `roadmap.ts`.

- **`session_start`** (Phase 3 Task 3.2)
  - Input: none (implicitly uses current session)
  - Output: `{ me: Memory | null; entrenched: Memory[]; active: Memory[]; timestamp: number }`
  - Implementation: returns `me:state` memory if it exists; hydrates from `memory_roadmap` buckets.

- **`memory_analogy`** (Phase 4 Week 4, HDC-backed)
  - Input: `{ memoryId: string; analogue_count?: number }`
  - Output: `{ original: Memory; analogues: { memory: Memory; distance: number }[] }`
  - Implementation: calls HDC sidecar at `:3458/encode` (Phase 7 Task 7.1), falls back to semantic search if HDC unavailable.

---

## Section 3: What Already Exists That the Daemon Can Reuse

### 3.1 Daemon Lifecycle Management

**File:** `/Users/acamp/repos/ForgeFrame/packages/server/src/daemon.ts` (lines 18–66)
- `pidPath()`, `portPath()` — standard file paths.
- `isDaemonRunning()` — PID existence check + signal test. Reusable.
- `stopDaemon()` — SIGTERM + cleanup. Reusable.

### 3.2 Event Emitter + Trigger System

**File:** `/Users/acamp/repos/ForgeFrame/packages/server/src/events.ts`
- `ServerEvents extends EventEmitter<ServerEventMap>` — already in use by HTTP server.
- Add new daemon event types here; they automatically flow to SSE `/api/events`.

**File:** `/Users/acamp/repos/ForgeFrame/packages/server/src/triggers.ts` (lines 18–80)
- `CronTrigger`, `WatchTrigger`, `TriggerManager` — already implemented.
- Triggers persist to `~/.forgeframe/triggers.json`.
- Daemon reads this on startup: `triggers.list()` and filters by enabled=true.

### 3.3 Sleep Pressure + NREM/REM Orchestration

**File:** `/Users/acamp/repos/ForgeFrame/packages/memory/src/dream-nrem.ts` (lines 46–123)
- `NremPhase.run()` — already orchestrates: LTD maintenance, decay, cluster scan, emotional triage, valence backfill.
- Called by HTTP endpoint `POST /api/dream/trigger` (line 270 in http.ts).
- Daemon reuses this unchanged.

**File:** `/Users/acamp/repos/ForgeFrame/packages/memory/src/dream-rem.ts` (implicit, inferred from http.ts)
- `RemPhase.run()` — orchestrates REM phase after NREM if pressure >= remThreshold.

**File:** `/Users/acamp/repos/ForgeFrame/packages/memory/src/guardian.ts` (lines 4–47)
- `GuardianComputer.compute(signals)` — takes `GuardianSignals`, returns `{ value, state, signals }`.
- State thresholds: `value < 0.3 → 'calm'`, `0.3–0.6 → 'warm'`, `>= 0.6 → 'trapped'`.
- `GuardianComputer.hebbianMultiplier(state)` — returns `1.0` (calm), `0.5` (warm), `0.0` (trapped).
- Daemon gates dream cycles: if `state === 'trapped'`, suppress NREM/REM.

### 3.4 Memory Store Interface

**File:** `/Users/acamp/repos/ForgeFrame/packages/memory/src/store.ts` (interface imported in http.ts)
- `store.count()`, `store.orphanCount()`, `store.recentDecayCount()` — used by `buildGuardianSignals()` (http.ts line 712).
- `store.getRecent(limit)` — returns N memories for roadmap bucketing.
- `store.listByTag(tag, limit)` — filters by source, valence, custom tags.
- `store.search(query, limit)` — semantic search.

### 3.5 Voice Widget Integration (Signal Layer)

**File:** `/Users/acamp/repos/voice-widget/VoiceWidget.swift` (lines 1–150 read)
- Transcribes audio locally via Whisper CLI.
- **No direct ForgeFrame HTTP hook visible in code read.** But launchd plist exists: `/Users/acamp/Library/LaunchAgents/com.forgeframe.voice-widget.plist` (lines 6–16).
- **Inference:** Voice widget must push transcriptions somewhere. Either:
  - Direct HTTP `POST http://localhost:3001/api/memories` with tags `['source:voice-widget']`.
  - Or writes to Distillery queue and Distillery worker pushes to ForgeFrame.
  - Daemon should listen for SSE `'memory:created'` events with tag `source:voice-widget` to react in real-time.

---

## Section 4: What Doesn't Exist and Must Be Built

### 4.1 Orchestrator Loop

**File to create:** `/Users/acamp/repos/ForgeFrame/packages/server/src/orchestrator.ts`

**Responsibilities:**
1. Poll sleep pressure every `tickIntervalMs` (configurable: 1s or 5s, per Vision Phase 2 Section 4 decision).
2. Check Guardian temperature every tick.
3. Fire SSE `daemon:heartbeat` event.
4. On pressure crossing threshold, call `POST /api/dream/trigger` (reuses existing endpoint).
5. Check `TriggerManager.nextDue()` and execute if ready.
6. Gracefully handle daemon shutdown on signal.

**Pseudocode shape (reference: distillery worker.py lines 356–388):**

```typescript
async function orchestratorLoop(store, events, http, triggers) {
  let tick = 0;
  while (!shutdownRequested) {
    const pressure = computeSleepPressure(store);
    const guardianTemp = guardian.compute(buildGuardianSignals(store));
    
    events.emit('daemon:heartbeat', { tick, uptime: process.uptime(), pressure: pressure.score });
    
    if (guardianTemp.state !== 'trapped' && pressure.recommendation !== 'sleep') {
      // Auto-trigger dream
      await http.post('/api/dream/trigger', {});
      events.emit('dream:cycle:auto-triggered', { reason: 'sleep-pressure' });
    }
    
    const due = triggers.nextDue();
    if (due) {
      await executeTrigger(due);
    }
    
    tick++;
    await sleep(tickIntervalMs);
  }
}
```

### 4.2 State Roadmap Tool

**File to create:** `/Users/acamp/repos/ForgeFrame/packages/server/src/roadmap.ts`

**Responsibilities:**
- Partition memories into 4 buckets using heuristics:
  - `active`: created in last N days, strength > 0.6.
  - `pending`: tagged with action markers, not yet marked `shipped`.
  - `entrenched`: high edge count, high average edge weight (structure memories).
  - `drifting`: strength < 0.3, low access rate, age > 30 days.

**No external library needed.** Uses existing `store` methods:
- `store.getRecent(limit)` — get newest.
- `store.getEdges(memoryId)` — edge count + weights.
- `store.listByTag(tag, limit)` — filter by action/shipped tags.

### 4.3 `me:state` Primitive (Phase 3 Task 3.1)

**Not a code file; a memory convention.**

When `session_start` is called:
1. Search for memory with tag `me:state`.
2. If found, deserialize its `content` as JSON: `{ "currentProject": "...", "lastAction": "...", "nextGoal": "..." }`.
3. Return it in `session_start` tool response.
4. Daemon can call `memory_save` with tag `me:state` to persist state updates.

This is **pure application convention** — no new primitives in `MemoryStore` needed.

### 4.4 Trigger Executor

**File to create:** `/Users/acamp/repos/ForgeFrame/packages/server/src/trigger-executor.ts`

**Responsibilities:**
- Wraps `TriggerManager.list()` and `TriggerManager.nextDue()`.
- On each due trigger, executes the `task` (string = shell command or MCP tool name).
- Logs execution and updates `lastRun` timestamp.
- Handles errors gracefully (emit event, continue).

### 4.5 launchd Plist for Daemon-v1

**File to create:** `/Users/acamp/Library/LaunchAgents/com.forgeframe.daemon-v1.plist`

**Pattern (copied from `/Users/acamp/Library/LaunchAgents/com.distillery.worker.plist`):**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.forgeframe.daemon-v1</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/node</string>
        <string>/path/to/dist/daemon-v1.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/acamp/repos/ForgeFrame</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/acamp/.forgeframe/daemon-v1.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/acamp/.forgeframe/daemon-v1.log</string>
</dict>
</plist>
```

---

## Section 5: Route Table — Vision Phase 2 → Daemon-v1

**Daemon-v1 extends Phase 2 output.** What Phase 2 builds vs. what daemon adds:

### Vision Phase 2 Tasks (from sprint plan)

| Task | Deliverable | Code Location |
|------|-------------|---|
| 2.1: Orchestrator skeleton + heartbeat | Poll loop, SSE `daemon:heartbeat` | NEW: `orchestrator.ts` |
| 2.2: NREM/REM schedule | Guardian gate + sleep pressure threshold | REUSE: `http.ts` line 270, `guardian.ts` |
| 2.3: Triggers armed at startup | Load from `~/.forgeframe/triggers.json` | REUSE: `triggers.ts` + NEW: `trigger-executor.ts` |
| 3.1: `me:state` primitive | Memory convention (tag + JSON content) | Convention only |
| 3.2: `session_start` hydration | MCP tool returning `{ me, entrenched, active }` | NEW: add to `tools.ts` |
| 3.3: `memory_roadmap` tool | MCP tool with 4 buckets | NEW: `roadmap.ts` + add to `tools.ts` |
| 3.4: Expanded `memory_search` neighbors | Extend search results with edge context | MODIFY: `tools.ts` existing `memory_search` |

### Daemon-v1 Adds On Top

- **Persistent loop:** Orchestrator runs continuously on daemon, not one-shot.
- **Auto-trigger logic:** Dream cycles fire based on sleep pressure without manual API call.
- **Event emission:** All daemon ticks emit SSE events for UI consumption.
- **Trigger execution:** Cron-scheduled tasks run in band with dream cycles.
- **Graceful shutdown:** Signal handlers, cleanup on `com.forgeframe.daemon-v1` `launchctl stop`.

### No Duplication Risk

Phase 2 tasks create the **primitives** (tools, endpoints, events).  
Daemon-v1 creates the **loop** that consumes them continuously.

If Phase 2 lands by Week 2 EOD (per sprint plan), Daemon-v1 implementation:
- Imports Phase 2 MCP tools from `tools.ts` (already registered).
- Imports Phase 2 events from `events.ts` (already extended).
- Reuses Phase 2 HTTP endpoints without modification.
- Wraps everything in the `orchestrator.ts` loop.

---

## Section 6: Integration Checklist

### HTTP Server (:3001) Changes

- [ ] Add `GET /api/daemon/heartbeat` → returns `{ tick, uptime, pressure, temp, nextWakeMs }`
- [ ] Add `GET /api/daemon/health` → returns `{ running, pid, port, triggerCount }`
- [ ] Extend `ServerEventMap` with daemon events: `daemon:heartbeat`, `daemon:tick`, `dream:cycle:auto-triggered`
- [ ] Ensure `/api/dream/trigger` remains callable by daemon (already exists)

### MCP Tools (:3001)

- [ ] Add `memory_roadmap` tool (calls `roadmap.ts`)
- [ ] Add `session_start` tool (queries for `me:state` memory, hydrates from roadmap)
- [ ] Extend existing `memory_search` to include `neighbors` + `validity` fields
- [ ] Add `memory_analogy` tool (stubs HDC, falls back to semantic search)

### Memory Package

- [ ] No changes to `MemoryStore` interface (roadmap bucketing uses existing methods)
- [ ] No changes to Guardian (already has `compute()` and `hebbianMultiplier()`)
- [ ] No changes to NREM/REM (already orchestrated by http.ts)

### Server Package

- [ ] Create `/Users/acamp/repos/ForgeFrame/packages/server/src/orchestrator.ts`
- [ ] Create `/Users/acamp/repos/ForgeFrame/packages/server/src/roadmap.ts`
- [ ] Create `/Users/acamp/repos/ForgeFrame/packages/server/src/trigger-executor.ts`
- [ ] Extend `/Users/acamp/repos/ForgeFrame/packages/server/src/tools.ts` with `memory_roadmap`, `session_start`, `memory_analogy`
- [ ] Extend `/Users/acamp/repos/ForgeFrame/packages/server/src/events.ts` with daemon event types
- [ ] Create new entry point: `/Users/acamp/repos/ForgeFrame/packages/server/src/daemon-v1.ts`

### launchd

- [ ] Create `/Users/acamp/Library/LaunchAgents/com.forgeframe.daemon-v1.plist`
- [ ] Test: `launchctl load` and verify `com.forgeframe.daemon-v1` appears in `launchctl list`

### Configuration

- [ ] Daemon tick interval (1s or 5s) — settable via env or config file
- [ ] Guardian trap gate — settable via `PUT /api/guardian/override` (already exists)
- [ ] Dream threshold tuning — via `PUT /api/dream/settings` (already exists)

---

## Section 7: Dependency Graph

```
Voice Widget (transcribes)
        ↓
     ┌──────────────────────────────────────┐
     ↓                                       ↓
ForgeFrame HTTP (:3001)          Distillery Worker (optional)
     ├─ POST /api/memories                  ↓
     ├─ SSE /api/events          ForgeFrame HTTP (writeback)
     └─ MCP tools (stdio)
        ├─ memory_save
        ├─ memory_search
        ├─ memory_roadmap (NEW)
        ├─ session_start (NEW)
        └─ memory_analogy (NEW)
            ↑
     ┌──────┴──────────┬──────────┬──────────┐
     ↓                 ↓          ↓          ↓
Daemon-v1        Guardian    Triggers   NREM/REM
(orchestrator)   (gate)      (executor) (existing)
     ├─ Heartbeat tick
     ├─ Sleep pressure poll
     ├─ Dream auto-trigger
     └─ Feed Tab SSE events

HDC Sidecar (:3458, Phase 7)
     ↓
memory_analogy tool (calls /encode)
```

---

## Section 8: Code Metrics & Scope

**New lines of code (LOC):**

- `orchestrator.ts` — ~250 LOC (polling loop, event emission, trigger check)
- `roadmap.ts` — ~150 LOC (memory bucketing logic)
- `trigger-executor.ts` — ~100 LOC (cron execution wrapper)
- `daemon-v1.ts` — ~150 LOC (entry point, lifecycle, log output)
- Tool extensions in `tools.ts` — ~200 LOC (3 new tools + 1 extended)
- Event types in `events.ts` — ~20 LOC (4 new event signatures)
- Test files — ~500 LOC (unit tests for each module)

**Total new code: ~1400 LOC (tests included).**

**No existing code deletion.** Current `daemon.ts` (HTTP server lifecycle) becomes a reusable utility imported by `daemon-v1.ts`.

---

## Section 9: Acceptance Criteria vs. Code

**Vision Phase 2 Week 2 EOD (2026-05-01):**
- `heartbeat` row visible every tick in Feed Tab (Listen to SSE `daemon:heartbeat` events)
- `dream_cycle` events fire when pressure builds (Triggered by `orchestrator.ts`, emitted as `dream:cycle:auto-triggered`)
- Triggers armed on daemon startup (Log line: `[triggers] armed N triggers` from `trigger-executor.ts`)
- `session_start` returns `{ me, entrenched, active }` (New tool in `tools.ts`)
- `memory_roadmap` returns 4 buckets (New tool, calls `roadmap.ts`)
- `memory_search` returns `neighbors` + `validity` (Extended in `tools.ts`)

**All testable via HTTP calls or SSE subscription.**

---

**End integration map.**
