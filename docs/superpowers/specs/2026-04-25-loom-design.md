# Loom — Meta-Organ for Claude Code Dispatch Governance

**Date:** 2026-04-25
**Status:** Spec. Pre-execution. Authored from `~/.claude/personas/notepad/2026-04-25-loom-organ-design.md` (D1-D10 locked) and the F5 prebuild_check sketch at `~/repos/ForgeFrame-loom/PREBUILD_CHECK_SKETCH.md`.
**Branch:** `feat/loom-organ` (worktree `~/repos/ForgeFrame-loom`)

---

## Thesis

The substrate has eyes on the world (Distillery), eyes on itself (Hebbian), eyes on the founder (Cockpit feed) — but no eyes on its own *act of thinking*. **Loom is the missing sensory loop: proprioception over its own cognition.**

Loom watches every Claude Code dispatch (Agent + Bash tool calls), writes them as `dispatch:*` memories, lets the dream cycle cluster them into `routing-principle:*` proposals, and surfaces those proposals via the Cockpit review queue for founder approval. Once approved, the router uses them to mutate or pass through future dispatches.

**We don't ship a routing policy. The creature derives one from watching itself dispatch.**

---

## CREATURE class: meta-organ (D2)

Loom is the prototype of a new CREATURE class: **meta-organs**.

| Class | What it does | Examples |
|------|--------------|----------|
| **Engine** | Substrate primitives | ForgeFrame memory, Hebbian, dream-schedule, sovereignty |
| **Sense** | Eyes on the world | Distillery |
| **Body** | Founder interface | Cockpit, CREATURE OS shell |
| **Domain organ** | Does work in the world | Reframed, Cipher, dad-watch, Resume Tailor |
| **Meta-organ** ← *new* | Observes / shapes substrate behavior itself | **Loom**, future Hermes layer, future budget enforcer |

Meta-organs own dedicated memory namespaces and have read-write access to the dispatch path. Domain organs do not.

---

## Three-layer architecture (D3)

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Claude Code session                                           │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  user prompt → tool call (Agent / Bash)                 │   │
│   └────────────────────────┬────────────────────────────────┘   │
│                            │                                    │
│                  ┌─────────┴─────────┐                          │
│                  │                   │                          │
│            PreToolUse         PostToolUse                       │
│            (matcher: Agent|Bash)  (matcher: Agent|Bash)         │
│                  │                   │                          │
│                  ▼                   ▼                          │
│   ┌────────────────────┐   ┌─────────────────────────┐          │
│   │  ROUTER (sync)     │   │  SENSOR (async)         │          │
│   │  policy.match()    │   │  write dispatch:*       │          │
│   │  → pass / mutate   │   │  memory row, fire-and-  │          │
│   │  → block / cold    │   │  forget                 │          │
│   │  budget ≤ 50ms     │   │  budget ≤ 50ms (async)  │          │
│   └────────────────────┘   └─────────────────────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                                            │
                                            ▼
                              ┌────────────────────────────┐
                              │  ForgeFrame memory         │
                              │  dispatch:*  (TTL 30d)     │
                              └─────────────┬──────────────┘
                                            │
                                            ▼
                              ┌────────────────────────────┐
                              │  REFLECTOR                 │
                              │  invoked by NREM dream     │
                              │  cycle (or CLI)            │
                              │  cluster → propose →       │
                              │  routing-principle:        │
                              │  proposed                  │
                              └─────────────┬──────────────┘
                                            │
                                            ▼ surfaced in Cockpit
                              ┌────────────────────────────┐
                              │  Founder review (Cmd+      │
                              │  Shift+R) approves /       │
                              │  rejects / modifies        │
                              │  → routing-principle:      │
                              │  approved (no decay)       │
                              └────────────────────────────┘
```

### Sensor — `PostToolUse` hook

Fires after every Agent or Bash tool call. Reads JSON from stdin (Claude Code hook payload), extracts dispatch fields, writes a `dispatch:*` memory row directly to SQLite (no MCP roundtrip — this is a hot path). Async — never blocks the next tool call.

### Router — `PreToolUse` hook

Fires before every Agent or Bash tool call. Reads JSON from stdin, looks up matching policy via `policy.match()`, returns one of:
- **Pass-through** — emit no decision, tool fires unchanged
- **Mutate** — emit modified `tool_input` JSON, Claude Code uses the mutated version
- **Block** — emit `{permissionDecision: "deny", reason: "..."}` to refuse the dispatch
- **Cold-start** — observe-only, always pass-through, write `dispatch:cold-start` tag for audit

Synchronous. Latency budget: **50ms p95**. Single SQLite query for policy lookup; no graph traversal.

### Reflector — dream-job cluster analysis

Invoked by:
- `forgeframe loom reflect` CLI (manual / cron)
- *(v1.1)* NREM dream phase — wired into `dream-schedule.ts`

Reads recent `dispatch:*` memories, clusters via Hebbian neighbors + tag co-occurrence, proposes routing principles as `routing-principle:proposed` memories. Each proposal links back to the source dispatches via `memory_link` for explainability.

Blindspot monitor (D6) falls out of the same cluster analysis: clusters with high entropy or unexpected gaps emit `blindspot-alert:*` memories.

---

## Boundary discipline — what Loom does NOT own

| Layer | Owner | Not Loom because |
|------|-------|------------------|
| Worktree dispatcher | Daemon-α | Loom observes; Daemon-α spawns |
| Trust gate (AUTO/ASK/NEVER) | Daemon-β | Loom can recommend; Daemon-β decides |
| Review queue UI | Cockpit (Cmd+Shift+R) | Loom proposes; Cockpit surfaces |
| Budget enforcer | Guardian | Loom logs cost; Guardian caps |
| Memory engine | `@forgeframe/memory` | Loom is a consumer |
| Dream scheduler | `@forgeframe/memory` dream-schedule.ts | Loom hooks in as a phase |

**Loom owns:** sensor hooks, router policy lookup, reflector dream-job, the `dispatch:*` and `routing-principle:*` namespaces.

---

## Memory schema

### `dispatch:*` (TTL 30d, D9)

One row per Agent or Bash dispatch. Body is JSON, tags carry searchable facets.

**Body shape:**
```json
{
  "tool": "Agent" | "Bash",
  "input_summary": "Explore agent: investigate auth middleware",
  "subagent_type": "Explore",                  // for Agent only
  "command_head": "git status",                // for Bash only (first 3 tokens)
  "started_at": 1745619012345,
  "completed_at": 1745619013120,
  "duration_ms": 775,
  "session_id": "01HXYZ...",
  "parent_dispatch": null,                     // if nested
  "exit_status": "success" | "error" | "denied",
  "router_action": "pass" | "mutate" | "block" | "cold-start"
}
```

**Tags (canonicalized per consolidation list):**
- `dispatch` — root tag
- `dispatch:tool:agent` or `dispatch:tool:bash`
- `dispatch:agent:<subagent_type_lowercased>` (e.g. `dispatch:agent:explore`, `dispatch:agent:plan`)
- `project:<canonical-name>` (e.g. `project:reframed`, `project:forgeframe`, `project:loom`) — derived from cwd
- `dispatch:tier:<auto|ask|never>` (when known from caller)
- `dispatch:cold-start` (during the 7-day window)
- `dispatch:router:mutated` or `dispatch:router:blocked` (when router took action)

### `routing-principle:*` (no decay; constitutional pattern)

One row per founder-approved routing principle. Body is JSON.

**Body shape:**
```json
{
  "rule": "Explore subagent for repo surveys with thoroughness=quick → cap to 3 queries",
  "scope": {
    "tool": "Agent",
    "subagent_type": "Explore",
    "project": null,                           // null = global
    "matchers": { "thoroughness": "quick" }
  },
  "action": {
    "kind": "mutate",
    "mutate": { "field": "max_queries", "value": 3 }
  },
  "derived_from_count": 23,
  "sample_dispatch_ids": ["...", "...", "..."],
  "proposed_at": 1745619012345,
  "approved_at": 1745619099999,
  "approved_by": "founder"
}
```

**Tags:**
- `routing-principle` — root tag
- `principle` — constitutional, no decay (per existing convention)
- `routing-principle:proposed` (awaiting founder review)
- `routing-principle:approved` (active)
- `routing-principle:rejected` (preserved for audit; not used by router)
- `project:<name>` (when scoped to a project)

### `blindspot-alert:*` (TTL 14d)

Cluster anomalies surfaced by the reflector. Body describes the anomaly; Cockpit surfaces alongside dream proposals.

---

## Cold-start protocol (D8) — 7-day pass-through

The router runs in **observe-only mode for the first 7 days** after the first sensor fire. Justification: the reflector has no signal until dispatches accumulate; mutating dispatches before any principles exist would be cargo-cult.

**Mechanism:**
- State file: `~/.forgeframe/loom-state.json`
- Schema: `{ "first_fire_at": 1745619012345, "router_armed_at": 1746223812345 }`
- Sensor writes `first_fire_at` on first invocation if absent
- Router reads state file each invocation:
  - If `now - first_fire_at < 7d` → log decision but always pass through; tag dispatch with `dispatch:cold-start`
  - Else → router uses policy normally

**Founder visibility:**
- README.md documents the 7-day window
- Cockpit Loom panel shows `cold-start: 5d 2h remaining`
- After arm, a one-time notification fires: *"Loom router armed — N principles ready"*

---

## Hook registration in `~/.claude/settings.json`

Single global hook block. Project-scoped behavior comes from memory tags + policy lookup, not from per-project hook duplication (D4).

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Agent|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/acamp/.claude/hooks/loom-sensor.sh",
            "async": true
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Agent|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/acamp/.claude/hooks/loom-router.sh"
          }
        ]
      }
    ]
  }
}
```

**Existing PostToolUse hook** (`forge-sliding-title.sh`) is preserved — Claude Code supports multiple hooks per matcher; both fire.

**Fork-subagents env var (D7):** `CLAUDE_CODE_ENABLE_FORK_SUBAGENT=1` is added to the user's shell profile alongside Loom shipping. Loom's existence makes this safe — forks become a controlled experiment with built-in tripwire.

---

## Package layout

New subdirectory inside the existing server package:

```
packages/server/src/loom/
├── index.ts          ← organ manifest + lifecycle adapter + barrel exports
├── sensor.ts         ← PostToolUse: write dispatch memory
├── router.ts         ← PreToolUse: policy lookup + decision JSON
├── reflector.ts      ← cluster dispatches → propose principles
├── policy.ts         ← pure: match(dispatch) → action
├── cold-start.ts     ← state file management
├── sensor.test.ts
├── router.test.ts
├── reflector.test.ts
├── policy.test.ts
└── cold-start.test.ts
```

**Hook wrappers** (in `~/.claude/hooks/`):
- `loom-sensor.sh` — pipes stdin to `npx tsx <path>/loom/sensor.ts`
- `loom-router.sh` — pipes stdin to `npx tsx <path>/loom/router.ts`, prints stdout

**CLI subcommand:**
- `forgeframe loom reflect` — invokes `reflector.ts` once
- `forgeframe loom status` — shows cold-start window remaining, dispatch count, principle count

---

## Integration points

### CREATURE OS (Stream E coupling)

Per `2026-04-25-creature-os-design.md`, CREATURE OS surfaces Loom output in:
- **Today Space** — pending `routing-principle:proposed` count + first-N preview
- **#a2a channel** — A2A messages tagged with originating dispatch ID
- **Models Space** — dispatch volume / cost dashboard derived from `dispatch:*` rows
- **Memory Space → Graph of Me** — per-organ overlay filterable by `dispatch:*`

CREATURE OS reads these via existing memory tools (`memory_search`, `memory_list_by_tag`). Loom does not need to know about CREATURE OS — the namespace contract is the integration.

### F5 prebuild_check tier (future Layer-4)

Per `PREBUILD_CHECK_SKETCH.md`, a future router tier scans 6 sources (memory / sessions / dispatch / worktrees / sprint doc / notepad) before dispatch. Returns a scored rollup; router uses the score as one input. **Out of scope for v1**; the policy interface in `policy.ts` is designed to accommodate this tier as a follow-on.

### Hermes (T1 thread)

When Hermes integration ships in Daemon-v1 (target 2026-07-24), it should plug into Loom's sensor stream. Hermes is also a meta-organ; the two share the `dispatch:*` namespace. Out of scope for v1.

---

## Performance + safety constraints (from @swe concerns)

| Constraint | Mechanism |
|------------|-----------|
| **Sensor never blocks tool dispatch** | `async: true` in hook config; sensor exits 0 immediately after spawning write |
| **Router p95 ≤ 50ms** | Single SQLite query in `policy.match()`; no graph traversal; no memory_search; no embedding |
| **Router crashes do not block tools** | Wrapper script catches non-zero exit + logs to `~/.creature/logs/loom-router-errors.log`, then exits 0 (pass-through) |
| **Memory volume bounded** | `dispatch:*` TTL 30d via existing decay engine |
| **Cache key invariance** | Router mutations change `tool_input.dispatch_type` not `prompt content`; unit test asserts cache_control hash is stable across mutations |
| **Cold-start is unfakeable** | 7-day window measured from first sensor fire (state file); skipping it requires manually editing the state file |

---

## Testing strategy

- **Unit** — `policy.test.ts` covers all match patterns + precedence; `cold-start.test.ts` covers state file lifecycle; `reflector.test.ts` covers clustering on a fixture dispatch set
- **Integration** — `sensor.test.ts` writes a fixture hook payload, asserts memory row + tags are correct; `router.test.ts` asserts decision JSON shape for pass/mutate/block/cold-start cases
- **Latency** — `router.test.ts` includes a benchmark: 1,000 router invocations against a 100-policy table must complete with p95 ≤ 50ms
- **Cache invariance (A7)** — unit test computes prompt-cache key before and after a mutation; asserts equality
- **NOT tested** — Claude Code hook execution itself (third-party); manual smoke test in `README.md` covers end-to-end

---

## Sovereignty

- All Loom data is local SQLite (`~/.forgeframe/memory.db`)
- No network calls in sensor or router hot paths
- Reflector uses local Ollama only (no frontier model in the loop)
- `dispatch:*` and `routing-principle:*` default sensitivity is `internal`; never crosses to frontier
- Sensor strips PII heuristics from `input_summary` (existing `scrub.ts` pattern in server package)

---

## In scope (v1)

- 4 source files (sensor / router / reflector / policy) + `cold-start.ts` + organ index/barrel
- 2 hooks registered in `~/.claude/settings.json` (PostToolUse + PreToolUse on `Agent|Bash`)
- 2 hook wrapper scripts in `~/.claude/hooks/`
- Memory schema additions (tag conventions documented in code; no DB migration needed — existing schema accommodates)
- 7-day cold-start protocol with state file
- TTL on `dispatch:*` at 30 days; `routing-principle:*` persists via `principle` tag
- CLI subcommand `forgeframe loom reflect` + `forgeframe loom status`
- Unit + integration tests including latency benchmark and cache-key invariance test
- README section documenting cold-start
- Single commit (or small series) on `feat/loom-organ`, pushed

## Out of scope (defer)

- Wiring reflector into `dream-schedule.ts` NREM phase (v1.1 — v1 uses CLI/cron)
- F5 prebuild_check tier as Layer-4 (sketch absorbed; implementation deferred until v1 has shipped)
- Hermes sensor stream integration (Daemon-v1 dependency)
- Cockpit UI for review queue (Cockpit feature; Loom only writes the proposed memories)
- Trust-tier inheritance for router mutations themselves (T5 thread; needs Devsecops meeting)
- Distillery dispatches (T2 thread; v1.1 once Anthropic-side stabilizes)
- Graph of Loom Cockpit pane (T3; defer to post-v1)

---

## Stop signals (from brief)

- If Loom router design conflicts irresolvably with Daemon-β trust spec → STOP, write checkpoint memo, defer router arm to Daemon-β era. **Mitigation:** v1 router is observe-only for 7 days regardless; arming happens long after Daemon-β scope locks.
- If sensor hook causes >50ms latency on Agent dispatches → STOP, redesign as async. **Mitigation:** sensor is `async: true` from day one; latency budget applies to the wrapper script's exec time only (target ≤ 5ms wrapper, then fork to background).

---

## Open questions

1. **Reflector trigger cadence** — manual CLI v1, then cron v1.0.5, then NREM-wired v1.1. Cron interval: 24h aligned to founder's morning routine? (Recommendation: yes, 06:00 local.)
2. **Policy precedence** — when two principles match the same dispatch with conflicting actions, which wins? Recommendation: most specific scope wins (project-scoped over global; tool-scoped over wildcard); ties broken by `approved_at` newest first.
3. **`input_summary` PII scrubbing** — reuse existing `scrub.ts` or write a lighter heuristic for the hot path? Recommendation: port the lightweight regex set only; full scrub on reflector batch.
4. **Founder review UX** — until Cockpit ships the surface, where do `routing-principle:proposed` memories appear? Recommendation: `forgeframe loom proposals` CLI subcommand for v1, then Cockpit surface in Wave 4 of CREATURE OS.

---

## Cross-links

- **Designed in:** `~/.claude/personas/notepad/2026-04-25-loom-organ-design.md` (D1-D10 locked, this spec honors all)
- **Builds on:** `~/.claude/personas/notepad/2026-04-02-organ-interface-open-questions.md` (Loom is the first concrete answer to the meta-organ question raised there)
- **Builds on:** `2026-04-22-cockpit-agent-dispatch.md` (Loom's review queue surfaces here)
- **Consumed by:** `2026-04-25-creature-os-design.md` (Today Space + #a2a Channel + Models Space + Graph of Me)
- **Future-proofed against:** `~/repos/ForgeFrame-loom/PREBUILD_CHECK_SKETCH.md` (Layer-4 prebuild_check)
- **Related thread:** `2026-04-13-hermes-dreaming-design.md` (Hermes as second meta-organ, shares `dispatch:*` namespace)
- **Sprint coordination:** `~/.creature/sprint/2026-04-25-master-sprint.md` (Stream A row)
- **Implementation plan:** `docs/superpowers/plans/2026-04-25-loom-implementation.md` (forthcoming, this session)
