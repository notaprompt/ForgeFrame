# Daemon-v1 Master Plan

**Status:** Execution-ready synthesis from four parallel planning agents
**Date:** 2026-04-20
**Context:** Day 2 of Wave 1 of Vision-v1 5-week sprint. Founder commits nuclear option compression (3-5 yr → 12-18 mo). Kid arrives October. Daemon-v1 is the force-multiplier.

---

## The goal, in one sentence

**An always-on autonomous orchestrator that handles the Vision/ForgeFrame project with the founder in the loop — decomposing todos, dispatching subagents into isolated worktrees, surfacing decisions via ntfy, and merging on approval — gated by AUTO/ASK/NEVER trust tiers and Guardian-as-presence.**

The daemon is not a separate bet from Vision. It is what Vision sprint Phase 2 (orchestrator skeleton, Week 2) grows into.

---

## What this plan is

Four parallel agents produced four subsidiary docs (all in this directory):

| Doc | Agent | What it covers |
|---|---|---|
| [`01-architecture.md`](./01-architecture.md) | Plan | Component diagram, data flow, API contract, state model, integration with Vision Phase 2, extension points |
| [`02-integration.md`](./02-integration.md) | Explore | Code-first map: what exists today in ForgeFrame/Distillery/Guardian, where hooks go, what must be built |
| [`03-trust-safety.md`](./03-trust-safety.md) | Plan | AUTO/ASK/NEVER manifest, ntfy approval loop, failure modes, Guardian integration, kill switch + rollback, constitutional protections |
| [`04-risk-timeline.md`](./04-risk-timeline.md) | Plan | Phased delivery (Daemon-0 → α → β → v1), risk register, critical path, slip protocol, Monday start |

This PLAN.md is the navigation layer. Read it first, then drill into the specific subsidiary doc for the facet you need.

---

## Phased delivery (load-bearing calendar)

### Daemon-0 — 2026-05-01 (Sprint Week 2 end)
Heartbeat + triggers armed + dream schedule + Feed Tab surfacing. **Exactly Vision Phase 2. Zero extra sprint scope.** Observation-only; no autonomous execution.

### Daemon-α — 2026-06-05 (2 weeks post-sprint)
Worktree dispatcher + task decomposition + Cockpit review queue + TELL-tier auto-execution + daily digest via ntfy.

### Daemon-β — 2026-06-26 (5 weeks post-sprint) ← **minimum-viable compression**
Machine-readable trust spec + ntfy ASK loop + token budget enforcement + rollback log. **This is the shape that actually compresses calendar time (~1.5-1.8x on surfaces it touches).**

### Daemon-v1 — 2026-07-24 (9 weeks post-sprint)
Hermes integration + dream cycle driving real background work + self-healing + minimal founder-in-loop (~3-5 ASKs/day).

### Stabilization — 2026-09-01
Patch-only from here. Must be self-healing before kid arrives October. "Vacation mode" drops to TELL-only after 72h no Feed interaction.

---

## What exists today that the daemon will reuse

Already shipped in ForgeFrame (verified in code by Explore agent — see `02-integration.md` for line numbers):

- `packages/server/src/daemon.ts` — HTTP daemon lifecycle, PID, SIGTERM
- `packages/server/src/events.ts` — full SSE event bus with `dream:*`, `hermes:*`, `guardian:*` typed events
- `packages/server/src/triggers.ts` — `TriggerManager` with `CronTrigger` + `WatchTrigger`, persistence, `setRunner()` + `start()`
- `packages/server/src/agent.ts` — `ForgeAgent.run(config)` — **the in-process subagent primitive**
- `packages/memory/src/sleep-pressure.ts`, `dream-nrem.ts`, `dream-rem.ts`, `guardian.ts` — the Hermes "brain"
- `swarm/launch.sh` + overlays — tmux + git-worktree dispatch pattern (needs codification as TS)

The daemon does not require a rewrite. It requires: 5 new TypeScript modules + 1 new SQLite file + 11 new HTTP endpoints + 8 new event types. See `01-architecture.md` §1.

---

## What must be built (new)

1. `packages/server/src/orchestrator.ts` — Vision Phase 2 Task 2.1 skeleton extended with `drainReviewQueue()` and `dispatchReadyTasks()` tick branches (additive, non-breaking)
2. `packages/server/src/dispatcher.ts` — worktree+agent spawner (TS port of `swarm/launch.sh`)
3. `packages/server/src/trust-gate.ts` — AUTO/ASK/NEVER enforcement at dispatcher boundary
4. `packages/server/src/review-queue.ts` — SQLite-backed queue + four HTTP endpoints
5. `packages/server/src/decomposer.ts` — todo → task-tree via local Qwen3:32B (sovereignty-enforced)
6. Extend `packages/server/src/events.ts` with `daemon:*` event types
7. New SQLite at `~/.forgeframe/daemon-v1.db` (separate from `memory.db`)

Week 2 of the Vision sprint (Apr 25 – May 1) is where the Daemon-0 subset lands. Daemon-α–β modules ship post-sprint.

---

## The three non-negotiable invariants

From `03-trust-safety.md`:

1. **Cognitive content never leaves the laptop.** Decomposition of cognitive or principle-tagged todos: local Qwen3:32B only. `claude -p` permitted only for `tier: 'public'` nodes. Enforced inside `decomposer.ts` routing table.

2. **Timeout equals abort. Never equals auto-approve.** Standard ASK = 4h → abort. Elevated-ASK = 12h → abort. Reframed-touching = 24h → abort. **No silent timeout ever auto-approves.**

3. **Guardian contradicts → BLOCK, even post-approval.** Before executing any approved ASK, run `contradiction_scan` against `principle|voice|constitutional`-tagged memories. Similarity ≥ 0.82 + non-zero contradiction density → action blocked, `ultron-block` memory written, high-priority ntfy. *Permission can be given; coherence with constitution cannot be waived.*

---

## Where ASK is surfaced

Channel stack:
1. **Primary:** ntfy.sh push to `acamp-daemon-v1` → phone, Mac, iPad with inline `Approve` / `Deny` / `Open Cockpit` buttons
2. **Mirror:** Feed Tab in Cockpit — pending ASK cards, unresolved count badge
3. **Fallback:** ntfy failure twice → daemon writes `ask-offline` memory + quiets

**One outstanding ASK at a time.** No approval chaining.

---

## Risk register (top 3)

From `04-risk-timeline.md`:

| Risk | Severity | Mitigation |
|---|---|---|
| **Scope creep into Vision sprint** | HIGH | Hard rule: Daemon-0 = only Phase 2. No Daemon-α work before 2026-05-22. Any commit touching worktree dispatch before that is rolled back. |
| **API budget blowout ($4K → $12K/mo)** | HIGH | Daemon-α ships with soft $150/day cap. Daemon-β enforces hard. Observation-only until then uses local Ollama; Claude spend stays founder-gated. |
| **Trust-gate bypass** | CRITICAL | Whitelist-only dispatcher in Daemon-α. Trust spec load-bearing at router layer in Daemon-β. Every action writes `trust_check` memory; Guardian scans for bypass attempts. |

Full 9-risk register in `04-risk-timeline.md` §3.

---

## Pause-points if life intervenes

- **After Daemon-0 (2026-05-01):** observability only. Safe stopping point.
- **After Daemon-β (2026-06-26):** TELL-tier + rollback. Useful but not yet driving real compression. Acceptable stopping point.
- **DO NOT pause mid-Daemon-α.** Review queue + TELL-tier are matched pair. Half-built is worse than either end.

Kid earlier than October → collapse Daemon-α + β into single-shot reduced scope, defer Daemon-v1 to Q4.

---

## Monday 2026-04-20 — first execution step

**Phase 1 Task 1.2 — PWA manifest for Feed Tab.** 45-90 min evening block. Not daemon code. Deliberately.

- Manifest JSON + three `<meta>` tags in `index.html`
- Verify `http://<laptop-ip>:3001/cockpit/?pane=feed` loadable from phone on LAN with Vision icon on home screen
- Commit
- Sleep by 22:30

This is Phase 1 of the Vision sprint, on the sprint overlay's explicit Monday slot. **Daemon work begins Saturday 04-25** with Vision Phase 2 Task 2.1. Scope discipline starts now — do NOT start sketching dispatcher or trust-tier spec Monday. The plan you're in is the plan.

---

## The honest synthesis

From `04-risk-timeline.md`:

> Daemon-v1 is **12 weeks of work effectively starting 2026-05-23** (after sprint + recovery week). Best case Aug 14, normal Sep 1, with one research-risk event Oct 1. All three pre-kid.
>
> The 5-week Vision sprint is not the daemon. The 5-week Vision sprint is the substrate on which the daemon is the next three months of work.

The compression math works at **Daemon-β** (~1.5-1.8x on touched surfaces, 25-30% autonomous, June 26). Daemon-v1 is the ceiling, not the floor. If time/energy/kid pressure forces a choice, β is the cut line and it's still enough to move the 12-18 month window.

No martyr plan. No marathon-every-night. Daemon-v1 survives kid-arrival because it stabilizes one month before.

---

## How to read this plan

- **Starting tonight / this week:** read §§ "Monday start" and `02-integration.md` §1–2 only. Stay on Vision sprint.
- **End of Vision sprint (May 22), planning recovery week:** read `01-architecture.md` fully and `04-risk-timeline.md` §2 (phased delivery).
- **Before touching any NEW daemon code:** read `03-trust-safety.md` fully. The trust spec is load-bearing from the first dispatcher line; don't ship `dispatcher.ts` without it.
- **Mid-execution (any post-sprint week):** use this PLAN.md's "Phased delivery" as the single-source-of-truth for what ships when.

---

## Cross-references

- Vision master index: ForgeFrame memory `72fcb856-0ce0-4572-a948-83777a247966`
- Vision 5-week sprint overlay: `/Users/acamp/repos/ForgeFrame/docs/superpowers/plans/2026-04-18-vision-5-week-sprint.md`
- Vision full implementation plan: `/Users/acamp/repos/ForgeFrame/docs/superpowers/plans/2026-04-18-vision-on-laptop-v1.md`
- Vision founding doc: `/Users/acamp/.claude/personas/notepad/2026-04-18-proto-vision-founding.md`
- Prior Hermes plan (April 13): `/Users/acamp/repos/ForgeFrame/docs/superpowers/plans/2026-04-13-unified-signal-cockpit-hermes.md`
- Agent orchestration origin (March 29): `/Users/acamp/.claude/personas/notepad/2026-03-29-agent-orchestration-vision.md`
- iOS app v1.1 memory: ForgeFrame memory `6e843fbe-8581-4fde-850c-bbf78d8b23bf`
