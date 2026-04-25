# Daemon-v1 — Risk, Timeline & Sprint Integration

**Context:** Founder at $4K/mo burn, ~12mo runway, first child Oct 2026, Cap1 day job. Daemon-v1 is the force-multiplier that makes 12-18 month compression plausible. It is NOT a separate bet — it is what Vision sprint Phase 2 grows into.

---

## Section 1 — Does Daemon-v1 fit in the 5-week sprint?

**Partially.** The orchestrator skeleton fits. The full daemon does not.

Sprint already contains daemon MVP inside Phase 2 (Week 2, 2026-04-25 → 05-01): heartbeat ticks, NREM/REM schedule, triggers armed at startup, all surfacing to Feed Tab. **That is Daemon-0. Zero extra sprint scope.**

Does NOT fit in the 5-week window:
- Worktree dispatcher (subagent spawning with isolated git worktrees)
- Review queue UI (Cockpit panel for approvals)
- Trust-tier gate enforcement
- ntfy ASK loop (phone-side approve/reject)
- Token budget enforcement
- Rollback log

These need **2-3 weeks additional work after Phase 12 acceptance on 2026-05-22.** Squeezing them in costs the Strange Loop Test, which is the Golem-criteria differentiator and therefore non-negotiable.

| Capability | Fits sprint? | Ships as |
|---|---|---|
| Heartbeat + triggers + dream schedule | Yes (Week 2 Phase 2) | Daemon-0 |
| Feed Tab surfacing daemon events | Yes (Week 1 Phase 1) | Daemon-0 |
| Worktree dispatcher + task decomp | No | Daemon-α (post-sprint) |
| Trust-tier spec + ASK loop | No | Daemon-β (post-sprint) |
| Token budget + rollback | No | Daemon-β |
| Hermes + dream-driven real work | No | Daemon-v1 (July) |

---

## Section 2 — Phased delivery plan

### Daemon-0 — 2026-05-01 (Fri, end of Sprint Week 2)
**Delivered:** Orchestrator loop, 5s heartbeats, dream schedule firing on sleep pressure, triggers armed at startup, Feed Tab showing all events live on phone. Exactly Phase 2 — zero extra scope.
**In the loop:** Founder reads Feed Tab passively; daemon does no autonomous action. Observation-only.

### Daemon-α — 2026-06-05 (Fri, ~2 weeks post-sprint)
**Delivered:**
- Worktree dispatcher (wraps `superpowers:using-git-worktrees`)
- Task decomposition organ (reads from `daemon:queue` memory tag)
- Review queue in Cockpit — fifth tab next to Feed, approve/reject buttons
- TELL-tier actions execute autonomously (indexer re-runs, memory consolidation, log rotation, benchmark re-runs)
- Daily digest 07:00 via ntfy
**In the loop:** Founder approves ASK-tier in Cockpit; TELL-tier fires without approval but visible.

### Daemon-β — 2026-06-26 (Fri, ~5 weeks post-sprint)
**Delivered:**
- Trust-tier spec machine-readable (`~/.forgeframe/trust-tiers.json`)
- ntfy ASK loop — phone approve/reject with timeout
- Token budget enforced by Guardian (daily cap, hard stop)
- Rollback log — `daemon_rollback <id>` works
**In the loop:** Founder can be AFK; daemon sits on ASK-tier until reply or timeout. Weekly triage.

### Daemon-v1 — 2026-07-24 (Fri, ~9 weeks post-sprint)
**Delivered:**
- Hermes skill integration (daemon dispatches Hermes searches)
- Dream cycle drives real background work — REM promotes/demotes memories, queues morning ASKs
- Self-directed work on defined surface
- Self-healing: 3x failure → guardian_alert
**In the loop:** Minimal. Founder checks digest, acts on ~3-5 ASKs/day. **This is the shape that has to survive kid-arrival.**

Target: Daemon-v1 stable by **September 2026**, one month pre-kid buffer.

---

## Section 3 — Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Scope creep into Vision sprint | HIGH | Daemon-0 scope = only Phase 2. No Daemon-α work until Phase 5+ complete. Commits touching worktree dispatch before 2026-05-22 are rolled back. |
| API budget blowout ($4K→$12K/mo) | HIGH | Daemon-α ships with soft daily cap (~$150/day). Daemon-β enforces hard. Until then, observation + TELL-only which uses local Ollama. Claude spend stays founder-gated. |
| Trust-gate bypass | CRITICAL | Daemon-α dispatcher REFUSES unknown action kinds; whitelist only. Daemon-β makes trust spec load-bearing at router. Every action writes `trust_check` memory. |
| Founder attention dilution (>5 ASK/day) | HIGH | Batch review UI; daily digest; compound-only principle. Sustained >5/day after Daemon-β → demote borderline actions to TELL. |
| Cascading failure on bad state | HIGH | Daemon-β rollback log. Every write reversible. Human-readable diff in review queue. Daemon pauses itself on 3 consecutive Guardian alerts. |
| Kid arrives, daemon breaks | CRITICAL | Daemon-v1 stable by 2026-09-01. Post-September patch-only. "Vacation mode" drops to TELL-only after 72h no founder Feed interaction. |
| LoRA slip blocks Strange Loop | HIGH | Mitigated in sprint overlay §6.1-6.2. Daemon plan assumes Vision-v1 ships on time OR in Option A/C shape. |
| Reframed paying-user incident during daemon work | MEDIUM | Reframed incidents preempt daemon dev. Daemon-β self-pauses on Reframed error spike. |
| Burnout from sprint + daemon | HIGH | Sprint overlay §5 rest cadence. Daemon-α starts 2 weeks post-sprint for recovery window (2026-05-23 → 05-29). |

---

## Section 4 — Critical path

```
Today (2026-04-19, Day 2 Wave 1)
  └─► Finish Phase 0 Task 0.3 redistill (tonight)
  └─► 2026-04-22 Wed: Feed Tab on phone (felt moment)
  └─► 2026-04-25 Sat: Phase 2 Task 2.1 orchestrator skeleton   ◄── DAEMON-0 BEGINS
  └─► 2026-05-01 Fri: triggers + dream schedule live            ◄── DAEMON-0 SHIPS
  └─► [Weeks 3-5: routing, intake, multimodal, LoRA, SAE]
  └─► 2026-05-22 Fri: Vision-v1 acceptance                     ◄── SPRINT ENDS
  └─► 2026-05-23 → 05-29: RECOVERY WEEK (non-negotiable)
  └─► 2026-05-30: Daemon-α work begins
  └─► 2026-06-05 Fri: Daemon-α ships (worktree + review queue)
  └─► 2026-06-26 Fri: Daemon-β ships (trust + ntfy + rollback)
  └─► 2026-07-24 Fri: Daemon-v1 ships (Hermes + dream-driven)
  └─► 2026-09-01: Daemon-v1 STABILIZED. Patch-only.
  └─► 2026-10-XX: Kid. Daemon self-healing.
```

**Blockers flagged:**
- Phase 8 LoRA slip → cascades into Week 5 SAE, possibly recovery. Push right, keep Daemon-α→β→v1 durations intact.
- Reframed incident takes priority.
- Cap1 crunch — timeline elastic.
- Kid-arrival earlier than Oct → collapse Daemon-v1 scope to "self-healing Daemon-β."

---

## Section 5 — Minimum-viable compression

**Honest minimum: Daemon-β. Not Daemon-v1.**

Compression factor by milestone:
- Daemon-0: ~1.0x (diagnostic only, zero execution)
- Daemon-α: ~1.2-1.3x (faster iteration loop but founder still in hot path)
- **Daemon-β: ~1.5-1.8x** (first point where founder sleeps and meaningful work happens)
- Daemon-v1: ~2-2.5x (Hermes + dream-driven work)

The 40% autonomous target only achievable at Daemon-v1. But **25-30% at Daemon-β is enough to move the 12-18 month window.** If time/energy/kid pressure forces a choice, β is the cut line.

---

## Section 6 — Slip protocol

**If Daemon-α doesn't land by 2026-06-05:**
- Cut Cockpit review queue UI; use flat `daemon_pending` tag + `/daemon-review` CLI skill. Saves ~3 days.
- Cut worktree dispatcher; use `git stash` + branch-per-task. Saves ~2 days, loses isolation.
- Cut task decomposition organ; accept hand-written tasks in `~/.forgeframe/daemon-queue.json`. Saves ~2 days.
- Floor: working TELL-tier executor + daily digest.

**If life intervenes:**
- **Pause-point 1: after Daemon-0 on 2026-05-01.** Observability only. Nothing breaks if you stop.
- **Pause-point 2: after Daemon-β on 2026-06-26.** TELL-tier + rollback. Useful but not yet driving real compression.
- **DO NOT pause mid-Daemon-α** — review queue + TELL-tier are matched pair. Half-built is worse than either end.

Kid arrives 2026-06-01 to 2026-07-15 → collapse Daemon-α + β into single-shot "autonomous TELL + audit + manual rollback," ship Daemon-β at reduced scope. Daemon-v1 deferred to Q4.

---

## Section 7 — Recommended start (Monday 2026-04-20)

**First task: Phase 1 Task 1.2 — PWA manifest for Feed Tab.** 45-90 min evening block.

Why:
- Tonight closes Phase 0.4 + 0.5 per sprint overlay Week 1.
- Monday is Cap1 workday, 2h evening window. PWA manifest is the overlay's explicit Monday task: manifest JSON, three `<meta>` tags, verify on phone LAN, commit. Achievable before 20:30.
- Unblocks felt-moment milestone (Wed 04-22) — the psychological anchor for the whole sprint.
- Does NOT touch daemon code. Daemon work begins Saturday 04-25 with Task 2.1. **Scope discipline starts now.**

**Explicitly NOT Monday:**
- Sketching the worktree dispatcher (March-of-next-year's work)
- Writing the trust-tier spec (premature — actions it gates don't exist yet)
- Opening a new "daemon architecture v2" plan doc (the plan you're in is the plan)

**Pre-bed Monday check:** Is `http://<laptop-ip>:3001/cockpit/?pane=feed` loadable on phone with Vision icon on home screen? Yes → Monday shipped. No → diagnose Tuesday triage, DO NOT stay up past 22:30.

---

## Closing

Daemon-v1 is **12 weeks of work effectively starting 2026-05-23** (after sprint + recovery). That puts it at 2026-08-14 best case, 2026-09-01 normal, 2026-10-01 with one research-risk event. All three pre-kid.

The 5-week Vision sprint is not the daemon. The 5-week Vision sprint is the substrate on which the daemon is the next three months of work. Do not conflate them — the conflation is what burns founders and partners.

Plan respects partner and kid: Daemon-β is the floor, Daemon-v1 is the ceiling, September is stabilization deadline, first post-sprint week is recovery (non-negotiable). No martyr plan. No marathon-every-night. The compression math works at β already.
