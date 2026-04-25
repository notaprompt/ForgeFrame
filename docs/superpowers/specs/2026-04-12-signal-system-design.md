# ForgeFrame v2 "Signal" — System Design Specification

**Date:** 2026-04-12
**Author:** Alex Campos + Claude Opus 4.6
**Status:** Draft — pending founder review
**Scope:** Four-layer cognitive operating system: Hebbian Memory Engine, Guardian Constitutional Governance, Signal Neural Pathway Renderer, Hermes Agent Integration

---

## 1. System Identity

ForgeFrame v2 "Signal" is a sovereign cognitive operating system with four integrated layers. Each layer is custom-built from first principles. The substrate IS the differentiator — nobody can wrap a library and replicate this.

```
LAYER 4: AGENT (Hermes integration)
  Autonomous loop runner. Scan, evaluate, act, learn, sleep, repeat.
  Talks to ForgeFrame via MCP. Doesn't see governance.

LAYER 3: SIGNAL (Neural pathway renderer)
  Custom WebGL. Procedural organic pathways.
  Visualizes the living memory in real time.

LAYER 2: GUARDIAN (Constitutional governance)
  TRIM cognitive layers. Trust tiers. Temperature.
  Awareness traps. The law. Skill: /forgeframe-governance

LAYER 1: MEMORY (Hebbian engine)
  Co-retrieval strengthening + depression. Decay.
  Consolidation as TRIM promotion. The learning substrate.
```

**Success criteria:** The system runs autonomously (Layer 4), learns from its own usage patterns (Layer 1), governs itself constitutionally (Layer 2), and you can watch it think in real time through procedural neural pathways (Layer 3). The first time a pathway visibly thickens because two memories were co-retrieved — that's the moment.

---

## 2. Layer 1: Hebbian Memory Engine

### 2.1 What Exists (Unchanged)

- Strength decay with half-life model (base 7 days, floor 0.1)
- Constitutional exemption (principle, voice skip decay)
- Strength restoration on retrieval (reconsolidation)
- Auto-linking via FTS on memory creation
- 7 edge relation types
- Artifact state machine (draft, ready, shipped, trapped)
- 386 passing tests

### 2.2 New: Co-Retrieval Strengthening (Tier 2 — Autonomous, Constitutional Guard)

When `memory_search` returns results, apply the full Hebbian rule:

**Long-Term Potentiation (LTP) — strengthen co-retrieved pairs:**
```
on_search_complete(results):
  pairs = all_pairs(results)
  for (m1, m2) in pairs:
    if constitutional(m1) or constitutional(m2): skip
    edge = getEdge(m1.id, m2.id)
    if edge and edge.last_hebbian_at > (now - 1 hour): skip  // refractory period
    if edge:
      edge.weight = min(2.0, edge.weight + 0.05)
      edge.last_hebbian_at = now
    elif co_retrieval_count(m1, m2) >= 3:
      createEdge(m1, m2, type: 'similar', weight: 0.3)
```

**Long-Term Depression (LTD) — weaken non-co-retrieved neighbors:**
```
  for m in results:
    for neighbor_edge in m.edges:
      neighbor = other_node(neighbor_edge, m)
      if neighbor NOT in results:
        if constitutional(neighbor): skip
        if neighbor_edge.last_hebbian_at > (now - 1 hour): skip
        neighbor_edge.weight -= 0.02
        neighbor_edge.last_hebbian_at = now
        if neighbor_edge.weight < 0.05:
          deleteEdge(neighbor_edge)  // synapse pruning
```

**Design rationale:**
- 0.05 increment (not 0.1) prevents runaway strengthening
- LTD prevents rich-get-richer — unused connections actively weaken
- Pruning at 0.05 removes dead synapses, keeping the graph clean
- 1-hour refractory period prevents session-hammering
- Constitutional guard: principle/voice edges never modified by Hebbian ops
- Co-retrieval count tracked in memory associations array (already exists, cap 20)

**New schema fields:**
- `memory_edges.last_hebbian_at` (INTEGER, nullable) — timestamp of last Hebbian modification

**SSE events:**
- Emit single `hebbian:batch-update` event per search with full changeset
- Debounce 500ms — merge changesets if searches happen rapidly
- Event payload: `{ strengthened: [{id, weight}], weakened: [{id, weight}], pruned: [id], created: [{id, source, target, weight}] }`

### 2.3 New: Consolidation as TRIM Promotion (Tier 3 — Autonomous + Human Gate)

Consolidation is how the system discovers its own patterns and principle candidates. It maps directly to TRIM layer promotion:

```
Object layer (observation, entity, milestone)
  --> consolidation --> Observer layer (pattern)
    --> meta-consolidation --> Interpreter layer candidate
      --> human promotion --> principle (constitutional, immutable)
```

**Trigger conditions (NOT timer-based):**
- Average edge weight in a connected component > 1.2 across 5+ nodes
- OR Guardian recursionDepth > 3 on same cluster in one session
- OR user explicitly requests: "consolidate this cluster"

**Consolidation pipeline:**
```
1. Identify candidate cluster (subgraph with avg weight > 1.2, size >= 5)
2. Verify: no constitutional memories in cluster
3. Run local LLM (Gemma 4 31B or Qwen 3 32B) to summarize:
   - Input: all memory contents in cluster
   - Output: title, summary, extracted patterns, suggested tags
4. Create PROPOSAL (not committed):
   {
     type: 'consolidation',
     content: llm_summary,
     sources: [memory_ids],
     suggested_tags: ['pattern'],
     status: 'pending_approval'
   }
5. Present to user via Cockpit UI or CLI
6. On approval:
   a. Create consolidated memory (memoryType: 'semantic', tags: ['pattern'])
   b. Create 'derived-from' edges from consolidated to each source
   c. Migrate external edges: consolidated inherits all edges from sources
      to nodes outside the cluster, weight = max(original weights)
   d. Halve stability of source memories (accelerated decay)
   e. Emit SSE: consolidation:complete
7. On rejection: log decision, mark cluster as reviewed, don't repropose for 7 days
```

**Consolidation depth limit: 2 levels maximum.**
- Level 0: Raw memories (Object layer)
- Level 1: First consolidation (Observer layer — tagged 'pattern')
- Level 2: Meta-consolidation of patterns (Interpreter layer candidate)
- No Level 3+. At Level 2, the memory is a "principle candidate" surfaced to the user. Human decides whether to promote to constitutional 'principle' tag (Tier 4 operation).

**Edge migration on consolidation:**
- External edges (source node outside cluster): inherited by consolidated memory, weight = max(originals)
- Internal edges (both nodes in cluster): become 'derived-from' edges
- Duplicate edge prevention: if consolidated node already has edge to target, keep higher weight

### 2.4 New: Contradiction Surfacing (Tier 3 — Autonomous + Human Gate)

**Trigger:** Weekly scan OR when Guardian contradictionDensity > 0.1

**Pipeline:**
```
1. Find all 'contradicts' edges where both memories are non-constitutional
2. For each pair, run local LLM analysis:
   - "Memory A says: {content}. Memory B says: {content}. How do they contradict?"
3. Generate proposal with options:
   a. Supersede A with B (A is outdated)
   b. Supersede B with A (B is outdated)
   c. Merge into new memory C (both partially right)
   d. Keep both (creative tension, remove contradicts edge, add 'related')
4. Present to user
5. On decision: execute, log provenance, update edges
6. Constitutional guard: if either memory has 'principle' or 'voice' tag,
   DO NOT propose resolution. Surface as "constitutional tension" for
   founder awareness only — no automated action.
```

---

## 3. Layer 2: Guardian Constitutional Governance

### 3.1 What Exists (Unchanged)

Full governance model as documented in `/forgeframe-governance` skill:
- 6 Guardian signals computing temperature (calm/warm/trapped)
- TRIM cognitive layers (Object/Observer/Interpreter + cross-layer)
- Constitutional tags (principle, voice) exempt from decay
- 4 trust tiers (autonomous, guarded, gated, human-only)
- Organ trust model (cognitive data never cloud)
- 386 passing tests covering all subsystems

### 3.2 New: Guardian-Aware Hebbian Governance

Guardian temperature modulates Hebbian learning rate:

```
hebbian_multiplier:
  calm (0.0-0.3):    1.0x  — normal learning
  warm (0.3-0.6):    0.5x  — slow down, you might be looping
  trapped (0.6-1.0): 0.0x  — HALT all Hebbian updates
```

**Rationale:** When Guardian detects trapped state (circular thinking, revisiting without action), the system should NOT be strengthening the very pathways you're stuck in. Halting Hebbian updates during trapped state prevents the feedback loop from becoming self-reinforcing.

### 3.3 New: Guardian Signal — hebbianImbalance

Seventh Guardian signal:

```
hebbianImbalance = max_edge_weight_in_graph / mean_edge_weight
normalized: min(imbalance / 5.0, 1.0)
```

Detects when a small number of pathways have become disproportionately strong compared to the rest. High imbalance suggests the system is over-indexing on a narrow set of connections — the memory equivalent of tunnel vision.

**Weight adjustment:** All 7 signals now equally weighted (1/7 each instead of 1/6).

### 3.4 New: Consolidation Proposals in Guardian Dashboard

Guardian warm/trapped states now surface alongside consolidation proposals:

```
Guardian Temperature: 0.45 (warm)
Top signal: recursionDepth (0.8) — you've accessed the "sovereignty" cluster 4 times this session

Consolidation available:
  5 memories about sovereignty (avg edge weight 1.4)
  → "Sovereignty isn't a feature — it's the architectural commitment that cognitive
     data never leaves the machine, enforced at runtime."
  [Approve] [Reject] [Edit first]
```

---

## 4. Layer 3: Signal — Neural Pathway Renderer

### 4.1 Design Philosophy

The renderer is NOT a graph visualization library with a skin. It is a custom WebGL application that makes knowledge look like a living nervous system. The aesthetic references: Refik Anadol (organic data flows), Ryoji Ikeda (density as texture), Jerobeam Fenderson (oscilloscope as medium), teamLab (interaction ripples through environment), CRT phosphor persistence (memory as fading light).

**Core metaphor:** The graph is a brain. Pathways are neural connections. Strong pathways are myelinated — thick, bright, fast. Weak pathways are thin, flickering, dissolving. New connections spark. Dead connections fade to noise. The viewer is looking at their own cognition through an oscilloscope.

### 4.2 Node Rendering: Lissajous Figures

Each node is rendered as a Lissajous curve whose shape encodes memory metadata:

```glsl
// Per-node parameters derived from memory data
float freqX = memoryType;     // principle=3, pattern=2, decision=4, observation=1
float freqY = 1.0 + floor(age * 4.0);
float phase = edgeCount * 0.7;
float amplitude = 8.0 + strength * 16.0;

// Lissajous curve (48-64 points per node)
vec2 pos = amplitude * vec2(
  sin(freqX * t + phase + u_time * 0.5),
  sin(freqY * t + u_time * 0.3)
);
```

**You can read a node's character from its shape:**
- Principles: complex, multi-lobed figures (high freqX)
- Observations: simple ellipses (freqX=1)
- Strong memories: large amplitude, crisp lines
- Weak memories: small amplitude, jittery (signal noise applied)

### 4.3 Edge Rendering: Procedural Neural Pathways

Edges are NOT straight lines. They are procedurally generated organic pathways:

**Geometry generation (cached, regenerated on weight threshold crossings):**
```
For each edge (source, target, weight):
  1. Compute cubic bezier control points with slight organic offset
  2. Sample N points along curve (N = 16 + weight * 16, more points = smoother)
  3. At each sample point, generate cross-section:
     - Width = 0.5 + weight * 2.0 pixels (weight-proportional thickness)
     - Slight noise displacement perpendicular to path (organic wobble)
  4. Build triangle strip from cross-sections
  5. Cache vertex buffer, tag with weight threshold bracket
```

**Weight threshold brackets for geometry regeneration:**
- 0.0 - 0.5: thin, sparse sampling, high noise (barely visible thread)
- 0.5 - 1.0: moderate, medium sampling (visible pathway)
- 1.0 - 1.5: thick, dense sampling, low noise (established connection)
- 1.5 - 2.0: thick with branching tendrils at midpoint (myelinated trunk)

**Per-frame shader uniforms (dynamic, no geometry regeneration):**
- `u_brightness`: maps to edge weight (continuous)
- `u_pulsePhase`: animated, creates signal-traveling-along-pathway effect
- `u_flickerAmount`: inverse of weight — weak edges flicker, strong edges steady
- `u_sonarHit`: flare intensity when sonar ping passes through

### 4.4 Post-Processing Pipeline

All effects applied as WebGL post-processing passes:

```
Pass 0: Force simulation (CPU or GPU compute)
Pass 1: Scene render to FBO
  - Nodes as Lissajous curves (instanced line strips)
  - Edges as procedural pathways (cached triangle strips)
  - Per-node/edge shader uniforms for animation
Pass 2: Phosphor persistence
  - Blend current frame with 92-95% of previous frame
  - Creates afterglow trails on everything
Pass 3: Post-processing stack
  a. Bloom (threshold + gaussian blur on bright areas)
  b. Chromatic aberration (subtle, distance from center)
  c. Scanlines (horizontal, animated vertical drift)
  d. Vignette (edges darken)
  e. Film grain (temporal noise, very subtle)
Pass 4: UI overlay (DOM, not WebGL)
  - Glass panels via CSS backdrop-filter
  - Olive Glass aesthetic (sage, gold, earth, terra palette)
  - FORGE wordmark, Guardian breathing eye, inspector panel
```

### 4.5 Interaction Model

**Sonar ping (click anywhere):**
- Expanding dashed ring at click point (gold color)
- Nodes flare as ring passes through them
- Particles flow outward along edges from flared nodes
- Connected nodes flare with propagation delay (distance-based)
- Audio: impulse → convolution reverb shaped by graph structure (if sound enabled)

**Node selection (click node):**
- Node Lissajous brightens, selection ring animates
- Connected edges highlight (brightness boost)
- Non-connected elements dim to 15% opacity
- Inspector panel slides in from right with memory content

**Search (Cmd+K):**
- Matching nodes flare, non-matching dim
- Graph physically reorganizes — matching nodes attract center
- Hebbian co-retrieval fires for all visible results

**Spawn animation (new memory created):**
- CRT scan-line artifact at spawn point
- Node materializes from noise to form over 1.5 seconds
- Auto-link edges grow in (bezier animation from zero to full length)
- Sonar ping from spawn point

**Hebbian visualization (edge weight changes):**
- Strengthened edge: brief brightness pulse, thickness interpolates up
- Weakened edge: dims, thins
- Pruned edge: dissolves into noise particles
- New edge created: grows from source to target with branching animation

**Consolidation visualization:**
- Source cluster nodes orbit inward toward centroid
- Edges compress and merge
- Flash at centroid
- New consolidated node materializes (larger, brighter Lissajous)
- derived-from edges grow outward to original positions (which dim)

### 4.6 Thermal Background

The existing fbm thermal shader is retained but enhanced:

- Graph cluster density feeds into shader as heat sources
- Guardian temperature drives global palette shift (calm sage → warm gold → trapped coral)
- Idle state: organic drift, barely perceptible
- Active state: responsive to interactions and Hebbian events

### 4.7 Sound Design (Opt-In)

Sound is OFF by default. User enables via Cockpit settings. Never autoplay.

**Implementation:** Tone.js + Web Audio API

- **Ambient drone:** Filtered noise, pitch = Guardian temperature, volume = memory count. Changes with time-of-day (lighter mornings, deeper nights).
- **Node hover tones:** Oscillator per hovered node. Type maps to memory type (sine=principle, triangle=pattern, sawtooth=observation, square=decision). Pitch = age. Volume = strength.
- **Sonar ping:** Impulse through convolution reverb. Graph structure shapes the reverb tail.
- **Hebbian events:** Soft tonal shift when edges strengthen. Slight dissonance on weaken.
- **Consolidation:** Harmonic convergence — multiple tones resolve to one.
- **Spatial audio:** Web Audio PannerNode. Nodes have screen position. Sound comes from where the node IS.

### 4.8 Olive Glass Chrome

The UI surrounding the graph maintains the ForgeFrame brand:

- **Header:** FORGE wordmark (tracked gradient bars), Guardian breathing eye, fps, temperature state
- **Search:** Pill-shaped Cmd+K input, expands on focus, glass background
- **Inspector:** Right panel, glass, slides in on node selection. Shows: title, insight, tags, strength bar, edges, history, artifacts
- **Status bar:** Memory count, edge count, avg strength, Guardian state
- **5 themes:** Olive (default), Ink (dark), Linen (warm), Slate (neutral), Void (pure dark)

---

## 5. Layer 4: Hermes Agent Integration

### 5.1 Architecture: Motor and Brain

Hermes is the motor (autonomous loop execution). ForgeFrame is the brain (memory + governance). MCP is the spinal cord (protocol boundary).

```
Hermes Agent Loop
  ├── classify task
  ├── plan approach
  ├── execute (40+ built-in tools)
  ├── extract skill (markdown)
  └── persist state
        ↓ MCP protocol
ForgeFrame Server
  ├── memory_save    → auto-link, TRIM tag, strength=1.0
  ├── memory_search  → RRF retrieval, Hebbian co-strengthening
  ├── memory_link    → edge creation with type
  ├── guardian_temp   → temperature + signals
  └── memory_promote → artifact pipeline
```

**Hermes does NOT know about:**
- Guardian temperature or signals
- TRIM cognitive layers
- Constitutional tags or immutability
- Hebbian learning rules
- Consolidation proposals

**Hermes only knows:**
- Save memories (ForgeFrame handles governance)
- Search memories (ForgeFrame handles Hebbian)
- Link memories (ForgeFrame validates edge types)
- Check temperature (receives calm/warm/trapped as opaque state)

### 5.2 Skill Flow: Hermes → ForgeFrame

When Hermes extracts a reusable skill from a completed task:

```
1. Hermes completes task successfully
2. Hermes abstracts solution into markdown skill
3. Hermes calls memory_save(content: skill_markdown, tags: ['skill'])
4. ForgeFrame stores with strength 1.0, auto-links to related memories
5. On future tasks, Hermes calls memory_search("how to do X")
6. ForgeFrame returns the skill memory (+ Hebbian co-strengthening)
7. Skills that never get re-retrieved decay naturally
8. Skills that get used constantly strengthen
```

The system learns which skills are actually useful. Dead skills fade. Core skills become strong enough to survive indefinitely.

### 5.3 Guardian Modulation of Agent Behavior

Hermes checks Guardian temperature before autonomous actions:

```
temperature = guardian_temp()

if temperature.state == 'calm':
  proceed normally — full autonomous operation

if temperature.state == 'warm':
  reduce scope — skip low-priority tasks
  increase logging — explain reasoning in memory_save
  surface proposals — don't auto-execute, propose to user

if temperature.state == 'trapped':
  HALT autonomous operations
  notify user: "Guardian detected trapped state. Pausing autonomous loop."
  shift to artifact-shipping mode: focus on promoting drafts, not creating new work
```

### 5.4 Hermes Configuration

**Model routing for agent tasks:**

| Task type | Model | Rationale |
|-----------|-------|-----------|
| Classify/triage | Gemma 4 27B MoE (local) | Fast, free, good enough |
| Evaluate/score | Gemma 4 31B Dense (local) | Structured reasoning |
| Creative/voice | Claude Sonnet API | Nuance, voice consistency |
| Architecture/deep | Claude Opus API | Complex reasoning |
| Consolidation summaries | Gemma 4 31B Dense (local) | Sovereignty: never send memory content to cloud |

**Sovereignty rule:** Consolidation and contradiction resolution ALWAYS run on local models. Memory content is cognitive data — it never leaves the machine for LLM processing (constitutional enforcement from organ trust model).

### 5.5 Loop Cadence

The agent loop runs on configurable cadence:

```
Default: every 6 hours (4x daily)
Each cycle:
  1. Check Guardian temperature (abort if trapped)
  2. Scan for new inputs (career-ops scan, email, etc.)
  3. Triage inputs (Gemma 4 local)
  4. Evaluate top matches (Gemma 4 local + Sonnet for top 5)
  5. Generate artifacts (PDFs, reports, outreach drafts)
  6. Check consolidation triggers (propose if ready)
  7. Check contradiction triggers (propose if found)
  8. Check follow-up schedule (nudge if due)
  9. Save session summary to ForgeFrame
  10. Emit SSE events for Cockpit visualization
```

---

## 6. Implementation Waves

### Wave 1: Hebbian Engine (estimated 3-4 days)

**Scope:** Co-retrieval strengthening + depression + pruning + refractory period

Files to modify:
- `packages/memory/src/store.ts` — add `hebbianUpdate()`, `longTermDepression()`
- `packages/memory/src/types.ts` — add `last_hebbian_at` to edge type
- `packages/memory/src/retrieval.ts` — call hebbianUpdate after search
- Migration 6: add `last_hebbian_at` column to `memory_edges`

New tests:
- Co-retrieval strengthens edge weight
- Non-co-retrieved neighbor edges weaken
- Edges below 0.05 get pruned
- Constitutional edges skip Hebbian
- Refractory period prevents re-modification within 1 hour
- Weight caps at 2.0

### Wave 2: Consolidation Engine (estimated 4-5 days)

**Scope:** Cluster detection, LLM summarization, proposal system, TRIM promotion, edge migration

Files to modify:
- `packages/memory/src/consolidation.ts` (NEW) — cluster finder, proposal generator
- `packages/memory/src/store.ts` — add `consolidate()`, `migrateEdges()`
- `packages/server/src/tools.ts` — add `consolidation_propose`, `consolidation_approve` MCP tools
- `packages/server/src/http.ts` — add proposal endpoints

New dependencies:
- Ollama client for local LLM summarization (Gemma 4 or Qwen 3)

New tests:
- Dense cluster detection (avg weight > 1.2, size >= 5)
- Consolidation creates derived-from edges
- External edges migrate with max(weights)
- Constitutional memories excluded from consolidation
- Depth limit enforced (max 2 levels)
- Rejected proposals not re-proposed for 7 days

### Wave 3: Guardian Hebbian Governance (estimated 2-3 days)

**Scope:** Temperature-modulated learning rate, hebbianImbalance signal, consolidation proposals in dashboard

Files to modify:
- `packages/memory/src/guardian.ts` — add 7th signal, modulation multiplier
- `packages/memory/src/store.ts` — apply Guardian multiplier to Hebbian ops
- `packages/server/src/http.ts` — consolidation proposal endpoints

New tests:
- Hebbian halted when Guardian trapped
- Hebbian halved when Guardian warm
- hebbianImbalance signal computation
- Proposal surfacing with Guardian context

### Wave 4: Contradiction Resolution (estimated 2-3 days)

**Scope:** Automated contradiction scanning, LLM analysis, proposal system

Files to modify:
- `packages/memory/src/contradictions.ts` (NEW) — scanner, analyzer, proposal generator
- `packages/server/src/tools.ts` — add `contradiction_scan`, `contradiction_resolve` MCP tools

New tests:
- Contradiction pairs detected from edges
- Constitutional tensions surfaced but not auto-resolved
- Resolution options generated (supersede, merge, keep both)
- Provenance logging on resolution

### Wave 5: Neural Pathway Renderer — Foundation (estimated 5-7 days)

**Scope:** WebGL pipeline, Lissajous nodes, procedural edge geometry, phosphor persistence

Files to create:
- `cockpit/web/renderer/` — full WebGL renderer
  - `pipeline.ts` — render pass orchestration
  - `nodes.ts` — Lissajous curve instanced rendering
  - `edges.ts` — procedural pathway geometry generation + caching
  - `phosphor.ts` — feedback buffer persistence
  - `shaders/` — GLSL vertex + fragment shaders for each pass

Approach:
- Start with regl (MIT, functional WebGL wrapper) for composable passes
- If regl proves insufficient for instanced geometry, fall back to raw WebGL2
- Force simulation stays CPU (d3-force or custom) — GPU compute shader is Wave 8+

### Wave 6: Neural Pathway Renderer — Post-Processing + Interaction (estimated 4-5 days)

**Scope:** Bloom, CRT effects, sonar ping, node selection, search visualization, spawn animation

Files to modify:
- `cockpit/web/renderer/post.ts` — bloom, chromatic aberration, scanlines, vignette, grain
- `cockpit/web/renderer/interaction.ts` — hit testing, sonar, selection, search
- `cockpit/web/renderer/animation.ts` — spawn, consolidation, Hebbian weight change animations

### Wave 7: Neural Pathway Renderer — Olive Glass Chrome + Sound (estimated 3-4 days)

**Scope:** UI overlay, inspector, search bar, status bar, themes, sound design

Files to modify:
- `cockpit/web/index.html` — Olive Glass UI shell
- `cockpit/web/audio.ts` — Tone.js integration, ambient drone, node tones, spatial audio

### Wave 8: Hermes Agent Integration (estimated 5-7 days)

**Scope:** Wire Hermes as agent loop runner, ForgeFrame as memory backend via MCP

Steps:
1. Install Hermes Agent locally
2. Configure to use ForgeFrame MCP server for memory (replace Hermes SQLite)
3. Build PostToolUse hook: Hermes skill extraction → ForgeFrame skill-tagged memory
4. Build Guardian check: Hermes queries temperature before autonomous actions
5. Configure model routing (Gemma 4 local for triage, Sonnet API for voice tasks)
6. Build loop cadence scheduler (6-hour cycle)
7. Wire SSE events so Cockpit visualizes agent activity in real time

### Wave 9: Integration Testing + Benchmarks (estimated 3-4 days)

**Scope:** End-to-end testing, LongMemEval benchmark, performance profiling

- Run LongMemEval benchmark — publish number (target: beat MemPalace's 96.6%)
- Run LoCoMo benchmark
- Profile Hebbian operations at scale (1K+ memories, 3K+ edges)
- Profile renderer at 60fps with 1K nodes
- Stress test consolidation with large clusters
- Test Guardian modulation under all temperature states

### Wave 10: Show HN Polish + Launch (estimated 3-5 days)

**Scope:** README, landing page, video, deployment

- Rewrite README with Strange Loop positioning
- Record 30-second demo video (silence → hover → sonar → Hebbian → consolidation)
- Screenshot: Lissajous graph with phosphor persistence, CRT scanlines, one cluster glowing
- Landing page (one page, Noa's copy, Stripe button for cloud tier)
- Dockerfile + Fly.io config for cloud deployment
- Tag release
- Post to Hacker News

---

## 7. Total Estimated Timeline

| Wave | Days | Cumulative | Deliverable |
|------|------|------------|-------------|
| 1: Hebbian Engine | 3-4 | 3-4 | Memories learn from co-retrieval |
| 2: Consolidation | 4-5 | 7-9 | System discovers its own patterns |
| 3: Guardian Hebbian | 2-3 | 9-12 | Governance modulates learning |
| 4: Contradictions | 2-3 | 11-15 | System surfaces tensions |
| 5: Renderer Foundation | 5-7 | 16-22 | Neural pathways visible |
| 6: Renderer Polish | 4-5 | 20-27 | CRT + sonar + interaction |
| 7: Chrome + Sound | 3-4 | 23-31 | Full Cockpit experience |
| 8: Hermes Integration | 5-7 | 28-38 | Autonomous agent loop |
| 9: Testing + Benchmarks | 3-4 | 31-42 | Published numbers |
| 10: Launch | 3-5 | 34-47 | Show HN |

**Realistic ship date: late May to mid-June 2026.**

Waves 1-4 (engine) can run in parallel with Waves 5-7 (renderer) via multi-agent swarm. Waves 8-10 are sequential. With parallel execution, the critical path shortens to ~30 days.

---

## 8. Multi-Agent Build Strategy

Each wave is independently buildable. The swarm pattern:

```
ARCHITECT (Opus 4.6) — owns the spec, reviews all PRs
  ├── BUILDER-ENGINE (Opus 4.6, worktree: feat/hebbian-engine)
  │     Waves 1-4: memory engine + Guardian + contradictions
  ├── BUILDER-RENDERER (Opus 4.6, worktree: feat/signal-renderer)
  │     Waves 5-7: WebGL pipeline + post-processing + chrome + sound
  ├── BUILDER-AGENT (Opus 4.6, worktree: feat/hermes-integration)
  │     Wave 8: Hermes wiring + MCP bridge + model routing
  └── SKEPTIC (Opus 4.6) — reviews each wave before merge
        Tests, constitutional compliance, performance, spec alignment
```

Integration points (sequential gates):
- Gate 1: Waves 1-4 merge → engine complete, all tests green
- Gate 2: Waves 5-7 merge → renderer complete, visualizing real data
- Gate 3: Wave 8 merge → agent wired, full loop running
- Gate 4: Wave 9 → benchmarks published
- Gate 5: Wave 10 → shipped

---

## 9. Risk Register

| Risk | Mitigation |
|------|------------|
| Hebbian runaway loop | LTD + refractory period + Guardian halt at trapped |
| Consolidation quality | Local LLM quality check + human gate + 7-day cooldown on rejection |
| Renderer performance | Cached geometry, shader-only animation, geometry regen only on weight brackets |
| Hermes fork maintenance | Don't fork. MCP boundary keeps Hermes untouched. Upstream updates just work |
| Cloud LLM for memory content | Constitutional enforcement: consolidation/contradiction always local models |
| Scope creep beyond 10 waves | Each wave has clear deliverable. Ship incrementally. Wave 5+ visible to users |
| Single developer bottleneck | Multi-agent swarm. 3 builders + 1 skeptic. Parallel worktrees |

---

## 10. What This Replaces

After Signal ships:
- **Obsidian for daily ops** → replaced by Cockpit graph view
- **Manual memory management** → replaced by Hebbian auto-learning
- **Manual pattern discovery** → replaced by consolidation proposals
- **Manual career-ops scanning** → replaced by Hermes agent loop
- **Separate Guardian product** → absorbed into ForgeFrame. Guardian IS ForgeFrame finished.
- **Business OS dashboard concept** → replaced by Cockpit status bar + inspector

---

## Appendix A: Constitutional Invariants (Never Violated)

1. Principle and voice memories never decay
2. Principle and voice edges never modified by Hebbian operations
3. Principle and voice memories never consolidated or merged
4. Cognitive and constitutional data never processed by cloud organs or APIs
5. Provenance logged for every autonomous operation
6. User can veto any Tier 3 proposal
7. User-only operations (Tier 4) never automated
8. Consolidation depth never exceeds 2 levels
9. Hebbian learning halts when Guardian reaches trapped state
10. Sound is never autoplay
