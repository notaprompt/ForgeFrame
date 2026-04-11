# Show HN Strike Plan — Ship Before April 22

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship ForgeFrame to Show HN before Google Cloud Next (April 22) with a benchmark number that beats MemPalace (96.6% LongMemEval) or credibly challenges it, a Cockpit screenshot that makes people stop scrolling, and a README that positions the Strange Loop.

**Architecture:** Everything is already built — schema v5 with temporal edges, 16 MCP tools, RRF retrieval, Guardian temperature, Cockpit with 3 themes. This plan is polish, benchmark, and package. No new subsystems.

**Tech Stack:** TypeScript (vitest), Vanilla JS/WebGL (Cockpit), Python (benchmarks), npm (packaging)

**Competition:** MemPalace — 24K stars in 3 days, 96.6% LongMemEval, local ChromaDB + MCP. They have numbers. We have the Cockpit + Strange Loop + temporal graph. We need numbers too.

---

## File Structure

No new packages. Files touched:

| File | Change |
|---|---|
| `packages/memory/src/retrieval.ts` | Verify RRF is using all 3 strategies, add query-intent classification |
| `packages/memory/src/guardian.ts` | Verify temperature computes from real signals, not stubs |
| `cockpit/web/index.html` | Semantic zoom, label density, edge opacity, context menu, markdown editor |
| `benchmarks/longmemeval/run.ts` | NEW — benchmark runner |
| `benchmarks/longmemeval/report.md` | NEW — results |
| `README.md` | Rewrite — Strange Loop positioning, benchmark number, Cockpit screenshot |
| `package.json` | Verify clean install path |

---

### Task 1: Verify RRF Retrieval Is Real

Before benchmarking, confirm the retrieval pipeline actually runs all three strategies. If any are stubbed, the benchmark number is meaningless.

**Files:**
- Read: `packages/memory/src/retrieval.ts`
- Test: `packages/memory/src/retrieval.test.ts`

- [ ] **Step 1: Read `retrieval.ts` and trace the `query()` and `semanticQuery()` methods**

Confirm each method runs: (1) FTS5 text search, (2) vector/embedding similarity, (3) graph traversal via edges. Look for any `// TODO`, stub returns, or disabled strategies.

- [ ] **Step 2: Read `retrieval.test.ts`**

Confirm tests exist for: RRF fusion combining multiple strategies, graph traversal producing results, edge-type weighting. If tests are missing, note what's needed.

- [ ] **Step 3: Run retrieval tests**

```bash
cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/retrieval.test.ts -v
```

Expected: all pass. If failures, fix before proceeding.

- [ ] **Step 4: If graph traversal is stubbed or missing, implement it**

In `retrieval.ts`, the `query()` method should:
1. Run FTS5 search → get ranked results
2. Run embedding similarity → get ranked results  
3. For top-N seed results from steps 1-2, call `store.getSubgraph(id, hops=1)` → collect connected memories
4. Fuse all three lists via RRF: `score = sum(1/(k+rank))` where `k=60`

- [ ] **Step 5: Add query-intent classification (MAGMA insight)**

Before retrieval, classify the query into intent categories to weight edge types:

```typescript
function classifyQueryIntent(query: string): 'causal' | 'temporal' | 'semantic' | 'contradictory' | 'general' {
  const q = query.toLowerCase()
  if (/\b(why|because|led to|caused|decided|chose)\b/.test(q)) return 'causal'
  if (/\b(when|before|after|during|while|timeline)\b/.test(q)) return 'temporal'
  if (/\b(contradict|conflict|disagree|opposite|wrong)\b/.test(q)) return 'contradictory'
  if (/\b(relate|similar|like|connect|about)\b/.test(q)) return 'semantic'
  return 'general'
}
```

Use intent to weight edge types in graph traversal:
- `causal` → prioritize `led-to`, `supersedes` edges (weight 2x)
- `temporal` → prioritize by `valid_from` proximity (weight 2x)
- `semantic` → prioritize `similar`, `implements` edges (weight 2x)
- `contradictory` → prioritize `contradicts` edges (weight 3x)
- `general` → equal weights

- [ ] **Step 6: Write test for query-intent classification**

```typescript
import { classifyQueryIntent } from './retrieval'

describe('classifyQueryIntent', () => {
  test('causal queries', () => {
    expect(classifyQueryIntent('why did I decide to use SQLite')).toBe('causal')
    expect(classifyQueryIntent('what led to the rewrite')).toBe('causal')
  })
  test('temporal queries', () => {
    expect(classifyQueryIntent('when did I start the cockpit')).toBe('temporal')
    expect(classifyQueryIntent('what happened before the release')).toBe('temporal')
  })
  test('contradictory queries', () => {
    expect(classifyQueryIntent('what contradicts the sovereignty claim')).toBe('contradictory')
  })
  test('semantic queries', () => {
    expect(classifyQueryIntent('what relates to memory architecture')).toBe('semantic')
  })
  test('general queries', () => {
    expect(classifyQueryIntent('forgeframe cockpit')).toBe('general')
  })
})
```

- [ ] **Step 7: Run all retrieval tests**

```bash
npx vitest run packages/memory/src/retrieval.test.ts -v
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/memory/src/retrieval.ts packages/memory/src/retrieval.test.ts
git commit -m "retrieval: add query-intent classification for edge-type weighting"
```

---

### Task 2: Verify Guardian Temperature Is Live

**Files:**
- Read: `packages/memory/src/guardian.ts`
- Read: `packages/server/src/http.ts` (the `/api/guardian/temperature` route)
- Test: `packages/memory/src/guardian.test.ts`

- [ ] **Step 1: Read `guardian.ts` — trace `GuardianComputer`**

Confirm it computes from real signals: revisit-without-action, time-since-last-artifact, contradiction density, orphan ratio, decay velocity. Look for hardcoded returns or stubs.

- [ ] **Step 2: Run guardian tests**

```bash
npx vitest run packages/memory/src/guardian.test.ts -v
```

- [ ] **Step 3: Hit the endpoint with real data**

```bash
TOKEN=$(cat ~/.forgeframe/token 2>/dev/null || echo "test")
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/guardian/temperature | jq .
```

Expected: JSON with temperature value and signal breakdown, computed from real memory data.

- [ ] **Step 4: If stubbed, wire real signal computation**

Each signal should query the store:
- `revisitWithoutAction`: memories where `access_count > 3` and no edges created in last 7 days
- `timeSinceLastArtifact`: `Date.now() - lastShippedArtifact.created_at` (or Infinity if none)
- `contradictionDensity`: count of `contradicts` edges / total edges
- `orphanRatio`: memories with 0 edges / total memories
- `decayVelocity`: average strength delta over last 24h

- [ ] **Step 5: Commit if changes made**

```bash
git add packages/memory/src/guardian.ts packages/memory/src/guardian.test.ts
git commit -m "guardian: wire real signal computation for temperature"
```

---

### Task 3: Cockpit Polish — Graph Readability

The graph works but is too dense. This task makes it screenshot-ready.

**Files:**
- Modify: `cockpit/web/index.html`

- [ ] **Step 1: Add label visibility threshold**

Only show node labels when:
- Node is hovered
- Node is selected
- Node strength is above 0.8 (constitutional/principle nodes always labeled)
- Zoom level is above a threshold (more labels visible when zoomed in)

Find the label rendering code. Add a visibility check:

```javascript
function shouldShowLabel(node, zoomLevel) {
  if (node.hovered || node.selected) return true
  if (node.strength > 0.8) return true
  if (zoomLevel > 2.0) return true
  if (zoomLevel > 1.5 && node.strength > 0.6) return true
  return false
}
```

- [ ] **Step 2: Add edge opacity by weight**

Edges should fade by weight. Strong edges (weight > 0.8) fully visible. Weak edges (weight < 0.3) nearly invisible unless one of their nodes is hovered/selected.

```javascript
function edgeOpacity(edge, hoveredNodeId) {
  if (edge.source_id === hoveredNodeId || edge.target_id === hoveredNodeId) return 0.4
  if (edge.weight > 0.8) return 0.15
  if (edge.weight > 0.5) return 0.08
  return 0.02
}
```

- [ ] **Step 3: Add semantic zoom — cluster collapse**

This is the key differentiator. At default zoom, group memories by their strongest tag into cluster nodes. Show cluster as a single larger node with the tag name. Zoom in → cluster expands into constituent memories.

Implementation approach:
1. On data load, compute clusters from tag co-occurrence or edge connectivity
2. At zoom < 1.0: show only cluster nodes (one per major tag group)
3. At zoom 1.0-2.0: show cluster nodes + high-strength individual nodes
4. At zoom > 2.0: show all nodes, clusters dissolve

```javascript
function computeClusters(memories, edges) {
  // Group by primary tag
  const clusters = new Map()
  for (const mem of memories) {
    const primaryTag = mem.tags?.[0] || 'untagged'
    if (!clusters.has(primaryTag)) {
      clusters.set(primaryTag, { tag: primaryTag, members: [], x: 0, y: 0, strength: 0 })
    }
    const cluster = clusters.get(primaryTag)
    cluster.members.push(mem)
    cluster.strength = Math.max(cluster.strength, mem.strength)
  }
  // Position cluster at centroid of members
  for (const [, cluster] of clusters) {
    cluster.x = cluster.members.reduce((s, m) => s + m.x, 0) / cluster.members.length
    cluster.y = cluster.members.reduce((s, m) => s + m.y, 0) / cluster.members.length
  }
  return clusters
}

function getVisibleNodes(memories, clusters, zoomLevel) {
  if (zoomLevel < 1.0) return [...clusters.values()]
  if (zoomLevel < 2.0) {
    const highStrength = memories.filter(m => m.strength > 0.7)
    return [...clusters.values(), ...highStrength]
  }
  return memories
}
```

- [ ] **Step 4: Add cluster ring indicator**

When a cluster node is visible, draw a dashed circle around it showing it contains sub-nodes:

```javascript
function drawClusterRing(ctx, cluster, zoomLevel) {
  const memberCount = cluster.members.length
  const radius = Math.sqrt(memberCount) * 8 + 20
  ctx.beginPath()
  ctx.arc(cluster.x, cluster.y, radius, 0, Math.PI * 2)
  ctx.setLineDash([4, 8])
  ctx.strokeStyle = `rgba(107, 89, 64, ${0.15 * Math.min(1, 2 / zoomLevel)})`
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.setLineDash([])
}
```

- [ ] **Step 5: Test visually**

Open Cockpit, verify:
- Default zoom: cluster nodes visible with dashed rings, no label noise
- Zoom in: clusters dissolve, individual nodes appear, labels show on strong nodes
- Zoom out: everything collapses back to clusters
- Hover: labels and edges illuminate for the hovered node
- Screenshot looks clean, not hairball

- [ ] **Step 6: Commit**

```bash
git add cockpit/web/index.html
git commit -m "cockpit: semantic zoom, label threshold, edge opacity by weight"
```

---

### Task 4: Cockpit Polish — Context Menu + Inline Edit

**Files:**
- Modify: `cockpit/web/index.html`

- [ ] **Step 1: Check if context menu exists**

Search `index.html` for `contextmenu` or `ctx-menu` or right-click handling. If it exists, verify it has: Open, Edit, Link, Promote, Tag. If not, add it.

- [ ] **Step 2: Add context menu if missing**

On node click, show a floating menu at cursor position:

```html
<div id="ctx-menu" class="ctx-menu">
  <div class="ctx-item" onclick="ctxAction('open')">Open<span class="ctx-key">⌘O</span></div>
  <div class="ctx-item" onclick="ctxAction('edit')">Edit<span class="ctx-key">⌘E</span></div>
  <div class="ctx-item" onclick="ctxAction('link')">Link<span class="ctx-key">⌘L</span></div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" onclick="ctxAction('promote')">Promote<span class="ctx-key">⌘P</span></div>
  <div class="ctx-item" onclick="ctxAction('tag')">Tag</div>
</div>
```

Style with the glass recipe from the spec. Position at click coordinates. Dismiss on outside click or Escape.

- [ ] **Step 3: Wire Edit action to inline markdown editor**

When "Edit" is clicked from context menu:
1. Inspector switches to a contenteditable div pre-filled with the memory's content
2. On blur or Cmd+S, PATCH to `/api/memories/:id` with updated content
3. Toast notification: "saved" on success, "failed" on error

```javascript
function startEdit(memoryId, content) {
  const editor = document.getElementById('md-editor')
  editor.contentEditable = true
  editor.textContent = content
  editor.dataset.memoryId = memoryId
  editor.focus()
  editor.addEventListener('blur', () => saveEdit(memoryId, editor.textContent), { once: true })
}

async function saveEdit(id, content) {
  const res = await fetch(`/api/memories/${id}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  })
  showToast(res.ok ? 'saved' : 'failed')
}
```

- [ ] **Step 4: Wire Promote action**

```javascript
async function promoteMemory(id) {
  const res = await fetch(`/api/memories/${id}/promote`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  })
  showToast(res.ok ? 'promoted to artifact' : 'failed')
}
```

- [ ] **Step 5: Wire Link action**

Enter "link mode" — next node click creates an edge:

```javascript
let linkMode = null

function startLinkMode(sourceId) {
  linkMode = sourceId
  document.body.style.cursor = 'crosshair'
  showToast('click a node to link')
}

async function completeLink(targetId) {
  if (!linkMode || linkMode === targetId) return
  const res = await fetch(`/api/memories/${linkMode}/edges`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_id: targetId, relation_type: 'related' })
  })
  linkMode = null
  document.body.style.cursor = 'default'
  showToast(res.ok ? 'linked' : 'failed')
}
```

- [ ] **Step 6: Test all context menu actions**

Verify: right-click node → menu appears → each action works → API calls succeed → UI updates.

- [ ] **Step 7: Commit**

```bash
git add cockpit/web/index.html
git commit -m "cockpit: context menu with edit, link, promote actions"
```

---

### Task 5: Run LongMemEval Benchmark

This is the number that matters. MemPalace claims 96.6%.

**Files:**
- Create: `benchmarks/longmemeval/run.ts`
- Create: `benchmarks/longmemeval/README.md`

- [ ] **Step 1: Research LongMemEval format**

```bash
# Clone the benchmark
cd /Users/acamp/repos
git clone https://github.com/xiaowu0162/LongMemEval.git
ls LongMemEval/
```

Understand: what's the input format, what's the expected output, how is accuracy measured. Read the README and any eval scripts.

- [ ] **Step 2: Write the benchmark harness**

Create `benchmarks/longmemeval/run.ts`:
1. Load LongMemEval dataset
2. For each test case: ingest the context memories into a fresh ForgeFrame store
3. Run the query through `MemoryRetriever.semanticQuery()` 
4. Compare retrieved results to ground truth
5. Compute accuracy metrics (precision, recall, F1, the specific metric LongMemEval uses)

The exact implementation depends on LongMemEval's format — this step requires reading their code first.

- [ ] **Step 3: Run the benchmark**

```bash
npx tsx benchmarks/longmemeval/run.ts
```

Record the results.

- [ ] **Step 4: Write results to `benchmarks/longmemeval/README.md`**

```markdown
# ForgeFrame LongMemEval Results

| System | LongMemEval Score |
|---|---|
| MemPalace (ChromaDB + MCP) | 96.6% |
| Graphiti/Zep (temporal KG) | 63.8% |
| Mem0 | 49.0% |
| **ForgeFrame** | **XX.X%** |

Run date: 2026-04-XX
ForgeFrame version: X.X.X
Retrieval: RRF (FTS5 + embedding + graph traversal)
```

- [ ] **Step 5: If score is below 90%, diagnose and improve**

Check: is graph traversal contributing? Is RRF fusion helping or hurting? Try adjusting `k` parameter in RRF (default 60). Try different embedding models. Try adjusting auto-link threshold. Each tweak → re-run benchmark → track improvement.

- [ ] **Step 6: Commit**

```bash
git add benchmarks/
git commit -m "benchmarks: LongMemEval results — XX.X%"
```

---

### Task 6: README Rewrite — Strange Loop Positioning

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read current README**

```bash
cat /Users/acamp/repos/ForgeFrame/README.md
```

- [ ] **Step 2: Rewrite with Strange Loop headline**

Structure:
1. **Headline:** "The only memory system that gets smarter by watching itself think"
2. **One Cockpit screenshot** (the graph with semantic zoom, olive theme)
3. **One paragraph:** what it is (sovereign cognitive infrastructure), what makes it different (temporal knowledge graph + Guardian awareness + recursive self-improvement)
4. **Benchmark table:** LongMemEval score vs competitors
5. **Install:** `npm install @forgeframe/memory` — 3 lines to working memory
6. **Features:** bullet list — temporal edges, RRF retrieval, strength decay, Guardian temperature, Cockpit UI, 16 MCP tools, BSL license
7. **Architecture:** the data flow diagram from the spec
8. **The Strange Loop:** 1 paragraph explaining recursive self-improvement — not as a feature but as the thesis
9. **License:** BSL with Apache 2.0 conversion

Do NOT include: Cloud pricing, SDK examples, roadmap, contributor guidelines. Those come after Show HN traction.

- [ ] **Step 3: Take the Cockpit screenshot**

Open Cockpit at localhost:3001. Set olive theme. Zoom to a level where 3-5 cluster nodes are visible with dashed rings, a few high-strength nodes labeled, edges visible but not hairball. Guardian eye calm. Take screenshot. Save as `docs/cockpit-screenshot.png`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/cockpit-screenshot.png
git commit -m "readme: rewrite with Strange Loop positioning and benchmark results"
```

---

### Task 7: Clean Install Path

**Files:**
- Modify: `package.json` (root and packages)

- [ ] **Step 1: Test clean install from scratch**

```bash
cd /tmp && mkdir ff-test && cd ff-test
git clone ~/repos/ForgeFrame .
npm install
npm run build
```

Expected: zero errors. If any, fix them.

- [ ] **Step 2: Test the binary starts**

```bash
npx forgeframe-memory --help
# or
npx forgeframe --help
```

Expected: help output, no crash.

- [ ] **Step 3: Test the Cockpit serves**

```bash
npx forgeframe-memory &
sleep 2
curl -s http://localhost:3001/ | head -5
```

Expected: HTML response (Cockpit page).

- [ ] **Step 4: Fix any issues, commit**

```bash
git add -A
git commit -m "chore: clean install path verified"
```

---

### Task 8: Show HN Post Draft

**Files:**
- Create: `docs/show-hn-draft.md`

- [ ] **Step 1: Write the post**

```markdown
# Show HN: ForgeFrame — The only memory system that gets smarter by watching itself think

ForgeFrame is sovereign cognitive infrastructure for AI agents. Local-first memory 
with temporal knowledge graphs, strength decay, and a recursive self-improvement loop 
that distills patterns from its own usage.

Built solo from a laptop as an alternative to cloud-hosted memory services like 
Mem0 and Zep. Your data stays on your machine. SQLite file you own.

What makes it different:
- Temporal knowledge graph with typed edges (led-to, contradicts, supersedes, implements)
- Multi-strategy retrieval: FTS5 + embeddings + graph traversal, fused via reciprocal rank fusion
- XX.X% on LongMemEval (vs MemPalace 96.6%, Graphiti 63.8%, Mem0 49%)
- Guardian: a cognitive awareness layer that monitors your memory patterns and flags when you're stuck in recursive loops
- The Cockpit: a WebGL-rendered graph of your own thinking with a thermal shader that reacts to your cognitive state
- 16 MCP tools — works with Claude Code out of the box
- The Strange Loop: periodic self-distillation derives new principles from the system's own session logs

BSL licensed. Free for individuals. 

[Screenshot]

GitHub: [link]
```

- [ ] **Step 2: Review against successful Show HN posts**

Check: is it under 300 words? Does it lead with the differentiator? Is the screenshot compelling? Does it mention the benchmark? Does it link to GitHub?

- [ ] **Step 3: Commit**

```bash
git add docs/show-hn-draft.md
git commit -m "docs: Show HN draft"
```

---

## Execution Order

Tasks 1-2 can run in parallel (verification). Task 3-4 can run in parallel (Cockpit polish). Task 5 depends on Task 1 (retrieval must be verified before benchmarking). Task 6-7 depend on Task 5 (need the benchmark number). Task 8 depends on everything.

```
[Task 1: RRF Verify] ──→ [Task 5: Benchmark] ──→ [Task 6: README] ──→ [Task 8: HN Post]
[Task 2: Guardian]   ──→                          [Task 7: Install]──→
[Task 3: Graph Polish] ──→ (screenshot for Task 6)
[Task 4: Context Menu] ──→
```

**Timeline:** Tasks 1-4 today. Task 5 tomorrow. Tasks 6-8 day after. Post by end of week. Before April 22.
