# Daemon-v1 Architecture

**Status:** Design, Week 1 Day 2 of Vision-v1 sprint
**MVP ship gate:** 2026-05-01 (end of Week 2)
**Relation to Vision plan:** Vision Phase 2 (Tasks 2.1–2.3) is the seed of this daemon. Daemon-v1 = Phase 2 + a worktree dispatcher + a review queue + a trust gate. Same process, same port, same DB.

## What exists / what's new / what's deferred

**Exists today (do not rewrite):**
- `packages/server/src/daemon.ts` — HTTP daemon lifecycle on :3001, PID at `~/.forgeframe/daemon.pid`, SIGTERM shutdown.
- `packages/server/src/events.ts` — `ServerEvents extends EventEmitter` with the full dream/hermes/guardian event map already typed (`dream:*`, `hermes:cycle:started`, `hermes:task:executing`, `guardian:dev_active`, `guardian:sleep_pressure`). **Daemon-v1 emits into this same bus.**
- `packages/server/src/triggers.ts` — `TriggerManager` with `CronTrigger` + `WatchTrigger`, persistence at `~/.forgeframe/triggers.json`, `setRunner()` + `start()`. The AgentRunner signature is already `(task, cwd, tier?) => Promise<void>`.
- `packages/server/src/agent.ts` — `ForgeAgent.run(config)` that executes a single task against the daemon. **This is our in-process subagent primitive.**
- `packages/memory/src/sleep-pressure.ts`, `dream-nrem.ts`, `dream-rem.ts`, `guardian.ts` — the Hermes "brain" primitives. `GuardianComputer`, `computeSleepPressure`, `NremPhase`, `RemPhase` all already imported in `http.ts`.
- `swarm/launch.sh` + `swarm/overlays/` — tmux-pane + git-worktree dispatch pattern. Shell-only, human-invoked today.
- `packages/server/src/push.ts` (Vision Phase 1 Task 1.3) — ntfy.sh `sendPush(topic, title, body, priority, tags)`. Lands this week, before Daemon-v1.

**New in Daemon-v1 (Week 1-2):**
- `packages/server/src/orchestrator.ts` — Vision Phase 2 Task 2.1 skeleton, extended into the tick loop below.
- `packages/server/src/dispatcher.ts` — programmatic worktree+agent spawner (codifies `swarm/launch.sh` as TypeScript).
- `packages/server/src/review-queue.ts` — SQLite-backed queue of completed subagent work awaiting founder approval.
- `packages/server/src/trust-gate.ts` — AUTO / ASK / NEVER enforcement at the dispatcher boundary.
- `packages/server/src/decomposer.ts` — todo-list → task-tree via local Qwen3:32B (Ollama), falling back to `claude -p` for public/non-cognitive decomposition.
- `~/.forgeframe/daemon-v1.db` — a second SQLite file next to `memory.db` for orchestration state (tasks, worktrees, reviews). Keeps cognitive memory and operational state cleanly separable.

**Deferred (post-sprint, Hebbian/Hermes-full):**
- Binding task outcomes into the Hebbian graph as `skill:success` / `correction` edges (Vision Phase 8.1 already wants this data).
- Full Hermes motor loop (NousResearch dependency, spec section 2 of `2026-04-13-hermes-dreaming-design.md`). Daemon-v1 is a Hermes-shaped placeholder the real Hermes can drop into.
- Device-mesh dispatch (run a subagent on a second M-series box via Urbit-style identity).

---

## 1. Component diagram

```
                        ┌─────────────────────────────────────────┐
                        │         ForgeFrame daemon :3001         │
                        │                                         │
  ntfy.sh  ◄─── push ───┤ ┌──────────┐    ┌─────────────────────┐ │
  (phone)               │ │  push.ts │◄───┤  review-queue.ts    │ │
                        │ └──────────┘    │   (SQLite)          │ │
                        │                 └─────────────────────┘ │
                        │                          ▲              │
  Cockpit Feed Tab ◄────┤ ┌────────────┐           │              │
  (SSE /api/events)     │ │ events.ts  │           │              │
                        │ └────────────┘           │              │
                        │      ▲                   │              │
                        │      │ emit()            │ enqueue()    │
                        │      │                   │              │
  cron/watch  ────► ┌───┴──────────────────────────┴───────────┐  │
                    │          orchestrator.ts (tick loop)     │  │
                    │  tick=1s ─ heartbeat                     │  │
                    │  tick%5  ─ evaluateTriggers              │  │
                    │  tick%10 ─ scanDistillery                │  │
                    │  tick%15 ─ drainReviewQueue              │  │
                    │  tick%30 ─ maybeDream (NREM/REM)         │  │
                    │  tick%60 ─ guardianPulse                 │  │
                    └──────────────────────────────────────────┘  │
                        │      │                    │             │
                        │      │ dispatch(task)     │ decompose() │
                        │      ▼                    ▼             │
                        │ ┌──────────────┐  ┌──────────────────┐  │
                        │ │ dispatcher.ts│  │ decomposer.ts    │  │
                        │ │  (worktrees) │  │  (Qwen3 / CLI)   │  │
                        │ └──────┬───────┘  └──────────────────┘  │
                        │        │ spawn                          │
                        │        ▼                                │
                        │ ┌─────────────────────────────────────┐ │
                        │ │   trust-gate.ts    AUTO | ASK | NEV │ │
                        │ └─────────────────────────────────────┘ │
                        │        │ gated                          │
                        │        ▼                                │
                        │ ┌─────────────────┐  ┌────────────────┐ │
                        │ │ ForgeAgent      │  │ claude -p      │ │
                        │ │ (in-process)    │  │ (subprocess,   │ │
                        │ │                 │  │  public tier   │ │
                        │ └─────────────────┘  │  only)         │ │
                        │                      └────────────────┘ │
                        │        │                                │
                        │        ▼                                │
                        │ /tmp/ff-wt/<task-id>/  (git worktree)   │
                        │                                         │
                        │ ┌─────────────────────────────────────┐ │
                        │ │  MemoryStore (packages/memory)      │ │
                        │ │  ~/.forgeframe/memory.db            │ │
                        │ │  GuardianComputer / NremPhase /     │ │
                        │ │  RemPhase / computeSleepPressure    │ │
                        │ └─────────────────────────────────────┘ │
                        └─────────────────────────────────────────┘
```

## 2. Data flow

Happy path, single todo item to merged work:

1. **Todo in** — founder drops a line into `~/vision/todo.md` (a `WatchTrigger` on that path, registered via existing `TriggerManager.addWatch`). Or `POST /api/daemon/todo` with `{content, project, trust?}`. Or a cron task (`0 9 * * *` scans todo.md nightly).
2. **Decomposition** — `decomposer.decompose(todoText, {project}): Promise<TaskTree>`. Uses local Qwen3:32B via `OllamaGenerator`. Grounding rule: cognitive decomposition never calls `claude -p` — sovereignty constraint enforced inside decomposer.
3. **Dispatch** — `orchestrator` walks the tree in dependency order. For each ready node, calls `dispatcher.dispatch(node)`.
4. **Trust gate** — `dispatcher.dispatch` routes through `trust-gate.evaluate(node)` first. AUTO tasks proceed. ASK tasks write a `review-queue` row and call `sendPush`. NEVER tasks are hard-rejected and logged with a `guardian_alert` event.
5. **Execute in worktree** — `git worktree add /tmp/ff-wt/<task-id> -b daemon/<task-id>` from `main`. Copy `swarm/overlays/builder.md` as `AGENT.md`. Spawn `ForgeAgent.run({task, cwd: worktreePath, tier, budget: 2.00, leash: 'auto'})`.
6. **Skeptic review** — if task has `skeptic: true`, fire second `ForgeAgent.run` using `swarm/overlays/skeptic.md`, read-only. Emits rating: `clean`, `cosmetic`, `load-bearing`, `time-bomb`.
7. **Consolidation** — `review-queue.enqueue({taskId, worktreePath, diff, skepticRating, summary})`.
8. **Human gate** — `sendPush` fires with `priority: time-bomb? 'urgent' : 'default'`. Deep-links to Feed Tab review row.
9. **Merge** — `POST /api/daemon/reviews/:id/accept` → `git merge --no-ff` into main, `git worktree remove`, emit `daemon:task:merged`, write `type:skill-success` memory.

Full loop target: 5–45 min per task. Daemon overhead under 15s.

## 3. API contract

New HTTP endpoints under `/api/daemon/*` (all bearer-auth'd):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/daemon/todo` | `{content, project?, trust?}` → `{taskTreeId}` |
| GET  | `/api/daemon/tasks` | List active task trees |
| GET  | `/api/daemon/tasks/:id` | Detail + subtasks + worktree |
| POST | `/api/daemon/tasks/:id/cancel` | Kill + cleanup |
| GET  | `/api/daemon/reviews` | `?status=pending\|all` |
| GET  | `/api/daemon/reviews/:id` | Full row + diff + skeptic report |
| POST | `/api/daemon/reviews/:id/accept` | Merge |
| POST | `/api/daemon/reviews/:id/reject` | Cleanup + correction memory |
| POST | `/api/daemon/reviews/:id/defer` | Push ntfy reminder forward |
| GET  | `/api/daemon/trust-policy` | Current AUTO/ASK/NEVER matrix |
| PUT  | `/api/daemon/trust-policy` | Replace policy (Guardian-gated) |

New `daemon:*` events emitted on existing SSE `/api/events` stream:
- `daemon:todo:received`, `daemon:task:decomposed`, `daemon:task:dispatched`, `daemon:task:completed`, `daemon:task:merged`, `daemon:task:rejected`, `daemon:review:queued`, `daemon:trust:denied`

## 4. State model

Separate SQLite at `~/.forgeframe/daemon-v1.db`:

```sql
CREATE TABLE task_trees (id TEXT PRIMARY KEY, root_content TEXT, project TEXT, created_at INTEGER, status TEXT);
CREATE TABLE tasks (id TEXT PRIMARY KEY, tree_id TEXT, parent_id TEXT, title TEXT, rationale TEXT, trust TEXT, deps TEXT, worktree_path TEXT, branch TEXT, status TEXT, cost REAL, started_at INTEGER, finished_at INTEGER);
CREATE TABLE reviews (id TEXT PRIMARY KEY, task_id TEXT, diff TEXT, skeptic_rating TEXT, skeptic_report TEXT, summary TEXT, status TEXT, notified_at INTEGER, resolved_at INTEGER);
CREATE TABLE trust_policy (pattern TEXT PRIMARY KEY, tier TEXT, updated_at INTEGER);
```

Reads from `~/.forgeframe/memory.db` via existing `MemoryStore` — never writes directly; all cognitive writes go through `memory_save` MCP tool.

## 5. Integration with Vision sprint Phase 2

Phase 2 Task 2.1 (orchestrator skeleton) ships exactly as Vision specifies. Daemon-v1 extends `startOrchestrator` additively:

```typescript
if (tick % 15 === 0) await drainReviewQueue();
if (tick % 7  === 0) await dispatchReadyTasks();
```

Phase 2 Tasks 2.2 + 2.3 unchanged. Daemon-v1 upgrades `TriggerManager.setRunner()` from direct `ForgeAgent.run` to trust-gated, worktree-isolated, review-queued dispatch.

**Net:** Vision Phase 2 exit gate passes with Daemon-v1 MVP installed. No Vision phase delayed.

Week 2 split:
- Mon–Tue: `trust-gate.ts` + `dispatcher.ts`
- Wed: `review-queue.ts` + schema + four endpoints
- Thu: `decomposer.ts` + `POST /api/daemon/todo` + Feed Tab `review-pending` renderer
- Fri: end-to-end smoke — drop line into `~/vision/todo.md`, walk to merged branch, observe on phone

## 6. Extension points (post-sprint)

1. **Hebbian graph binding** (Phase 8): On `daemon:task:merged`, write `memory_link` edges between todo / diff / `skill:*` memories. Hook: `daemon.onMerge` subscriber in `hebbian.ts`.
2. **Full Hermes integration** (Apr 13 plan Phase 4): `dispatcher.registerExecutor(name, fn)` hook. NousResearch Hermes motor loop becomes alternate executor alongside `ForgeAgent`.
3. **Device mesh** (Phase 11.3): `RemoteDispatcher` SSHes to sibling M-series box. Fits behind same interface, signed by `identity.priv`.
4. **Trust-policy learning:** Weekly Guardian-supervised pass proposes upgrades from ASK→AUTO based on acceptance patterns. Runs inside REM via `hindsight.ts`.
5. **Multi-operator:** Extend `trust_policy` key to `(pattern, actor)` for future collaborators.
6. **Voice approvals** (Phase 6.3): Kokoros reads pending review, Whisper catches "accept"/"reject"/"defer." Zero daemon changes — calls same endpoints.

## Sovereignty invariants (load-bearing)

- Cognitive decomposition: local Qwen3:32B only. `claude -p` only for `tier: 'public'` nodes.
- Review queue diffs never leave machine. ntfy payloads contain title + summary + deep-link only.
- `NEVER` list seeded from `~/CLAUDE.md` principle memories at boot. Cannot be modified by any agent.
- `daemon:trust:denied` events always mirror into `guardian_alert`.
