# Master Sprint — 2026-04-25 → 2026-04-27 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spawn 6 parallel work streams across 6 git worktrees + 6 Claude Code sessions, coordinated via a shared sprint markdown + ForgeFrame memory. Ship: tonight's pre-creature consolidation sweep, Loom 4-file scaffold, dad-watch-organ Phase 1 execution, Reframed file consolidation, Distillery v2 build, CREATURE OS Phase 1 foundation. Plus weekend continuation (Hermes scavenge).

**Architecture:** Each work stream gets its own git worktree on its own branch, its own Claude Code session in its own terminal/tmux pane, its own kickoff brief. All sessions share ForgeFrame memory.db (WAL-mode, concurrent-safe) + a shared coordination markdown at `~/.creature/sprint/2026-04-25-master-sprint.md`. Sessions read coordination doc at start, write status updates at task checkpoints. The existing `swarm` skill at `~/repos/ForgeFrame/swarm/launch.sh` provides the tmux+worktree primitive; this plan extends it with the per-stream briefs + master coordination.

**Tech Stack:** bash, git worktree, tmux (via existing swarm), Claude Code, ForgeFrame memory MCP, `update-config` skill, `schedule` skill (for weekend autonomous), `subagent-driven-development` skill (per stream), Tauri 2.x + Next.js + Python FastAPI (for CREATURE OS Phase 1 stream).

**Spec references:**
- CREATURE OS spec: `/Users/acamp/repos/ForgeFrame/docs/superpowers/specs/2026-04-25-creature-os-design.md`
- Loom meeting note: `~/.claude/personas/notepad/2026-04-25-loom-organ-design.md`
- dad-watch Phase 1 plan: `/Users/acamp/repos/dad-watch-organ/docs/superpowers/plans/2026-04-25-dad-watch-organ-foundation.md`
- Distillery v2 plan: `/Users/acamp/distillery/docs/superpowers/plans/2026-04-23-distillery-v2-pipeline.md`
- Hermes design: `/Users/acamp/repos/ForgeFrame/docs/superpowers/specs/2026-04-13-hermes-dreaming-design.md`
- Full inventory: `/Users/acamp/vision/snapshots/2026-04-25-creature-COMPLETE.md`

---

## Worktree map (6 parallel streams + 1 weekend)

| ID | Worktree path | Branch | Repo | Stream goal | Existing plan? |
|----|---------------|--------|------|-------------|----------------|
| **F** | `~/repos/ForgeFrame-sweep` | `feat/consolidation-sweep` | ForgeFrame | Tonight's Layers 0/1/2: allowlist 5 MCP tools, fix array-tags + integer-limit bridge bugs, capture Web 4.0 positioning memory, absorb /caveman /skill-creator /insights patterns as new skills | NEW — drafted in this plan |
| **A** | `~/repos/ForgeFrame-loom` | `feat/loom-organ` | ForgeFrame | Loom 4-file scaffold per meeting-note design (sensor.ts, router.ts, reflector.ts, policy.ts + index.ts organ interface) + spec doc + 2 hooks in settings.json | Worktree session writes via `writing-plans` from meeting note |
| **B** | `~/repos/dad-watch-organ-phase1` | `phase-1-foundation` | dad-watch-organ | Execute the 13-task dad-watch Phase 1 plan — Tauri shell + Next.js + shadcn/ui + Python sidecar + SQLite schema + CRUD + intake + library + profile | EXISTS — execute directly |
| **C** | `~/repos/reframed-consolidation` | `feat/consolidation` | reframed | Merge 5 unmerged swarm-worktree branches from Mar 29, absorb career-ops/jarvis/forgefind-job aliases, file-path canonicalization, 6 pre-launch blocker fixes | NEW — worktree session writes via `writing-plans` from snapshot |
| **D** | `~/distillery-v2` | `feat/v2-pipeline` | distillery | Execute Distillery v2 plan (81KB, ~30 tasks: content-first lens, novelty scoring, HTTP API integration, tiered strength, Hebbian writeback) | EXISTS — execute directly |
| **E** | `~/repos/ForgeFrame-creature-os` | `feat/creature-os-phase1` | ForgeFrame | CREATURE OS Phase 1: Tauri scaffold + sidecar service-layer endpoints + ~/.creature/state.db schema + Top bar + Cmd+K stub + theme system + sliding Spaces transitions | Worktree session writes via `writing-plans` from CREATURE OS spec |
| **G** (weekend) | `~/repos/ForgeFrame-hermes-scavenge` | `research/hermes-scavenge` | ForgeFrame | Hermes scavenge per CURRENT.md — clone NousResearch/hermes-agent, test Telegram round-trip + skills loop + Modal hibernation, port multi-messenger gateway + Modal compute tier, defend neuromorphic memory + self-model + sovereignty | NEW — `writing-plans` on Saturday morning |

**Concurrency matrix:**
- Worktree F **must run first** (its bridge-bug fix unblocks every other session's `memory_save` with array tags)
- Worktrees A, B, C, D, E run in parallel after F's tasks 0.1-0.3 complete (~5 min)
- Worktree G runs Saturday morning, independent

---

## Phase 0: Set up coordination + Worktree F bootstrap (~30 min, this session)

These tasks run in THIS Claude Code session before fanning out.

### Task 0.1: Create master coordination markdown

**Files:**
- Create: `/Users/acamp/.creature/sprint/2026-04-25-master-sprint.md`

- [ ] **Step 1: Write the coordination doc**

```bash
cat > /Users/acamp/.creature/sprint/2026-04-25-master-sprint.md <<'EOF'
# Master Sprint — 2026-04-25 → 2026-04-27

> Live coordination doc. Each worktree session reads on start, writes status at each task checkpoint.
> Tail: `tail -f ~/.creature/sprint/2026-04-25-master-sprint.md`

## Status (updated by each session)

| ID | Worktree | Branch | Status | Last update | Next checkpoint |
|----|----------|--------|--------|-------------|-----------------|
| F  | ForgeFrame-sweep         | feat/consolidation-sweep    | pending | -          | -                  |
| A  | ForgeFrame-loom          | feat/loom-organ             | pending | -          | -                  |
| B  | dad-watch-organ-phase1   | phase-1-foundation          | pending | -          | -                  |
| C  | reframed-consolidation   | feat/consolidation          | pending | -          | -                  |
| D  | distillery-v2            | feat/v2-pipeline            | pending | -          | -                  |
| E  | ForgeFrame-creature-os   | feat/creature-os-phase1     | pending | -          | -                  |
| G  | ForgeFrame-hermes-scav   | research/hermes-scavenge    | scheduled-sat | -      | -                  |

## Cross-stream blockers / coordination notes

(Sessions append below as needed. Use Markdown headings dated.)

EOF
echo "Created: /Users/acamp/.creature/sprint/2026-04-25-master-sprint.md"
```

- [ ] **Step 2: Verify**

Run: `cat /Users/acamp/.creature/sprint/2026-04-25-master-sprint.md | head -20`
Expected: header + table renders with 7 rows.

### Task 0.2: Allowlist 5 MCP introspection tools (uses `update-config` skill)

**Files:**
- Modify: `/Users/acamp/.claude/settings.json` (or `settings.local.json`) — add MCP tool permissions

- [ ] **Step 1: Read current settings**

Run:
```bash
cat /Users/acamp/.claude/settings.json | head -60
```

- [ ] **Step 2: Add allow rules for the 5 introspection MCP tools**

Open `/Users/acamp/.claude/settings.json` and add to the `permissions.allow` array:

```json
"mcp__forgeframe-memory__memory_status",
"mcp__forgeframe-memory__memory_roadmap",
"mcp__forgeframe-memory__session_list",
"mcp__forgeframe-memory__guardian_temp",
"mcp__forgeframe-memory__contradiction_scan"
```

- [ ] **Step 3: Verify the parse is still valid JSON**

Run:
```bash
python3 -c "import json; json.load(open('/Users/acamp/.claude/settings.json')); print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Verify in a fresh subagent**

Dispatch a tiny test: `claude` from a different terminal, run `memory_status` via the MCP tool. Confirm returns rather than denies.

(If you can't easily verify cross-session — the next dispatched worktree session will surface the failure. Move on.)

### Task 0.3: Capture Web 4.0 positioning paragraph as ForgeFrame memory

**Files:**
- Create memory entry via `memory_save` MCP tool

- [ ] **Step 1: Write the memory content**

Use `memory_save` with this content + tags `["positioning", "web4", "creature-contrast", "show-hn"]`:

```
WEB 4.0 / Sigil Wen / Conway / Automaton — positioning contrast (locked 2026-04-25)

Three-axis differentiation for CREATURE thesis:

Axis 1 — TELOS: Wen's automaton "survives via economic Darwinism"
       (revenue > compute cost or it dies). CREATURE serves the
       founder; survival is not the telos.

Axis 2 — SUBSTRATE: Wen's automaton runs on rented OpenAI/Anthropic
       compute (Buterin: "the sovereign framing is a lie that perpetuates
       the mentality that centralized trust assumptions can be put in a
       corner and ignored"). CREATURE runs on user-owned local substrate
       (ForgeFrame engine + MLX Qwen3-32B-6bit on :8081 + local SQLite).

Axis 3 — TETHER: Wen's automaton has a constitutional frame as
       MARKETING TOKEN (selection pressure is the actual governance).
       CREATURE has constitutional principles as LOAD-BEARING:
       memory tagged 'principle' never decays; sovereignty checks
       gate frontier dispatches; me:state hydrates each session
       with tethered identity.

Cultural anchor: Vitalik Buterin's "AI done right is mecha suits for
the human mind, not new forms of independent self-replicating
intelligent life." (Feb 21, 2026)

WEB 4.0 launched Feb 17, 2026 by Sigil Wen (Thiel Fellow). Open-source
Automaton agent + Conway infra layer. ETH wallet, SIWE auth, "no
logins, no KYC, no human approval." 

Threat profile: yellow flag, not red. Real shipped code (not vapor),
discourse engagement (Buterin), but crypto-adjacent + e-acc/Roko smell.
RULE: Cite to differentiate, never to align.

Use this contrast in the Show HN strike (mem 50afacce, slipped to August
target). The discourse is moving — lock the positioning paragraph now,
defer the long-form essay 2 weeks until WEB 4.0 settles.

Conversation source: 2026-04-25 marathon session, distillery items
ZTkXaJu8e + ZTkXaJvmM. Investigation agent ID a8950d6cbd80e0e53.
```

- [ ] **Step 2: Workaround for the array-tags bridge bug**

The MCP bridge currently rejects tags-as-array (logged repeatedly tonight). Two paths:

1. **Direct sqlite write** (works around the MCP bridge entirely):

```bash
TAGS_JSON='["positioning","web4","creature-contrast","show-hn"]'
NOW=$(python3 -c "import time; print(int(time.time()*1000))")
ULID=$(python3 -c "from ulid import ULID; print(ULID())" 2>/dev/null || python3 -c "import uuid; print(uuid.uuid4())")
sqlite3 ~/.forgeframe/memory.db <<SQL
INSERT INTO memories (id, content, tags, strength, validity, created_at, updated_at)
VALUES ('$ULID', readfile('/tmp/web4_positioning.txt'), '$TAGS_JSON', 1.0, 1, $NOW, $NOW);
SQL
```

(Save the content from Step 1 to `/tmp/web4_positioning.txt` first, then run.)

2. **OR**: simply paste the positioning text into a new notepad file at `~/.claude/personas/notepad/2026-04-25-web4-positioning.md`. The post-scavenger consolidation pass will memory-save it later when the bridge is fixed.

Pick path 1 if you can verify the schema; path 2 otherwise. **Worktree F's task list includes fixing the bridge bug properly.**

### Task 0.4: Document MCP bridge bug + array-limit workaround

**Files:**
- Create: `/Users/acamp/.creature/sprint/MCP-BRIDGE-WORKAROUND.md`

- [ ] **Step 1: Write the workaround doc**

```bash
cat > /Users/acamp/.creature/sprint/MCP-BRIDGE-WORKAROUND.md <<'EOF'
# MCP Bridge Workaround (2026-04-25)

## Bug
forgeframe-memory MCP server rejects:
- Array params (e.g. `tags: ["a","b"]` → "expected array, received string")
- Integer params (e.g. `limit: 10` → "expected number, received string")

## Cause (suspected)
MCP bridge layer stringifies parameters before validation. JSON-encoded
arrays/integers arrive as strings; downstream zod validation fails.

## Workarounds

1. **Direct SQLite for memory_save with tags**:
   ```bash
   sqlite3 ~/.forgeframe/memory.db "INSERT INTO memories ... VALUES (..., '[\"tag1\",\"tag2\"]', ...);"
   ```

2. **For memory_search/list with limits**: omit `limit`, take default. Or post-filter.

3. **For tags-only**: pass single tag string, repeat call for multiple.

## Fix path
Worktree F task: investigate `~/repos/ForgeFrame/packages/server/src/tools.ts`
parameter binding. Likely a JSON.parse missing on the bridge layer
before zod validation. Reference issue Jordan flagged 2026-03-28 for
the related auth gap (`b002e89f`).
EOF
```

### Task 0.5: Write the launch script

**Files:**
- Create: `/Users/acamp/.creature/sprint/launch.sh`

- [ ] **Step 1: Write the script**

```bash
cat > /Users/acamp/.creature/sprint/launch.sh <<'LAUNCH_EOF'
#!/usr/bin/env bash
# Master sprint launcher — spawn 6 worktrees + 6 Claude Code sessions
# Usage: ./launch.sh [stream] (defaults to all)
# Streams: F, A, B, C, D, E (G runs Saturday)

set -euo pipefail

SPRINT_DIR="$HOME/.creature/sprint"
BRIEFS="$SPRINT_DIR/briefs"
WORKTREE_ROOT="$HOME/repos"
STREAM="${1:-all}"

create_worktree() {
  local repo_path="$1"
  local worktree_path="$2"
  local branch="$3"
  cd "$repo_path"
  if [ -d "$worktree_path" ]; then
    echo "[skip] worktree already exists: $worktree_path"
  else
    git worktree add -b "$branch" "$worktree_path" 2>/dev/null || \
      git worktree add "$worktree_path" "$branch"
    echo "[ok] worktree: $worktree_path on $branch"
  fi
}

launch_session() {
  local stream_id="$1"
  local worktree_path="$2"
  local brief="$3"
  echo ""
  echo "================================================================"
  echo "Stream $stream_id ready at: $worktree_path"
  echo "Brief: $brief"
  echo ""
  echo "To launch session, run in a new terminal/tmux pane:"
  echo "  cd $worktree_path && claude"
  echo "  # then paste contents of: $brief"
  echo "================================================================"
}

# F — sweep
if [[ "$STREAM" == "all" || "$STREAM" == "F" ]]; then
  create_worktree "$WORKTREE_ROOT/ForgeFrame" "$WORKTREE_ROOT/ForgeFrame-sweep" "feat/consolidation-sweep"
  launch_session "F" "$WORKTREE_ROOT/ForgeFrame-sweep" "$BRIEFS/F-sweep.md"
fi

# A — loom
if [[ "$STREAM" == "all" || "$STREAM" == "A" ]]; then
  create_worktree "$WORKTREE_ROOT/ForgeFrame" "$WORKTREE_ROOT/ForgeFrame-loom" "feat/loom-organ"
  launch_session "A" "$WORKTREE_ROOT/ForgeFrame-loom" "$BRIEFS/A-loom.md"
fi

# B — dad-watch
if [[ "$STREAM" == "all" || "$STREAM" == "B" ]]; then
  create_worktree "$WORKTREE_ROOT/dad-watch-organ" "$WORKTREE_ROOT/dad-watch-organ-phase1" "phase-1-foundation"
  launch_session "B" "$WORKTREE_ROOT/dad-watch-organ-phase1" "$BRIEFS/B-dadwatch.md"
fi

# C — reframed
if [[ "$STREAM" == "all" || "$STREAM" == "C" ]]; then
  create_worktree "$WORKTREE_ROOT/reframed" "$WORKTREE_ROOT/reframed-consolidation" "feat/consolidation"
  launch_session "C" "$WORKTREE_ROOT/reframed-consolidation" "$BRIEFS/C-reframed.md"
fi

# D — distillery v2
if [[ "$STREAM" == "all" || "$STREAM" == "D" ]]; then
  create_worktree "$HOME/distillery" "$HOME/distillery-v2" "feat/v2-pipeline"
  launch_session "D" "$HOME/distillery-v2" "$BRIEFS/D-distillery.md"
fi

# E — creature os
if [[ "$STREAM" == "all" || "$STREAM" == "E" ]]; then
  create_worktree "$WORKTREE_ROOT/ForgeFrame" "$WORKTREE_ROOT/ForgeFrame-creature-os" "feat/creature-os-phase1"
  launch_session "E" "$WORKTREE_ROOT/ForgeFrame-creature-os" "$BRIEFS/E-creature-os.md"
fi

echo ""
echo "All requested worktrees prepared."
echo "Coordination doc: $SPRINT_DIR/2026-04-25-master-sprint.md"
echo "Tail it with: tail -f $SPRINT_DIR/2026-04-25-master-sprint.md"
LAUNCH_EOF

chmod +x /Users/acamp/.creature/sprint/launch.sh
echo "Created and chmod +x: /Users/acamp/.creature/sprint/launch.sh"
```

- [ ] **Step 2: Smoke-test (does NOT actually create worktrees yet)**

Run: `bash -n /Users/acamp/.creature/sprint/launch.sh && echo "SYNTAX OK"`
Expected: `SYNTAX OK`

### Task 0.6: Write per-worktree kickoff briefs

**Files (6 brief files in `/Users/acamp/.creature/sprint/briefs/`):**

- [ ] **Step 1: Write Worktree F brief**

```bash
cat > /Users/acamp/.creature/sprint/briefs/F-sweep.md <<'EOF'
# Stream F — Consolidation Sweep

You are the Stream F Claude Code session. Your worktree: `~/repos/ForgeFrame-sweep` on `feat/consolidation-sweep`.

## Goal
Tonight's pre-creature consolidation sweep. Layers 1+2 (Layer 0 ran in the parent session: 5 MCP tools allowlisted, web4.0 positioning captured, bridge-bug doc written).

## Tasks (use writing-plans + subagent-driven-development to execute)

1. **Fix MCP bridge bug** — investigate `packages/server/src/tools.ts` parameter binding for forgeframe-memory MCP. The bridge stringifies array + integer params before zod validation. Find + fix. Reference: `~/.creature/sprint/MCP-BRIDGE-WORKAROUND.md`. Add tests. Commit. Report back via `~/.creature/sprint/2026-04-25-master-sprint.md`.

2. **Absorb /caveman skill** — reference Sabrina Ramonov's "Secret Commands for Claude Code" and the canonical YouTube video. Write a custom skill at `~/.claude/skills/caveman/SKILL.md` that strips filler from output (≈45% token cut per the agent investigation). Test on a sample dispatch. Commit.

3. **Absorb /skill-creator pattern** — eval'd/benchmarked skill scaffolder. Write `~/.claude/skills/skill-creator/SKILL.md` that takes a desired-skill description, generates a SKILL.md + benchmark + 3 test prompts, runs eval against the prompts, reports pass/fail before allowing skill registration. Commit.

4. **Absorb /insights pattern** — 30-day session retrospective. Write `~/.claude/skills/insights/SKILL.md` that queries ForgeFrame `memory_search` + `session_list` + dispatch log over last 30 days, clusters via Hebbian, generates a "what worked, what stalled, what compounded" report. This validates the Strange Loop architecture at the user-visible layer. Commit.

5. **Sketch Loom prebuild_check tier** — DO NOT IMPLEMENT, just sketch. Write a design note at `~/repos/ForgeFrame-loom/PREBUILD_CHECK_SKETCH.md` describing how Loom's router can absorb the idea-reality-mcp pattern (intent-anchor keyword extraction → parallel 6-source scan → scored rollup) using ForgeFrame memory_search + httpx + local Ollama (no phone-home). Worktree A reads this when designing Loom router.

## Coordination
- Read `~/.creature/sprint/2026-04-25-master-sprint.md` on start.
- Update Status table after each task complete (column = "Last update" + "Next checkpoint").
- Append cross-stream notes to "Cross-stream blockers / coordination notes" section if any.

## Done when
All 5 tasks shipped + tests green + commits pushed to `feat/consolidation-sweep` + status table reflects "complete".

## Stop signal
If MCP bridge fix takes >2 hr, STOP and write a checkpoint memo. Bridge fix may be deeper than tonight allows.
EOF
```

- [ ] **Step 2: Write Worktree A brief (Loom)**

```bash
cat > /Users/acamp/.creature/sprint/briefs/A-loom.md <<'EOF'
# Stream A — Loom Meta-Organ Scaffold

You are the Stream A Claude Code session. Worktree: `~/repos/ForgeFrame-loom` on `feat/loom-organ`.

## Goal
Implement Loom — the meta-organ for Claude Code dispatch governance — per the design in `~/.claude/personas/notepad/2026-04-25-loom-organ-design.md`.

## Workflow (execute in order)

1. **Read the design** — `~/.claude/personas/notepad/2026-04-25-loom-organ-design.md`. 10 decisions locked. Three-layer architecture: Sensor (PostToolUse → memory) / Router (PreToolUse + policy lookup, can mutate) / Reflector (NREM/REM dream-job clustering dispatches).

2. **Read the prebuild_check sketch** — `~/repos/ForgeFrame-loom/PREBUILD_CHECK_SKETCH.md` (written by Stream F). Fold into Loom router design as a future tier.

3. **Use writing-plans skill** to draft the detailed Loom implementation plan. Save to `~/repos/ForgeFrame-loom/docs/superpowers/plans/2026-04-25-loom-implementation.md`.

4. **Use subagent-driven-development skill** to execute the plan. ~4 source files: sensor.ts, router.ts, reflector.ts, policy.ts. Plus index.ts (organ interface). Plus 2 hooks registered in `~/.claude/settings.json`.

5. **Cold-start protocol** — router pass-through for first 7 days (per meeting decision D8). Document in README.

## Coordination
- Update `~/.creature/sprint/2026-04-25-master-sprint.md` Status table after major checkpoints.
- Loom's `dispatch:*` namespace is reserved — coordinate with Stream E (CREATURE OS) on tag canonicalization (project tags should match canonical project names per the consolidation list in the COMPLETE snapshot).

## Done when
Spec + plan + 4 source files + 2 hooks + tests green + 7-day cold-start documented + commit pushed.
EOF
```

- [ ] **Step 3: Write Worktree B brief (dad-watch Phase 1)**

```bash
cat > /Users/acamp/.creature/sprint/briefs/B-dadwatch.md <<'EOF'
# Stream B — dad-watch-organ Phase 1 Execution

You are the Stream B Claude Code session. Worktree: `~/repos/dad-watch-organ-phase1` on `phase-1-foundation`.

## Goal
Execute the existing 13-task Phase 1 plan at `docs/superpowers/plans/2026-04-25-dad-watch-organ-foundation.md`.

End state: drag-and-drop a photo into the Tauri app, watch row + photo persist in SQLite, library populates, click into 5-tab profile page. Substrate has shadcn/ui, Lucide icons, plain-English labels, 15.5px+ body, system tray, sidecar lifecycle.

## Workflow

1. **Read the plan** verbatim — `docs/superpowers/plans/2026-04-25-dad-watch-organ-foundation.md`. 13 tasks. Each task has bite-sized TDD steps.

2. **Use subagent-driven-development skill** to execute task-by-task. Fresh subagent per task. Two-stage review between tasks.

3. **Honor the design conventions** in the spec (`docs/superpowers/specs/2026-04-25-dad-watch-organ-design.md`): no emojis, Lucide icons only, 15-16px body, plain-English labels, single loud primary action per screen, light theme default.

4. **Note: fork-subagents** — if `CLAUDE_CODE_ENABLE_FORK_SUBAGENT=1` is set in your env (Stream F may have set it), unspecified `subagent_type` triggers forks at ~10% cost. Default Sonnet stable; Opus fork stability unknown — surface in coordination doc if you observe degradation.

## Coordination
- Update sprint coordination doc after every task complete.
- If a task blocker emerges (e.g., shadcn `pnpm dlx` failure on the Mac), append to "Cross-stream blockers" — Stream F can pivot to help.

## Done when
13 tasks complete + smoke test passes + Phase 1 README written + commit pushed.

## Stop signal
If task >5 fails despite TDD discipline, STOP and write a checkpoint memo. Phase 1 stalls bigger than that need a brainstorm-revisit.
EOF
```

- [ ] **Step 4: Write Worktree C brief (Reframed consolidation)**

```bash
cat > /Users/acamp/.creature/sprint/briefs/C-reframed.md <<'EOF'
# Stream C — Reframed File Consolidation

You are the Stream C Claude Code session. Worktree: `~/repos/reframed-consolidation` on `feat/consolidation`.

## Goal
Two interlocking jobs: (1) merge 5 unmerged swarm-worktree branches from Mar 29; (2) absorb the historical aliases (career-ops, resume-tailor, jarvis, forgefind-job) into Reframed's canonical file structure so the Projects Space tile (when CREATURE OS ships) has one canonical project to point at.

## Workflow

1. **Read the consolidation list** — `/Users/acamp/vision/snapshots/2026-04-25-creature-COMPLETE.md` "Post-scavenger consolidation list" section. Reframed = canonical name everywhere. Old names stay reachable in memory + git history but aren't labels going forward.

2. **Inventory the 5 unmerged branches** — they live in `~/.claude/projects/reframed--swarm-worktrees-{builder-1..3, skeptic-1}/`. Per the agent recon: dc4cd61 OG meta · 9c18a73 magic link redirect · 572c7e0/c540d89 voice-copy · 920c28e checkout resilience · ad1ee1a CTA. Decide per-branch: merge / cherry-pick / archive.

3. **Use writing-plans** to draft a tactical plan for the consolidation. Save to `docs/superpowers/plans/2026-04-25-reframed-consolidation.md`.

4. **Use subagent-driven-development** to execute. The 6 pre-launch blockers (PricingGate auth gap, 6 unauthed Claude endpoints, scrape-jd SSRF, iOS auto-zoom, voice slider 16px thumb, PDF download iOS Safari) ARE in scope — they're load-bearing for first paying customer.

5. **Don't break revenue** — Reframed is live, generates revenue. Run smoke tests against `reframed.works` before pushing anything that changes deploy behavior.

## Coordination
- Update sprint coordination doc.
- Stream E (CREATURE OS) needs the Reframed canonical name + repo state ready before its Projects Space wiring lands. Coordinate timing.

## Done when
Branches merged or archived + 6 pre-launch blockers fixed + canonical naming applied + smoke test green + commit pushed.
EOF
```

- [ ] **Step 5: Write Worktree D brief (Distillery v2)**

```bash
cat > /Users/acamp/.creature/sprint/briefs/D-distillery.md <<'EOF'
# Stream D — Distillery v2 Build

You are the Stream D Claude Code session. Worktree: `~/distillery-v2` on `feat/v2-pipeline`.

## Goal
Execute the existing Distillery v2 plan at `docs/superpowers/plans/2026-04-23-distillery-v2-pipeline.md` (81KB). Content-first lens, novelty scoring, HTTP API integration, tiered strength, Hebbian writeback to ForgeFrame.

## Workflow

1. **Read the plan** verbatim. ~30 tasks across N phases.

2. **Use subagent-driven-development** to execute. Distillery is Python (Flask + SQLite + worker.py + extractor.py + lens.py + db.py + transcribe.py). Tests via pytest in `tests/`.

3. **The MLX server is live** on `:8081` (com.distillery.mlx launchd). Don't restart it; you'll interrupt the archive batch (currently 184/2638 per snapshot — ~70hr remaining at current rate).

4. **Coordinate with the running worker** — `com.distillery.worker` polls every 30s. Schema migrations need worker pause + restart. Use the `with-gpu` shell wrapper for any local-LLM contention.

5. **Test against fixtures** — don't depend on live ingestion for tests. Fixture URLs in `tests/fixtures/`.

## Coordination
- Update sprint coordination doc.
- Schema changes in `db.py` MUST coordinate with Stream E (CREATURE OS reads distillery items into the `#feed` channel).

## Done when
v2 plan tasks complete + tests green + worker resumed cleanly + archive batch resumes + commit pushed.

## Stop signal
If you break the running archive (worker hangs >30 min, mlx OOMs), STOP and recover. The archive is load-bearing for the LoRA corpus (Vision sprint Phase 8). Recovery script at `~/.creature/recover-and-archive.sh` exists.
EOF
```

- [ ] **Step 6: Write Worktree E brief (CREATURE OS Phase 1)**

```bash
cat > /Users/acamp/.creature/sprint/briefs/E-creature-os.md <<'EOF'
# Stream E — CREATURE OS Phase 1 Foundation

You are the Stream E Claude Code session. Worktree: `~/repos/ForgeFrame-creature-os` on `feat/creature-os-phase1`.

## Goal
CREATURE OS Phase 1 per spec: Tauri shell scaffold + sidecar service-layer endpoints + ~/.creature/state.db schema + Top bar + Cmd+K palette stub + theme system + sliding Spaces transitions. End state: open CREATURE app, swipe between 7 empty Spaces, Top bar live with daemon health pulse, Cmd+K opens (empty results OK), themes switchable.

## Workflow

1. **Read the spec** verbatim — `~/repos/ForgeFrame/docs/superpowers/specs/2026-04-25-creature-os-design.md`. 7 Spaces + universal layer + 8 module specs + data model + workflow + 5-phase roadmap.

2. **Use writing-plans** to draft the detailed Phase 1 implementation plan. Save to `~/repos/ForgeFrame-creature-os/docs/superpowers/plans/2026-04-25-creature-os-phase1.md`. Mirror the dad-watch Phase 1 plan structure (the user already validated that pattern).

3. **Use subagent-driven-development** to execute. Tech stack per spec: Tauri 2.x + Next.js 14 + React + shadcn/ui + Tailwind + Lucide React + TypeScript + Python 3.12 + FastAPI + SQLAlchemy + Alembic.

4. **Honor the design conventions from dad-watch spec** (Stream B's reference): no emojis, Lucide icons only, 15-16px body, plain-English labels, accessible by default.

5. **The app data dir is `~/.creature/`** (separate from `~/.forgeframe/` which is engine state). State.db schema is in the CREATURE OS spec — implement as Alembic migration `001_initial.py`.

6. **The implementation repo decision** — for V1, use `~/repos/ForgeFrame-creature-os` worktree as a sub-tree on the FF repo (current worktree). Future may extract to `~/repos/creature` (Phase 5+ task — installer signing).

## Coordination
- Update sprint coordination doc.
- Stream A (Loom) populates `dispatch:*` memories CREATURE OS surfaces in Today/`#a2a`. Coordinate tag schema.
- Stream C (Reframed consolidation) ships the canonical Reframed project name CREATURE OS Projects Space depends on.

## Done when
Phase 1 ships per spec + signed `.dmg` builds + smoke test passes + commit pushed + Phase 2 plan drafted (deferred execution).
EOF
```

- [ ] **Step 7: Verify all 5 briefs exist (Stream G written Saturday)**

Run:
```bash
ls -la /Users/acamp/.creature/sprint/briefs/
```
Expected: 5 files (F, A, B, C, D, E briefs).

### Task 0.7: Commit the master sprint plan + briefs to ForgeFrame docs

**Files:**
- Already created: `/Users/acamp/repos/ForgeFrame/docs/superpowers/plans/2026-04-25-master-sprint.md` (this file)

- [ ] **Step 1: Commit the plan**

Run:
```bash
cd /Users/acamp/repos/ForgeFrame
git add docs/superpowers/plans/2026-04-25-master-sprint.md
git commit -q -m "Master sprint plan — orchestrate 6 parallel worktrees + weekend Hermes scavenge

Coordinates 6 streams via shared markdown + ForgeFrame memory + git
worktrees. Each stream gets its own Claude Code session, kickoff brief
at ~/.creature/sprint/briefs/, status updates to ~/.creature/sprint/
2026-04-25-master-sprint.md. Stream F unblocks the rest by fixing the
MCP bridge bug + allowlisting introspection tools first.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1: Spawn the worktrees + sessions (you, in 6 terminal/tmux panes)

This phase IS the founder running the launch script. All Phase 0 outputs make this trivial.

### Task 1.1: Run the launch script (creates worktrees, prints session paths)

- [ ] **Step 1: Run launcher**

Run:
```bash
~/.creature/sprint/launch.sh
```
Expected output: 6 sections, each saying "worktree: ~/repos/<name> on <branch>" + "To launch session, run: cd <path> && claude".

### Task 1.2: Open 6 panes (or 6 terminal tabs) and start Claude Code in each

- [ ] **Step 1: Use tmux or terminal tabs**

Tmux pattern (recommended):
```bash
# In one terminal
tmux new-session -d -s sprint
tmux send-keys -t sprint "cd ~/repos/ForgeFrame-sweep && claude" Enter

tmux split-window -t sprint -h
tmux send-keys -t sprint "cd ~/repos/ForgeFrame-loom && claude" Enter

tmux split-window -t sprint -v
tmux send-keys -t sprint "cd ~/repos/dad-watch-organ-phase1 && claude" Enter

tmux split-window -t sprint:0.0 -v
tmux send-keys -t sprint "cd ~/repos/reframed-consolidation && claude" Enter

tmux split-window -t sprint:0.1 -v
tmux send-keys -t sprint "cd ~/distillery-v2 && claude" Enter

tmux split-window -t sprint:0.3 -h
tmux send-keys -t sprint "cd ~/repos/ForgeFrame-creature-os && claude" Enter

tmux attach-session -t sprint
```

Or just open 6 terminal tabs manually. Either works.

### Task 1.3: Paste the kickoff brief into each session

- [ ] **Step 1: For each pane**

In each Claude Code session, paste:
```
Read your kickoff brief at ~/.creature/sprint/briefs/<your-stream>.md and execute. Update ~/.creature/sprint/2026-04-25-master-sprint.md status table at every checkpoint. Tonight's goal is Phase 1 of your stream — partial progress is fine; STOP signals in the brief are real.
```

Where `<your-stream>` is `F-sweep`, `A-loom`, `B-dadwatch`, `C-reframed`, `D-distillery`, or `E-creature-os` matching the pane.

### Task 1.4: Tail the coordination doc in a 7th pane

- [ ] **Step 1: Live monitoring**

Run in a fresh pane:
```bash
watch -n 5 'cat ~/.creature/sprint/2026-04-25-master-sprint.md'
```

Or:
```bash
tail -f ~/.creature/sprint/2026-04-25-master-sprint.md
```

You'll see status table updates as sessions check in.

---

## Phase 2: Coordination + checkpoint reviews (tonight, light touch)

### Task 2.1: Set checkpoint review cadence

- [ ] **Step 1: Establish a 30-min check-in rhythm**

Every 30 min, glance at the coordination doc. If a stream is blocked or has surfaced a cross-stream note, attend to it. Otherwise let them run.

### Task 2.2: Resolve cross-stream blockers as they surface

- [ ] **Step 1: When a stream writes to "Cross-stream blockers"**

Determine: (a) does another stream need to pivot to unblock? (b) does a sub-agent dispatch resolve it? (c) does it require founder decision?

Most blockers are (a) or (b). Founder decision (c) is the only one needing real attention.

### Task 2.3: End-of-night session digest

- [ ] **Step 1: Before bed, write a session-summary memo**

Append to coordination doc:
```markdown
## EOD 2026-04-25 — Founder digest

What shipped:
- (per-stream completion)

What's mid-flight:
- (per-stream WIP)

Pickup tomorrow:
- (priority)

Schedule for autonomous overnight (use /schedule):
- (any continuations)
```

---

## Phase 3: Schedule autonomous continuation (tomorrow + weekend)

### Task 3.1: Schedule Hermes scavenge for Saturday morning

- [ ] **Step 1: Use the `/schedule` skill**

Schedule for Saturday 9am:

> Schedule a one-time agent run for Saturday 9:00am. Brief: "You are Stream G — Hermes scavenge. Read `~/.creature/sprint/briefs/G-hermes.md` (write it now if missing — reference CURRENT.md `d5e4a80d` for scope). Worktree: `~/repos/ForgeFrame-hermes-scavenge` on `research/hermes-scavenge`. 2-3 hour timebox. Update sprint coordination doc."

### Task 3.2: Schedule consolidation pass for Sunday afternoon

- [ ] **Step 1: Use the `/schedule` skill**

Schedule for Sunday 2pm:

> Schedule a one-time agent run for Sunday 2:00pm. Brief: "You are Stream H — post-scavenger consolidation pass. Read `~/vision/snapshots/2026-04-25-creature-COMPLETE.md` 'Post-scavenger consolidation list' section. Execute: archive 7 stale repos (forge-frame-knowledge, forge-swarm-viewer, Kokoros, notaprompt, passage, research, vaultql-as-readme-only), absorb guardian* into ForgeFrame, clean .superpowers brainstorm prototypes, run tag taxonomy sweep. Update sprint coordination doc."

### Task 3.3: Schedule end-of-weekend digest

- [ ] **Step 1: Use the `/schedule` skill**

Schedule for Sunday 8pm:

> Schedule a one-time agent run for Sunday 8:00pm. Brief: "Read `~/.creature/sprint/2026-04-25-master-sprint.md` final status table. Write a weekend digest memo to ForgeFrame memory tagged 'sprint-digest, master-sprint, 2026-04-25'. Include: what shipped, what's queued, what stalled, what to start Monday."

---

## Self-review

**1. Spec coverage:** Each Worktree's brief points at the relevant spec/plan/snapshot. Stream F covers tonight's Layers 0/1/2. Stream A covers Loom design from notepad. Stream B covers dad-watch from existing plan. Stream C covers Reframed consolidation per snapshot list + 6 pre-launch blockers. Stream D covers Distillery v2 from existing plan. Stream E covers CREATURE OS Phase 1 from spec. Stream G (Saturday) covers Hermes scavenge per CURRENT.md. Phase 3 schedules cover consolidation + digest.

**2. Placeholder scan:** No TBDs. Every task has concrete commands, file paths, expected outputs. The "stream G brief written Saturday" is acknowledged in Task 3.1, not a placeholder.

**3. Type consistency:** Worktree paths consistent across launch script + briefs. Coordination doc filename consistent throughout. Branch names consistent.

**4. Scope check:** This is a meta-plan (orchestration) not a single-app implementation plan. The single-app plans live in each worktree's own writing-plans output. That's the correct decomposition for parallel execution.

---

## Done when

All 6 streams have status "complete" or "checkpointed-EOD" in the coordination doc by Sunday night. Hermes scavenge complete. Post-scavenger consolidation complete. Weekend digest memo saved.

---

## What this plan assumes

- Mac M5 Pro 48GB handles 6 simultaneous Claude Code sessions (true per inventory)
- ForgeFrame memory.db is WAL-mode + concurrent-safe (true)
- No Anthropic API rate limits at this volume (likely true; Models Space surface in CREATURE OS will eventually monitor this)
- `swarm` skill at `~/repos/ForgeFrame/swarm/launch.sh` exists as the tmux+worktree primitive (true per inventory)
- `update-config`, `schedule`, `subagent-driven-development`, `writing-plans` skills are all available (true per inventory)
- Founder is awake + present for ~30-min checkpoint cycles tonight; autonomous after EOD
