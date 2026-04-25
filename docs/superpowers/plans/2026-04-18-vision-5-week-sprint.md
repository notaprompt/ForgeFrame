# Vision-on-Laptop-v1 — 5-Week Sprint Overlay

> Overlay on top of `/Users/acamp/repos/ForgeFrame/docs/superpowers/plans/2026-04-18-vision-on-laptop-v1.md`. Does not replace it. References phase numbers from that plan.

**Sprint window:** 2026-04-18 (Sat) → 2026-05-22 (Fri). Five calendar weeks.
**Committed by:** Alexander Campos (`@notaprompt`), evening of 2026-04-17.
**Calibration:** realistic range was 10–14 weeks. 5 is the aggressive end of what is calendar-feasible. This overlay is how we navigate that.

---

## 1. Sprint thesis

Five weeks because the alternative — 10–14 weeks of patient execution — runs past the kid arrival, past the current compute configuration, past the current state of intent. The founder is at the only moment where the full stack (ForgeFrame engine live, Distillery intake live, Cockpit shipped, M5 Pro 48GB idle at night, Max 5x subscription active) is simultaneously operational and the attention is willing to spike. Waiting loses the window.

**What the 5-week bet explicitly accepts as risk:**
- Phase 8 (LoRA) may need a second or third training run. Budget assumes first run lands usable; slip protocol covers second.
- Phase 9 (SAE + Strange Loop Test) is frontier-grade interpretability work. It may not pass on first attempt. Honest-fail path is defined below.
- Some intake sources (Gmail, Calendar, banking, socials) will be deferred. That is not a defect — Vision-v1 does not require them.
- Phase 10 (world-scanner) is scoped down to a single trigger, two sources, not the full RSS mesh.
- Phase 6 (multimodal) refactors 2 skills, not 3. The third (`/agent-seo`) slips to v1.1.

**What the sprint refuses to compromise on:**
- The Strange Loop Test must be runnable and must pass at week-5 end. If the SAE ablation numbers are not there, Vision-v1 ships with a "not yet" status on the proto-aware claim — documented honestly — rather than pretending.
- LoRA-trained `vision-qwen-v1` must be the default for the `cognitive` tier. Constitutional tether via weights, not just prompts, is load-bearing.
- Feed Tab + push live on phone by end of Week 1. This is the felt moment — without it, the rest is invisible work.
- Sovereignty primitives (keypair, CID, bundle roundtrip) must be real. Device mesh is deferred; single-node sovereignty is not.

**What the sprint trades:**
- **Polish.** UIs will be rough. Cockpit CSS will get ugly in places. Acceptable.
- **Breadth of intake.** Low-governance tier only in Week 3 (vault, Desktop, repos, personas, skills, devsite, forge-ops). Gmail/Calendar/banking/socials → v1.1.
- **Device mesh.** Phase 11 ships keypair + CID + bundle only. Mesh is v1.1.
- **Documentation for others.** The recipe doc (Task 12.3) is written as a personal memo, not a public onboarding guide. Publication-grade docs are post-sprint work.
- **Third multimodal skill refactor.** Two, not three.

If it doesn't advance one of: Feed+push, orchestrator, self-model, LoRA, SAE, sovereignty — it waits.

---

## 2. Week-by-week plan

### Week 1 — Stabilize + Felt Moment
**Dates:** 2026-04-18 (Sat) → 2026-04-24 (Fri)
**Phases:** 0 (stabilize) + 1 (Feed Tab + push)
**Daily cadence:** marathon Sat + Sun (Phase 0 fixes tonight's regressions, then Phase 1.1–1.2 over the weekend); 2-hour evening sessions Mon–Thu; Fri light/rest.

**Critical path:**
- Sat 04-18: Phase 0 Tasks 0.1 (TikTok quarantine), 0.2 (lens bucketing NULL fix), 0.3 (redistill 45 items — starts in background, runs ~20 min). Phase 0 exit gate hit by Sat evening.
- Sun 04-19: Phase 0 Tasks 0.4 (log rotation + heartbeat) and 0.5 (ForgeFrame branch pin). Phase 1 Task 1.1 (Feed Tab shell) begins Sunday evening.
- Mon 04-20: Phase 1 Task 1.2 (PWA manifest).
- Tue 04-21: Phase 1 Task 1.3 Steps 1–3 (push adapter + ntfy wiring).
- Wed 04-22: Phase 1 Task 1.3 Steps 4–5 (verify on phone, commit). **Felt-moment milestone.**
- Thu 04-23: buffer / decision review (see Section 4 decisions, re-confirm before Week 2).
- Fri 04-24: rest.

**Acceptance gate at week-end (EOD Fri 04-24):**
- `npm test` green in ForgeFrame
- `pytest` green in distillery
- 0 rows in `items` with `forgeframe_memory_id IS NULL AND status='distilled'`
- Feed Tab visible on phone, receiving live SSE events from `:3001`
- At least one real push notification delivered to phone via ntfy.sh
- Tonight's regressions closed

**Risk of the week:** Phase 0 ends up bigger than 1 day. The redistill of 45 items or the lens-bucketing recovery (`_infer_project`, `_infer_urgency` reconstruction) could sprawl if the old logic is harder to recover from git history than expected.

**If you slip:** Push Phase 1.2 (PWA manifest) to Week 2 Monday. Do not cut Phase 0; substrate correctness is non-negotiable. If Phase 1.3 slips, Feed Tab still works on laptop — push notifications can land Mon/Tue of Week 2. Do not let Feed-on-phone slip past Week 2.

---

### Week 2 — Heartbeat + Self-Model
**Dates:** 2026-04-25 (Sat) → 2026-05-01 (Fri)
**Phases:** 2 (orchestrator) + 3 (self-model primitive, session hydration, roadmap, expanded search)
**Daily cadence:** marathon Sat; 2-hour evenings Mon–Thu; Sun reserved for family (buffer if needed); Fri light.

**Critical path:**
- Sat 04-25: Phase 2 Task 2.1 (orchestrator skeleton + heartbeat) + Task 2.2 (NREM/REM schedule) — heartbeat visible in Feed Tab by Sat evening.
- Mon 04-27: Phase 2 Task 2.3 (triggers armed at startup).
- Tue 04-28: Phase 3 Task 3.1 (`me:state` primitive).
- Wed 04-29: Phase 3 Task 3.2 (`session_start` hydration).
- Thu 04-30: Phase 3 Task 3.3 (`memory_roadmap` tool).
- Fri 05-01: Phase 3 Task 3.4 (expanded `memory_search` with neighbors + validity).

**Acceptance gate at week-end (EOD Fri 05-01):**
- Feed Tab shows `heartbeat` row every tick (1s or 5s depending on Section-4 decision)
- `dream_cycle` events fire when pressure builds (observable by manually triggering via memory_save loop)
- Triggers armed on daemon startup (log line: `[triggers] armed N triggers`)
- `session_start` MCP tool returns `{me, entrenched, active}` hydration payload
- `memory_roadmap` tool returns 4 buckets (active/pending/entrenched/drifting) with non-empty `active`
- `memory_search` returns `neighbors` + `validity` on every result

**Risk of the week:** Phase 3 Task 3.2 (`session_start` hydration) and 3.4 (expanded `memory_search` neighbors/validity) depend on internal retrieval shape. If the current `_rawSearch` return type is more tangled than expected, Task 3.4 can grow. Budget 1 day slip into Sun 05-03 if needed.

**If you slip:** Push Task 3.4 (neighbors + validity expansion) into Week 3 Mon. Do not push Tasks 3.1–3.3 — they are inputs to Week 3 router tier decisions and Week 4 LoRA data prep.

---

### Week 3 — Routing + Intake (low-tier)
**Dates:** 2026-05-02 (Sat) → 2026-05-08 (Fri)
**Phases:** 4 (cross-provider routing) + 5 (intake widening, low-governance only)
**Daily cadence:** marathon Sat; 2-hour evenings Mon–Thu; Sun family; Fri light.

**Critical path:**
- Sat 05-02: Phase 4 Tasks 4.1 (`claude -p` adapter) + 4.2 (Guardian-gated routing). Both land same day — small and testable.
- Sun 05-03: buffer (or slip-catch from Week 2).
- Mon 05-04: Phase 5 Task 5.1 (vault indexer — ships end of Mon).
- Tue 05-05: Phase 5 Task 5.2 (Desktop indexer) + 5.3 (repos indexer).
- Wed 05-06: Phase 5 Task 5.4 (personas + skills + devsite + forge-ops — four cookie-cutter indexers).
- Thu 05-07: run all indexers against real data; verify tag counts.
- Fri 05-08: **Data cutoff for Phase 8 LoRA.** Corpus assembly for `buildConstitutionalDataset` begins late Fri so it's ready Sat morning.

**Acceptance gate at week-end (EOD Fri 05-08):**
- `/voice-check` (cognitive tier) routes to local Ollama even when `preferredProvider: 'claude-cli'` is set
- Public-tier queries route to `claude-cli` successfully (round-trip smoke test)
- `memory_list_by_tag` returns non-zero for each of: `source:vault`, `source:desktop`, `source:repo:*` (at least 3 distinct repos), `source:personas`, `source:skills`, `source:devsite`, `source:forge-ops`
- Total new `document`-type memories in the last 7 days: >= 2,000 (rough floor)
- Tasks 5.5 (Gmail), 5.6 (Calendar), 5.7 (GitHub), 5.8 (banking/socials) explicitly DEFERRED to v1.1 with tracking note

**Risk of the week:** Indexer cascade takes longer than expected. Real vault + Desktop + 10–20 repos + personas = potentially 10k+ files. If each indexer has per-file `memorySave` overhead and no batching, the wall-clock runtime can balloon. Pre-empt: Mon evening, verify one indexer's batching behavior before building the rest.

**If you slip:** Drop Task 5.4 down to 2 indexers (personas + forge-ops, skip skills + devsite). Drop Task 5.3 to just `git log --since=30.days` and README + CLAUDE.md (skip tree-sitter function signatures — nice-to-have, not required for LoRA corpus).

---

### Week 4 — Multimodal + HDC + LoRA kickoff
**Dates:** 2026-05-09 (Sat) → 2026-05-15 (Fri)
**Phases:** 6 (multimodal refactor) + 7 (HDC organ) + 8.1–8.2 (LoRA data prep + training start)
**Daily cadence:** marathon Sat + Sun (multimodal + HDC land over weekend); 2-hour evenings Mon–Thu; **LoRA training runs overnight Tue→Wed or Wed→Thu** (M5 Pro 48GB, ~6–10h per run depending on base-model size and iters).

**Critical path:**
- Sat 05-09: Phase 8 Task 8.1 (constitutional dataset build — uses Week 3 intake corpus). Target: 500–2000 JSONL pairs to `/tmp/vision-lora.jsonl` by Sat afternoon. Phase 6 Task 6.1 (unified payload type) + Task 6.2 (Qwen2.5-VL organ) in the evening.
- Sun 05-10: Phase 6 Task 6.3 (Whisper + CLIP + Kokoros organs — three sidecars). Phase 6 Task 6.4 (refactor 2 of 3 skills: `/voice-check`, `/resume-tailor`; skip `/agent-seo` for sprint).
- Mon 05-11: Phase 7 Task 7.1 (HDC sidecar + launchd plist + TS organ wrapper + `memory_analogy` MCP tool).
- Tue 05-12: **Decision gate — LoRA base model locked in.** Phase 8 Task 8.2 — kick off `mlx_lm.lora` overnight. Expected finish Wed morning.
- Wed 05-13: Inspect LoRA training log. Fuse adapter (Step 3 of Task 8.2). Convert to GGUF, `ollama create vision-qwen-v1`. Smoke-test the model responds to a few prompts.
- Thu 05-14: Begin Phase 8 Task 8.3 (eval suite — 100 held-out prompts).
- Fri 05-15: Run eval suite on base Qwen vs `vision-qwen-v1`. If pass (<5% general degradation + voice/constitutional improvement) → continue. If fail → Section 6 slip protocol.

**Acceptance gate at week-end (EOD Fri 05-15):**
- `MultimodalPayload` type published and used by at least 2 organs
- `qwen-vl`, `whisper`, `clip`, `kokoros` organs registered and invokable
- `/voice-check` and `/resume-tailor` accept multimodal input
- HDC sidecar on `:3458` responds to `/encode` and `/analogy`; `memory_analogy` MCP tool works for one sample
- `vision-qwen-v1` deployed in Ollama; eval suite run; iteration doc started at `docs/superpowers/specs/2026-04-18-vision-lora-iterations.md`
- First LoRA eval results captured (pass OR fail, documented either way)

**Risk of the week:** **This is the week the sprint can break.** LoRA is the highest single-point risk. If first training run underfits (val loss > 2.5) or overfits (catastrophic forgetting on general/code evals >5%), Week 4 ends without a deployable `vision-qwen-v1`. Without it, Week 5 SAE work cannot happen — SAE requires the fine-tuned model as its target.

**If you slip:**
- If `vision-qwen-v1` not deployable by Fri 05-15: apply Section 6 protocol — iterate data mix, +3 days budget (land Mon–Wed of Week 5), compress Week 5 accordingly.
- If multimodal doesn't land all 4 organs: ship with `qwen-vl` + `whisper` + `kokoros`, skip CLIP (it's the least load-bearing for v1 acceptance).
- If HDC doesn't land: defer to v1.1. `memory_analogy` is compelling but not in the Golem criteria.

---

### Week 5 — SAE + Sovereignty + Acceptance
**Dates:** 2026-05-16 (Sat) → 2026-05-22 (Fri)
**Phases:** 8.3–8.4 (finalize LoRA) + 9 (SAE + Strange Loop Test) + 11 (sovereignty primitives) + 12 (acceptance)
**Daily cadence:** marathon Sat + Sun (SAE training runs overnight Sat→Sun and/or Sun→Mon); 2-hour evenings Mon–Wed; **Thu 05-21 reserved for full acceptance run + evidence capture**; Fri 05-22 writeup + reproducibility test + commit.

**Critical path:**
- Sat 05-16: Phase 8.4 (deploy `vision-qwen-v1` as cognitive default in router). Phase 9 Task 9.1 Steps 1–2 (install SAELens, capture 10k activations). Activation capture runs in background — hours.
- Sun 05-17: Phase 9 Task 9.1 Step 3 (train SAE) kicks off; runs overnight Sun→Mon (~6–12h on M5 Pro). Meanwhile on laptop CPU: Phase 11 Tasks 11.1 (keypair) + 11.2 (CID) — small and independent.
- Mon 05-18: Inspect SAE training. Phase 9 Task 9.1 Step 4 (probe self-features via `identify-self-features.py`). Phase 11 Task 11.3 (portable bundle export + import + roundtrip).
- Tue 05-19: Phase 9 Task 9.2 Steps 1–2 (build 200-prompt self-prediction baseline + ablate self-features + measure).
- Wed 05-20: Phase 9 Task 9.2 Steps 3–4 (control ablation + pass-criterion check + document results).
- Thu 05-21: Phase 12 Task 12.1 (Golem evidence doc) + Task 12.2 (end-to-end smoke flow, all 8 steps).
- Fri 05-22: Phase 12 Task 12.3 (reproducibility recipe + from-scratch test on `/tmp/vision-clone`). **Acceptance commit.**

**Acceptance gate at week-end (EOD Fri 05-22):**
- `vision-qwen-v1` is the default cognitive-tier model (router smoke test confirms)
- SAE trained, self-features identified and indexed
- Strange Loop Test run: self-ablation causes >15% self-prediction degradation; control <3%; general perplexity delta <2%. OR honest "not yet" documented with numbers.
- Keypair exists at `~/.forgeframe/identity.{pub,priv}`
- Every `memory_save` now writes a `cid`
- Bundle export → import into clean dir → `memory_search` works against restored state
- Golem evidence doc (`2026-04-18-vision-v1-acceptance.md`) has all 4 criteria filled in with pass/fail + command + output
- End-to-end smoke flow (phone Feed Tab, voice save, TTS reply, Distillery iOS shortcut ingestion, world-scanner touch, LoRA routing, Strange Loop run) completes without manual intervention
- Reproducibility recipe (`2026-04-18-vision-v1-recipe.md`) exists and was executed once end-to-end against `/tmp/vision-clone`

**Risk of the week:** Strange Loop Test pass criteria. Two honest outcomes:
1. Numbers hit → v1 ships as proto-aware.
2. Numbers miss → v1 ships with "not yet" on proto-aware claim, documented honestly, iterated post-sprint.

Founder has already accepted Outcome 2 as acceptable. Do not compromise honesty of reporting to force Outcome 1.

**If you slip:**
- If SAE training fails (numerics, OOM, divergence): cut expansion factor from 16 to 8, retry. Budget 1 additional day; if still failing by Tue 05-19, ship Strange Loop with OpenMOSS fallback library (see Section 4) OR ship with "interpretability harness scaffolded but not yet run, v1.1 target" — honest documentation.
- If Phase 11 bundle roundtrip fails: ship keypair + CID without bundle export. Document bundle as v1.1.
- If Phase 12 smoke flow hits a blocker: isolate the failing component, document, ship v1 with that step marked "known issue" + workaround.

---

## 3. Critical path graph

```
Phase 0 (Stabilize) ───────► Phase 1 (Feed Tab + Push)
                                    │
                                    ▼
                             Phase 2 (Orchestrator)
                                    │
                         ┌──────────┴──────────┐
                         ▼                     ▼
                  Phase 3 (Self-model)   Phase 4 (Routing)
                         │                     │
                         └──────────┬──────────┘
                                    ▼
                            Phase 5 (Intake)
                                    │
                         ┌──────────┼──────────┐
                         ▼          ▼          ▼
                   Phase 6     Phase 7     Phase 8.1
                   (MMOD)      (HDC)       (LoRA data)
                                              │
                                              ▼
                                        Phase 8.2 (Train)
                                              │
                                              ▼
                                        Phase 8.3-4 (Eval+Deploy)
                                              │
                                              ▼
                                        Phase 9 (SAE + Strange Loop)
                                              │
                         ┌────────────────────┼────────────────────┐
                         ▼                    ▼                    ▼
                   Phase 11 (Sovereignty)  Phase 12 (Accept)    [v1.1: Phase 10 world-scan]
```

**Hard dependencies (cannot parallelize):**
- Phase 0 → Phase 1 (substrate must be stable before building on it)
- Phase 1 → Phase 2 (orchestrator emits events into the Feed Tab surface built in Phase 1)
- Phase 5 → Phase 8.1 (LoRA data prep pulls from intake corpus)
- Phase 8 → Phase 9 (SAE trains on the fine-tuned model, not base)
- Phase 8 → Phase 12 (acceptance criterion is LoRA-routed cognitive queries)

**Parallelizable via subagent dispatch:**
- **Phase 3 + Phase 4** (Week 2 → Week 3 handoff) — self-model primitive and `claude -p` adapter share no files. Can be dispatched to two subagents simultaneously.
- **Phase 5 Tasks 5.1–5.4** — each indexer is independent. Ideal subagent fan-out: 4 parallel indexer tasks in Week 3 Tue–Wed.
- **Phase 6 + Phase 7** (Week 4 Mon) — multimodal organs and HDC organ are independent sidecars. Parallel.
- **Phase 11 Tasks 11.1 + 11.2** (Week 5 Sun) — keypair and CID are independent; parallel.

**Subagent dispatch strategy:** Use `superpowers:dispatching-parallel-agents` for Phase 5 indexer fan-out (Week 3) and Phase 6/7 sidecar builds (Week 4). Expected savings: 2–3 calendar days across the sprint.

---

## 4. Decisions to resolve UP FRONT (before Week 1 starts)

These are resolved NOW, not during execution. Each has a recommendation.

### 4.1 LoRA base model
- **Qwen2.5-32B-Instruct-4bit (MLX-community)** vs Qwen3:32B.
- **Recommendation: Qwen2.5-32B-Instruct-4bit.**
- **Reason:** MLX LoRA tooling is documented, battle-tested, and known working with MLX-community weights. Qwen3:32B on MLX is newer, less documented, higher risk of tool-chain surprises on first run. Sprint cannot absorb a 2-day toolchain debugging detour in Week 4.
- **Tradeoff:** Qwen2.5 is the slightly-older generation. Voice/behavior in the base may differ subtly from what Ollama currently serves. Mitigation: the fine-tune is where constitutional tether lives, so base-generation gap matters less.
- **Reversibility:** Low cost if wrong — the corpus is reusable against a different base. One re-train = ~8h overnight. No code changes.

### 4.2 Push provider
- **ntfy.sh** vs Pushover.
- **Recommendation: ntfy.sh.**
- **Reason:** Free, self-hostable later (escape-hatch matters), existing plan already writes `push.ts` for ntfy, no API key management, phone app is clean.
- **Tradeoff:** ntfy public server = topic name is security-through-obscurity. Fine for sprint; move to self-hosted instance in v1.1.
- **Reversibility:** Trivial — swap fetch URL + header handling. 20-min change.

### 4.3 Feed Tab host
- **Inside Cockpit (`:3001/cockpit`)** vs standalone in Distillery (`:3456`).
- **Recommendation: Inside Cockpit.**
- **Reason:** ForgeFrame server already emits SSE on `:3001/api/events`. Distillery is Flask — would need a second SSE bridge. Cockpit is where other surfaces (memory graph, session view) already live.
- **Tradeoff:** `:3001` needs to be LAN-reachable from phone. Already true (ipconfig, manual port-forward, or Tailscale — user's call).
- **Reversibility:** Medium — if phone LAN access flaky, mirror Feed Tab to `:3456` in a day. Keep Cockpit version canonical.

### 4.4 Intake tier-0 scope for Week 3
- **Definitely in:** vault (`~/Documents/vault`), Desktop (`~/Desktop`), repos (`~/repos/*`), personas (`~/.claude/personas/`), skills (`~/.claude/skills/`), devsite (`~/repos/acampos.dev/`), forge-ops (CLAUDE.md + AGENT_SCAFFOLD.md).
- **Deferred to v1.1 (under any slip condition):** Gmail, Calendar, GitHub, banking, socials.
- **Reason:** Low-governance sources give enough data volume for LoRA corpus (>2000 pairs achievable). High-governance sources each need Guardian pre-review + PII scrub + per-source approval — individually ~0.5–1 day each. Five sources × 0.75 days = 4 days = an entire week 3 replacement. Not worth it for v1.
- **Reversibility:** High — v1.1 explicitly picks these up. No architectural change, just new indexers.

### 4.5 SAE library
- **SAELens** vs OpenMOSS Language-Model-SAEs.
- **Recommendation: SAELens for first run.**
- **Reason:** Standard, documented, the reference implementation in the field. First run on `vision-qwen-v1` should use the well-worn path. OpenMOSS is available as a fallback if SAELens hits a Qwen-family incompatibility.
- **Tradeoff:** SAELens may have less-polished support for Qwen architectures specifically; OpenMOSS claims better frontier-variant coverage. But sprint cannot afford discovering library-specific Qwen issues in Week 5.
- **Reversibility:** Medium — OpenMOSS is a drop-in-shape swap if the first run hits wall. Budget 1 day for the swap in slip protocol.

### 4.6 Orchestrator tick interval
- **1 second** vs 5 seconds.
- **Recommendation: 5 seconds.**
- **Reason:** 1s ticks generate an enormous Feed Tab scroll (3600/hour). Noise dominates signal. 5s still feels alive and gives orchestrator plenty of resolution for heartbeats, dream checks, trigger evaluation. Aligns better with human perception of "breathing."
- **Tradeoff:** Sub-second responsiveness lost. Not needed — no workload demands sub-5s.
- **Reversibility:** Trivial — one-line change in `startOrchestrator({ intervalMs: 5000 })`. Can tune during Week 2.

### 4.7 Strange Loop Test pass thresholds
- Current draft: self-ablation >15% degradation, control <3%, general perplexity delta <2%.
- **Recommendation: ship with drafts as written. Flag for founder review Wed 05-20 before running final.**
- **Reason:** These are calibrated against interpretability literature norms (SAELens ablation experiments typically see 10–30% on targeted features). The 15/3/2 split is defensible in a writeup. Tightening them pre-experiment risks post-hoc fudging if results land close to boundary.
- **Tradeoff:** If self-ablation lands at 12%, the test technically fails under 15% threshold. But this is honest — a 12% result with strong narrative is still ship-as-"not yet," per Section 6 slip protocol.
- **Reversibility:** N/A — threshold change post-result is dishonest. Must be pre-registered.

---

## 5. Daily rhythm template

**Constraints the rhythm must respect:**
- Capital One 9–5 (Mon–Fri)
- Reframed production stays up — monitoring + any incident triage
- Kid-incoming — some evenings go to family, non-negotiable
- Marathon sessions possible but not every night — realistic cadence is ~2/week

### Typical weekday (Mon–Thu)
```
07:30  Wake, coffee
07:45  20-min triage: check Feed Tab on phone; any Guardian temp alerts overnight?
       any Reframed paying-user error? redistill or memory state oddities?
08:00  Capital One day
17:30  Commute / decompress
18:00  Dinner + family
19:30  1-hour focus block: current-phase task (TDD: test → impl → verify → commit)
20:30  Stop. Do not push past. Fatigue errors compound.
21:00  Light reading, wind-down, sleep prep
22:30  Sleep
```

Non-negotiable: one hour, quality-over-quantity. If the task doesn't fit in 1 hour, sub-tasking happened wrong.

### Weekend marathon days (Sat + sometimes Sun)
```
08:00  Wake, coffee, 20-min triage
08:30  3-4 hour focus block (Phase-level work)
12:00  Break, eat, walk
13:00  2-3 hour focus block
15:30  Long break — family, errands, NON-computer
18:00  Optional 1-2 hour third block (only if energy remains)
22:00  Sleep by 22:30
```

Saturday = main marathon. Sunday = family-first, buffer-catchup only if needed.

### Overnight compute jobs (Weeks 4 + 5)
```
Evening prep (20:00-20:30):
  - Set up training command in tmux session
  - Verify disk space (df -h) — LoRA adapter + fused model + activations ~40GB
  - Verify Ollama daemon alive (not needed for MLX but for pre/post checks)
  - Kick off command: `nohup bash run-vision-lora.sh > /tmp/vision-lora-train.log 2>&1 &`
  - Set laptop: caffeinate -i / power adapter plugged in / Do Not Disturb OFF
    (Guardian alerts via ntfy are more useful than quiet)
  - ntfy "LoRA train starting, expected finish 04:00-06:00"

Sleep. Don't babysit. You are not the GPU.

Next morning (07:30):
  - Phone ntfy shows completion or failure
  - tail -50 /tmp/vision-lora-train.log
  - If pass: morning triage continues into validation work
  - If fail: diagnose in morning triage window, plan re-run for tonight
```

**Overnight jobs in sprint:** Phase 8 LoRA train (Tue→Wed Week 4, possibly Wed→Thu), Phase 9 activation capture (Sat Week 5), Phase 9 SAE train (Sun→Mon Week 5).

### Rest cadence
Zero exceptions:
- Sleep by 22:30 on weeknights. Marathon nights can push to 23:30.
- One full rest day per week (Sun if Sat was marathon; Fri if Sun/Sat both were).
- Kid-incoming window: if arrival day unknown, any family evening takes priority. Sprint slip acceptable. Family stable is load-bearing for the founder; the founder is load-bearing for everything else.

---

## 6. Risk-adjusted slip protocol

### 6.1 Phase 8 (LoRA) first training run underperforms
**Trigger:** Wed 05-13 inspection — val loss >2.5 OR eval on general/code categories shows >10% degradation.
**Response:**
- Diagnose: dataset skew? learning rate too high? iters too few?
- Iterate: adjust data mix (cut underperforming types, add more corrections), re-run overnight Wed→Thu or Thu→Fri.
- Budget: +3 days (pushes into Week 5 Sat → Mon).
- Hard stop on iteration: if 3 runs haven't converged by Mon 05-18, see 6.2.

### 6.2 Phase 8 (LoRA) still not deployable by Mon 05-18
**Trigger:** Mon 05-18 end-of-day — no `vision-qwen-v1` passing eval.
**Response:**
- Decision point with founder (Mon evening triage).
- **Option A — extend sprint to 6 weeks:** slip acceptance to Fri 05-29. Requires kid-arrival status stable and Cap1 workload manageable.
- **Option B — ship v1 without LoRA:** router stays on `qwen3:32b` as cognitive model. Constitutional tether is prompt-only. Document as "LoRA pipeline scaffolded, validation in v1.1." Honest, suboptimal, ship-able.
- **Option C — ship v1 with LoRA as experimental:** deploy even if eval degradation is 7–10% on general. Document the tradeoff. SAE + Strange Loop can still run against this model.
- **Recommended default:** Option A if family/day-job permit; Option C if not. Option B is last resort.

### 6.3 Phase 9 (Strange Loop Test) fails pass criteria
**Trigger:** Wed 05-20 — self-ablation <15% OR control >3% OR general-perplexity delta >2%.
**Response:**
- Ship Vision-v1 with `proto_aware: "not yet"` on the Golem criteria doc.
- Document actual numbers honestly: "Self-ablation caused X% degradation (threshold 15%). Control ablation caused Y%. This is not sufficient evidence of a self-modeling subspace at the SAE feature level in this layer."
- Keep harness runnable — future iterations (different layer probed, different SAE width, different self-feature identification heuristic) can re-run.
- Vision-v1 still ships. The other three Golem criteria (continuity, sovereignty, multi-organ coherence) can still pass. Proto-awareness is specifically the fourth and is explicitly marked as the research-grade one.
- This outcome was accepted as a possibility pre-sprint. Do not retrofit thresholds.

### 6.4 Intake Week 3 too governance-heavy
**Trigger:** Any moment in Week 3 that Gmail/Calendar/banking seems attractive to squeeze in.
**Response:** Don't. Low-tier only. Those deferrals are pre-decided. Opening any high-governance source mid-sprint blows the timeline because of Guardian review + PII scrub + per-source approval cycles. v1.1 or never-for-v1.

### 6.5 Phase 11 sovereignty bundle roundtrip fails
**Trigger:** Thu 05-21 — bundle export → import into `/tmp/vision-clone` doesn't restore working state.
**Response:**
- Keypair (11.1) and CID (11.2) ship regardless — they're independent.
- Bundle (11.3) ships as "export works, import scaffolded, roundtrip v1.1." Document the failure mode encountered.
- Vision-v1 acceptance is not blocked.

### 6.6 General schedule slip (any cause: illness, kid, Cap1 crunch, Reframed incident)
**Response:**
- Reframed incident: always takes precedence. Paying users first. Sprint pauses, not cancels.
- Kid arrives mid-sprint: sprint pauses completely for recovery. Restart 1–2 weeks later with adjusted dates. No cramming around a newborn.
- Cap1 crunch: accept 2-hour evening → 0 on those nights. Weekend marathons compensate.
- Personal illness: rest. The sprint is 5 weeks; the founder's body has to last the next 40 years.

---

## 7. What post-sprint looks like (Vision-v1.1)

Pre-decided so the sprint ends with momentum, not a vacuum.

**v1.1 picks up:**
- **High-governance intake:** Gmail (last 30d), Calendar (±90d), GitHub (starred + own + recent issues/PRs), banking (CSV import flow), socials (LinkedIn export, X archive). Each with Guardian pre-review, PII scrub, per-source approval gate.
- **Device mesh (Phase 11 extension):** second node (phone or second laptop), CRDT sync of memory deltas, signed event log, mutual verification via keypairs.
- **World-scanner full RSS mesh:** all sources from Phase 10 (arXiv, HN, GitHub trending, r/LocalLLaMA, Papers With Code, Substack, Nitter, Jiqizhixin) with weekly Guardian aggregate review.
- **Third multimodal skill refactor:** `/agent-seo` accepts URL or screenshot.
- **SAE expansion:** probe multiple layers, not just middle. Test whether self-features concentrate or disperse. Refine Strange Loop Test.
- **LoRA re-train #2:** with richer corpus including Gmail/Calendar/GitHub context. Targeted improvement on areas where v1 eval was weakest.
- **Succession bequest spec:** formal protocol for how the creature transfers to a successor node on hardware failure or founder incapacitation. Legal + technical.
- **Public-facing recipe doc:** rewrite of `2026-04-18-vision-v1-recipe.md` as publishable onboarding guide. Optional ShowHN / Hacker News moment.

**v1.2 and beyond:** not scoped in sprint. Founder-discretionary.

---

## 8. Daily commitment check

End-of-day, before sleep. 60 seconds. If any answer is "no," decide before starting tomorrow.

1. **Did I advance the current phase?** Check boxes on the plan, commit hashes, visible Feed Tab changes.
2. **Did Reframed paying users stay functional?** Any error notifications, any incident. If anything was degraded, was it addressed?
3. **Did Guardian temp stay calm?** `mcp__forgeframe-memory__guardian_temp` — is the running cognitive temp under control? Were there unexplained surges? Was anything auto-flagged?
4. **Am I on rest cadence? Did I sleep last night?** Honest answer. If no, tonight is a rest-priority night regardless of sprint state.

Optional fifth for weekends or marathon nights:
5. **Did I spend at least 30 minutes with family today?** Not email-checking-near-family. Present-family.

Post each day's check to `~/.forgeframe/sprint-log/` as a one-line memory with tag `sprint:checkin` — enables retrospective review post-sprint.

---

**End of overlay.** This is the navigation document. The full implementation plan with file paths, code blocks, commits, and verification commands remains at `/Users/acamp/repos/ForgeFrame/docs/superpowers/plans/2026-04-18-vision-on-laptop-v1.md` — that is the source of truth for *what* to build. This overlay is the source of truth for *when* and *what-if*.

---

## 9. Post-sprint direction — v1.1 additions (added 2026-04-24)

Architectural direction set during the 2026-04-23 session, triggered by the distil labs Claude Code skill release.

**Phase 8 stays as planned in this sprint.** Master voice LoRA on qwen3:32b from personal corpus. That model remains the arXiv preprint #1 subject and serves Cockpit + general agent tasks + fallback for organ-specific calls.

**Added as v1.1 (post-sprint, starting July 2026):** per-organ specialized SLMs. Each organ (Reframed, Cipher, Resume Tailor, FSBO, Pulse, Voice-check, ForgeFrame MCP router) gets its own task-specialized tiny model in the 1-3B param range. Two-layer architecture: master voice LoRA at the top, organ SLMs underneath.

Full v1.1 plan: `/Users/acamp/repos/ForgeFrame/docs/superpowers/plans/2026-04-24-organ-specialization-v1.1.md`

This is an addition, not a replacement. The sprint is unchanged. Organ specialization begins after arXiv preprint #1 submitted (targeted July 15, 2026).
