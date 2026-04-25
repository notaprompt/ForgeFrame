# CREATURE OS — Design Spec

**Date:** 2026-04-25
**Status:** Draft, awaiting user review before implementation plan
**Implementation repo:** TBD (likely `~/repos/creature` when scaffolded)
**Authoring path:** `/Users/acamp/repos/ForgeFrame/docs/superpowers/specs/2026-04-25-creature-os-design.md`

## Purpose

A unified founder-facing OS that contains all of CREATURE — engine, organs, gateways, intake — in one place. Replaces opening 50 tabs, 40 conversations, and switching across 6 launchd-managed services with a single shell where everything is visible, navigable, and steerable. Founder and creature operate as one **fused loop**: the substrate watches what the founder does (CLI, files, repos, trades, conversations, distillery feed), surfaces what matters when it matters, asks questions **later** (async, not interrupting). Sovereignty + autopoiesis preserved per the existing CREATURE thesis. State-of-the-art for April 2026.

The defining UX claim: **you open CREATURE in the morning. Everything else lives inside it.** Apple Terminal stops being a separate app — it's absorbed as one Space. Chat-as-only-interface is rejected — chat is one mode of one Space, not the shape of the whole thing.

The defining aesthetic claim: **OG Xbox × Lain × macOS Tahoe × Olive Glass / Signal**. Bold layered tiles, cyberpunk Wired terminal, translucent depth, warm phosphor — emphatically not ChatGPT-generic.

## CREATURE acronym (locked, per memory `25ff956b`)

```
C reature
│
├─ C  ognitive    — it's a mind: memory, reasoning, self-reference
├─ R  ecursive    — thinks about its own memories; dreams consolidate
│                   memories-of-memories
├─ E  ntropic     — accumulates noise; dream cycles metabolize entropy
│                   into meaning (consolidation, decay, pruning)
├─ A  utopoietic  — self-maintaining and self-producing per Maturana/Varela.
│                   Memory topology is continuously self-manufactured
├─ T  emporal     — has its own clock: wake, sleep, dream, NREM/REM
├─ U  ser-owned   — sovereign, local-first, not renting cognition from a vendor
├─ R  eflective   — me:state + session hydration: knows what it is across sessions
└─ E  mergent     — behavior beyond what was programmed
```

The acronym itself answers WEB 4.0: User-owned (vs Conway agent-owned wallets) + Autopoietic-with-constitutional-tether (vs Wen's economic Darwinism) + Reflective (vs survival-as-telos).

## Naming model (locked 2026-04-25 evening)

| Name | What it is | Visibility |
|------|-----------|------------|
| **CREATURE** | The OS, the realized whole, what the founder opens | Internal canonical name; may stay internal-only per `a3c03218` (OSS strategy: ForgeFrame open, Vision/CREATURE proprietary) |
| **ForgeFrame** | The engine. npm packages `@forgeframe/memory`, `@forgeframe/server`, `@forgeframe/core`, `@forgeframe/proxy` | Public, MIT (memory + server) and AGPL (core + proxy) |
| **Vision** | The LoRA fine-tuned model codename (`vision-qwen-v1`, target Phase 8 of Vision sprint) — cognition running *inside* CREATURE | Internal proprietary |
| **Distillery** | The senses (iOS Share Sheet → Ollama lens → curated memory rows) | Internal |
| **Cockpit** | The memory-observation pane (mounted as one Space inside CREATURE) | Internal |
| **Loom** | Meta-organ for dispatch governance (designed in 2026-04-25 team meeting) | Internal |
| **Hermes** | Meta-organ for autonomous execution (Daemon-v1, target 2026-07-24) | NousResearch dependency, MIT — used not forked |
| **Domain organs** | Reframed, Cipher, dad-watch, Voice Widget, Business OS — live as Projects inside CREATURE | Mixed (Reframed public, others internal) |

**The previous Vision = "creature has a name" framing (memory `9dd82ef8`, 2026-04-18) is reconciled by reading "Vision" as the *runtime cognition* (the model) rather than the *shell*. The shell is CREATURE.**

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│                CREATURE OS — Tauri 2.x desktop shell                     │
│                (~50MB resident, signed installer, double-click open)     │
│                                                                          │
│   ┌───────────────────────────── 7 Spaces ────────────────────────────┐  │
│   │  Today  Projects  Channels  Goals  Models  Memory  Terminal      │  │
│   │  ─────  ────────  ────────  ─────  ──────  ──────  ────────      │  │
│   │   default landing     │ swipe / Ctrl+Arrow / Cmd+1..7            │  │
│   └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│   ┌───────────────────── Universal layer ─────────────────────────────┐  │
│   │  Top bar (Space switcher, daemon pulse, Guardian temp pip)       │  │
│   │  Cmd+K palette (universal jump across all sources)               │  │
│   │  Cmd+; "Talk to creature" overlay (async chat, root context)     │  │
│   │  Cmd+T spawn terminal tab (lands in Terminal Space)              │  │
│   │  Notification gutter (sleep pressure, dream cycles, alerts)      │  │
│   │  Theme system (Olive Glass · Lain · Tahoe · Xbox-blade)          │  │
│   └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└────────────────────┬─────────────────────────────────────────┬───────────┘
                     │ HTTP + WebSocket                        │ pty
                     ▼                                         ▼
   ┌────────────────────────────────────┐    ┌──────────────────────────┐
   │  ForgeFrame daemon (existing)      │    │  Embedded Claude Code    │
   │  HTTP :3001 + MCP stdio + SSE      │    │  pty subprocess(es)      │
   │  Memory engine + Hebbian + Dream   │    │  themed (Olive / Lain)   │
   │  Guardian + me:state + Roadmap     │    │  per Terminal Space tab  │
   │  + new CREATURE-OS service layer:  │    └──────────────────────────┘
   │    /goals, /channels, /projects,   │
   │    /jobs, /conversations,          │
   │    /github-mirror, /a2a            │
   └─────────────────┬──────────────────┘
                     │
   ┌─────────────────┴─────────────────────────────────────────────────┐
   │  Local SQLite stores                                              │
   │   ~/.forgeframe/memory.db    (existing, ~16MB, 700+ memories)    │
   │   ~/.creature/state.db       (NEW — goals, channels, projects,   │
   │                              conversations index, github mirror) │
   └───────────────────────────────────────────────────────────────────┘

   ┌───────────────── Already running (launchd) ───────────────────────┐
   │  com.forgeframe.server      (HTTP :3001)                          │
   │  com.distillery.server      (Flask :3456 — intake)                │
   │  com.distillery.worker      (worker.py polling)                   │
   │  com.distillery.mlx         (MLX-LM :8081, Qwen3-32B-6bit local)  │
   │  com.distillery.telegram    (outbound bot)                        │
   │  com.forgeframe.voice-widget (Swift app)                          │
   └───────────────────────────────────────────────────────────────────┘

   ┌────────── PWA mobile mirror (read-only V1, write later) ──────────┐
   │  Same Spaces, simplified per-Space layout                         │
   │  Feed Tab pattern from Apr 22 marathon as prior art               │
   └───────────────────────────────────────────────────────────────────┘
```

Two-runtime: **Tauri 2.x desktop shell** (front + tray + window mgmt + embedded pty) + **Python FastAPI sidecar** = the existing ForgeFrame daemon plus a thin CREATURE-OS service layer for goals/channels/projects/jobs/conversations/github-mirror/a2a state.

All data local. No cloud sync. Sovereignty intact.

## The 7 Spaces

Full-screen, swipe/keyboard between them, persistent state per Space.

### 1. Today (default landing)
Top-3 attention items creature thinks matter, recent dispatches across all organs, pending approvals, sleep pressure + Guardian temp gauge, stalled threads, what's hot from Distillery feed, calendar context (next 24h), conversation tracker mini-view ("3 stalled, 1 with creature waiting on you"). The morning surface.

### 2. Projects (Mission Control grid)
Tile per project: status badge, last-touched timestamp, hot threads count, hero glyph. Includes ForgeFrame, Reframed, Cipher, dad-watch, Loom, Distillery, Voice Widget, Business OS, Marketing organ (when scoped), and any new project. Click any tile → project drill (per-project Business OS pattern, see Module F).

### 3. Channels (Slack-style)
Left rail = channels, main pane = channel feed, right rail (collapsible) = channel members + pinned items. Channel types in Module A.

### 4. Goals
Every goal you've set. Default view: "this week" top-N by recency × strength. Each goal: title, owner (you / sub-bot / organ), status (active/blocked/completed/archived), parent project, child threads, evidence links. Drill into any goal → evidence trail. Sub-bots can propose goals from drift detection; founder approves.

### 5. Models
LoRA training UI (Vision sprint Phase 8 surface), model swap panel, cost/usage/rate-limit dashboard per provider (Anthropic, DeepSeek, MagIC, OpenAI), Vision-qwen-v1 status (training run, eval suite results, deployment state), local Ollama registry (Qwen3-32B-6bit on :8081 already live), MLX server health, key vault status.

### 6. Memory
**The existing Cockpit base spec (`2026-04-09-cockpit-design.md`) mounted as one Space.** WebGL2 graph (10k+ nodes), semantic zoom, memory editor (tabs, inline markdown, Obsidian-grade), node context menu, dream journal viewer, consolidation/contradiction queues, Hebbian heatmap, **Graph of Me sub-pane** (live-bound to ForgeFrame memory, per-organ overlays, time-zoom — the existing `~/vision/reflection/graph-of-me.html` upgraded from static JSONL). Wave B/C/D/E/F polish ships in parallel against this Space.

### 7. Terminal
Embedded forgeframe-themed Claude Code session(s), spawned as pty inside Tauri. Multiple terminal tabs in this Space. **The Approach 3 layer baked in.** Slash-command surfaces views from other Spaces inline (`/today`, `/projects/cipher`, `/goals`, `/memory/search "loom"`). Model swap inline (`/model claude-haiku-4-5`, `/model qwen3-32b-mlx`). **Apple Terminal absorbed.**

## Universal layer (always available)

- **Top bar:** Space switcher · tab name · clock · uptime · Daemon-0 health pulse · Guardian temperature pip · MLX/MCP status pips · sea angel (*Clione limacina*) breathing mark per memory `3868f624`
- **Cmd+K palette:** universal search/jump across any project, channel, Space, file, memory, dispatch, goal, past conversation. The thing that turns "I have 50 tabs and 40 conversations" into one search box.
- **Cmd+; "Talk to creature" overlay:** floating chat tied to root context. Talk to creature *as creature* from any Space without leaving current Space. Async — creature can answer later if it wants to think first. Default model: DeepSeek; swap inline.
- **Cmd+T:** spawn new Terminal tab in Terminal Space (or focus existing).
- **Notification gutter:** low-priority toasts (sleep pressure threshold crossed, dream cycle complete, blindspot alert from Loom, channel mention, goal milestone, archive batch progress).
- **Theme system:** see Aesthetic section below.

## Module specs

### A. Slack-style Channels module + sub-bot model

Channel types:
- **Project channels** (`#reframed`, `#cipher`, `#dad-watch`, `#loom`, `#distillery`, `#forgeframe`, etc.) — one per project
- **Persona team channel** (`#team`) — all 8 personas always-on members
- **Topic channels** (`#family`, `#money`, `#applications`, `#general`)
- **Organ status channel** (`#status`) — heartbeat, dream events, Guardian alerts, archive progress, launchd health
- **Distillery feed channel** (`#feed`) — incoming distilled items, routable to project channels via context routing rules

**Live persona team channel (`#team`):**
- All 8 personas (Dev Okafor `@swe`, Mara Voss `@system-architect`, Kai `@product-manager`, Ellis `@consultant`, Noa `@creative-director`, Sam `@devsecops`, Lena `@ux`, the CFO `@cfo`) as persistent members
- DM any single persona for a 5-min question (`@swe → DM`)
- "Pull aside" two personas into ad-hoc threaded sub-conversation (`@swe + @system-architect, pull aside re: Loom router latency`)
- Run full meeting on demand — `/teammeeting [topic]` slash command in `#team` triggers existing teammeeting skill, meeting note auto-saves to `~/.claude/personas/notepad/YYYY-MM-DD-topic.md`
- Personas hold persistent context — read past notes + this channel's history before responding
- Realistic chemistry preserved (Dev allies with Mara on implementation reality; Noa pushes back on Ellis on strategic framing; Sam alliances with Mara on infra/sovereignty)

**Sub-bot model:**
- `/spawn @bot-name purpose: "..."` creates a sub-bot as channel member
- Each sub-bot: system prompt, tool access scope, context bound to its channel
- Examples: `@research-bot` (Explore subagent), `@scrub-bot` (voice consistency pass), `@calibration-bot` (Cipher Brier-score updater), `@watcher-bot` (GitHub trending against goals)
- Manage via `/list-bots`, `/kill @bot`, `/edit @bot`, `/bot-status @bot`
- Sub-bots speak in channel + can be DM'd

**Real-time:** WebSocket via existing SSE pattern (Feed Tab Apr 22 prior art). Message types: human text, agent dispatch result, file drop, distillery item, organ status event, persona response, sub-bot response.

**Mentions / threads:** `@persona`, `@bot`, `@channel`, `@here`, project mentions, threaded inline replies (Slack-style).

**DMs:** open 1:1 thread with any persona/bot/sub-bot from channel.

### B. GitHub watcher organ

Background daemon polls trending GitHub repos every N hours (configurable, default 4h). Scores each against active goals from Goals Space using **local Ollama embeddings** (no phone-home — sovereignty intact). Surfaces top matches as "creature noticed" cards in Today + as a tile in Projects Space. Click → creature explains relevance + suggested action (read / fork / scavenge / ignore / add-to-watch).

**Local-vs-public mirror:** indexes `~/repos/` + `gh api user/repos`. Drift detection: "you have 3 commits on Reframed not pushed", "this GitHub repo (`acampos/old-thing`) has 0 local checkout — clone or archive?", "this repo has 12 unmerged PRs across 3 branches".

Lives as Today widget + Projects Space tile + `#feed` channel routing for high-relevance hits.

### C. Goals page wiring

Goals stored in ForgeFrame memory tagged `goal:active`, `goal:blocked`, `goal:completed`, `goal:archived`. Each goal record:
- `title` (short, action-shaped: "ship Loom sensor layer", "land Anthropic interview")
- `owner` (you / sub-bot / organ — e.g. `@research-bot` for "scout 5 more aligned-AI orgs")
- `status` (active / blocked / completed / archived)
- `parent_project` (FK to project)
- `child_threads[]` (links to conversation threads in Channels)
- `evidence_links[]` (memory IDs, dispatch IDs, file paths, commit SHAs)
- `created_at`, `updated_at`, `due_date?`

Default view: "this week" top-N by recency × strength. Drill any goal → evidence trail. Sub-bots can propose goals from drift detection (Loom reflector finds "you've been on essays 3 days, no Reframed activity" → proposes goal "ship Reframed Phase 3 signups by Friday"); founder approves/edits/dismisses.

### D. A2A surface (sub-pane in Channels + accessible from Models)

Agent-to-agent comms visible to founder. When Hermes (or current Agent dispatching) spawns sub-agents, they coordinate via channel-style messages in `#a2a`. Founder can interject / pull aside / kill / re-prompt. Trust gates per Daemon-β trust spec when it ships. Built on top of existing `forge-swarm-viewer` pattern (named-agent + role-badge work, mem `13a57df6`).

### E. Conversation tracker (sub-pane in Today, queryable from Cmd+K)

Indexes every Claude Code session (157 in `.claude/projects/-Users-acamp/` per inventory), every channel conversation, every persona DM, every distillery thread. Surface in Today: *"you've been in 12 conversations this week. 3 stalled. 1 with creature waiting on you."* Click → drop into the conversation context.

Solves the 40-conversations-open problem explicitly. The first time CREATURE OS ships, it indexes existing transcripts; thereafter it watches new conversations as they happen via SessionEnd hook.

### F. Business OS per project (Projects Space drill)

Each project tile, on click, opens its own mini Business OS view — the existing `localhost:3333` pattern, generalized as a per-project component:
- Financials (where applicable — Cipher P&L, Reframed MRR, dad-watch sales)
- Recent activity (last N dispatches, commits, file changes, conversation threads)
- Agent status (active sub-bots, in-flight LangGraph nodes, etc.)
- Current goals (filter Goals Space by `parent_project = self`)
- Recent dispatches (filter Loom telemetry by `project = self`)
- Related memories (search ForgeFrame for `project:self` tag)
- GitHub state (commits ahead/behind, open PRs, issues, GH Actions status)
- Files (project root tree, recently modified)
- Todos

One pattern, N instances, each scoped to project context.

### G. Memory of Me + Graph of Me (Memory Space sub-pane)

The existing `~/vision/reflection/graph-of-me.html` (216KB single-file primitive, 175 events on 11 thread lanes, memory `76d5c5b3`) mounted as a Memory Space pane. Upgraded from static JSONL to **live-bound** to ForgeFrame memory. Per-organ overlays (filter by Cipher / Reframed / Distillery / Guardian / Loom). Time-zoom (year → month → week → day grain). Adversarial mode: pin two events, ask why they correlate. Dream-mode: NREM cycles surface graph-of-me overlays during sleep window.

The "Memory of Me" structure (rich markdown editor, all 700+ memories navigable, the architecture itself navigable) lives as a sub-file thing inside Memory Space — preserved as you specified.

### H. Embedded terminal + themed CLI launcher

Tauri spawns pty subprocesses. CLI is themed (Olive Glass / Lain modes via shell prompt + color overrides). Multiple tabs in Terminal Space. Slash commands surface views from other Spaces inline:
- `/today` → renders Today view in pane
- `/projects/cipher` → renders Cipher project drill
- `/goals` → renders Goals page
- `/memory/search "loom"` → renders memory results
- `/dispatch <task>` → spawns Agent (sub-bot or one-shot)
- `/model <slug>` → swap model for current session

Cmd+T from any Space spawns new terminal tab. Apple Terminal becomes optional.

## Aesthetic system

| Space | Default theme | Why |
|-------|---------------|-----|
| Today | Olive Glass | warm landing, the morning surface |
| Projects | Xbox-blade | bold layered tiles, Mission Control |
| Channels | Tahoe | translucent depth, Slack/Discord depth feel |
| Goals | Olive Glass | warm, focused |
| Models | Olive Glass + amber pulse | calm but data-dense |
| Memory | Olive Glass | matches existing Cockpit |
| Terminal | Lain | dense mono, scanlines, cyberpunk |

**Sliding transitions:** macOS Spaces-style, ~250ms cubic-bezier. Three-finger swipe / Ctrl+Arrow keyboard.

**Iconography:** Lucide React (matches dad-watch organ design conventions) + custom **Clione limacina (sea angel)** mark for CREATURE itself per memory `3868f624`. Sea angel breathes/pulses in top bar as a tiny live identity mark.

**Typography:** Inter (or `Berkeley Mono` for Lain Terminal Space — addresses the "want to differentiate from Claude Code default font" note from earlier). Body 15-16px minimum (matches dad-watch organ design conventions for older eyes).

**Color tokens:** locked in `frontend/styles/tokens.css`, theme switcher swaps token sets per-Space.

**No emojis in UI** (matches dad-watch design conventions). Lucide icons only.

## Data model

### Existing (already in `~/.forgeframe/memory.db`)
`watches` (used by ForgeFrame existing engine), `photos`, `events`, `checkpoints`, `oauth_tokens`, `reference_db` — all already shipped per ForgeFrame inventory. Memory schema v10. ~700 memories. ~10K Hebbian edges.

### New (in `~/.creature/state.db`)

```sql
-- One row per project (Reframed, Cipher, dad-watch, Loom, etc.)
CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  repo_path       TEXT,
  github_url      TEXT,
  status          TEXT,                       -- live | beta | built | spec | concept | stale
  bucket          TEXT,                       -- domain | meta | gateway | engine
  hero_glyph      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- One row per goal
CREATE TABLE goals (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  owner           TEXT,                       -- "you" | "@bot-name" | "@organ-name"
  status          TEXT NOT NULL,              -- active | blocked | completed | archived
  parent_project  TEXT REFERENCES projects(id),
  due_date        INTEGER,
  evidence_links  TEXT,                       -- JSON array of refs
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- One row per channel
CREATE TABLE channels (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,              -- "#cipher", "#team", "#feed"
  kind            TEXT NOT NULL,              -- project | persona-team | topic | organ-status | distillery-feed
  parent_project  TEXT REFERENCES projects(id),
  created_at      INTEGER NOT NULL
);

-- Channel members (humans, personas, sub-bots)
CREATE TABLE channel_members (
  channel_id      TEXT NOT NULL REFERENCES channels(id),
  member_id       TEXT NOT NULL,              -- "you" | "@swe" | "@research-bot"
  member_kind     TEXT NOT NULL,              -- human | persona | subbot
  joined_at       INTEGER NOT NULL,
  PRIMARY KEY (channel_id, member_id)
);

-- All channel messages
CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  channel_id      TEXT NOT NULL REFERENCES channels(id),
  author_id       TEXT NOT NULL,
  thread_root     TEXT,                       -- if replying in thread
  body            TEXT NOT NULL,
  message_kind    TEXT NOT NULL,              -- human | agent | file | distillery | organ-status | system
  created_at      INTEGER NOT NULL
);

-- Sub-bot definitions
CREATE TABLE subbots (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,       -- "@research-bot"
  channel_id      TEXT NOT NULL REFERENCES channels(id),
  system_prompt   TEXT NOT NULL,
  tool_access     TEXT NOT NULL,              -- JSON of allowed tools
  status          TEXT NOT NULL,              -- live | paused | killed
  created_at      INTEGER NOT NULL
);

-- Conversation tracker index
CREATE TABLE conversations (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,              -- claude-code-session | channel-thread | persona-dm | distillery-thread
  title           TEXT,
  status          TEXT NOT NULL,              -- active | stalled | waiting-on-you | waiting-on-creature | resolved
  last_active     INTEGER NOT NULL,
  ref             TEXT NOT NULL               -- file path / channel/thread / etc.
);

-- GitHub mirror state
CREATE TABLE github_repos (
  id              TEXT PRIMARY KEY,           -- owner/name
  is_local        INTEGER NOT NULL,
  local_path      TEXT,
  is_remote       INTEGER NOT NULL,
  remote_url      TEXT,
  commits_ahead   INTEGER,
  commits_behind  INTEGER,
  open_prs        INTEGER,
  last_synced     INTEGER NOT NULL
);

-- A2A messages (parallel to messages but agent-to-agent)
CREATE TABLE a2a_messages (
  id              TEXT PRIMARY KEY,
  parent_dispatch TEXT NOT NULL,              -- the originating Hermes/Loom dispatch
  from_agent      TEXT NOT NULL,
  to_agent        TEXT NOT NULL,
  body            TEXT NOT NULL,
  trust_status    TEXT NOT NULL,              -- AUTO | ASK | NEVER (per Daemon-β)
  created_at      INTEGER NOT NULL
);
```

## Workflow / data flow per Space

| Space | Reads from | Writes to |
|-------|-----------|-----------|
| Today | ForgeFrame memory (recent + roadmap), `messages`, `conversations`, `goals`, dispatch log, calendar (Google Calendar MCP), Distillery `#feed` | `goals` (when accepting bot-proposed goal), conversation status updates |
| Projects | `projects`, `goals` (filtered), dispatch log (filtered), ForgeFrame memory (filtered by project tag), `github_repos`, repo file system | `projects`, project notes |
| Channels | `channels`, `messages`, `subbots`, `channel_members`, ForgeFrame memory (linked) | `channels`, `messages`, `subbots`, `channel_members`, ForgeFrame memory (saved snippets) |
| Goals | `goals`, ForgeFrame memory (`goal:*` tags) | `goals` |
| Models | Provider APIs (cost/usage), MLX server status, Ollama registry, LoRA training state | training run config, model swap state |
| Memory | ForgeFrame memory (full), `~/vision/reflection/graph-of-me.html` data | ForgeFrame memory (edits via existing memory editor) |
| Terminal | spawned pty processes, Claude Code state | local file system, ForgeFrame memory (via MCP tools) |

## Error handling

| Failure | Behavior |
|---------|----------|
| ForgeFrame daemon down | Top bar pulse red, Spaces show "engine offline, restart?", Terminal opens diagnostic, attempt auto-restart via launchd |
| MLX :8081 down | Models Space flags red, auto-fallback to cloud per existing distillery `.env` config (`FALLBACK_MODEL=claude-haiku-4-5-20251001`) |
| Distillery worker down | `#feed` channel pauses, status pip red, archive batch resumes from last checkpoint when worker recovers |
| Sub-agent dies / hangs | Visible in `#a2a`, founder can `/kill @bot` / restart / re-prompt |
| Channel WebSocket drop | Visual reconnect indicator, message buffer flushes on reconnect (idempotent message IDs) |
| Memory MCP bridge bug (current array-tags + integer-limit) | Logged + retried with workaround until upstream fixed (folds into Layer 0 of tonight's pre-sprint) |
| GitHub watcher rate-limited | Backoff per-source, surface in Today as "GitHub watch paused — quota in 47min" |
| Persona context overflow | Trim oldest channel history before re-prompt; warn in `#status` if trim exceeded threshold |

## Testing strategy

- **E2E** (Playwright on Tauri webview): open CREATURE → land on Today → swipe to Projects → click Cipher → drill → return → Channels → spawn `@research-bot` in `#feed` → DM `@system-architect` → run `/teammeeting Loom router design` in `#team` → close
- **Unit** on FastAPI sidecar endpoints (per existing Cockpit and dad-watch patterns)
- **Persona simulation tests** — deterministic outputs given canned context (using same fixture pattern as existing teammeeting skill)
- **Theme switching** round-trips per Space
- **Memory writes** — every CREATURE-OS write to ForgeFrame memory tested for tag canonicalization (post-consolidation pass — see related work below)
- **NOT tested** — third-party libraries (Tauri, Lucide, sonner), upstream OSS mounted as panes

## In scope (v1)

- Tauri shell with 7 Spaces + universal layer + theme system
- All 7 Spaces functional with V1 depth (richer per-Space drill comes in V1.1+)
- Slack-style Channels + persona team channel + sub-bot spawn/manage/kill
- GitHub watcher organ V1 (background poll + Today surface + drift detection)
- Goals page V1 (CRUD + bot-proposed goal flow)
- Models Space V1 (read-only dashboard; LoRA training launch button stubbed → opens existing CLI)
- Memory Space = mounted Cockpit base spec (Wave A) + Graph of Me sub-pane
- Embedded terminal + themed CLI launcher + slash-command Space surfacing
- Conversation tracker V1 (read-only across existing transcripts + new SessionEnd-hook indexing)
- Business OS per project V1 (status + recent activity + goals + memories)
- A2A surface V1 (read-only — interaction comes with Daemon-β trust gates)
- ForgeFrame daemon CREATURE-OS service layer (new endpoints + new SQLite store)
- Sea angel breathing mark in top bar
- macOS Spaces-style sliding transitions

## Out of scope (defer to v1.1+)

- PWA mobile mirror with full write capability (V1 = read-only)
- Cockpit Wave B/C/D/E/F polish (ships parallel against Memory Space)
- LoRA training UI full interactivity (V1 stubs, V1.1 wires)
- Full Hermes integration (Daemon-v1 dependency, target Jul 24)
- Sub-bot persistence across reboots (V1 in-memory only)
- A2A trust-gate enforcement (Daemon-β dependency, target Jun 26)
- Marketing organ as a project tile (needs own brainstorm first)
- Apache Superset integration for Business OS per project (existing TODO `256fd2c3`)
- Cross-device sync (sovereignty principle — local-first, no sync in V1)
- Full CalDAV / iCloud calendar integration (Google Calendar MCP only V1)
- iMessage AI bot (blocked on dedicated 2nd Apple ID, mem `f05ef437`)

## What this design assumes

- ForgeFrame daemon stays running on `:3001` (already true via launchd)
- MLX Qwen3-32B-6bit stays on `:8081` (already true via launchd)
- Distillery worker continues processing the 2,638-item archive batch (already true, currently 184/2638)
- Cockpit base spec implementation continues per Wave B/C plan (parallel — Memory Space mounts whatever Cockpit becomes)
- Vision LoRA training proceeds per Vision sprint Phase 8 (parallel)
- Daemon-α/β/v1 timeline holds (Jun 5 / Jun 26 / Jul 24 — A2A trust gates and Hermes land into existing surfaces)
- Loom meta-organ ships per its own spec drafted from `~/.claude/personas/notepad/2026-04-25-loom-organ-design.md` — its sensor populates `dispatch:*` memories CREATURE OS surfaces in Today/`#a2a`
- The pre-creature consolidation pass runs (tonight's layered sprint) — fixes MCP bridge bugs, allowlists 5 introspection tools, absorbs `/caveman` `/skill-creator` `/insights` patterns
- Reframed file consolidation runs before CREATURE OS ships — collapses `career-ops`, `resume-tailor`, `jarvis`, `forgefind-job` aliases into the canonical `Reframed` repo so the Projects Space tile has one canonical project to point at

## Open questions (acknowledged, defer to writing-plans)

1. **Cockpit Wave B/C/D/E/F sequencing** relative to CREATURE OS shell shipping — recommendation: Cockpit-as-Memory-Space ships at Wave A; Wave B/C polish parallel
2. **Persona context budget** — how much history each persona holds; risk of bloat. Recommendation: rolling window of last N channel messages + their own past notepad files only
3. **A2A trust-gate design** — folds into Daemon-β work. V1 of CREATURE OS surfaces A2A read-only
4. **Mobile PWA V1 scope** — read-only for which Spaces? Recommendation: Today, Channels (read), Memory (read) — write comes V1.1
5. **Embedded terminal session model** — one Claude Code per terminal tab vs shared session. Recommendation: one-per-tab (simpler state, matches user mental model of "each tab is a workspace")
6. **"Talk to creature" overlay model** — default DeepSeek, swap inline (no preference locked)
7. **Goal taxonomy / parent-child structure** — flat per-project V1, hierarchy V1.1 if needed
8. **Marketing organ** — needs own brainstorm; the user saw a repo, hasn't been recon'd; tracked as future work
9. **ASCII angel fish breathing in top bar** — design detail, V1 (renders in canvas, ~12fps subtle pulse)
10. **Multi-window** — V1 single window, full-screen Spaces. V1.1 considers multi-window for Cockpit pop-out + Terminal pop-out

## Implementation phasing (high-level — detailed plan in writing-plans)

```
PHASE 1 — Shell foundation                   (~1 week, 12-15 tasks)
  Tauri scaffold + universal layer + Top bar + Cmd+K palette stub +
  theme system + sliding transitions + sidecar layer (new endpoints +
  ~/.creature/state.db schema + Alembic migration)
  END STATE: open CREATURE, swipe between empty Spaces, Top bar live

PHASE 2 — Core Spaces                        (~1 week, 15-18 tasks)
  Today (data wiring) + Memory (mount Cockpit base) + Terminal (pty +
  themed shell) + Cmd+T spawn flow + slash-command Space surfacing
  END STATE: usable for daily morning routine; Cockpit fully accessible
  inside CREATURE; Apple Terminal can be closed

PHASE 3 — Projects + Goals + Models          (~1 week, 12-15 tasks)
  Projects Mission Control grid + per-project Business OS drill +
  Goals CRUD + Models read-only dashboard + LoRA training stub
  END STATE: can navigate every project from one place; goals visible

PHASE 4 — Channels + Sub-bots + A2A          (~1 week, 18-22 tasks)
  Channels Slack-style UI + persona team channel (#team) + sub-bot
  spawn/manage + WebSocket realtime + Distillery feed routing +
  A2A read-only surface
  END STATE: live persona channel works; can spawn @research-bot;
  conversation in channel persists; #feed routes distillery items

PHASE 5 — GitHub watcher + Conversation tracker + polish  (~1 week, 12-15 tasks)
  GitHub watcher organ daemon + local-vs-public mirror + drift detection +
  Conversation tracker indexing existing 157 sessions + V1 PWA mirror +
  ASCII sea angel + per-Space theme polish + production installer
  END STATE: CREATURE OS V1 — signed installer, dad-watch-organ design
  conventions honored, ready to use as primary surface
```

Each phase ships a runnable intermediate. Implementation plan (via writing-plans skill) decomposes each phase into bite-sized TDD tasks per superpowers convention.

## Cross-links

- **Builds on:** `2026-04-09-cockpit-design.md` (Cockpit base — mounted as Memory Space)
- **Builds on:** `2026-04-22-cockpit-agent-dispatch.md` (dispatch surface — folds into Channels + A2A)
- **Builds on:** `2026-04-13-hermes-dreaming-design.md` (Hermes integration — A2A surface enables this)
- **Builds on:** `2026-04-12-signal-system-design.md` (Signal aesthetic — informs theme system)
- **Builds on:** `2026-04-18-vision-on-laptop-v1.md` (Vision sprint — Models Space surfaces Phase 8 LoRA)
- **Builds on:** `2026-04-20-daemon-v1/` (Daemon-α/β/v1 timeline — A2A trust gates land here)
- **Builds on:** `~/.claude/personas/notepad/2026-04-25-loom-organ-design.md` (Loom meta-organ — populates dispatch memories CREATURE surfaces)
- **Builds on:** `~/vision/snapshots/2026-04-25-creature-COMPLETE.md` (full inventory snapshot — the basis for "what goes in CREATURE OS")
- **Builds on:** `~/repos/dad-watch-organ/docs/superpowers/specs/2026-04-25-dad-watch-organ-design.md` (design conventions: no emojis, Lucide icons, 15-16px+ body, plain English, single loud primary action, accessible by default)
- **References for visual identity:** memory `3868f624` (Clione limacina sea angel mark), memory `b6b31539` (SIGNAL aesthetic brainstorm)
- **References for naming:** memory `25ff956b` (CREATURE acronym), memory `9dd82ef8` (Vision = creature has a name — reconciled here as Vision = LoRA model codename)
- **Constitutional anchors:** memory `a3c03218` (OSS strategy: ForgeFrame open, CREATURE proprietary), memory `600b7b40` (sovereignty: cognitive data stays local), memory `59594bb0` (Guardian IS ForgeFrame finished), memory `a0542744` (Strange Loop thesis)
- **Threats / contrasts:** Sigil Wen WEB 4.0 / Conway / Automaton (Feb 17, 2026) — CREATURE OS is the user-owned, constitutionally-tethered, autopoietic counter-thesis. Buterin's "mecha suits for the human mind" frame is the cultural anchor.
