# Signal Cockpit UI — Design Spec

**Authors:** Alex Campos + Claude Opus 4.6
**Date:** 2026-04-14
**Status:** Design approved
**Parent specs:** 2026-04-09-cockpit-design.md, 2026-04-13-hermes-dreaming-design.md

---

## Thesis

The Signal UI makes the dream engine visible and steerable without breaking the Cockpit's identity as a graph-first instrument panel. Two surfaces, one data source: an ambient dream state in the inspector for passive awareness, and a full overlay for intentional engagement. The matriarchal contract: the system shows what it noticed, the founder decides what matters, silence is a valid response.

## Design Philosophy

**Matriarchal UX.** The system holds space. It doesn't demand attention, interrupt flow, or manufacture urgency. Information is layered like a conversation — surface-level at a glance, depth available when you lean in. No badges, no counters, no guilt. The sonar breathes. The journal speaks in narrative. The founder engages when ready.

**Awe through collision.** Information density that feels calm. Motion that has weight. Material honesty. The overlay is glass floating over a living thermal graph — dream data rendered on frosted glass with the neural network glowing underneath.

**Legible at a glance, poetic on engagement.** The status bar sonar is a thumbnail — three dimensions, instantly readable. The overlay sonar is the full portrait — the fourth dimension (polarity) reveals itself as the waveform has room to lean. Same shape, same data, more space to breathe.

---

## 1. Sonar Waveform

An oscilloscope-style waveform that lives in the status bar, right-anchored. Not a dot, not a badge — a line that lives.

### Status Bar (Small — 3 Dimensions)

Approximately 120px wide, 32px tall. Renders as a continuous sine-like wave using canvas or SVG.

| Dimension | Encoding |
|---|---|
| Guardian state | Color: sage (#8aab7f) = calm, gold (#b8965a) = warm, terra (#c4956a) = trapped. Continuous gradient, not stepped. |
| Sleep pressure | Amplitude: taller wave = more to process. Range: 4px (idle) to full height (pressure > 50). |
| Urgency | Frequency: slow breathing sine = calm (0.5 Hz), faster oscillation = building (2 Hz), rapid vibration = trapped (4+ Hz). |

The wave animates continuously. Click to open the Signal overlay.

### Overlay Header (Large — 4 Dimensions)

Same waveform, expanded to approximately 300px wide, 80px tall. The additional space reveals:

| Dimension | Encoding |
|---|---|
| Graph polarity | Waveform lean: right-leaning = net strengthening, left-leaning = net weakening. Computed from drift detection results. |

The transition from small to large is the moment — the overlay rises and the waveform stretches and unfolds, the polarity revealing itself as the shape has room to express direction. The lean was always in the data. You just couldn't see it at status bar size.

### Behavioral Rules

- The waveform never stops. Even when calm, it breathes at 0.5 Hz.
- No labels, no numbers on the waveform itself. Pure spatial-emotional read.
- When a new dream cycle completes, one slow bloom pulse — a single expansion that says "I have something" without interrupting.
- Trapped state: same color spectrum pushed to intensity (deeper terra, tighter frequency, higher amplitude). NOT a separate color. The continuum speaks for itself.

---

## 2. Signal Overlay

A glass panel that slides up from the bottom of the screen over the graph. The graph stays visible underneath, dimmed. The overlay is a moment — open, review, steer, dismiss, return to driving.

### Layout

```
┌─────────────────────────────────────────────────┐
│  [dimmed graph + thermal shader visible]         │
│                                                  │
├── ═══════════════════════════════════════════ ──┤  ← overlay top edge (rounded)
│  ─── handle bar ───                              │
│                                                  │
│  SIGNAL                          [sonar large]   │
│                                                  │
│  Pruned 3 weak connections overnight. Noticed    │
│  a tension between shipping fast and production- │
│  grade deployment. Found a possible thread       │
│  between your sovereignty thesis and pricing.    │
│                                                  │
│  dream cycle completed 04:23 — 187s — 62 → 18   │
│                                                  │
│  ─── what changed ─────────────────────────────  │
│  · Pruned 3 edges below threshold                │
│  · Applied strength decay                        │
│  · Detected 2 clusters                           │
│                                                  │
│  ─── two memories that have never met ─────────  │
│  ┌────────────┐  │  ┌────────────┐               │
│  │ sovereignty │  ·  │ business   │               │
│  │ memory     │  │  │ memory     │               │
│  └────────────┘  │  └────────────┘               │
│  do these know each other?                       │
│  [real]  [meh]  [nothing]                        │
│                                                  │
│  ─── productive tension ───────────────────────  │
│  ─── does this still feel true? ───────────────  │
│  ─── graph health ─────────────────────────────  │
│  ─── gone quiet ───────────────────────────────  │
│  ─── drift ────────────────────────────────────  │
└─────────────────────────────────────────────────┘
```

### Entry Point: The Journal Headline

The first thing you see is a single narrative sentence. Not metrics, not a dashboard — a sentence from your subconscious. It summarizes the most important thing that happened during the dream cycle.

The headline is rendered at 22px, weight 200, high line-height. Inline links for tensions and seeds are subtly underlined. Key concepts are highlighted in gold. The sentence is complete on its own — you can read it and dismiss the overlay.

Below the headline: a timestamp line in mono, low opacity. "dream cycle completed 04:23 — 187s — pressure 62 → 18"

### Progressive Disclosure

Below the headline, sections unfurl on scroll. Each section animates in with staggered timing — the headline settles first, then sections bloom one by one. Every section has a small uppercase mono label.

Sections in order:

1. **What changed** — bullet list of structural changes (edges pruned, decay applied, clusters found, valence backfilled). Change-list bullets use sage dots.

2. **Two memories that have never met** (dream seed) — two memory cards side by side, bridged by a gold vertical thread with a breathing dot at center. Below: "do these know each other?" in italic. Grade buttons: `real` / `meh` / `nothing` as ghost pills. If the founder taps "real," a single-line text field blooms: "what's the thread?" — optional, cursor ready, can tap away without typing. No other grade gets a follow-up.

3. **Productive tension** — terra-tinted card showing two memories with a bidirectional arrow between them. One sentence describing the tension in italic below. No action buttons. No resolution prompt. The system noticed. That's it.

4. **Does this still feel true?** (hindsight review) — card showing the entrenched memory, stats in mono ("reinforced 34x · never challenged · charged"), and ONE question: "does this still feel true?" Buttons: `keep` / `add nuance` / `weaken`. Weaken requires a confirm step (second tap). The card has NO warning color — same glass as everything else. It's a mirror, not an alarm.

5. **Graph health** — four stats in a row (memories, edges, avg weight, orphans) rendered large in mono. Below: source calibration as thin horizontal bars with percentage labels.

6. **Gone quiet** — silence detection results. Each entry: tag name, silent duration, prior access count. No action. Just awareness.

7. **Drift** — drift detection results. Each entry: tag name, direction arrow, percentage change, weight trajectory. No action. Just awareness.

### Behavioral Rules

- Sections with no data are hidden entirely (e.g., no seeds = "two memories" section doesn't appear). The overlay is only as tall as it needs to be.
- Maximum one seed per overlay open. Maximum one hindsight review. Tensions, silence, and drift can have multiple entries (capped at 3 each).
- The overlay respects `prefers-reduced-motion` — sections appear instantly without stagger animation.
- Dismiss: click outside the overlay, swipe down on the handle, or press Escape.
- No close button. The handle bar and outside-click are sufficient.

### The Matriarchal Contract

- No "3 items need review" badges anywhere.
- Ungraded seeds expire after 24 hours. No reminder. No follow-up.
- Ignored hindsight reviews get one gentle re-surface after 3 cycles, then silence.
- The founder's silence is a valid response at every gate.

---

## 3. Inspector Dream Surface

When no node is selected in the graph, the inspector panel transforms from empty space into an ambient dream surface. Quiet presence, not a dashboard.

### Content (Idle State)

The inspector shows:

1. **Sonar echo** — a small version of the waveform (3 dimensions, matching the status bar). Provides visual anchor connecting inspector to status bar.

2. **One-liner** — the journal headline sentence, truncated to 2 lines. Enough to feel the state without reading the full journal. Click to open the overlay.

3. **Graph health** — the four key stats (memories, edges, avg weight, orphans) in compact mono. These are always relevant.

4. **Pinned tensions** — if the founder has pinned any tensions from the overlay's tension board, they appear here as persistent cards. Dismissible. Annotatable (click to add a note that only the founder sees).

### Transition

When the founder selects a node, the dream surface gracefully fades and the Memory/Edges/History tabs appear. When the node is deselected, the dream surface returns. The transition should feel like turning a page, not switching an app.

### What Does NOT Go Here

- Full journal text (that's the overlay)
- Seed grading interface (that's the overlay)
- Hindsight review (that's the overlay)
- Source calibration details (that's the overlay)
- Any action that requires decision-making

The inspector dream surface is for *ambient awareness*. The overlay is for *intentional engagement*. The boundary is: if it requires a button, it's overlay. If it's just information, it's inspector.

---

## 4. Interaction Details

### Seed Grading

| Action | Result |
|---|---|
| Tap "real" | Edge created (weight 0.5). Optional text field blooms — single line, placeholder "what's the thread?", auto-focused. Tap away = edge created without note. Type + enter = edge created with note as edge metadata. |
| Tap "meh" | Seed logged as inconclusive. May re-surface later with more context. No UI change. |
| Tap "nothing" | Seed logged as rejected. Partition pairing deprioritized. No UI change. |

### Hindsight Response

| Action | Result |
|---|---|
| Tap "keep" | Memory marked as reviewed. Skipped for 90 days. |
| Tap "add nuance" | Text field appears below. Founder writes clarification. Appended to memory content, original preserved. |
| Tap "weaken" | Confirm step: button text changes to "confirm weaken" with terra tint. Second tap reduces edge weights by 0.3 (floor 0.05). Single tap away = cancel. |

### Tension Interaction

| Action | Result |
|---|---|
| No action | Tension acknowledged by viewing. |
| Pin (icon) | Tension persists in inspector dream surface. |
| Dismiss (icon) | Tension removed permanently. |
| Annotate (click) | Small text field. Founder writes a note. Stored locally, system never reads it. |

---

## 5. Animation & Motion

All animations use `cubic-bezier(0.16, 1, 0.3, 1)` — an ease-out curve with slight overshoot. Things settle into place, they don't snap.

| Element | Animation |
|---|---|
| Overlay rise | translateY(100%) → 0, 800ms, with opacity 0 → 1 |
| Journal headline | translateY(12px) → 0, 1200ms, delayed 400ms |
| Section stagger | Each section delayed +200ms from previous |
| Seed text bloom | height 0 → auto, 400ms, after "real" tap |
| Sonar expand | Status bar size → overlay size, synchronized with overlay rise |
| Inspector crossfade | Dream surface ↔ node detail, 300ms opacity transition |
| Sonar waveform | Continuous animation, never stops. requestAnimationFrame loop. |

### Reduced Motion

When `prefers-reduced-motion: reduce` is active:
- Overlay appears instantly (no slide)
- Sections appear instantly (no stagger)
- Sonar waveform becomes a static shape (current state rendered, no animation)
- All transitions become instant opacity swaps

---

## 6. Theming

All Signal UI uses the existing CSS custom property system. No new color tokens — the sonar, overlay, cards, and buttons all derive from the existing palette:

| Element | Light themes (olive/linen/slate) | Dark themes (ink/void) |
|---|---|---|
| Overlay glass | `rgba(240,238,230,0.65)` + blur(60px) | `rgba(30,30,35,0.65)` + blur(60px) |
| Sonar calm | sage `var(--sage)` | sage (pops on dark) |
| Sonar warm | gold `var(--gold)` | gold |
| Sonar trapped | terra `var(--terra)` | terra |
| Seed bridge | gold at 30% opacity | gold at 30% opacity |
| Tension card | terra at 4% bg, 10% border | terra at 4% bg, 10% border |
| Hindsight card | Same glass as everything else | Same glass as everything else |
| Grade buttons | Ghost pills, border-only | Ghost pills, border-only |

The overlay inherits the grain texture (`body::after` SVG noise) at the same opacity as the rest of the app.

---

## 7. Data Flow

```
NREM/REM cycle runs
    ↓
Results stored: NremResult + RemResult
    ↓
Journal written as memory (tags: dream-journal, phase, date)
    ↓
SSE events emitted (dream:nrem:complete, dream:rem:complete, dream:journal:written)
    ↓
Cockpit receives SSE events
    ↓
Sonar waveform updates (pressure, Guardian state from API poll)
Inspector dream surface refreshes (latest journal headline)
    ↓
Founder clicks sonar
    ↓
Overlay opens, fetches:
  GET /api/dream/journal/latest    → journal content
  GET /api/dream/seeds/pending     → ungraded seeds
  GET /api/dream/hindsight/pending → hindsight candidates
  GET /api/dream/tensions          → tension candidates
  GET /api/dream/pressure          → current pressure + components
    ↓
Founder interacts (grade seed, respond to hindsight, pin tension)
    ↓
POST /api/dream/seeds/:id/grade
POST /api/dream/hindsight/:id/respond
    ↓
SSE events emitted (dream:seed:graded, dream:hindsight:responded)
    ↓
Overlay updates inline, sonar pulse acknowledges
```

---

## 8. File Structure

The Cockpit is a single-file vanilla HTML/CSS/JS application (`cockpit/web/index.html`). The Signal UI additions follow this pattern — no new files, no build step. New code is added as clearly-demarcated sections within the existing file.

### New Sections in index.html

```
// ===== SONAR WAVEFORM =====
// Canvas-based oscilloscope renderer
// Three-dimension encoding (status bar) + four-dimension (overlay)

// ===== SIGNAL OVERLAY =====
// DOM construction for overlay panel
// Journal rendering, seed cards, tension cards, hindsight cards
// Grade interaction handlers
// Open/close animation

// ===== INSPECTOR DREAM SURFACE =====
// Idle-state content for inspector panel
// Journal one-liner, graph health, pinned tensions
// Crossfade transition with node detail view

// ===== SIGNAL SSE HANDLERS =====
// New event handlers for dream:*, guardian:*, valence:* events
// Sonar state updates, inspector refresh triggers
```

### Estimated Size

The existing Cockpit is ~2300 lines. The Signal UI additions are estimated at ~800-1000 lines:
- Sonar waveform renderer: ~150 lines (canvas animation loop, dimension mapping)
- Signal overlay: ~400 lines (DOM construction, sections, interaction handlers)
- Inspector dream surface: ~100 lines (idle state rendering, crossfade)
- SSE handlers: ~80 lines (event → state updates)
- CSS: ~200 lines (overlay glass, cards, animations, responsive)

---

## 9. Constitutional Invariants (UI)

1. No notification badges, counts, or urgency indicators anywhere in the Signal UI.
2. No gamification (streaks, completion percentages, "items reviewed this week").
3. Ungraded seeds expire silently after 24 hours.
4. Hindsight "weaken" always requires two-step confirmation.
5. Tensions are never presented with a resolution prompt.
6. The founder's silence is a valid response at every interaction point.
7. The sonar waveform never stops breathing.
8. `prefers-reduced-motion` is respected at every animation point.
9. All interactive elements are keyboard-accessible.
10. The overlay never blocks access to the graph — Escape always dismisses.

---

## 10. What This Spec Does NOT Cover

- WebGL neural pathway renderer (Signal Layer 3 from parent spec — separate wave)
- Semantic zoom / nested clusters (Phase 8)
- Tab system / markdown editor (Phase 8)
- Theme settings panel UI (Phase 8)
- Mobile responsive layout (Phase 8)
- Tauri desktop shell integration

These are future work. This spec covers the Signal overlay, sonar waveform, and inspector dream surface only.
