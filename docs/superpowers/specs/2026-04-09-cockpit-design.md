# ForgeFrame Cockpit — Design Spec

The artifact-choice surface for ForgeFrame. Where the loop becomes visible and steerable.

## Thesis

The Cockpit is not a dashboard, not a knowledge browser, not an Obsidian clone. It is the operational surface of the loop described in "On Observation and Identity Modeling" — the place where memory becomes visible, steering becomes possible, and artifacts choose to exit.

The driver steers. The engine ships. Guardian provides road feel.

## Audience

1. **The founder** — primary user, quality bar, uses it nightly
2. **ForgeFrame open source developers** — the Show HN screenshot, what makes ForgeFrame visible and sticky
3. **Enterprise** (free if 1 and 2 are nailed) — the thing someone sees over your shoulder at Cap1

## Aesthetic Direction

**Olive Glass** — light translucent panels over a reactive thermal canvas.

### Color System
- Background: olive-green base, reactive via Guardian thermal WebGL shader
- Panels: translucent glass, slightly darker than background to communicate depth/stackability
  - `backdrop-filter: blur(40px) saturate(1.5)`
  - Panel-over-same-color creates a faintly darker saturated hue
- Text: dark on light, seven opacity tiers (0.75 / 0.5 / 0.3 / 0.18 / 0.1 / 0.05 / 0.02)
- Accents: mint green (`#34C77B`) for active/healthy, hot red (`#E5484D`) for trapped/alert
- Dark mode available as option, not default

### Typography — StrudelVision DNA
- UI: Inter, weights 100-400 only, antialiased
- Code/data: JetBrains Mono, weight 300-400
- Labels: 8-9px, 1.5-2.5px letter-spacing, uppercase, weight 400-500
- Hero elements: weight 100, wide letter-spacing
- Everything understated, legible, intuitive

### Texture
- Film grain overlay from swarm viewer (`body::after`, SVG noise at ~0.025 opacity)
- Glass panels with inset shadow: `0 1px 0 rgba(255,255,255,0.8) inset`
- Ghost buttons only — no fills, borders brighten on hover
- Pill-shaped search bar, sharp (2px radius) tags

### Guardian Thermal Shader
WebGL2 fragment shader as the full-page background canvas. Computes a slow organic fbm noise field whose color temperature responds to Guardian state:
- **Calm** (temp 0.0-0.3): cool olive/sage tones, barely perceptible drift
- **Warm** (temp 0.3-0.6): shifting toward amber/cream, increased contrast
- **Trapped** (temp 0.6-1.0): coral/warm wash, more visible thermal variation

Temperature is computed from Guardian signals (see Guardian Temperature section). The atmosphere is felt, not read.

## Architecture

### Delivery
- **Desktop**: Tauri shell (~5MB binary, system WebView, Rust). Native window chrome, menu bar, keyboard shortcuts. Primary experience.
- **Mobile/Remote**: Same frontend served by Hono at `:3001`, replacing the current swarm viewer at `GET /`. Responsive layout — inspector collapses to bottom sheet, sidebar becomes hamburger drawer.
- **One codebase**: Vanilla HTML/CSS/JS with custom WebGL. No framework. No build step. Same philosophy as StrudelVision and the swarm viewer.

### Data Flow
```
ForgeFrame Memory (SQLite)
    ↓
Hono HTTP API (:3001)  ←→  MCP Server (Claude Code)
    ↓
SSE Event Stream (/api/events)
    ↓
Cockpit Frontend (WebGL + DOM)
    ↓
Tauri Shell (desktop) OR Browser (mobile)
```

### Tech Stack
- **Frontend**: Vanilla JS, custom WebGL2 graph renderer, CSS custom properties for theming
- **Graph engine**: Custom WebGL2 force-directed layout. Nodes as instanced quads, edges as lines. GPU-computed forces for smooth 10k+ node performance.
- **Editor**: Lightweight markdown editor — contenteditable with a minimal parsing layer, not a full framework. Renders inline preview.
- **Desktop shell**: Tauri v2. Rust backend for file system access, window management, auto-update.
- **Server**: Existing Hono HTTP server in ForgeFrame, extended with new endpoints.

## Layout

Three-column layout with status bar:

```
┌──────────┬─────────────────────────┬──────────────┐
│          │                         │              │
│ Sidebar  │    Main Graph Area      │  Inspector   │
│ (glass)  │    (void / canvas)      │  (glass)     │
│          │                         │              │
│ - views  │  ┌─────────────────┐    │ - tabs       │
│ - tags   │  │  search pill     │    │ - memory     │
│ - agents │  └─────────────────┘    │ - edges      │
│ - guard. │                         │ - history    │
│          │    [graph nodes]        │ - preview    │
│          │                         │ - artifacts  │
│          │  [zoom]    [view toggle]│              │
├──────────┴─────────────────────────┴──────────────┤
│ Status Bar: memories | sessions | strength | guard│
└───────────────────────────────────────────────────┘
```

### Sidebar (glass panel, collapsible)
- **Brand**: "forge" in weight 100, 8px letter-spacing
- **Views**: graph, memories, sessions, skills, editor — click to switch main area
- **Tags**: filterable, colored dots per tag category
- **Agents**: live agent status from SSE — builder/skeptic/architect with active/watching/idle states, pixel characters from swarm viewer
- **Guardian**: breathing eye indicator + temp label (calm/warm/trapped)

### Main Area (transparent — void/canvas shows through)
- **Graph view**: custom WebGL force-directed graph. Memories are nodes, edges are relationships. Node size = strength. Node opacity decays with strength. Selected node glows mint.
- **Search pill**: floating, centered top. `Cmd+K` shortcut. Searches memories, skills, sessions.
- **Zoom controls**: bottom-left, glass pill buttons
- **View toggle**: bottom-right — Graph / List / Feed

### Inspector (glass panel, collapsible)
- **Tabs**: Memory / Edges / History — click to switch
- **Memory list**: cards with content preview, tags, strength bar. Decayed memories strike-through. New memories flash mint.
- **Guardian notices**: red left-border whispers when patterns are flagged
- **Markdown preview**: rendered preview of selected memory
- **Artifact Choice section**: shipped (green) / drafting (amber) / trapped (red) status

### Status Bar (glass, full-width)
- Counters: memories, sessions, strength avg, edges
- Guardian status: eye + current state + active flags

## Interaction Model

**Observe → Steer → Return to driving.**

The Cockpit is not a workspace. It's the instrument panel. Open it, feel the state, make corrections, close it.

### Node Context Menu
Click any graph node → floating context menu appears:
- **Open** — opens memory in a new tab (Obsidian-style tab bar above inspector)
- **Edit** — inline markdown editing in inspector
- **Link** — enter edge-drawing mode: click another node to create a typed edge
- **Promote** — move memory into artifact pipeline (draft state)
- **Tag** — quick retag popover

macOS-native feel: compact, no icons, just text. Appears at click position. Dismisses on outside click or Escape.

### Tab System
- Tabs appear above the inspector panel
- Each tab is an open memory with full markdown editor
- Close, reorder, maximize (inspector expands to fill main area)
- Tabs persist across sessions (stored in localStorage / Tauri state)

### Keyboard Shortcuts
- `Cmd+K` — search
- `Cmd+E` — toggle editor for selected memory
- `Cmd+L` — enter link mode
- `Cmd+P` — promote selected
- `Cmd+\` — toggle sidebar
- `Cmd+Shift+\` — toggle inspector
- `Escape` — dismiss context menu / exit mode

## Memory Layer Upgrade

### Current State
SQLite with FTS5 + vector embeddings. Flat tags. Implicit associations (co-retrieval JSON array). Strength decay.

### Target State
Temporal knowledge graph with multi-strategy retrieval.

### Schema Changes

#### New: `memory_edges` table
```sql
CREATE TABLE memory_edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES memories(id),
  target_id TEXT NOT NULL REFERENCES memories(id),
  relation_type TEXT NOT NULL,  -- 'led-to', 'contradicts', 'supersedes', 'implements', 'similar', 'derived-from'
  weight REAL DEFAULT 1.0,
  created_at INTEGER NOT NULL,
  metadata TEXT,  -- JSON
  UNIQUE(source_id, target_id, relation_type)
);
CREATE INDEX idx_edges_source ON memory_edges(source_id);
CREATE INDEX idx_edges_target ON memory_edges(target_id);
CREATE INDEX idx_edges_type ON memory_edges(relation_type);
```

#### Modified: `memories` table — add temporal fields
```sql
ALTER TABLE memories ADD COLUMN valid_from INTEGER;      -- when this fact became true
ALTER TABLE memories ADD COLUMN superseded_by TEXT;       -- id of the memory that replaced this
ALTER TABLE memories ADD COLUMN superseded_at INTEGER;    -- when it was superseded
ALTER TABLE memories ADD COLUMN memory_type TEXT DEFAULT 'semantic';  -- 'semantic', 'episodic', 'principle', 'artifact'
ALTER TABLE memories ADD COLUMN readiness REAL DEFAULT 0; -- artifact readiness score (0-1)
```

### Multi-Strategy Retrieval
On `memory_search`, run three strategies in parallel and fuse:
1. **FTS5** — keyword/text match (existing)
2. **Vector** — embedding similarity (existing)
3. **Graph traversal** — from seed nodes, walk N hops via edges, collect connected subgraph

Fusion via **reciprocal rank fusion**: each strategy produces a ranked list, scores are `1/(k+rank)` where k=60, fused by sum. This is what Graphiti uses and it outperforms any single strategy.

### Auto-Linking
On `memory_save`:
1. Query top-5 similar memories by embedding
2. Create `similar` edges with weight = cosine similarity (above 0.7 threshold)
3. If content mentions another memory's key terms, create `related` edge
4. LLM can upgrade edge types during sessions (similar → led-to, similar → contradicts)

### Memory Consolidation
Periodic agent job (the Strange Loop's self-distillation):
1. Find clusters of related memories (connected components in graph with high edge density)
2. LLM summarizes cluster into a higher-level "consolidated" memory
3. Original memories get `derived-from` edges pointing to the consolidation
4. Consolidated memories have `memory_type: 'semantic'`, originals may decay faster

### Supersession
When a memory is updated:
1. Old version gets `superseded_by` = new memory id, `superseded_at` = now
2. New memory gets `valid_from` = now
3. Edge created: new `supersedes` old
4. Old memory remains in graph (provenance) but decays faster
5. Inspector "History" tab shows the supersession chain

## New API Endpoints

```
POST   /api/memories/:id/edges          — create edge
GET    /api/memories/:id/edges          — list edges for a memory
DELETE /api/memories/edges/:edgeId      — delete edge
GET    /api/memories/:id/graph?hops=2   — subgraph: N hops from node
GET    /api/memories/:id/history        — supersession chain
POST   /api/memories/:id/promote        — promote to artifact (sets readiness tracking)
GET    /api/artifacts                   — list all promoted artifacts with status
GET    /api/guardian/temperature         — current temp + signals that computed it
GET    /api/graph/full                  — full graph topology (nodes + edges, paginated)
```

## New MCP Tools

```
memory_link     — create a typed edge between two memories
memory_graph    — retrieve N-hop subgraph around a memory
memory_promote  — promote a memory to artifact status
guardian_temp   — query current Guardian temperature and signals
```

## Guardian Temperature

A computed signal representing the health of the user's cognitive loop. Not a single metric — a composite.

### Input Signals
- **Revisit-without-action count**: how many times a memory/topic has been searched or accessed without being edited, linked, or promoted
- **Time-since-last-artifact-exit**: how long since something was shipped
- **Contradiction density**: number of unresolved `contradicts` edges in the graph
- **Orphan ratio**: memories with zero edges / total memories
- **Decay velocity**: rate at which memories are losing strength without being reinforced
- **Recursion depth**: how many times the same cluster has been accessed in the current session

### Computation
Weighted sum of normalized signals, mapped to 0.0 (calm) → 1.0 (trapped). Stored in memory as a time series for historical tracking. Updated on every memory access event.

### Surfacing
- WebGL thermal shader (atmosphere)
- Guardian eye in sidebar (calm/warm/trapped)
- Status bar text
- Guardian notices in inspector (contextual warnings)
- Specific patterns get named: "cockpit revisited 4x without creating an artifact"

## Artifact State Machine

```
memory → [promote] → draft → [ready signal] → ready → [ship] → shipped
                       ↓                                  ↑
                    [trapped detection]              [autonomous ship
                       ↓                              or human gate]
                    trapped
```

- **draft**: promoted from memory. Readiness starts at 0.
- **readiness** compounds from: edits, skeptic review, strength, edge count, time-in-draft
- **ready**: readiness crosses threshold. ForgeFrame prepares the ship (PR, deploy command, publish format).
- **shipped**: artifact exited the loop. Green dot.
- **trapped**: revisited many times, readiness not increasing. Red dot. Guardian flags it.

The shipping mechanism itself (how to deploy, commit, publish) is left to ForgeFrame's agent pipeline. The Cockpit shows the state. The user can steer (edit, promote, force-ready) but doesn't power the engine.

## Mobile Layout

Responsive breakpoints:
- **Desktop** (>1024px): three-column layout as designed
- **Tablet** (768-1024px): sidebar collapses to icon strip, inspector slides over main area
- **Mobile** (<768px): single-column. Bottom tab bar (graph/memories/artifacts/guardian). Inspector is a bottom sheet that slides up. Context menu becomes a bottom action sheet.

Graph view on mobile: pinch-to-zoom, tap to select, long-press for context menu. WebGL renders the same — just touch events instead of mouse.

## What This Replaces

- Swarm viewer at `GET /` → Cockpit (swarm agent status moves into sidebar)
- Obsidian for daily ops → Cockpit memory browser + editor
- Obsidian `identity/` folder → ForgeFrame memory is the single source of truth
- Obsidian graph view → Cockpit graph with real typed edges
- Obsidian Dataview → Cockpit inspector with tag/strength/date queries
- Business OS dashboard concept → absorbed into Cockpit as a view

## What This Does NOT Include

- Chat interface — the Cockpit is not a chat window. Claude Code stays in the terminal.
- File system browsing — this is a memory tool, not a file manager.
- Code editing — use your editor. The Cockpit edits memories and skills, not source code.
- Onboarding / tooltips / tutorials — build for yourself first.

## Build Order

Three parallel workstreams:

### WS1: Memory Layer Upgrade
1. Schema migration (edges table, temporal fields)
2. Edge CRUD in store.ts
3. Multi-strategy retrieval (RRF fusion)
4. Auto-linking on save
5. New API endpoints (edges, graph, history)
6. New MCP tools (memory_link, memory_graph)

### WS2: Guardian + Artifacts
1. Guardian temperature module (signal collection, computation)
2. Artifact state machine (promote, readiness, ship detection)
3. Guardian API endpoint
4. Artifact API endpoints
5. Trapped detection logic
6. MCP tools (guardian_temp, memory_promote)

### WS3: Cockpit Frontend
1. Layout shell (three-column, glass panels, status bar)
2. WebGL thermal shader (Guardian canvas)
3. WebGL graph renderer (force-directed, instanced nodes/edges)
4. Sidebar (nav, tags, agents, Guardian eye)
5. Inspector (memory list, tabs, strength bars, Guardian notices)
6. Context menu (open, edit, link, promote, tag)
7. Tab system + markdown editor
8. Search (Cmd+K overlay)
9. Olive green theme + dark mode option
10. Mobile responsive layout
11. Tauri shell integration

### WS4: Integration
1. Wire frontend to live API
2. SSE event handling (new memories, edge changes, Guardian temp updates)
3. Graph populates from real ForgeFrame data
4. Swarm viewer replacement (serve Cockpit at `GET /`)
5. Tauri build pipeline
