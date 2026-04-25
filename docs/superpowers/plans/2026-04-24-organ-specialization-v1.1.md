# Organ Specialization — v1.1 addition to Vision-v1 roadmap

**Date created:** 2026-04-24
**Author:** Alex Campos
**Type:** post-sprint addition (NOT in 5-week sprint)
**Target start:** mid-July 2026 (after arXiv #1 submitted)
**Target end:** Q3 2027 (staged over 3-4 months of exploration + implementation)

**Relationship to 5-week sprint:** This is a **v1.1 addition**, not a replacement. The 5-week sprint's Phase 8 (master voice LoRA on qwen3:32b from personal corpus) ships unchanged. This plan adds a **second layer** on top of that: per-organ specialized SLMs.

---

## Why this direction

The 5-week sprint ships one LoRA — a general voice model on your personal corpus. That's the right move for the sprint because:
- It's the arXiv preprint #1 topic (personal-corpus LoRA feasibility at consumer hardware scale)
- It captures your general cognitive pattern for Cockpit + general agent tasks
- Single training run, single arXiv paper, coherent sprint outcome

But CREATURE has **organs** — Cipher (trading), Reframed (reframing), Resume Tailor (career), FSBO agent, Pulse (meta-reflection), Voice-check (editorial), and others coming. Each organ has task-specific behavior that the general voice model is **over-specced for**. A 32B general model is expensive and slow for deciding whether a credit-union tool call matched intent, or whether a trade pattern looks healthy.

The right architecture emerged during the 2026-04-23 session triggered by the [distil labs Claude Code skill release](https://github.com/distil-labs/distil-cli-skill):

```
Substrate: ForgeFrame (memory, routing, daemon, dream cycles)
├── Master voice model: qwen3:32b + personal-corpus LoRA
│   ├── Captures general cognitive voice
│   ├── Used by Cockpit for everything general
│   └── Used by organs for fallback / general reasoning
└── Per-organ specialized SLMs (this plan):
    ├── Cipher: Qwen3-1.7B tuned on successful trade traces
    ├── Reframed: tiny model tuned on reframing patterns + voice-check judgments
    ├── Resume Tailor: tuned on resume generation traces
    ├── FSBO agent: tuned on real-estate response patterns
    ├── Pulse synthesizer: tuned on weekly report generation traces (once pulse has ~20 reports)
    └── Voice-check enforcer: tuned on voice-register judgment traces
```

Each organ's SLM: 1-3B params, 10-30x faster than the general model on its specific task, runs locally on consumer hardware.

This is the **complement**, not the replacement, of the master LoRA.

---

## Architectural principles

1. **Two-layer hierarchy.** Master voice LoRA = general. Organ SLMs = specialized. Every organ falls back to the master LoRA if its SLM fails.
2. **Each organ independent.** An organ's SLM can be retrained without touching others. No monolithic retraining.
3. **Local inference always.** Organ SLMs run on the CREATURE host (Mac mini). Zero cloud dependency at inference.
4. **Training-time sovereignty per organ.** Some organs (Cipher, Reframed public data) can use distil labs cloud teachers. Others (personal corpus, voice-check judgments) must use local-only committee.
5. **No speculative organ training.** Only train an organ's SLM when the organ has enough production traces (N ≥ 200 cleaned traces minimum).

---

## Tools landscape (as of April 2026)

**Option 1: distil labs Claude Code skill** (github.com/distil-labs/distil-cli-skill)
- Committee relabel (4 teachers + arbiter)
- Teacher eval gate before training
- Self-hosted deployment (llama.cpp + vLLM weights)
- Training teachers run in distil labs cloud (GLM-5, gpt-oss-120b)
- Free for open-source projects
- **Trade-off:** cloud training, local inference

**Option 2: Local-only committee pipeline (to be built)**
- Replicates distil labs' technique locally
- Uses Ollama models as teachers: qwen3:32b, qwen3.5:27b, kwangsuklee-reasoning-distilled, plus non-Qwen for diversity (Gemma 2 27B, Llama 3.3 70B, Phi-3.5 medium, Mistral Small 24B)
- 4-5 family committee reduces correlated error
- ~80-90% quality of distil labs' cloud committee
- Fully sovereign — no cloud touch at any stage
- **Trade-off:** build cost (20-40 hours), slightly lower label quality

**Option 3: MLX-LM distributed fine-tune** (Apple, available since WWDC 2025)
- Apple-native distributed training via MPI
- Requires multi-Mac setup (post-2nd-Mac era)
- No committee relabel built in — would need to combine with Option 2 technique

**Option 4: Roll your own with MLX-LM single-node + manual labeling**
- Simplest, lowest tooling dependency
- No committee relabel benefits
- Good for organs where you have high-quality labeled data already

**Decision matrix per organ:** See "Sovereignty routing per organ" section below.

---

## Organs in scope (ranked by readiness)

### Organs ready for SLM training by July 2026 (sufficient trace volume)

| Organ | Trace source | Estimated trace count by July | Suitable tool |
|---|---|---|---|
| **Reframed** | Production API logs at reframed.works | ~500-2000 reframings (anonymized) | distil labs cloud OK |
| **Voice-check** | Historical voice-check runs across essays + applications | ~100-300 judgment traces | local-only (personal data) |
| **Resume Tailor** | Production tailoring runs | ~200-500 traces | distil labs cloud OK (if user data anonymized) |
| **ForgeFrame MCP router** | Call logs from the production daemon | ~2000+ routing decisions | local-only (operational sensitivity) |

### Organs not ready until Q4 2026 / Q1 2027 (insufficient traces)

| Organ | Why not ready | Target |
|---|---|---|
| **Cipher V2** | V2 just launching post-sprint; needs 3+ months of V2 traces | Q1 2027 |
| **FSBO agent** | Minimal production traces; depends on gig volume | Q1-Q2 2027 |
| **Pulse synthesizer** | Needs ~20+ weekly reports to have training signal | October 2026 earliest |
| **Daemon-α (agent dispatch)** | Starts May 3 per sprint, won't have sufficient decision traces until Q4 | Q4 2026 |

---

## Sovereignty routing per organ

| Organ | Training tool | Reason |
|---|---|---|
| Reframed | distil labs cloud | Public-facing product; user data can be anonymized; distil labs' teachers give best quality |
| Resume Tailor | distil labs cloud | Same as Reframed |
| Cipher | distil labs cloud | Public market data + broker APIs |
| FSBO agent | distil labs cloud | Real-estate + public real-estate data |
| Voice-check | **local-only committee** | Trained on personal essays + voice judgments |
| ForgeFrame MCP router | **local-only committee** | Operational traces may include sensitive agent interactions |
| Pulse synthesizer | **local-only committee** | Synthesis based on personal weekly data |
| Daemon-α | **local-only committee** | Agent decision traces, may touch sensitive work |

**Rule of thumb:** if an organ's training traces contain data the founder wouldn't send to Anthropic's API, don't send them to distil labs either.

---

## Timeline (staged)

### Phase A — Exploration (July 2026, post-sprint + post-arXiv-#1)

- [ ] Apply distil labs Claude Code skill to Reframed traces (safest pilot, public-facing data)
- [ ] Compare: Reframed-specialized SLM vs Reframed using master voice LoRA
- [ ] Measure: latency, quality (user rating), cost
- [ ] Decision: is the per-organ approach actually worth the maintenance overhead?
- [ ] Write up results as informal blog post or arXiv preprint #2 candidate

**Budget:** 20-40 hours over 2-3 weeks. Parallelizable with arXiv #1 publication work.

### Phase B — Expand to 2-3 public-facing organs (August 2026)

If Phase A confirms value:

- [ ] Resume Tailor SLM via distil labs (traces ready, public-data-OK)
- [ ] Cipher V2 SLM via distil labs (when V2 has 3+ months of traces, likely Q1 2027 — deferred)
- [ ] Document per-organ benchmark suite

**Budget:** 30-50 hours over 4-6 weeks.

### Phase C — Build local-only committee pipeline (Q1-Q2 2027, post-paternity)

**Timing note:** Per 2026-04-23 life-sequence decision, Oct-Dec 2026 is paid paternity leave with minimal CREATURE development. Phase C work resumes in January 2027 after return to Capital One and beginning of job search. Work continues through Q1-Q2 2027.

- [ ] Design committee relabel pipeline using local Ollama models only
- [ ] Pull non-Qwen models for committee diversity (Gemma 2, Llama 3.3, Phi-3.5, Mistral Small)
- [ ] Build teacher eval gate (scores ≥0.70 before training fires)
- [ ] Build synthetic generation step using local teachers
- [ ] Ship first local-committee-trained SLM: Voice-check enforcer (most sovereignty-sensitive organ)
- [ ] Write up: "Local-Only Committee Distillation for Personal Corpora" — potential arXiv preprint #3

**Budget:** 60-100 hours over 4-5 months. Constrained by dual-track focus (job search + newborn + post-paternity adjustment + CREATURE work). Realistic: Jan 2027 start, Apr-May 2027 ship.

### Phase D — Full organ specialization (Q2-Q3 2027)

**Timing context:** By Q2 2027, new lab role likely landed (Spring 2027 per 2026-04-23 sequence). Higher-income, stable routine enables Phase D ambition. Summer 2027 SFH purchase in Northern Virginia lands alongside Phase D completion.

- [ ] Every organ has its own SLM
- [ ] All sovereignty-sensitive organs trained via local-only pipeline
- [ ] Public-facing organs using distil labs or local (user choice)
- [ ] Benchmark suite runs quarterly; organs get retrained when traces accumulate meaningful new patterns
- [ ] **Level 3 reaches 100%** (lab role landed + full organ specialization)

---

## Success criteria

**Phase A success (July 2026):**
- At least one organ has a specialized SLM deployed
- SLM beats master voice LoRA on organ-specific eval by ≥10% on measured quality AND is ≥5x faster
- Documentation exists for retraining the organ when traces accumulate

**Full plan success (Q3 2027):**
- All public-facing organs have distil-labs-trained SLMs
- All sovereignty-sensitive organs have local-only-committee-trained SLMs
- Master voice LoRA still serves Cockpit + general tasks + fallback
- Local-only pipeline is published (arXiv #3 candidate)
- Maintenance cost: ≤1 hour per quarter per organ retraining

---

## Failure modes + mitigation

| Risk | Mitigation |
|---|---|
| distil labs discontinues free tier or pivots | Local-only pipeline (Phase C) becomes critical; design as fallback from day 1 |
| Per-organ SLMs add more complexity than they save | Abort if Phase A doesn't show clear win; revert to master-LoRA-for-all |
| Organ trace volume insufficient for meaningful training | Defer per-organ training until N ≥ 200 cleaned traces; use master LoRA in interim |
| Local committee quality too low to be useful | Add more non-Qwen models; increase committee size to 6-8; accept quality hit for sovereignty |
| WWDC 2026 or Apple ships something that obviates this | Re-evaluate plan; this is a real risk for the distributed-training portion specifically |

---

## Does NOT belong in this plan

- Hardware upgrades (Mac mini M4 Pro 64GB, second Mac for cluster) — tracked separately in session notes
- Cluster + EXO exploration — a 2027+ concern, not organ specialization
- LoRA base model training itself — that's sprint Phase 8
- Organ implementation (Cipher, Reframed, FSBO) — each has its own plan file

---

## Cross-links

- 5-week sprint: `~/repos/ForgeFrame/docs/superpowers/plans/2026-04-18-vision-5-week-sprint.md` — Phase 8 (master voice LoRA) is the prerequisite
- Vision on laptop: `~/repos/ForgeFrame/docs/superpowers/plans/2026-04-18-vision-on-laptop-v1.md`
- CREATURE umbrella: `/Users/acamp/vision/CREATURE.md` — organs + substrate architecture
- Cipher V2 scope: `~/repos/ForgeFrame/docs/superpowers/plans/2026-04-21-cipher-v2-scope.md`
- Pulse design: `~/forge-ops/pulse/docs/superpowers/specs/2026-04-24-pulse-design.md` — pulse is an organ too, will eventually get specialized
- distil labs skill: github.com/distil-labs/distil-cli-skill
- Anthropic MCP ecosystem
- Apple MLX distributed (WWDC 2025): developer.apple.com/videos/play/wwdc2025/298/

---

## Open questions

1. Does the voice-check organ need fine-tuning at all, or can it stay prompt-engineered indefinitely?
2. When pulse accumulates ~20 reports, does pulse-specialization add meaningful value, or is general voice LoRA sufficient for weekly synthesis?
3. Is the per-organ SLM hierarchy best served by different base models (Qwen vs Gemma vs Phi) or all-Qwen with different sizes?
4. Should there be a "master coordinator" LoRA that routes between organ SLMs, or does ForgeFrame's existing routing layer handle that?

These are exploration-phase questions. Don't attempt to answer before Phase A runs.
