# Cockpit as Agent Dispatch Surface — Spec Addendum

**Peer to:** `2026-04-09-cockpit-design.md` (base Cockpit design — covers memory-graph observation, tabs, semantic zoom, aesthetic)
**Adds:** the *dispatch half* of the Cockpit — where the founder spawns, observes, reviews, and approves agent work dispatched by Daemon-α+

**Date:** 2026-04-22
**Status:** Spec-draft. Pre-execution. Depends on Daemon-α (2026-05-03) for the machinery.

---

## Thesis

The base Cockpit design is a memory-observation surface — you look at the creature's mind, edit it, steer it. This addendum defines the other half: **the Cockpit is also the surface where the founder dispatches agents and reviews their work.**

Framing: **Cursor + dispatch had a baby.** Cursor-grade keyboard IDE (palette, inline editing, command grammar) — but pointed at spawning and managing parallel AI agents instead of writing code directly.

The base spec says: *"Observe → Steer → Return to driving."* This spec adds: *"Dispatch → Observe → Review → Approve."*

Both loops live in the same Cockpit; both feel native to the keyboard; both write to the same memory.

## Audience

1. **The founder** — primary user. Dispatches agents at 9am, reviews their work at 5pm, approves or refines overnight.
2. **ForgeFrame open source developers** — this is the screenshot that distinguishes Cockpit from every agent framework with a chat box.
3. **Enterprise** — the pattern that lets a PM/tech-lead orchestrate an entire sub-team of AI agents from one surface.

---

## Five surfaces of the dispatch loop

### 1. Dispatch surface (spawn)

**Command:** `Cmd+Shift+D` — "Dispatch a task"

Opens a modal over the canvas with the following fields:

- **Task description** — free-form markdown, multi-line. Grows as you type.
- **Saved templates** — pull from `~/.forgeframe/dispatch-templates.json` (e.g. "Review recent PRs", "Draft a response to X", "Refactor the auth middleware").
- **Team composition** — multiselect of personas (`@swe`, `@system-architect`, `@cfo`, `@devsecops`, etc.). Single-agent default; multi for team-dialog mode.
- **Parallel count** — for single-persona dispatches, spawn N of them for comparison. Default 1.
- **Trust tier** — `AUTO` / `ASK` / `NEVER` (maps to Daemon-β trust-gate). Default `ASK`.
- **Context injection** — preview of which memories will be loaded. Sovereignty-filtered: any `sensitive` or `local-only` memory is excluded from frontier-bound agents by default; override requires explicit toggle.
- **Budget** — time ceiling (default 30 min) + cost ceiling (default $5).
- **Foreground vs background** — background = run in isolated worktree via Daemon-α; foreground = take over current Cockpit view.

Submit: fires `POST /api/dispatch` → Daemon-α spawns the worktree + agents → `agent:spawned` SSE event → agent appears in Observation surface.

### 2. Observation surface (watch)

**Location:** Inspector panel, new tab: "Active agents"

One row per running agent:
- **Agent name + persona handle** — `@swe-a1b2c3`
- **Status** — spawning / running / blocked / completed / failed (colored dot + label)
- **Progress timeline** — streaming list of tool calls, file reads, key decisions. Clickable to expand.
- **Context preview** — which memory IDs were pulled in (sovereignty-tagged visibly: 🟢 public, 🟡 sensitive-abstracted, 🔴 local-only-excluded)
- **Cost tracker** — tokens used, $ spent, % of budget consumed
- **Runtime clock** — ticks up from spawn
- **Quick actions** — pause, interrupt, send-message (agent-to-agent dialog), view output

Multi-agent teams get a grouped view with a shared dialog pane (see section 5).

### 3. Review surface (inspect)

**Location:** New main-area mode: "Review" (peers to Graph / List / Feed)
**Shortcut:** `Cmd+Shift+R` — jump to review queue

Queue view: all completed agents awaiting review, sorted by completion time.

Per-item review card shows:
- **Proposed changes** — a unified diff pane (code) + memory-delta pane (memories added/modified/removed) + side-effects list (external API calls, file writes outside worktree, emails drafted, etc.)
- **Agent's reasoning** — a rendered markdown summary the agent generates at completion ("Why I did what I did")
- **Sovereignty audit** — which sensitive memories were referenced, how they were handled, whether the output touches sensitive tiers
- **Confidence** — agent's self-reported confidence (optional; null if not provided)
- **Test results** — if agent ran tests, pass/fail breakdown

### 4. Approval surface (commit)

Built into the Review surface. Three actions per item:
- `Cmd+Enter` — **approve** (commit changes, close review)
- `Cmd+Shift+Backspace` — **reject** (discard worktree, prompt for note)
- `Cmd+M` — **modify** (open inline editor on the diff, edit, then approve the edited version)

Batch actions:
- Select multiple review items (`Shift+click` or `Cmd+A`)
- Approve-all / reject-all with one gesture

**Trust tier gates (via Daemon-β):**
- `AUTO` items — auto-approved; appear in Review only as post-hoc audit log (with "rollback" action still available for 24h)
- `ASK` items — appear in queue; ntfy + Telegram ping on arrival
- `NEVER` items — refused by Daemon-β before agent even spawns; shown in a "refused" pane with the refusal reason

**Rollback:** any approved change has an "Undo" button visible for N hours (default 24). Undo restores the pre-approval state in the worktree + reverses memory deltas.

**Audit log:** every approval / rejection / modification is saved to memory with tag `action:approved`, `action:rejected`, or `action:modified`, plus the source agent and rationale. Creature uses this for future calibration of trust-tier classification.

### 5. A2A (agent-to-agent) dialog

**When:** Dispatch includes multiple personas (e.g. `@swe + @system-architect + @devsecops` on one task).

**How:** Daemon-α spawns a shared channel in the worktree. Each agent can:
- Read the channel (see what others have said)
- Write to the channel (contribute, question, disagree)
- Read each other's working memory (subject to sovereignty filter)

**Founder's view:** a chat-style pane in the Observation surface. Each agent message prefixed with its handle. Founder can interject at any time — messages prefixed `@founder:` appear to all agents as a priority channel input.

**Persistence:** every A2A dialog is saved to memory tagged `team-dialog` + the dispatch ID. Queryable later via `memory_list_by_tag`.

**Example use:** *"refactor the auth middleware; dispatch @swe + @devsecops + @system-architect"* → agents debate the architectural approach before anyone writes code; founder reads the debate, picks a direction, approves the winning approach.

---

## Integration with existing layers

| Layer | This spec uses |
|---|---|
| **Daemon-α** | Worktree dispatcher (isolation), review queue (state), trust-gate (AUTO/ASK/NEVER classification) |
| **Daemon-β** | ntfy + Telegram ASK notifications for ASK-tier items |
| **Sovereignty** | sovereigntyCheck runs on all context-injection steps; sensitive memories auto-abstracted, local-only auto-excluded |
| **Memory** | Every dispatch, completion, review, approval, and rejection writes a row. Agent reasoning stored as `artifact` memory type for future LoRA training |
| **Gateway** | ASK notifications fire via `push.ts` (ntfy) and `telegram.ts` (Telegram); Discord when shipped |
| **Event bus** | New SSE events: `agent:spawned`, `agent:blocked`, `agent:completed`, `review:pending`, `approval:granted`, `approval:rejected`, `team-dialog:message` |

---

## New API endpoints

```
POST   /api/dispatch                     — spawn a new dispatch (task + team + tier + budget)
GET    /api/dispatch                     — list active + recent dispatches
GET    /api/dispatch/:id                 — dispatch detail (status, cost, runtime)
POST   /api/dispatch/:id/interrupt       — stop a running agent
POST   /api/dispatch/:id/message         — inject a founder message into A2A dialog
GET    /api/review                       — review queue (completed awaiting approval)
POST   /api/review/:id/approve           — commit the agent's changes
POST   /api/review/:id/reject            — discard, with reason
POST   /api/review/:id/modify            — modify then approve (takes edited diff)
POST   /api/review/:id/rollback          — undo a previously-approved change (within N hours)
```

## New MCP tools

```
dispatch_spawn(task, team?, tier?, budget?, parallel?, foreground?)
dispatch_list(status?)
dispatch_interrupt(id, reason?)
dispatch_message(id, message)
review_list()
review_approve(id)
review_reject(id, reason)
review_modify(id, modified_diff)
review_rollback(id, reason?)
```

## Keyboard shortcuts (additions to base Cockpit)

| Shortcut | Action |
|---|---|
| `Cmd+Shift+D` | New dispatch (opens dispatch modal) |
| `Cmd+Shift+R` | Jump to review queue |
| `Cmd+Shift+V` | View active agents panel |
| `Cmd+Shift+A` | Spawn team (opens A2A dispatch) |
| `Cmd+Enter` | (in review) approve selected |
| `Cmd+Shift+Backspace` | (in review) reject selected |
| `Cmd+M` | (in review) modify selected |

## Layout additions

- **Sidebar — new section "Active agents"** (peer to Views, Tags, Guardian). Shows N running / M awaiting review, live.
- **Inspector — new tab "Agents"** with the real-time observation panel (see section 2).
- **Main area — new mode "Review"** (peer to Graph, List, Feed). Default view when `Cmd+Shift+R`.
- **Status bar — new counter** `dispatches: active N · queued M · reviewed K today`.

---

## Exit criteria — the felt-moment

1. Founder hits `Cmd+Shift+D`, types *"refactor the auth middleware for compliance"*, picks `@swe + @system-architect + @devsecops`, tier = `ASK`, budget = 45min.
2. Dispatch fires. Three agents spawn in an isolated worktree. A2A dialog begins.
3. Founder leaves the desk, goes to dinner.
4. 40 min later: Telegram ping — *"dispatch complete, 3 files changed, 1 sovereignty note flagged, awaiting review"*
5. Founder opens Cockpit on phone, swipes through review queue, reads the A2A debate that led to the final design, approves 2 changes, modifies 1 with a note ("make the token rotation window 12h not 24h").
6. Everything logged to memory. Creature now has another `team-dialog` cluster + three more `action:approved` and one `action:modified` events tagged with founder's reasoning.
7. Over weeks, trust-tier classifier learns from these reviews: founder almost always approves `@swe + @system-architect` small refactors → those start getting auto-tiered `AUTO`; founder frequently modifies `@cfo` financial projections → those stay `ASK` permanently.

When the loop in step 7 is live and self-calibrating, the Cockpit-as-dispatch-surface has hit its mature form.

---

## Dependencies + sequencing

- **Requires (blocking):** Daemon-α shipped (worktree dispatcher, review queue, trust gate) — 2026-05-03 start per Vision master plan
- **Requires (blocking):** sovereignty enforcement (Phase 4) — Wave 2, for context filtering on sensitive memories during dispatch
- **Requires (soft):** Telegram gateway armed (token configured) — Wave 2, for ASK notifications outside the Cockpit
- **Blocks:** nothing in the core Vision-v1 sprint; this spec ships in Wave 4 or 5 (2026-05-10+) after Daemon-α is live

---

## Open questions (for a future scoping meeting)

1. **Review UI density** — how much of the diff should render inline vs. click-to-expand? Trade-off: comprehension vs. screen real estate on mobile.
2. **A2A dialog persistence scope** — do we save every message or only distilled decisions? Disk + token cost implications.
3. **Rollback semantics** — what happens when rollback-after-24h is attempted? Refuse? Allow with confirmation?
4. **Trust-tier learning cadence** — is it real-time (every approval updates classifier) or batched (nightly retrain on last 100 approvals)?
5. **Team-dialog with founder-as-persona** — should `@founder` be a full persona agents can message back to via ntfy/Telegram, or strictly read-only to agents?

---

## Cross-links

- Base Cockpit design: `/Users/acamp/repos/ForgeFrame/docs/superpowers/specs/2026-04-09-cockpit-design.md`
- Daemon-v1 architecture: `/Users/acamp/repos/ForgeFrame/docs/superpowers/plans/2026-04-20-daemon-v1/01-architecture.md`
- Daemon-v1 trust + safety: `/Users/acamp/repos/ForgeFrame/docs/superpowers/plans/2026-04-20-daemon-v1/03-trust-safety.md`
- Phase 4 sovereignty audit: `/Users/acamp/vision/plans/2026-04-25-phase4-routing-sovereignty.md`
- CREATURE umbrella doc: `/Users/acamp/vision/CREATURE.md`
- Vision 5-week sprint plan: `/Users/acamp/repos/ForgeFrame/docs/superpowers/plans/2026-04-18-vision-5-week-sprint.md`
