# Wave A: Graph Overhaul (Cytoscape.js) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Canvas 2D hairball graph with a Cytoscape.js compound graph featuring tag-based clusters, semantic zoom, weighted node sizing, and the full visual language from the spec.

**Architecture:** Cytoscape.js loaded via CDN into the existing single-file Cockpit. A new `/api/graph/clustered` endpoint computes cluster assignments server-side using connected components + tag affinity. The old Canvas 2D graph renderer is replaced entirely; the WebGL thermal shader stays as the background layer.

**Tech Stack:** Cytoscape.js (CDN), cytoscape-fcose (CDN), cytoscape-expand-collapse (CDN), cytoscape-popper (CDN), TypeScript (server endpoint), Vanilla JS (Cockpit)

**Spec:** `docs/superpowers/specs/2026-04-14-final-sprint-design.md` — Wave A section

---

## Phase Map

```
PHASE 1: Server (clustered graph endpoint)     SEQUENTIAL
  Task 1: Clustered graph endpoint + tests      --- new API

PHASE 2: Cockpit (Cytoscape integration)        SEQUENTIAL
  Task 2: CDN scripts + Cytoscape init          --- depends on 1
  Task 3: Stylesheet + theme mapping            --- depends on 2
  Task 4: Remove old renderer, wire Cytoscape   --- depends on 3
  Task 5: Semantic zoom (expand-collapse)        --- depends on 4
  Task 6: SSE live updates + interaction         --- depends on 5
```

---

### Task 1: Clustered graph endpoint

**Files:**
- Modify: `packages/server/src/http.ts`
- Create: `packages/memory/src/clustering.ts`
- Create: `packages/memory/src/clustering.test.ts`
- Modify: `packages/memory/src/index.ts`

This endpoint returns the full graph with cluster assignments. Clusters are computed from connected components, labeled by dominant custom tag.

- [ ] **Step 1: Write clustering tests**

Create `packages/memory/src/clustering.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { computeClusters } from './clustering.js';

describe('computeClusters', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('returns empty clusters for empty database', () => {
    const result = computeClusters(store);
    expect(result.clusters).toHaveLength(0);
    expect(result.nodes).toHaveLength(0);
  });

  it('groups connected memories into clusters', () => {
    const m1 = store.create({ content: 'sovereignty architecture', tags: ['observation', 'sovereignty'] });
    const m2 = store.create({ content: 'sovereignty local-first', tags: ['decision', 'sovereignty'] });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related' });

    const m3 = store.create({ content: 'pricing strategy', tags: ['decision', 'business'] });
    const m4 = store.create({ content: 'enterprise tier', tags: ['observation', 'business'] });
    store.createEdge({ sourceId: m3.id, targetId: m4.id, relationType: 'related' });

    const result = computeClusters(store);
    expect(result.clusters).toHaveLength(2);

    const labels = result.clusters.map(c => c.label).sort();
    expect(labels).toEqual(['business', 'sovereignty']);
  });

  it('labels cluster by dominant custom tag', () => {
    const m1 = store.create({ content: 'a', tags: ['observation', 'sovereignty'] });
    const m2 = store.create({ content: 'b', tags: ['decision', 'sovereignty'] });
    const m3 = store.create({ content: 'c', tags: ['pattern', 'architecture'] });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related' });
    store.createEdge({ sourceId: m2.id, targetId: m3.id, relationType: 'related' });

    const result = computeClusters(store);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].label).toBe('sovereignty');
  });

  it('does not cluster groups with fewer than 3 members', () => {
    const m1 = store.create({ content: 'lonely a', tags: ['observation'] });
    const m2 = store.create({ content: 'lonely b', tags: ['observation'] });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related' });

    const result = computeClusters(store);
    expect(result.clusters).toHaveLength(0);
    expect(result.nodes.filter(n => n.parent === null)).toHaveLength(2);
  });

  it('assigns orphan memories to tag-based clusters if 3+ share a tag', () => {
    store.create({ content: 'orphan a', tags: ['observation', 'sovereignty'] });
    store.create({ content: 'orphan b', tags: ['decision', 'sovereignty'] });
    store.create({ content: 'orphan c', tags: ['pattern', 'sovereignty'] });

    const result = computeClusters(store);
    expect(result.clusters.length).toBeGreaterThanOrEqual(1);
    const sovCluster = result.clusters.find(c => c.label === 'sovereignty');
    expect(sovCluster).toBeDefined();
    expect(sovCluster!.memberCount).toBe(3);
  });

  it('computes visual weight from edge types', () => {
    const m1 = store.create({ content: 'hub', tags: ['observation'] });
    const m2 = store.create({ content: 'a', tags: ['observation'] });
    const m3 = store.create({ content: 'b', tags: ['observation'] });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'led-to' });
    store.createEdge({ sourceId: m1.id, targetId: m3.id, relationType: 'similar' });

    const result = computeClusters(store);
    const hub = result.nodes.find(n => n.id === m1.id);
    expect(hub).toBeDefined();
    // led-to = 3, similar = 0.5, total = 3.5
    expect(hub!.visualWeight).toBeCloseTo(3.5);
  });

  it('computes cluster avgStrength', () => {
    const m1 = store.create({ content: 'a', tags: ['observation', 'test'] });
    const m2 = store.create({ content: 'b', tags: ['observation', 'test'] });
    const m3 = store.create({ content: 'c', tags: ['observation', 'test'] });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'related' });
    store.createEdge({ sourceId: m2.id, targetId: m3.id, relationType: 'related' });

    const result = computeClusters(store);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].avgStrength).toBe(1.0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/clustering.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement clustering module**

Create `packages/memory/src/clustering.ts`:

```typescript
/**
 * @forgeframe/memory — Graph Clustering
 *
 * Computes cluster assignments for the Cockpit graph view.
 * Uses connected components for grouping, dominant custom tag for labeling.
 */

import type { MemoryStore } from './store.js';
import type { Memory } from './types.js';
import { TRIM_TAGS } from './types.js';

const EDGE_TYPE_WEIGHTS: Record<string, number> = {
  'led-to': 3,
  'contradicts': 2,
  'supersedes': 2,
  'implements': 2,
  'derived-from': 1.5,
  'related': 1,
  'similar': 0.5,
};

const MIN_CLUSTER_SIZE = 3;
const SYSTEM_TAGS = new Set([...TRIM_TAGS, 'dream-journal']);

export interface ClusteredNode {
  id: string;
  content: string;
  tags: string[];
  strength: number;
  valence: string;
  memoryType: string;
  createdAt: number;
  accessCount: number;
  visualWeight: number;
  parent: string | null;
}

export interface ClusterInfo {
  id: string;
  label: string;
  memberCount: number;
  avgStrength: number;
  dominantTrimTag: string;
}

export interface ClusteredGraph {
  nodes: ClusteredNode[];
  clusters: ClusterInfo[];
  edges: Array<{ id: string; source: string; target: string; relationType: string; weight: number }>;
}

function getCustomTags(tags: string[]): string[] {
  return tags.filter(t => !SYSTEM_TAGS.has(t as any));
}

function getDominantTag(memories: Memory[], custom: boolean): string {
  const counts = new Map<string, number>();
  for (const mem of memories) {
    const tags = custom ? getCustomTags(mem.tags) : mem.tags;
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  let best = '';
  let bestCount = 0;
  for (const [tag, count] of counts) {
    if (count > bestCount) { best = tag; bestCount = count; }
  }
  return best || 'uncategorized';
}

function getDominantTrimTag(memories: Memory[]): string {
  const trimSet = new Set<string>(TRIM_TAGS as readonly string[]);
  const counts = new Map<string, number>();
  for (const mem of memories) {
    for (const tag of mem.tags) {
      if (trimSet.has(tag)) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  let best = 'observation';
  let bestCount = 0;
  for (const [tag, count] of counts) {
    if (count > bestCount) { best = tag; bestCount = count; }
  }
  return best;
}

function computeVisualWeight(store: MemoryStore, memoryId: string): number {
  const edges = store.getEdges(memoryId);
  let weight = 0;
  for (const edge of edges) {
    weight += EDGE_TYPE_WEIGHTS[edge.relationType] ?? 1;
  }
  return weight;
}

export function computeClusters(store: MemoryStore): ClusteredGraph {
  const components = store.getConnectedComponents();
  const allMemories = store.getRecent(10000);
  const allEdges: ClusteredGraph['edges'] = [];

  // Collect all edges
  const edgeIds = new Set<string>();
  for (const mem of allMemories) {
    for (const edge of store.getEdges(mem.id)) {
      if (!edgeIds.has(edge.id)) {
        edgeIds.add(edge.id);
        allEdges.push({
          id: edge.id,
          source: edge.sourceId,
          target: edge.targetId,
          relationType: edge.relationType,
          weight: edge.weight,
        });
      }
    }
  }

  // Track which memories are in a component
  const memoryToComponent = new Map<string, number>();
  for (let i = 0; i < components.length; i++) {
    for (const id of components[i].memoryIds) {
      memoryToComponent.set(id, i);
    }
  }

  const clusters: ClusterInfo[] = [];
  const nodeParent = new Map<string, string>();

  // Cluster connected components with 3+ members
  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    if (comp.memoryIds.length < MIN_CLUSTER_SIZE) continue;

    const members = comp.memoryIds.map(id => store.get(id)).filter(Boolean) as Memory[];
    if (members.length < MIN_CLUSTER_SIZE) continue;

    const label = getDominantTag(members, true);
    const trimTag = getDominantTrimTag(members);
    const avgStrength = members.reduce((sum, m) => sum + m.strength, 0) / members.length;
    const clusterId = 'cluster-' + label.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '-' + i;

    clusters.push({
      id: clusterId,
      label,
      memberCount: members.length,
      avgStrength: Math.round(avgStrength * 100) / 100,
      dominantTrimTag: trimTag,
    });

    for (const id of comp.memoryIds) {
      nodeParent.set(id, clusterId);
    }
  }

  // Orphan memories: group by custom tag if 3+ share one
  const orphans = allMemories.filter(m => !memoryToComponent.has(m.id));
  const orphansByTag = new Map<string, Memory[]>();
  for (const mem of orphans) {
    const customTags = getCustomTags(mem.tags);
    for (const tag of customTags) {
      const list = orphansByTag.get(tag) || [];
      list.push(mem);
      orphansByTag.set(tag, list);
    }
  }

  const assignedOrphans = new Set<string>();
  for (const [tag, members] of orphansByTag) {
    const unassigned = members.filter(m => !assignedOrphans.has(m.id));
    if (unassigned.length < MIN_CLUSTER_SIZE) continue;

    const trimTag = getDominantTrimTag(unassigned);
    const avgStrength = unassigned.reduce((sum, m) => sum + m.strength, 0) / unassigned.length;
    const clusterId = 'cluster-orphan-' + tag.replace(/[^a-z0-9]/gi, '-').toLowerCase();

    clusters.push({
      id: clusterId,
      label: tag,
      memberCount: unassigned.length,
      avgStrength: Math.round(avgStrength * 100) / 100,
      dominantTrimTag: trimTag,
    });

    for (const mem of unassigned) {
      nodeParent.set(mem.id, clusterId);
      assignedOrphans.add(mem.id);
    }
  }

  // Build node list
  const nodes: ClusteredNode[] = allMemories.map(mem => ({
    id: mem.id,
    content: mem.content,
    tags: mem.tags,
    strength: mem.strength,
    valence: mem.valence,
    memoryType: mem.memoryType,
    createdAt: mem.createdAt,
    accessCount: mem.accessCount,
    visualWeight: computeVisualWeight(store, mem.id),
    parent: nodeParent.get(mem.id) || null,
  }));

  return { nodes, clusters, edges: allEdges };
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/clustering.test.ts
```

Expected: all pass.

- [ ] **Step 5: Export and add HTTP endpoint**

Add to `packages/memory/src/index.ts`:

```typescript
export { computeClusters } from './clustering.js';
export type { ClusteredGraph, ClusteredNode, ClusterInfo } from './clustering.js';
```

Add to `packages/server/src/http.ts`, after the existing `GET /api/graph/full` endpoint:

```typescript
  app.get('/api/graph/clustered', (c) => {
    const { computeClusters } = require('@forgeframe/memory');
    const result = computeClusters(store);
    return c.json(result);
  });
```

Note: use dynamic import since computeClusters may not be in the built output yet. Alternatively use the static import at the top of http.ts:

In the import line at the top of http.ts, add `computeClusters` to the imports from `@forgeframe/memory`.

- [ ] **Step 6: Build and verify**

```bash
cd /Users/acamp/repos/ForgeFrame && npm run build && npx vitest run
```

Expected: all tests pass, clean build.

- [ ] **Step 7: Commit**

```bash
git add packages/memory/src/clustering.ts packages/memory/src/clustering.test.ts packages/memory/src/index.ts packages/server/src/http.ts
git commit -m "add clustered graph endpoint with tag-based cluster assignment"
```

---

### Task 2: CDN scripts + Cytoscape initialization

**Files:**
- Modify: `cockpit/web/index.html` (head section + script section)

Add Cytoscape.js and extensions via CDN, create the container element, and initialize the Cytoscape instance.

- [ ] **Step 1: Add CDN script tags**

In the `<head>` section of `cockpit/web/index.html`, before `<style>`, add:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.30.4/cytoscape.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cytoscape-fcose@2.2.0/cytoscape-fcose.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cytoscape-expand-collapse@4.1.0/cytoscape-expand-collapse.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@popperjs/core@2.11.8/dist/umd/popper.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cytoscape-popper@2.0.0/cytoscape-popper.min.js"></script>
```

- [ ] **Step 2: Add Cytoscape container**

In the HTML body, find `<canvas id="graph-canvas"></canvas>` and add a div right after it:

```html
    <canvas id="graph-canvas"></canvas>
    <div id="cy-container" style="position:absolute;top:0;left:0;right:0;bottom:0;z-index:1;"></div>
```

Also add CSS for the container (in the style section):

```css
  #cy-container {
    background: transparent;
  }
  #cy-container canvas {
    background: transparent !important;
  }
```

- [ ] **Step 3: Add Cytoscape state and init function**

In the `<script>` block, after the sonar section and before `// ===== SIGNAL OVERLAY =====`, add:

```javascript
  // ===== CYTOSCAPE GRAPH =====
  var cy = null;

  var TRIM_TAG_COLORS = {
    principle: '#8aab7f', voice: '#8aab7f',
    decision: '#b8965a', pattern: '#b8965a',
    observation: '#8b7355', entity: '#8b7355',
    thread: '#c4956a', skill: '#c4956a',
    milestone: '#8b7355', evaluation: '#b8965a',
  };

  var TRIM_TAG_COLORS_DIM = {
    principle: 'rgba(138,171,127,0.15)', voice: 'rgba(138,171,127,0.15)',
    decision: 'rgba(184,150,90,0.15)', pattern: 'rgba(184,150,90,0.15)',
    observation: 'rgba(139,115,85,0.15)', entity: 'rgba(139,115,85,0.15)',
    thread: 'rgba(196,149,106,0.15)', skill: 'rgba(196,149,106,0.15)',
    milestone: 'rgba(139,115,85,0.15)', evaluation: 'rgba(184,150,90,0.15)',
  };

  function getTrimTagColor(tags) {
    for (var i = 0; i < tags.length; i++) {
      if (TRIM_TAG_COLORS[tags[i]]) return TRIM_TAG_COLORS[tags[i]];
    }
    return '#8b7355';
  }

  function getTrimTagColorDim(tags) {
    for (var i = 0; i < tags.length; i++) {
      if (TRIM_TAG_COLORS_DIM[tags[i]]) return TRIM_TAG_COLORS_DIM[tags[i]];
    }
    return 'rgba(139,115,85,0.15)';
  }

  function nodeRadius(visualWeight) {
    return Math.max(6, Math.min(24, 6 + visualWeight * 1.5));
  }

  function buildCytoscapeStylesheet() {
    return [
      { selector: 'node', style: {
        'background-color': function(ele) { return getTrimTagColor(ele.data('tags') || []); },
        'background-opacity': function(ele) { return Math.max(0.2, ele.data('strength') || 0.5); },
        'width': function(ele) { return nodeRadius(ele.data('visualWeight') || 0) * 2; },
        'height': function(ele) { return nodeRadius(ele.data('visualWeight') || 0) * 2; },
        'label': '',
        'border-width': function(ele) {
          var v = ele.data('valence');
          return (v === 'charged' || v === 'grounding') ? 2 : 0;
        },
        'border-color': function(ele) {
          var v = ele.data('valence');
          if (v === 'charged') return '#b8965a';
          if (v === 'grounding') return '#8aab7f';
          return 'transparent';
        },
        'shape': function(ele) {
          return ele.data('memoryType') === 'artifact' ? 'diamond' : 'ellipse';
        },
        'transition-property': 'background-opacity, width, height',
        'transition-duration': '0.3s',
      }},
      { selector: 'node:selected', style: {
        'border-width': 3,
        'border-color': '#b8965a',
        'overlay-opacity': 0,
      }},
      { selector: ':parent', style: {
        'background-color': function(ele) { return getTrimTagColorDim([]); },
        'background-opacity': function(ele) { return Math.max(0.05, (ele.data('avgStrength') || 0.5) * 0.12); },
        'border-width': 1,
        'border-style': 'dashed',
        'border-color': function(ele) {
          var trimTag = ele.data('dominantTrimTag') || 'observation';
          return (TRIM_TAG_COLORS[trimTag] || '#8b7355');
        },
        'border-opacity': 0.3,
        'label': function(ele) { return ele.data('label') || ''; },
        'font-family': "'JetBrains Mono', monospace",
        'font-size': 9,
        'font-weight': 500,
        'text-transform': 'uppercase',
        'letter-spacing': '1.5px',
        'color': 'var(--t3)',
        'text-valign': 'bottom',
        'text-margin-y': 8,
        'padding': 16,
        'shape': 'round-rectangle',
        'corner-radius': 12,
      }},
      { selector: 'edge', style: {
        'width': function(ele) {
          var rt = ele.data('relationType');
          return (rt === 'led-to' || rt === 'contradicts' || rt === 'supersedes') ? 1.5 : 0.8;
        },
        'line-color': '#8b7355',
        'line-opacity': function(ele) { return Math.max(0.05, Math.min(0.3, (ele.data('weight') || 0.5) * 0.3)); },
        'curve-style': 'bezier',
        'target-arrow-shape': 'none',
      }},
      { selector: 'edge:selected', style: {
        'line-opacity': 0.6,
        'line-color': '#b8965a',
      }},
    ];
  }

  function initCytoscape(graphData) {
    var container = document.getElementById('cy-container');
    if (!container) return;

    // Build Cytoscape elements from clustered graph data
    var elements = [];

    // Add cluster parent nodes
    for (var ci = 0; ci < graphData.clusters.length; ci++) {
      var cluster = graphData.clusters[ci];
      elements.push({
        group: 'nodes',
        data: {
          id: cluster.id,
          label: cluster.label,
          memberCount: cluster.memberCount,
          avgStrength: cluster.avgStrength,
          dominantTrimTag: cluster.dominantTrimTag,
        },
      });
    }

    // Add memory nodes
    for (var ni = 0; ni < graphData.nodes.length; ni++) {
      var node = graphData.nodes[ni];
      elements.push({
        group: 'nodes',
        data: {
          id: node.id,
          parent: node.parent,
          content: node.content,
          tags: node.tags,
          strength: node.strength,
          valence: node.valence,
          memoryType: node.memoryType,
          visualWeight: node.visualWeight,
          createdAt: node.createdAt,
        },
      });
    }

    // Add edges
    for (var ei = 0; ei < graphData.edges.length; ei++) {
      var edge = graphData.edges[ei];
      elements.push({
        group: 'edges',
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          relationType: edge.relationType,
          weight: edge.weight,
        },
      });
    }

    if (cy) cy.destroy();

    cy = cytoscape({
      container: container,
      elements: elements,
      style: buildCytoscapeStylesheet(),
      layout: {
        name: 'fcose',
        animate: true,
        animationDuration: 800,
        animationEasing: 'ease-out',
        quality: 'default',
        randomize: true,
        nodeDimensionsIncludeLabels: true,
        packComponents: true,
        nodeRepulsion: function() { return 8000; },
        idealEdgeLength: function() { return 80; },
        edgeElasticity: function() { return 0.1; },
        nestingFactor: 0.15,
        gravity: 0.3,
        gravityRange: 1.5,
        numIter: 2500,
      },
      minZoom: 0.1,
      maxZoom: 5,
      wheelSensitivity: 0.3,
    });

    // Node selection
    cy.on('tap', 'node', function(evt) {
      var node = evt.target;
      if (node.isParent()) return;
      var id = node.id();
      selectNode(id);
    });

    // Deselect on background tap
    cy.on('tap', function(evt) {
      if (evt.target === cy) selectNode(null);
    });

    // Show label on hover
    cy.on('mouseover', 'node', function(evt) {
      var node = evt.target;
      if (node.isParent()) return;
      var content = node.data('content') || '';
      var firstLine = content.split('\n')[0] || '';
      node.style('label', firstLine.slice(0, 50));
      node.style('font-size', 10);
      node.style('font-family', "'Inter', sans-serif");
      node.style('font-weight', 300);
      node.style('color', 'var(--t1)');
      node.style('text-background-opacity', 0.7);
      node.style('text-background-color', 'var(--panel-solid)');
      node.style('text-background-padding', '4px');
      node.style('text-background-shape', 'roundrectangle');
    });

    cy.on('mouseout', 'node', function(evt) {
      var node = evt.target;
      if (node.isParent()) return;
      node.style('label', '');
    });

    state.memoryCount = graphData.nodes.length;
    state.edgeCount = graphData.edges.length;
    renderSidebar();
    renderStatusbar();
  }
```

- [ ] **Step 4: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add Cytoscape.js initialization with compound node stylesheet"
```

---

### Task 3: Theme-reactive stylesheet

**Files:**
- Modify: `cockpit/web/index.html`

The Cytoscape stylesheet needs to react to theme changes. When the user switches themes, the graph colors update.

- [ ] **Step 1: Add theme-aware color function**

In the Cytoscape section, add a function that reads the current theme and returns adjusted colors:

```javascript
  function getThemeGraphColors() {
    var isDark = state.theme === 'ink' || state.theme === 'void';
    return {
      edgeColor: isDark ? 'rgba(232,230,225,0.08)' : 'rgba(139,115,85,0.12)',
      labelColor: isDark ? 'rgba(232,230,225,0.7)' : 'rgba(28,25,23,0.6)',
      labelBg: isDark ? 'rgba(30,30,35,0.8)' : 'rgba(240,238,230,0.8)',
      clusterBorder: isDark ? 0.2 : 0.3,
      selectedBorder: isDark ? '#b8965a' : '#a07d42',
    };
  }

  function updateCytoscapeTheme() {
    if (!cy) return;
    var colors = getThemeGraphColors();
    cy.style()
      .selector('edge').style({ 'line-color': colors.edgeColor })
      .update();
  }
```

- [ ] **Step 2: Hook into theme switching**

In the settings panel theme click handler (search for `state.theme = t;`), add after the `document.documentElement.setAttribute` line:

```javascript
          updateCytoscapeTheme();
```

- [ ] **Step 3: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add theme-reactive Cytoscape stylesheet"
```

---

### Task 4: Replace old renderer, wire Cytoscape to data

**Files:**
- Modify: `cockpit/web/index.html`

Remove the old Canvas 2D graph renderer and wire Cytoscape to the clustered API endpoint.

- [ ] **Step 1: Replace loadGraph function**

Find the existing `loadGraph` function and replace it:

```javascript
  function loadGraph() {
    return api('/api/graph/clustered').then(function(data) {
      state.nodes = data.nodes || [];
      state.edges = data.edges || [];
      state.nodeMap.clear();
      for (var i = 0; i < state.nodes.length; i++) {
        state.nodeMap.set(state.nodes[i].id, state.nodes[i]);
      }
      state.memoryCount = data.nodes ? data.nodes.length : 0;
      state.edgeCount = data.edges ? data.edges.length : 0;

      if (state.nodes.length > 0) {
        var sum = 0;
        for (var j = 0; j < state.nodes.length; j++) sum += (state.nodes[j].strength || 0);
        state.avgStrength = sum / state.nodes.length;
      }

      initCytoscape(data);
      renderSidebar();
      renderStatusbar();
    }).catch(function(err) {
      console.error('Failed to load graph:', err);
      showBanner('Could not reach server. Check that ForgeFrame is running.');
    });
  }
```

- [ ] **Step 2: Hide old graph canvas**

Find the `<canvas id="graph-canvas">` and add `style="display:none"`:

```html
    <canvas id="graph-canvas" style="display:none"></canvas>
```

- [ ] **Step 3: Remove old renderer from main loop**

Update the `mainLoop` function to remove `simulateForces()` and `drawGraph()`:

```javascript
  function mainLoop(time) {
    drawThermal(time);
    if (sonarSmallCanvas) drawSonar(sonarSmallCanvas, state.guardianTemp, state.guardianState, state.sleepPressure, time);
    if (sonarLargeCanvas && state.signalOverlayOpen) drawSonar(sonarLargeCanvas, state.guardianTemp, state.guardianState, state.sleepPressure, time);
    requestAnimationFrame(mainLoop);
  }
```

- [ ] **Step 4: Update switchView for Cytoscape**

Update `switchView` so the Cytoscape container visibility toggles with graph view:

```javascript
  function switchView(viewName) {
    state.activeView = viewName.toLowerCase();
    if (state.activeView === 'graph') state.sidebarView = 'graph';
    else if (state.activeView === 'list') state.sidebarView = 'memories';
    else if (state.activeView === 'feed') state.sidebarView = 'sessions';

    var cyEl = document.getElementById('cy-container');
    var lv = document.getElementById('list-view');
    var fv = document.getElementById('feed-view');
    var zb = document.getElementById('zoom-bar');

    if (cyEl) cyEl.style.display = state.activeView === 'graph' ? 'block' : 'none';
    lv.classList.toggle('active', state.activeView === 'list');
    fv.classList.toggle('active', state.activeView === 'feed');
    zb.style.display = state.activeView === 'graph' ? 'flex' : 'none';

    if (state.activeView === 'list') renderListView();
    if (state.activeView === 'feed') renderFeedView();
    if (state.activeView === 'graph' && cy) cy.resize();
  }
```

- [ ] **Step 5: Commit**

```bash
git add cockpit/web/index.html
git commit -m "replace Canvas 2D graph with Cytoscape.js clustered renderer"
```

---

### Task 5: Semantic zoom (expand-collapse)

**Files:**
- Modify: `cockpit/web/index.html`

Wire up the expand-collapse extension for compound nodes with click + zoom threshold.

- [ ] **Step 1: Initialize expand-collapse and zoom threshold**

In `initCytoscape`, after the `cy = cytoscape(...)` call and the event handlers, add:

```javascript
    // Register expand-collapse
    if (cy.expandCollapse) {
      var api_ec = cy.expandCollapse({
        layoutBy: {
          name: 'fcose',
          animate: true,
          animationDuration: 500,
          randomize: false,
          nodeDimensionsIncludeLabels: true,
          nodeRepulsion: function() { return 4000; },
          idealEdgeLength: function() { return 60; },
          nestingFactor: 0.15,
        },
        fisheye: false,
        animate: true,
        animationDuration: 500,
        undoable: false,
        cueEnabled: false,
      });

      // Collapse all initially
      var parents = cy.nodes(':parent');
      if (parents.length > 0) {
        api_ec.collapseAll();
      }

      // Double-click to expand/collapse
      cy.on('dbltap', 'node', function(evt) {
        var node = evt.target;
        if (node.isParent()) {
          if (api_ec.isCollapsible(node)) {
            api_ec.collapse(node);
          } else {
            api_ec.expand(node);
          }
        }
      });

      // Zoom threshold: auto-expand at 2.5x, auto-collapse below 1.0x
      var lastZoom = cy.zoom();
      cy.on('zoom', function() {
        var zoom = cy.zoom();
        var extent = cy.extent();
        var centerX = (extent.x1 + extent.x2) / 2;
        var centerY = (extent.y1 + extent.y2) / 2;

        if (zoom >= 2.5 && lastZoom < 2.5) {
          // Find the cluster nearest to viewport center
          var closestParent = null;
          var closestDist = Infinity;
          cy.nodes(':parent').forEach(function(p) {
            if (!api_ec.isExpandable(p)) return;
            var pos = p.position();
            var dist = Math.sqrt(Math.pow(pos.x - centerX, 2) + Math.pow(pos.y - centerY, 2));
            if (dist < closestDist) { closestDist = dist; closestParent = p; }
          });
          if (closestParent) api_ec.expand(closestParent);
        }

        if (zoom < 1.0 && lastZoom >= 1.0) {
          api_ec.collapseAll();
        }

        lastZoom = zoom;
      });
    }
```

- [ ] **Step 2: Update zoom bar to work with Cytoscape**

Replace the zoom bar button handlers:

```javascript
  function buildZoomBar() {
    var bar = document.getElementById('zoom-bar');
    clearEl(bar);
    var zoomIn = el('div', { className: 'zbtn', textContent: '+' });
    zoomIn.addEventListener('click', function() { if (cy) cy.zoom({ level: cy.zoom() * 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }); });
    bar.appendChild(zoomIn);
    var zoomOut = el('div', { className: 'zbtn', textContent: '\u2212' });
    zoomOut.addEventListener('click', function() { if (cy) cy.zoom({ level: cy.zoom() * 0.7, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }); });
    bar.appendChild(zoomOut);
    var zoomFit = el('div', { className: 'zbtn', textContent: '\u25A3' });
    zoomFit.addEventListener('click', function() { if (cy) cy.fit(null, 50); });
    bar.appendChild(zoomFit);
  }
```

- [ ] **Step 3: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add semantic zoom with expand-collapse and zoom thresholds"
```

---

### Task 6: SSE live updates + node interaction

**Files:**
- Modify: `cockpit/web/index.html`

Wire SSE events to update the Cytoscape graph in real-time.

- [ ] **Step 1: Update SSE handlers for Cytoscape**

Find the `memory:created` SSE handler and update it to add nodes to Cytoscape:

```javascript
    es.addEventListener('memory:created', function(e) {
      try {
        var mem = JSON.parse(e.data);
        state.nodeMap.set(mem.id, mem);
        state.nodes.push(mem);
        state.memoryCount = state.nodes.length;
        if (cy) {
          cy.add({
            group: 'nodes',
            data: {
              id: mem.id,
              content: mem.content,
              tags: mem.tags || [],
              strength: mem.strength || 1.0,
              valence: mem.valence || 'neutral',
              memoryType: mem.memoryType || 'semantic',
              visualWeight: 0,
            },
            position: { x: Math.random() * 500, y: Math.random() * 500 },
          });
        }
        renderSidebar();
        renderStatusbar();
      } catch(err) { /* ignore */ }
    });
```

Update the `edge:created` handler:

```javascript
    es.addEventListener('edge:created', function(e) {
      try {
        var edge = JSON.parse(e.data);
        state.edges.push(edge);
        state.edgeCount = state.edges.length;
        if (cy) {
          cy.add({
            group: 'edges',
            data: {
              id: edge.id,
              source: edge.sourceId,
              target: edge.targetId,
              relationType: edge.relationType || 'related',
              weight: edge.weight || 1.0,
            },
          });
        }
        renderStatusbar();
      } catch(err) { /* ignore */ }
    });
```

Update the `memory:deleted` handler:

```javascript
    es.addEventListener('memory:deleted', function(e) {
      try {
        var data = JSON.parse(e.data);
        var id = data.id || data;
        state.nodes = state.nodes.filter(function(n) { return n.id !== id; });
        state.nodeMap.delete(id);
        state.edges = state.edges.filter(function(edge) { return edge.sourceId !== id && edge.targetId !== id; });
        if (state.selectedId === id) selectNode(null);
        state.memoryCount = state.nodes.length;
        state.edgeCount = state.edges.length;
        if (cy) {
          var cyNode = cy.getElementById(id);
          if (cyNode.length) cy.remove(cyNode);
        }
        renderSidebar();
        renderStatusbar();
      } catch(err) { /* ignore */ }
    });
```

- [ ] **Step 2: Add window resize handler for Cytoscape**

In the `boot()` function, update the resize listener:

```javascript
    window.addEventListener('resize', function() {
      resizeGraph();
      if (cy) cy.resize();
    });
```

- [ ] **Step 3: Commit**

```bash
git add cockpit/web/index.html
git commit -m "wire SSE live updates and resize to Cytoscape graph"
```

---

## Verification

After all tasks:

1. `npm run build` — clean
2. `npx vitest run` — all pass (568+ plus new clustering tests)
3. Start server, open Cockpit
4. Graph shows clustered compound nodes with dashed rings and labels
5. Double-click a cluster — it expands with animation, children fan out
6. Double-click again — collapses back
7. Zoom in past 2.5x — nearest cluster auto-expands
8. Zoom out below 1x — all clusters auto-collapse
9. Hover a node — label appears on tooltip
10. Click a node — inspector shows detail
11. Thermal shader visible through transparent graph background
12. Theme switch updates graph colors
13. New memories from SSE appear in graph
