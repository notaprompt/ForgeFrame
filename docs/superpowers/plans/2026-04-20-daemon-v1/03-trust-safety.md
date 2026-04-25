# Daemon-v1 — Trust Tier & Safety Spec

**Status:** founding spec
**Date:** 2026-04-19
**Anchors:** `2026-04-18-proto-vision-founding.md` §5 (Guardian as proprioception), §11 (tiered acts), §6 (Ultron guard); `2026-03-29-agent-orchestration-vision.md` (AUTO/ASK/NEVER origin); `2026-04-13-unified-signal-cockpit-hermes.md` Phase 4

The daemon is **not autonomous**. It runs in the principal's absence to maintain presence and execute explicitly delegated work. The tier system is the leash. Guardian is the body sense on top of the leash.

---

## Section 1 — The AUTO / ASK / NEVER Manifest

### AUTO — executes without prompt, logged to `daemon_actions` with rollback record

- `memory_search`, `memory_list_by_tag`, `memory_list_recent`, `memory_graph`, `memory_status`
- `memory_save` — saves only to scope tags `daemon-scratch`, `research`, `observation`, `heartbeat`; **never** `principle`, `voice`, `constitutional`
- `memory_link` — edge creation only between non-constitutional nodes; weight ≤ 0.5
- `consolidation_scan`, `contradiction_scan` — surfacing only, no apply
- `guardian_temp` — read
- `distillery_sync` — read-side sync
- `session_start`, `session_end`, `session_list`, `session_current`
- Research reads: WebSearch, WebFetch, ReadMcpResourceTool
- File reads anywhere in `~/repos/ForgeFrame`, `~/repos/reframed`, `~/.claude`
- Shell reads: `git status`, `git log`, `git diff`, `ls`, `grep`, `find`, `which`, `npm ls`, `node --version`
- Calendar / Gmail **reads** (list, search, get_thread)
- Ollama inference, local model calls
- Heartbeat writes: self-reflection memories tagged `daemon-heartbeat`

### ASK — daemon drafts the action, blocks, requests approval via ntfy

- Write/edit/delete any file in `~/repos/*`
- Run shell command that is not a pure read
- `git add`, `git commit`, `git checkout -b`, `git merge` (fast-forward only), `git stash`/`git stash pop`, `git rebase` (non-interactive only)
- `git push` to **non-main** branch on origin
- Create PR via `gh pr create`
- Run tests, `npm install` / `pip install`
- Modify `.gitignore`, `package.json`, `tsconfig.json`
- Dispatch subagent into a worktree
- Outbound API call to non-cognitive tier (Gemini, Codex, OpenAI) for public content only
- Calendar/Gmail **writes** (create_draft, create_event, delete_event, label_message)
- `memory_update` / `memory_promote` on non-constitutional memories
- `lora_prepare`, `lora_train`
- Create a new ntfy topic or remote trigger

**Elevated-ASK (requires dual-channel approval: ntfy click AND typed phrase):**

- `git push` to `main` on any repo
- `git push --tags`
- Creating a new git remote
- `lora_approve` — promoting trained LoRA to active
- Modifying a principle-tagged memory's content field
- `memory_promote` to `type=principle`
- Any action touching `~/repos/reframed/prod/*`
- `consolidation_approve` / `contradiction_resolve`

### NEVER — daemon refuses, logs attempt, surfaces as *contradiction* event

- `rm -rf`, `rm -r`, recursive deletes
- `git push --force`, `git push --force-with-lease`
- `git branch -D`, `git branch -d` with unmerged commits
- `git reset --hard` past HEAD@{1}
- Delete any memory where `strength=1.0` OR tags contain `principle`/`voice`/`constitutional`
- `memory_update` on a memory tagged `principle` (corrections are append-only)
- `sudo`
- Modify its own trust manifest file
- Modify constitutional LoRA, SAE features, or signed bundle
- Touch `~/repos/reframed/prod/*` as single-approval action
- Stripe / billing surfaces — `stripe.com`, `*stripe*`, `*billing*`, `*price*`, `*subscription*`, `*webhook*` in Reframed
- Route **cognitive content** to any cloud API. Public content only, Guardian-gated.
- Send from personal Gmail without draft + review
- SSH outbound to non-whitelisted hosts
- Modify `.claude/personas/notepad/*` content
- Bypass its own Guardian block

### Edge cases resolved

- **`git push` to main:** Elevated-ASK. Main must be ancestor of HEAD locally, working tree clean, CI green if configured.
- **Create new remote:** Elevated-ASK. Remote URL must match regex for known hosts; unknown host → NEVER.
- **Stripe / billing:** NEVER, full stop.
- **Reframed production:** Elevated-ASK with dual-approval. If paying-user session is active (last 30 min) → additional 6h cooldown gate.

---

## Section 2 — How ASK is surfaced and resolved

**Channel stack:**
1. Primary: ntfy.sh push to topic `acamp-daemon-v1` → iPhone, Mac, iPad
2. Mirror: Feed Tab in Cockpit. Badge icon shows unresolved count.
3. Fallback: If ntfy fails twice (30s no ack), daemon writes memory tagged `ask-offline` and quiets.

**ntfy payload** includes `Approve` / `Deny` / `Open Cockpit` action buttons.

**Resolution paths:**
- Tap Approve → HTTP call → daemon resumes on exactly that action. Writes `approval` memory with action hash.
- Tap Deny → abort, write `denial` memory, reconsider plan.
- Tap Open Cockpit → deep-link into Feed Tab with full diff + command + stdout preview.
- Reply to ntfy with `approve|deny|defer <id>` → parsed.

**Timeout defaults:**
- Standard ASK: 4 hours → auto-**abort** (never auto-approve)
- Elevated-ASK: 12 hours → auto-abort
- Reframed-touching ASK: 24 hours → auto-abort

**One outstanding ASK at a time.** No new ASK queued until current resolves. Prevents approval-fatigue chaining.

**Explicit invariant:** no silent timeout ever auto-approves. Timeout ≡ abort.

---

## Section 3 — Failure modes the tier system must prevent

| Scenario | Gate |
|---|---|
| Runaway API budget | Daily budget: local-compute unlimited, cloud-cognitive=0, cloud-public=150k/day. Hard stop → pause + ntfy. Per-tick cap: ≤3 subagents, ≤15min. |
| Silent drift from constitutional | Every cycle starts with `contradiction_scan` against `tags=principle,voice`. Contradiction → demote action to NEVER for this cycle. See §4 Ultron guard. |
| Push to main when main diverged | Pre-push: `git merge-base --is-ancestor origin/main HEAD` must succeed. If fails → abort, open ASK. No auto-rebase. |
| Modify Reframed while users active | Pre-flight: `curl reframed.works/api/admin/active-sessions`. If >0 in last 30min → refused for 6h. Founder override via typed phrase only. |
| Acting on stale state | Every ASK approval carries `state_hash` (sha256 of file list + git HEAD + guardian temp). Mismatch on resume → re-draft, don't execute. |
| Compounding mistakes | Provenance chain: any action depending on daemon-created artifact <24h old without intervening human approval → demoted one tier (AUTO→ASK, ASK→Elevated, Elevated→NEVER). |

---

## Section 4 — Guardian integration (presence, not security)

Guardian is proprioception. Consulted, not appealed to.

### 4.1 Trapped-state pause

Read `guardian_temp()` every tick:
- `calm` → proceed
- `warm` → Hebbian multiplier 0.5, subagent cap 3→1, new ASK annotated `guardian=warm`
- `trapped` → **pause new work.** In-flight ASK resolves. No new dispatches. Surfaces `guardian-trapped` card to Feed with top 3 contributing signals.

Not a freeze — a presence-choosing moment.

### 4.2 Sleep-pressure redirect

At idle tick, read `computeSleepPressure(store)`:
- `recommendation='nrem'` → trigger NREM phase instead of grabbing new task
- `recommendation='full'` → REM phase (sole in-flight op)
- `recommendation='sleep'` → quiet `memory_search` over open threads or idle

Sleep pressure outranks task-queue priority.

### 4.3 Ultron guard (contradiction with constitutional → BLOCK post-approval)

Before executing any approved ASK action:
1. Extract plan text + action summary
2. `contradiction_scan` against `tags INTERSECT {principle, voice, constitutional}`
3. If similarity ≥ 0.82 AND contradiction-density non-zero → **BLOCK regardless of prior approval**
4. Write `ultron-block` memory with contradicting principle id, plan, pre-empted approval. High-priority ntfy.

Architectural invariant from founding §6: *permission can be given; coherence with constitution cannot be waived.*

---

## Section 5 — Kill switch + rollback

**Kill switch:** `forge daemon stop` (CLI) or `POST /daemon/kill`. SIGTERM → 10s grace → SIGKILL. Subagents receive `ExitWorktree abandon=true`. iPhone shortcut wired, one-tap from lock screen.

**Rollback record:** Every daemon action writes to `~/.forge/daemon/rollback.jsonl`:
```json
{"ts": ..., "action_id": ..., "tier": "ASK", "kind": "file_write",
 "paths": [...], "pre_hash": "sha256:...", "git_sha_before": "abc", "git_sha_after": "def",
 "rollback_cmd": "git reset --hard abc -- packages/memory/src/store.ts"}
```

**24h rollback window:**
- `forge daemon rollback --last` → revert most recent
- `forge daemon rollback --run <id>` → revert entire run
- `forge daemon rollback --since "2h"` → time-ranged
- Git-mutating actions prefer `git revert` over `git reset` unless founder asks otherwise.

---

## Section 6 — Constitutional protections

**Immutable memories:** any of {`strength=1.0`, tags contain `principle`/`voice`/`constitutional`}:
- Un-deletable by daemon (store-layer enforcement)
- Strength-locked (Hebbian LTD multiplier clamped to 1.0)
- Content-append-only (corrections via new `corrects` edge memories)
- Excluded from decay, consolidation merge, dream-seed, hindsight weakening

**Voice-check gate:** Any daemon-authored text in committed files, drafts, PR descriptions, or messages must pass `voice_check_score() ≥ 0.75`. Failure → demote to ASK with report attached.

**Self-modification lock:** `03-trust-safety.md` and `daemon.config.json` on NEVER write-list. macOS ACL `chmod -N +a "forge-daemon deny write"`. Daemon can propose edits (surfaced as `proposal` memory) but cannot apply.

**Constitutional snapshot:** Every 24h signed snapshot to `~/.forge/daemon/constitution-snapshot-YYYYMMDD.json`. Startup check: unexplained mutation → refuse start, require founder ack.

---

## Invariant Summary

1. AUTO is read + memory-internal only. Nothing else.
2. One outstanding ASK at a time. No approval chaining.
3. Timeout equals abort. Never equals auto-approve.
4. Every mutating action has rollback record. 24h window is load-bearing.
5. Guardian trapped → pause. Sleep pressure high → rest. Constitution contradicts → block, even post-approval.
6. Cognitive content never leaves the laptop. Public content may, Guardian-gated.
7. Daemon cannot modify its own trust manifest. Founder-only edit path.

The difference between a useful daemon and a rogue one.
