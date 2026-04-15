# ForgeFrame Final Sprint — Design Spec

**Authors:** Alex Campos + Claude Opus 4.6
**Date:** 2026-04-14
**Status:** Design approved
**Parent specs:** 2026-04-09-cockpit-design.md, 2026-04-14-signal-cockpit-ui-design.md

---

## Thesis

Three waves to a production-grade daily driver. Wave A replaces the hairball with a clustered Cytoscape.js graph. Wave B completes every Cockpit feature from the original spec. Wave C packages the benchmarks and README for Show HN. The screenshot is real because the tool is real.

---

## WAVE A: Graph Overhaul (Cytoscape.js)

### Library

**Cytoscape.js** (MIT, 11K stars, Canvas 2D + WebGL preview)

Extensions:
- `cytoscape-fcose` — compound-node-aware force-directed layout
- `cytoscape-expand-collapse` — animated cluster expand/collapse
- `cytoscape-popper` — tooltip and context menu positioning

Install via CDN script tags in `cockpit/web/index.html` (no build step, matches existing pattern).

### Clustering Strategy

**Hybrid: connected components + tag naming.**

1. Use `store.getConnectedComponents()` to get natural graph clusters
2. For each cluster, find the dominant custom tag (most common non-TRIM tag among members)
3. That tag becomes the cluster label (e.g., "sovereignty", "architecture", "reframed")
4. If a cluster has no custom tags, use the dominant TRIM tag
5. Orphan memories (no edges) cluster by their first custom tag, or stay unclustered if they have no tags
6. Clusters with fewer than 3 members stay unclustered (don't wrap singletons/pairs)

The clustering is computed server-side via a new endpoint: `GET /api/graph/clustered` returns nodes with `parent` fields set to cluster IDs.

### Node Visual Language

| Channel | Encodes | Details |
|---|---|---|
| Size | Weighted edge count | `(led_to * 3) + (contradicts * 2) + (supersedes * 2) + (implements * 2) + (similar * 0.5) + (related * 1) + (derived_from * 1.5)` mapped to 6-24px radius |
| Color | TRIM tag | sage (#8aab7f) = principle/voice, gold (#b8965a) = decision/pattern, earth (#8b7355) = observation/entity, terra (#c4956a) = thread/skill |
| Opacity | Strength | 0.1-1.0 mapped to 0.2-1.0 opacity |
| Border | Valence | charged = 2px gold ring, grounding = 2px sage ring, neutral = none |
| Shape | Type | circle = memory, diamond = artifact |

### Cluster Parent Visual Language

| Channel | Encodes | Details |
|---|---|---|
| Size | Member count | Proportional, minimum 40px radius |
| Color | Dominant TRIM tag of members | Same palette as nodes, 15% opacity fill |
| Opacity | Average member strength | Faded cluster = dying domain |
| Border | Dashed ring | 1px dashed, tag color at 30% opacity |
| Label | Dominant custom tag | 9px mono, uppercase, below cluster |
| Badge | Member count | Small mono number, top-right |

### Semantic Zoom

**Click to expand (primary) + zoom threshold (assist).**

- Double-click a cluster to expand. Children fan out with animated force layout (fcose). Double-click again to collapse.
- If zoom level crosses 2.5x with a cluster under the viewport center, that cluster auto-expands.
- If zoom level drops below 1.0x, all expanded clusters auto-collapse.
- Click-expand always works as override regardless of zoom level.
- `cytoscape-expand-collapse` handles the animation and edge re-routing.

### Layout

**fcose (compound force-directed).**

- Cluster-level repulsion keeps clusters separated
- Node-level forces arrange children within expanded clusters
- Edge-driven attraction pulls connected nodes/clusters closer
- Cooling simulation: 300 frames to settle, then static
- On data change (SSE event), reheat with reduced energy (200 frames)

### Edge Rendering

- Edges between nodes in the same cluster: visible only when cluster is expanded
- Edges between different clusters: rendered as cluster-to-cluster edges when collapsed, node-to-node when both clusters expanded
- Edge opacity = edge weight mapped to 0.1-0.5
- Edge color = earth (#8b7355) at 20% opacity
- Edge width = 1px (similar) to 2px (causal/contradicts)

### Integration with Existing Cockpit

Cytoscape.js replaces the custom Canvas 2D graph renderer entirely:
- Remove: `initNodePositions`, `simulateForces`, `drawGraph`, `hitTest`, `screenToWorld`, graph mouse handlers
- Keep: `drawThermal` (WebGL shader stays as background canvas behind Cytoscape's container)
- Cytoscape renders into a new `<div id="cy-container">` that sits on top of the thermal canvas
- Cytoscape container background is transparent — the thermal shader shows through
- Node selection in Cytoscape triggers `selectNode(id)` which renders the inspector (same as before)
- SSE events (memory:created, edge:created, etc.) update the Cytoscape graph instance

### New API Endpoint

`GET /api/graph/clustered` — returns the full graph with cluster assignments:

```json
{
  "nodes": [
    { "id": "...", "content": "...", "tags": [...], "strength": 0.8, "parent": "cluster-sovereignty", ... },
    ...
  ],
  "clusters": [
    { "id": "cluster-sovereignty", "label": "sovereignty", "memberCount": 12, "avgStrength": 0.7 },
    ...
  ],
  "edges": [...]
}
```

### Theme Integration

Cytoscape stylesheet maps to CSS custom properties. On theme change, rebuild the stylesheet and call `cy.style().fromJson(newStylesheet).update()`. The five themes (olive, ink, linen, slate, void) each produce a complete Cytoscape stylesheet.

---

## WAVE B: Cockpit Completion

### B1: Context Menu

Right-click or long-press a node → floating context menu at cursor position.

Menu items:
- **Open** — select the node, inspector shows detail
- **Edit** — toggle inspector into edit mode (Cmd+E)
- **Link** — enter edge-drawing mode: cursor changes, click another node to create a `related` edge
- **Promote** — move memory to artifact state (`POST /api/memories/:id/promote`)
- **Tag** — quick retag popover (text input, autocomplete from existing tags)

Style: ghost panel, no icons, compact text. Appears at click position. Dismisses on outside click or Escape. Same glass treatment as other panels.

Cytoscape has built-in context menu support via `cxtmenu` extension, or we build a simple DOM menu positioned via `cytoscape-popper`.

### B2: Settings Panel (Cmd+,)

The existing settings overlay already has theme swatches and connection info. Extend with:

- **Theme selector** — visual preview swatches (already built)
- **Font size scaling** — slider, 80%-120%, applies to all UI text via CSS custom property
- **Reduced motion toggle** — checkbox, sets `prefers-reduced-motion` override
- **Graph density** — slider: minimal (fewer edges shown) / standard / dense (all edges)
- **Guardian sensitivity** — slider, scales the temperature composite (lower = more calm, higher = more reactive)
- **Sonar** — toggle visibility, adjust waveform speed

Store all settings in localStorage. Apply on boot.

### B3: Editor (Inspector Transform)

Double-click a memory or Cmd+E → inspector content field becomes editable.

Implementation:
- The memory content div gets `contenteditable="true"`
- A subtle "editing" state: border-bottom changes to gold, cursor blinks
- Cmd+S saves: `PATCH` or `PUT` to update memory content via API, then re-render inspector
- Escape cancels: revert contenteditable, re-render from original data
- Blur auto-saves if content changed

Escape hatch: Cmd+Shift+E opens a centered overlay with a larger textarea for deep rewrites. Same save/cancel behavior. This overlay is visually distinct from the Signal overlay (no glass rise animation — instant appear, clean close).

### B4: Artifact State Machine UI

In the inspector, when a memory has `memoryType: 'artifact'`, show the state machine:

```
draft ──→ ready ──→ shipped
  ↓
trapped
```

Visual: a horizontal progress bar with 3 dots (draft/ready/shipped). Current state is filled, future states are outlined. If trapped, the progress bar pulses terra.

Below the bar:
- Readiness score (0-1, percentage)
- "Ship" button (only when ready, calls `POST /api/memories/:id/ship`)
- "Promote" button on non-artifact memories starts the pipeline

### B5: Mobile Responsive

Breakpoints from spec:
- **Desktop** (>1024px): three-column as built
- **Tablet** (768-1024px): sidebar collapses to icon strip, inspector slides over main area
- **Mobile** (<768px): single column. Bottom tab bar (graph/memories/signal). Inspector is a bottom sheet. Context menu becomes bottom action sheet.

Cytoscape handles touch events natively (pinch-to-zoom, tap to select, long-press for context menu).

---

## WAVE C: Benchmarks + README + Show HN

### C1: Query-Intent Retrieval (MAGMA Insight)

Before retrieval, classify query intent and weight edge types:

```typescript
function classifyQueryIntent(query: string): 'causal' | 'temporal' | 'semantic' | 'contradictory' | 'general'
```

Keyword heuristics (no LLM call needed):
- causal: "why", "because", "led to", "decided", "chose"
- temporal: "when", "before", "after", "during", "timeline"
- contradictory: "contradict", "conflict", "disagree", "opposite"
- semantic: "relate", "similar", "like", "connect", "about"
- general: everything else

In graph traversal step of RRF, weight edges by intent:
- causal → `led-to` and `supersedes` edges get 2x weight
- temporal → sort by `valid_from` proximity
- contradictory → `contradicts` edges get 3x weight
- semantic → `similar` and `related` edges get 2x weight
- general → equal weights

### C2: LongMemEval Benchmark

Create `benchmarks/longmemeval/` directory:
- Download LongMemEval dataset
- Write benchmark runner that:
  1. Seeds ForgeFrame with the benchmark's conversation history
  2. Runs each query through ForgeFrame's retrieval
  3. Compares retrieved results against ground truth
  4. Reports precision, recall, F1
- Target: beat Mem0 (49%), challenge MemPalace (96.6%)

### C3: README Rewrite

Structure:
1. **Headline:** "The only memory system that gets smarter by watching itself think"
2. **Cockpit screenshot** — the clustered graph with thermal shader, glass panels
3. **What it does** — 3 bullets: sovereign memory, Hebbian learning, dream engine
4. **Benchmark number** — LongMemEval score prominently displayed
5. **Quick start** — `npm install`, configure Claude Code, done
6. **Architecture** — diagram of the four layers
7. **The Strange Loop** — how the dream engine works, why it matters
8. **Show HN link**

### C4: Show HN Post

Title: "ForgeFrame — sovereign memory that dreams (Hebbian learning + anti-Hebbian dreaming)"

Body: 3 paragraphs. What it is, what makes it different, link to repo. Include the Cockpit screenshot.

---

## POST-LAUNCH WAVES

### Wave D: SDK + Importers
- Python SDK (`pip install forgeframe`)
- TypeScript SDK (`npm install @forgeframe/sdk`)
- Obsidian vault importer (`forge import obsidian ~/vault`)
- Mem0 export importer
- Generic markdown folder importer

### Wave E: Distillery Organ Upgrade
- Content-first lens (constitution moves to user prompt)
- Novelty scoring (relevance * novelty)
- ForgeFrame HTTP API integration (decouple from SQLite)
- Tiered strength-at-save (0.4/0.55/0.7)
- Writeback with co-retrieval edges

### Wave F: Cloud + Licensing
- BSL licensing for @forgeframe/memory
- Cloud Relay ($10-20/mo encrypted proxy)
- Team features ($30-50/seat)
- Dashboard web app

---

## Constitutional Invariants (Sprint)

1. No feature ships without being used by the founder first
2. The Cockpit is a daily driver, not a demo
3. The screenshot is real because the tool is real
4. Sovereignty: all cognitive data stays local during sprint
5. No framework dependencies — vanilla JS, CDN scripts only
6. Every wave produces a working, usable increment
7. Benchmarks are honest — publish the real number, whatever it is
