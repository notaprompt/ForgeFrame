# Wave 8 Redesign: Hermes Integration + Dreaming Architecture

**Authors:** Alex Campos + Claude Opus 4.6
**Date:** 2026-04-13
**Status:** Design approved
**Parent spec:** 2026-04-12-signal-system-design.md (Section 5, Wave 8)

---

## 1. Architecture: Two Independent Loops

The original spec had one loop (Hermes, 6-hour cron, doing everything). This redesign splits into two loops with a clean boundary.

### Hermes Loop (Motor) — task-driven

- Scan for new inputs (career-ops, email, inbound)
- Triage/classify inputs (Gemma local)
- Evaluate top matches (Gemma + Sonnet for top picks)
- Execute tasks (generate artifacts, outreach drafts, reports)
- Extract skills from completed tasks
- All memory operations go through ForgeFrame MCP

### ForgeFrame Dream Loop (Brain) — pressure-driven, self-triggered

- NREM phase: cluster, deduplicate, strengthen/weaken (cheap, runs often)
- REM phase: abstract, cross-link, hindsight review, dream seeding (expensive, runs on pressure threshold)
- Dream journal written after each cycle
- Guardian modulates both loops independently

### Boundary Rule

Hermes never triggers consolidation, contradiction scanning, or dreaming. ForgeFrame never executes tasks. MCP is the only interface between them. Neither controls the other's rhythm.

```
HERMES (motor)                         FORGEFRAME (brain)
  scan -> triage -> execute -> skill     NREM -> REM -> journal -> sleep
        |                                      ^
    memory_save ---- MCP --------> Hebbian on every query
    memory_search -- MCP --------> co-retrieval strengthening
    guardian_temp -- MCP --------> temperature check
                                   sleep_pressure self-monitors
                                   dream triggers independently
```

---

## 2. Hermes Integration (Dependency, Not Fork)

Install Hermes (NousResearch/hermes-agent, MIT license) as-is. Write a thin integration layer. Three components.

### A) ForgeFrame MemoryProvider

Python class implementing Hermes' `MemoryProvider` ABC.

- `initialize()` — connect to ForgeFrame MCP server via stdio
- `prefetch()` — runs before each Hermes turn. Calls `guardian_temp`. If trapped, raises halt. If warm, sets reduced-scope flag on the turn context.
- `sync_turn()` — runs after each Hermes turn. Any memories Hermes saved get routed through ForgeFrame MCP (auto-link, TRIM tag, Hebbian wiring all happen server-side). Intercepts skill saves and routes them through `memory_save` with `['skill']` tags.
- `on_session_end()` — triggers NREM if sleep pressure warrants it and `dev_active` is false.
- `on_pre_compress()` — before Hermes compresses its context, save a session summary to ForgeFrame.

### B) Guardian Tool

Registered in Hermes' tool registry via their self-registration pattern.

- `guardian_temp` tool that calls ForgeFrame MCP and returns opaque state: `calm`, `warm`, or `trapped`
- Hermes sees the state but not the signals behind it (hebbianImbalance, staleness, etc. stay ForgeFrame-internal)

### C) Model Routing Config

| Task type | Model | Rationale |
|---|---|---|
| Classify/triage | Gemma 4 27B MoE (local) | Fast, free, good enough |
| Evaluate/score | Gemma 4 31B Dense (local) | Structured reasoning |
| Creative/voice | Claude Sonnet (API) | Nuance, voice consistency |
| Architecture/deep | Claude Opus (API) | Complex reasoning |
| All dream operations | Local only (Gemma/Qwen) | Sovereignty: cognitive data never leaves the machine |

### What We Don't Touch in Hermes

TUI, messaging gateways, RL training, browser tools, delegation system. We use their agent loop, tool registry, MCP client, cron scheduler, and memory provider interface.

---

## 3. Sleep Pressure + Dream Scheduling

Sleep pressure is a single metric ForgeFrame computes from its own state.

```
sleep_pressure = (unconsolidated_count * 0.4)
              + (hours_since_last_dream * 0.3)
              + (unscanned_contradiction_pairs * 0.2)
              + (pending_hebbian_decay_count * 0.1)
```

### Thresholds

| Pressure | Action |
|---|---|
| < 20 | Sleep. Nothing to do. |
| 20-50 | NREM only — cheap compression pass |
| > 50 | Full dream cycle — NREM then REM |
| Guardian trapped | No dreaming regardless of pressure |

### dev_active Signal

Idle detection via macOS `IOHIDSystem` idle time:

```bash
ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000)}'
```

Two states:

| Idle time | State |
|---|---|
| < 15 minutes | Active — suppress all autonomous loops |
| > 15 minutes | Idle — dream if conditions met |

Keyboard/mouse input resets the timer instantly.

### Combined Dream Trigger

```
can_dream = (idle_seconds > 900)
          AND (memory_pressure == 'normal')
          AND (sleep_pressure > threshold)
          AND (guardian != 'trapped')
```

Four booleans. All must be true. If memory pressure is `warn` or `critical`, skip the cycle. If founder touches keyboard mid-dream, current phase finishes gracefully then models unload.

### Scheduling

ForgeFrame checks pressure on two triggers:

1. **Session end** — when a session closes, compute pressure. If threshold met and dev_active is false, dream.
2. **Idle timer** — lightweight check every 30 minutes. If pressure is above threshold and dev_active is false, dream.

No fixed cron. Pressure-driven.

### Ollama Configuration

Set `OLLAMA_KEEP_ALIVE=5m`. Models load on demand, stay hot for 5 minutes after last use, unload automatically.

---

## 4. NREM Phase (Compression)

Runs when pressure is 20+ and conditions are met. Cheap, fast.

### Steps

1. **Hebbian maintenance** — run LTD pass on edges not co-retrieved since last dream. Prune edges below 0.05. (Already built, Wave 1.)
2. **Cluster scan** — run connected component detection on edges above weight threshold. (Already built, Wave 2.)
3. **Deduplication** — within each detected cluster, ask local LLM: "Are any of these saying the same thing?" If yes, generate a merge proposal. (Already built, Wave 2.)
4. **Emotional triage** — `charged` memories in new clusters bump that cluster's consolidation priority. `neutral` clusters can wait. `grounding` memories skipped entirely.
5. **Backfill valence** — any memories saved without valence classification (Ollama was down at save time) get classified now.

### What's New vs What Exists

| Step | Status |
|---|---|
| Hebbian LTD + pruning | Already built (Wave 1) |
| Cluster detection | Already built (Wave 2) |
| Dedup/merge proposals | Already built (Wave 2) |
| Emotional triage | New |
| Valence backfill | New |

### Duration

1-3 minutes depending on graph size. Gemma 27B loads for LLM calls, unloads when done.

### Output

Updated edge weights, pruned dead edges, consolidation proposals queued for human review. Nothing committed autonomously except Hebbian weight changes (Tier 2).

---

## 5. REM Phase (Recombination)

Runs only when pressure is 50+. Expensive, creative.

### Steps

1. **Dream seeding** — sample 2-3 memories from disconnected graph regions. LLM pre-filters obvious garbage. Plausible connections sent to founder for grading. (See Section 9.)
2. **Hindsight review** — audit entrenched memories for blind spots. Findings sent to founder. (See Section 10.)
3. **Tension detection** — find memory pairs that pull in different directions without contradicting each other. Surface for awareness. (See Section 11.)
4. **Dream journal** — local LLM writes narrative summary of the full cycle. (See Section 8.)

### What's New vs What Exists

| Step | Status |
|---|---|
| Dream seeding | New |
| Hindsight review | New |
| Tension detection | Partially exists (contradiction engine does hard contradictions, not soft tensions) |
| Dream journal | New |

### Duration

5-15 minutes. Gemma 27B or 31B Dense depending on memory headroom.

### Output

All proposals go through existing proposal system. Human reviews in Cockpit or CLI. Nothing mutates memory autonomously except Hebbian weights. Constitutional memories untouched at every step.

### TRIM Mapping

| Dream phase | Triple-network analog |
|---|---|
| NREM (compression) | CEN — executive, structured, task-oriented processing |
| REM (recombination) | DMN — default mode, associative, narrative synthesis |
| Emotional triage | SN — salience gating what gets processed and how deeply |
| Guardian modulation | SN — interrupt signal that can halt either network |

---

## 6. Cockpit Control Surface

Everything that runs autonomously is observable and steerable from Cockpit.

### Dream Controls

| Control | What it does |
|---|---|
| Sleep pressure gauge | Live readout of the pressure formula components |
| Dream now | Manual trigger — skip the idle check, run immediately |
| Suppress dreaming | Toggle — pause all autonomous dreaming until resumed |
| NREM only mode | Toggle — allow compression but suppress REM |
| Pressure threshold sliders | Adjust the 20/50 thresholds |

### Hermes Controls

| Control | What it does |
|---|---|
| Loop status | Idle, running, paused? What task? |
| Pause/resume | Stop/start the Hermes loop |
| Force cycle | Trigger a triage cycle now |
| Task queue | See queued tasks, reorder, remove, add |
| Model routing override | Force a specific model temporarily |

### Guardian Controls

| Control | What it does |
|---|---|
| Temperature display | Current state + all signals with values |
| Signal overrides | Manually set a signal |
| Trust tier viewer | What's Tier 1/2/3/4, autonomous vs proposal-gated |

### Hebbian Controls

| Control | What it does |
|---|---|
| Edge weight heatmap | Visual — strongest and weakest connections |
| Freeze learning | Toggle — pause all Hebbian updates |
| LTP/LTD rate sliders | Tune strengthening/weakening aggressiveness |

### Dream Journal Viewer

| Control | What it does |
|---|---|
| Journal feed | Chronological dream journals — morning briefing |
| Proposal queue | Pending proposals — approve/reject inline |
| Tension board | Soft tensions — dismiss, pin, or annotate |

### Emotional Tagging

| Control | What it does |
|---|---|
| Valence editor | See and override emotional tag on any memory |
| Charged memories view | Filter to emotionally weighted memories |

### Principle

If the system can do it autonomously, you can see it, pause it, tune it, or override it from Cockpit. No black boxes.

### Implementation

SSE events + REST endpoints on ForgeFrame's HTTP layer. Controls are the API — the UI is a separate concern for the renderer waves.

---

## 7. Emotional Tagging System

Valence assigned at save time, propagates through the system.

### Three Valence States

| Valence | Meaning | Example |
|---|---|---|
| `charged` | Emotional weight — decision under pressure, personal stakes, conflict, breakthrough | "Decided to leave the job", "First paying customer" |
| `neutral` | Factual, operational, informational | "API endpoint moved to /v2", "Meeting at 3pm" |
| `grounding` | Identity-anchoring — principles, values, constitutional | "Cognitive data never leaves the machine" |

### Assignment

On `memory_save`, ForgeFrame runs lightweight local LLM classification. Single prompt, single token response. Gemma 27B handles this trivially.

**Fallback:** If Ollama unavailable, default to `neutral`. Never block a save on valence classification. Backfill during next NREM cycle.

**Override:** User can manually set valence from Cockpit. Manual valence is sticky — system never reclassifies a user-set valence.

### Propagation

| System | Effect |
|---|---|
| Consolidation priority | Clusters containing `charged` memories proposed first |
| Hebbian LTP | `charged` memories get 1.2x multiplier on co-retrieval strengthening |
| Hebbian LTD | `grounding` memories exempt from decay (constitutional protection with encoded reason) |
| Hindsight review | `charged` + high weight + never contradicted = highest scrutiny |
| Dream seeding | At least one `charged` memory per seed set |
| Dream journal | Journal notes which memories carried emotional weight |
| Retrieval | Valence returned as field. No ranking impact — modulates processing, not retrieval |

### Storage

New column on memories table:

```sql
valence TEXT DEFAULT 'neutral' CHECK(valence IN ('charged', 'neutral', 'grounding'))
```

### Constitutional Rule

`grounding` valence and `principle`/`voice` tags must agree. If a memory is tagged `principle` or `voice`, its valence is `grounding` — always, automatically, non-overridable.

### Testing Requirements

- Valence classification accuracy: benchmark against 100 hand-labeled memories, target >85% agreement
- Fallback path: test with Ollama down, verify saves succeed with `neutral` default
- Backfill: test that NREM correctly classifies memories saved without valence
- Override: test that manual valence survives reclassification attempts
- Constitutional agreement: test that `principle`-tagged memory always has `grounding` valence
- Propagation: test that `charged` memories increase cluster priority and LTP multiplier
- Edge cases: empty content, very short content, multilingual content

---

## 8. Dream Journal

A narrative memory written by the local LLM after each dream cycle. Not a log — a synthesis.

### Structure

```markdown
---
type: dream-journal
phase: nrem | rem | full
timestamp: 2026-04-14T04:23:00Z
duration_ms: 187000
sleep_pressure_before: 62
sleep_pressure_after: 18
model: gemma4-27b-moe
---

## What changed
- Pruned 3 edges below 0.05 threshold
- Strengthened 12 edges via LTD/LTP maintenance
- Cluster detected: 5 memories around "sovereignty + deployment architecture"

## What I'm proposing
- Merge proposal: 2 memories about MCP boundary patterns are saying the same thing
- Abstraction proposal: connection between TRIM salience network and Guardian temperature
- Hindsight flag: "Local models always sufficient for triage" reinforced 34 times, never challenged

## What I noticed but didn't act on
- Tension between "ship fast" and "production-grade global deployment"
- Cluster forming around reframed customer conversations — not dense enough yet

## Seeds tried
- [Memory A] x [Memory B] x [Memory C] — discarded, no connection
- [Memory D] x [Memory E] — proposed to founder, awaiting grade

## Graph health
- Total memories: 847
- Total edges: 2,341
- Avg edge weight: 1.08
- Strongest cluster: "ForgeFrame architecture decisions" (12 nodes, avg 1.6)
- Most isolated: 23 orphan memories with zero edges
- Charged memories processed: 7 of 7
```

### Storage

Saved as ForgeFrame memory with tags `['dream-journal', phase, date]`. The journal participates in the memory graph — edges to referenced memories, Hebbian strengthening when retrieved.

### Metacognitive Loop

Future dream cycles retrieve prior journals. "I've noticed this cluster forming for three cycles now" becomes possible. The system tracks its own trajectory.

### Morning Briefing

Cockpit surfaces the most recent journal as the first thing the founder sees. Not a notification — just there.

### Production Considerations

- Journal generation is the last step — if cycle crashes mid-phase, whatever completed still gets journaled
- Max journal length: 2000 tokens (prompt-enforced)
- Journals older than 90 days: content summarized to single paragraph, full version archived
- Journal generation failure doesn't block the dream cycle from completing

---

## 9. Dream Seeding (Human-in-the-Loop Recombination)

The mechanism for "I slept on it and had an idea." The system finds seeds. The founder grades them.

### Seed Selection

```
1. Partition graph by tag clusters
2. Select 2-3 memories from DIFFERENT partitions
3. Prefer at least one `charged` memory per seed set
4. Exclude: memories that already share edges
5. Exclude: `grounding` memories (principles don't need recombination)
6. Prefer: memories saved in last 7 days paired with memories older than 30 days
```

### Pre-filter

Each seed set gets one LLM prompt. The LLM is a bouncer, not a judge — it only kills seeds that are obviously disconnected. Anything remotely plausible goes to the founder.

If pre-filter says "no connection, not even close" — discard, log in journal.
If pre-filter says "maybe something here" — send to founder.

### Founder Grading

Delivered via iMessage, Cockpit push, or whatever channel is live:

```
Dream seed — two memories that have never met:

[Memory A summary]
[Memory B summary]

The system sees a possible connection: [one sentence].

Grade: fire (real) / shrug (meh) / x (nothing)
```

Founder taps one response.

| Grade | Action |
|---|---|
| fire (real) | Create edge, log connection, LTP boost |
| shrug (meh) | Log "inconclusive", may re-surface later with more context |
| x (nothing) | Log "founder rejected", deprioritize that partition pairing |

### What the System Learns

| Signal | Teaching |
|---|---|
| fire on neuroscience x product | That pairing is fertile — sample more |
| x on architecture x grocery list | Dead pairing — deprioritize |
| fire on charged x old memory | Emotional + deep knowledge = good seeds |
| Consistent shrug | System finding noise — tighten pre-filter |
| Response time | Implicit engagement signal (graded fast = compelling) |

### Volume Control

- Max 3 seeds per dream cycle sent to founder
- If all 5 seed sets pass pre-filter, rank by novelty of partition pairing, send top 3
- No response within 24 hours = `ungraded`, no reminder, no follow-up
- Response rate drops below 30% = stop sending, resume when founder starts grading again

### Strange Loop Principle

The system's dreaming enriches the founder's cognition, not its own model of the founder's cognition. The founder sees connections they wouldn't have found. The founder grades on intuition the system can't have. The grades reshape what the system looks for. The loop runs through the founder, not around them.

---

## 10. Hindsight Review (Anti-Hebbian Audit)

Catches blind spots — memories that got strong through repetition, not truth.

### Selection

```sql
SELECT memories WHERE
  hebbian_weight > 1.5
  AND contradiction_count = 0
  AND age > 14 days
  AND tag NOT IN ('principle', 'voice')
  AND last_hindsight_review IS NULL
     OR last_hindsight_review < now() - 30 days
```

Memories ranked for review by `hebbian_weight * valence_multiplier`:

| Valence | Multiplier | Reasoning |
|---|---|---|
| `charged` | 1.5x | Beliefs formed under pressure harden fastest, need most scrutiny |
| `neutral` | 1.0x | Facts — still worth reviewing but less urgent |
| `grounding` | skip | Constitutional. Never reviewed, never weakened. |

### Delivery

Bundled into dream journal morning briefing, not individual notifications:

```
## Hindsight review (1 memory needs your eyes)

"Local models are always sufficient for triage"
Reinforced 34 times. Never challenged. Charged.

System's concern: This was true when task complexity was low.
As Hermes takes on deeper evaluation tasks, the 27B MoE
may hit a ceiling you haven't tested yet.
```

One per cycle, max. Embedded in the journal. Section hidden when empty.

### Founder Response

| Response | Action |
|---|---|
| **Keep** (one tap, or ignore for 48hrs) | Confidence validated. Skip hindsight for 90 days. |
| **Add nuance** (tap + type) | Founder writes clarification. Appended to memory, preserving original. |
| **Weaken** (tap + confirm) | Reduce Hebbian weight by 0.3. Two-step confirmation required. |

### Safety Model

| Risk | Mitigation |
|---|---|
| Too many reviews | Max 1 per cycle, embedded in journal, hidden when empty |
| Accidental weaken | Two-step confirm, doing nothing = keep |
| Wrong weaken | 30-day undo log with one-tap restore |
| Missing something | Same memory triggers 3 cycles in a row without response = one gentle escalation, then silence |

### Weaken History

```
Weaken history (last 30 days):
  Apr 14 — "Local models always sufficient" (1.7 -> 1.4) [Restore]
  Apr 11 — "Ship weekly cadence" (1.5 -> 1.2) [Restore]
```

---

## 11. Tension Detection

Different from contradictions. Not "A says X, B says not-X." Tensions are "A and B are both true but pull in different directions."

### Detection

During REM, LLM gets pairs of high-weight memories from different tag clusters:

```
These two memories are both strongly held. They are NOT contradictions —
both can be true simultaneously. But do they create a tension?
Do they pull toward different priorities, resource allocations, or timelines?

If yes: describe the tension in one sentence. Is it productive (drives
good trade-off decisions) or concerning (one will eventually override
the other without the founder noticing)?

If no: say "compatible" and move on.
```

### Routing

| Type | Action |
|---|---|
| Compatible | Nothing. Log in journal. |
| Productive tension | Add to Cockpit tension board. No notification. |
| Concerning tension | Surface in dream journal morning briefing, one line. |

### Rules

- Tensions are never resolved by the system
- Never proposed for resolution, weakened, or modified
- System notices and makes visible; founder holds tensions consciously
- Max 3 tensions surfaced per cycle
- Already-seen tensions don't re-surface unless new evidence changes them
- Founder can dismiss, pin, or annotate tension board entries

---

## 12. SSE Events + Observability

Everything emits events. Cockpit consumes them.

### New Event Types

| Event | Payload | When |
|---|---|---|
| `dream:started` | `{ phase, sleep_pressure, trigger }` | Dream cycle begins |
| `dream:nrem:complete` | `{ edges_pruned, edges_strengthened, clusters_found, duration_ms }` | NREM done |
| `dream:rem:complete` | `{ seeds_tried, seeds_proposed, hindsights_sent, tensions_found, duration_ms }` | REM done |
| `dream:journal:written` | `{ memory_id, phase, pressure_before, pressure_after }` | Journal saved |
| `dream:seed:sent` | `{ seed_id, memory_ids, connection_summary }` | Seed sent for grading |
| `dream:seed:graded` | `{ seed_id, grade, response_time_ms }` | Founder graded |
| `dream:hindsight:sent` | `{ memory_id, concern_summary }` | Hindsight sent |
| `dream:hindsight:responded` | `{ memory_id, action, previous_weight, new_weight }` | Founder responded |
| `dream:tension:detected` | `{ memory_ids, tension_summary, type }` | Tension surfaced |
| `hermes:cycle:started` | `{ trigger, guardian_state }` | Hermes loop begins |
| `hermes:cycle:complete` | `{ tasks_triaged, artifacts_generated, skills_extracted, duration_ms }` | Hermes done |
| `hermes:task:executing` | `{ task_id, task_summary, model }` | Hermes on a task |
| `hermes:suppressed` | `{ reason }` | Loop skipped |
| `guardian:dev_active` | `{ idle_seconds, state }` | dev_active changed |
| `guardian:sleep_pressure` | `{ pressure, threshold, components }` | Pressure updated |
| `valence:classified` | `{ memory_id, valence, method }` | Memory got valence |

### Composes With Existing Events

- `hebbian:ltp`, `hebbian:ltd`, `hebbian:prune` (Wave 1)
- `consolidation:proposal`, `consolidation:approved` (Wave 2)
- `contradiction:detected`, `contradiction:resolved` (Wave 4)

### Production Observability

| Concern | Solution |
|---|---|
| Dream crash mid-phase | Each phase emits start/complete. Missing complete = crash. Cockpit red indicator. Journal captures what finished. |
| Hermes hang | Configurable timeout (default 10 min). Exceeded = `hermes:cycle:timeout`, kill, log. |
| Model OOM | `memory_pressure` check before each phase. If warn mid-cycle, finish current phase, skip rest, emit `dream:aborted`. |
| Event volume | Fire-and-forget SSE. No event persistence — journal is the durable record. |

---

## 13. Constitutional Invariants (Extended)

Original 10 invariants from the parent spec, plus new ones for this design:

1. Principle and voice memories never decay
2. Principle and voice edges never modified by Hebbian operations
3. Principle and voice memories never consolidated or merged
4. Cognitive and constitutional data never processed by cloud APIs
5. Provenance logged for every autonomous operation
6. User can veto any Tier 3 proposal
7. User-only operations (Tier 4) never automated
8. Consolidation depth never exceeds 2 levels
9. Hebbian learning halts when Guardian reaches trapped state
10. Sound is never autoplay
11. **Dream seeding grades come from the founder, never auto-graded**
12. **Hindsight review never weakens without two-step founder confirmation**
13. **Tension detection never resolves — only surfaces**
14. **`grounding` valence on principle/voice memories is non-overridable**
15. **Dream cycles respect dev_active — never compete with the founder for the machine**
16. **Dream journal is the last phase — always written, even on crash**

---

## 14. Implementation Estimate

| Component | Days | Dependencies |
|---|---|---|
| Emotional tagging (migration + classification + propagation) | 2 | None |
| Sleep pressure + dev_active signal | 1 | None |
| NREM phase (wire existing engines + emotional triage) | 1 | Emotional tagging |
| Dream journal | 1 | NREM |
| REM phase (seeding + hindsight + tension) | 3 | NREM, emotional tagging |
| Hermes MemoryProvider + Guardian tool | 2 | None (parallel track) |
| Hermes model routing config | 0.5 | Hermes integration |
| Cockpit control surface (API endpoints) | 2 | All dream/Hermes work |
| SSE events | 1 | All components |
| Integration testing | 2 | Everything |

**Total: ~15 days** (two parallel tracks: ForgeFrame dream engine + Hermes integration, merging at Cockpit + SSE)

**Critical path:** Emotional tagging -> NREM -> REM -> Cockpit -> integration tests

**Parallel track:** Hermes integration can proceed independently until Cockpit wiring.

---

## 15. Risk Register

| Risk | Mitigation |
|---|---|
| Hermes upstream breaking changes | MCP boundary insulates. MemoryProvider ABC is stable. If it breaks, swap the provider, don't chase upstream. |
| Dream cycle consumes too much memory | memory_pressure check before each phase. Abort gracefully. Models unload via OLLAMA_KEEP_ALIVE=5m. |
| Valence classification quality | Benchmark against hand-labeled set. 85% threshold. Below that, retune the prompt before shipping. |
| Founder ignores dream seeds | Response rate tracking. Auto-suppress below 30%. Resume on re-engagement. No nagging. |
| Hindsight review creates anxiety | Max 1 per cycle. Keep = default. Weaken requires two steps. Framing is "the system is curious" not "the system disagrees." |
| Tension board becomes noise | Max 3 per cycle. Already-seen don't repeat. Dismiss is permanent. |
| dev_active heuristic wrong | Simple idle time, not process detection. Hard to get wrong. 15-minute threshold tunable from Cockpit. |
| Dream journal quality degrades | 2000 token cap. 90-day summarization. Journal quality is a prompt engineering problem, not an architecture problem. |
| Hermes + dream cycle compete for Ollama | dev_active suppresses both. If somehow both fire, Ollama queues requests — second caller waits. Not ideal but safe. |

---

## Appendix A: Competitive Landscape (Dreaming Systems)

Research conducted 2026-04-13. Three repos implementing dreaming patterns:

| Repo | Stars | Architecture | Human review? |
|---|---|---|---|
| openclaw-auto-dream | 588 | LLM prompt spec, file-based, 4 AM cron | No |
| cortex-engine | 45 | TypeScript MCP server, SQLite + Ollama, 8-phase NREM/REM | No |
| brain-mem | 45 | Python FastAPI, Neo4j + SQLite, 12-step pipeline | No |

### What ForgeFrame Has That None of Them Have

- Constitutional governance with trust tiers
- Human-in-the-loop proposals (consolidation, seeding, hindsight)
- Guardian modulation that can halt the system
- Explicit Hebbian mechanics (not formula-based scoring)
- Emotional valence as a first-class signal
- Dream journal as metacognitive feedback loop
- Founder-graded dream seeding (Strange Loop: human in the loop, not replicated digitally)
- TRIM triple-network mapping grounded in published neuroscience research

### Ideas Adopted From Research

| Source | Idea | How ForgeFrame Uses It |
|---|---|---|
| cortex-engine | NREM/REM phase split | ForgeFrame splits cheap compression from expensive recombination |
| cortex-engine | sleep_pressure metric | ForgeFrame computes pressure from unconsolidated count + time + contradictions + decay |
| cortex-engine | hindsight review | ForgeFrame adds anti-Hebbian audit with founder confirmation |
| brain-mem | creative recombination | ForgeFrame's dream seeding with structured graph sampling instead of random |
| openclaw-auto-dream | growth/streak metrics | Implicit in dream journal graph health section |

### Ideas Rejected

| Source | Idea | Why Rejected |
|---|---|---|
| cortex-engine | Fiedler value | Vanity metric at current scale. Add when renderer ships and needs a display number. |
| All three | Fully autonomous operation | Violates ForgeFrame's constitutional governance. Proposals, not executions. |
| brain-mem | Neo4j graph database | SQLite + FTS5 is sufficient and keeps the stack simple. |

---

## Appendix B: Claude Code Feature Flags (Context)

The Claude Code source leak (March 31, 2026) revealed a hidden feature flag `AutoDream` — memory consolidation during idle time. This validates that dreaming is becoming table stakes for agent frameworks. ForgeFrame's implementation is architecturally deeper (NREM/REM split, emotional valence, human-in-the-loop seeding, Guardian modulation) but the competitive window for "first sovereign dreaming system" is narrowing.

A separate leak shows a Lovable-style fullstack app builder in Claude's web UI. This is a different product category (vibe coding vs sovereign cognitive infrastructure) and does not affect ForgeFrame's positioning.
