# Wave B: Cockpit Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete all remaining Cockpit features: context menu, settings panel, inline editor, artifact state machine UI, and mobile responsive layout.

**Architecture:** All modifications to `cockpit/web/index.html`. Each task adds a self-contained feature section. No new server-side code — all APIs already exist.

**Tech Stack:** Vanilla JS, CSS custom properties, Cytoscape.js (context menu via popper), contenteditable (editor)

**Spec:** `docs/superpowers/specs/2026-04-14-final-sprint-design.md` — Wave B section

**Depends on:** Wave A (Cytoscape.js must be integrated first for context menu positioning)

---

## Phase Map

```
PHASE 1: Interaction                    SEQUENTIAL
  Task 1: Context menu (right-click)    --- depends on Cytoscape
  Task 2: Settings panel extension      --- independent

PHASE 2: Editor                         SEQUENTIAL
  Task 3: Inspector inline editor       --- depends on context menu
  Task 4: Deep edit overlay             --- depends on inline editor

PHASE 3: Completion                     PARALLEL
  Task 5: Artifact state machine UI     --- independent
  Task 6: Mobile responsive layout      --- independent
```

---

### Task 1: Context menu

**Files:**
- Modify: `cockpit/web/index.html`

Right-click or long-press a node shows a floating context menu. Uses Cytoscape's `cxttap` event + DOM menu positioned via `cytoscape-popper`.

- [ ] **Step 1: Add context menu CSS**

Add in the CSS section:

```css
  .node-ctx-menu {
    position: fixed; z-index: 600;
    background: var(--panel-solid);
    backdrop-filter: blur(40px) saturate(1.5);
    -webkit-backdrop-filter: blur(40px) saturate(1.5);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 1px 0 rgba(255,255,255,0.4) inset;
    padding: 4px 0; min-width: 140px;
    opacity: 0; pointer-events: none;
    transition: opacity 0.15s;
  }
  .node-ctx-menu.visible { opacity: 1; pointer-events: auto; }
  .node-ctx-item {
    padding: 6px 16px; font-size: 12px; font-weight: 400; color: var(--t1);
    cursor: pointer; font-family: var(--font-ui); transition: background 0.15s;
  }
  .node-ctx-item:hover { background: var(--t6); }
  .node-ctx-sep { height: 1px; background: var(--t6); margin: 4px 0; }
```

- [ ] **Step 2: Add context menu DOM element**

In HTML body, after the existing `<div class="ctx-menu" id="ctx-menu"></div>`:

```html
    <div class="node-ctx-menu" id="node-ctx-menu"></div>
```

- [ ] **Step 3: Add context menu JS**

After the Cytoscape init section:

```javascript
  // ===== NODE CONTEXT MENU =====
  var nodeCtxTarget = null;

  function showNodeCtxMenu(nodeId, x, y) {
    nodeCtxTarget = nodeId;
    var menu = document.getElementById('node-ctx-menu');
    clearEl(menu);

    var items = [
      { label: 'Open', action: 'open' },
      { label: 'Edit', action: 'edit' },
      { label: 'Link', action: 'link' },
      { sep: true },
      { label: 'Promote', action: 'promote' },
      { label: 'Tag', action: 'tag' },
    ];

    for (var i = 0; i < items.length; i++) {
      if (items[i].sep) {
        menu.appendChild(el('div', { className: 'node-ctx-sep' }));
        continue;
      }
      (function(item) {
        var row = el('div', { className: 'node-ctx-item', textContent: item.label });
        row.addEventListener('click', function() {
          handleNodeCtxAction(item.action, nodeCtxTarget);
          hideNodeCtxMenu();
        });
        menu.appendChild(row);
      })(items[i]);
    }

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.add('visible');
  }

  function hideNodeCtxMenu() {
    document.getElementById('node-ctx-menu').classList.remove('visible');
    nodeCtxTarget = null;
  }

  function handleNodeCtxAction(action, nodeId) {
    if (!nodeId) return;
    if (action === 'open') {
      selectNode(nodeId);
    } else if (action === 'edit') {
      selectNode(nodeId);
      setTimeout(function() { startInlineEdit(); }, 100);
    } else if (action === 'link') {
      startLinkMode(nodeId);
    } else if (action === 'promote') {
      api('/api/memories/' + nodeId + '/promote', { method: 'POST' }).then(function() {
        var node = state.nodeMap.get(nodeId);
        if (node) node.memoryType = 'artifact';
        if (cy) {
          var cyNode = cy.getElementById(nodeId);
          if (cyNode.length) cyNode.data('memoryType', 'artifact');
        }
      }).catch(function() {});
    } else if (action === 'tag') {
      selectNode(nodeId);
      // Tag editing handled in inspector
    }
  }

  var linkModeSource = null;

  function startLinkMode(sourceId) {
    linkModeSource = sourceId;
    if (cy) {
      cy.nodes().style('opacity', 0.4);
      var source = cy.getElementById(sourceId);
      if (source.length) source.style('opacity', 1);
    }
    showBanner('Click another node to create a link. Escape to cancel.');
  }

  function endLinkMode() {
    linkModeSource = null;
    if (cy) cy.nodes().removeStyle('opacity');
    hideBanner();
  }

  // Wire into Cytoscape (add in initCytoscape after existing event handlers):
  // cy.on('cxttap', 'node', function(evt) { ... });
  // This must be added inside initCytoscape, after the cy = cytoscape(...) call.
```

- [ ] **Step 4: Wire context menu into initCytoscape**

In `initCytoscape`, after the existing `cy.on('tap', ...)` handlers, add:

```javascript
    // Right-click context menu
    cy.on('cxttap', 'node', function(evt) {
      var node = evt.target;
      if (node.isParent()) return;
      evt.originalEvent.preventDefault();
      var pos = evt.renderedPosition || evt.position;
      var rect = cy.container().getBoundingClientRect();
      showNodeCtxMenu(node.id(), rect.left + pos.x, rect.top + pos.y);
    });

    // Link mode: click target node
    cy.on('tap', 'node', function(evt) {
      if (!linkModeSource) return;
      var target = evt.target;
      if (target.isParent()) return;
      if (target.id() === linkModeSource) return;
      api('/api/memories/' + linkModeSource + '/edges', {
        method: 'POST',
        body: JSON.stringify({ targetId: target.id(), relationType: 'related' }),
      }).catch(function() {});
      endLinkMode();
    });
```

Add Escape handler for link mode in the existing keydown listener:

```javascript
      if (e.key === 'Escape' && linkModeSource) { endLinkMode(); return; }
```

Add click-outside dismiss:

```javascript
  document.addEventListener('click', function(e) {
    var menu = document.getElementById('node-ctx-menu');
    if (menu && !menu.contains(e.target)) hideNodeCtxMenu();
  });
```

- [ ] **Step 5: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add node context menu with open, edit, link, promote, tag"
```

---

### Task 2: Settings panel extension

**Files:**
- Modify: `cockpit/web/index.html`

Extend the existing settings overlay with font size, reduced motion, graph density, Guardian sensitivity.

- [ ] **Step 1: Add settings state**

In the `state` object, add:

```javascript
    fontSize: parseFloat(localStorage.getItem('ff-font-size') || '1'),
    reducedMotion: localStorage.getItem('ff-reduced-motion') === 'true',
    graphDensity: localStorage.getItem('ff-graph-density') || 'standard',
    guardianSensitivity: parseFloat(localStorage.getItem('ff-guardian-sensitivity') || '1'),
```

- [ ] **Step 2: Extend showSettings function**

In the existing `showSettings()` function, after the theme swatches section, add new sections for each setting. The full implementation should add slider inputs for font size (0.8-1.2), a checkbox for reduced motion, a 3-option toggle for graph density (minimal/standard/dense), and a slider for Guardian sensitivity (0.5-2.0).

Each setting saves to localStorage on change and applies immediately:
- Font size: sets `document.documentElement.style.fontSize = (size * 100) + '%'`
- Reduced motion: toggles a `data-reduced-motion` attribute on `<html>`
- Graph density: filters edges in Cytoscape by weight threshold (minimal: > 0.5, standard: > 0.1, dense: all)
- Guardian sensitivity: stored for use by Guardian temperature computation

- [ ] **Step 3: Apply settings on boot**

In the `boot()` function, apply stored settings:

```javascript
    if (state.fontSize !== 1) document.documentElement.style.fontSize = (state.fontSize * 100) + '%';
    if (state.reducedMotion) document.documentElement.setAttribute('data-reduced-motion', 'true');
```

- [ ] **Step 4: Commit**

```bash
git add cockpit/web/index.html
git commit -m "extend settings panel with font size, motion, density, sensitivity"
```

---

### Task 3: Inspector inline editor

**Files:**
- Modify: `cockpit/web/index.html`

Double-click memory content or Cmd+E toggles the inspector into edit mode.

- [ ] **Step 1: Add editor state and CSS**

State:

```javascript
    editingMemoryId: null,
```

CSS:

```css
  .inspector-editing {
    border-bottom: 2px solid var(--gold);
  }
  .mem-detail-content[contenteditable="true"] {
    outline: none;
    cursor: text;
    border-bottom: 1px solid var(--gold-dim);
    padding-bottom: 8px;
    min-height: 60px;
  }
  .edit-indicator {
    font-size: 9px; font-weight: 500; letter-spacing: 2px; text-transform: uppercase;
    color: var(--gold-dim); font-family: var(--font-mono); margin-bottom: 8px;
  }
```

- [ ] **Step 2: Add editor functions**

```javascript
  function startInlineEdit() {
    if (!state.selectedMemory) return;
    state.editingMemoryId = state.selectedMemory.id;
    renderInspector();
    // After render, focus the contenteditable
    var editable = document.querySelector('.mem-detail-content[contenteditable]');
    if (editable) {
      editable.focus();
      // Move cursor to end
      var range = document.createRange();
      range.selectNodeContents(editable);
      range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function saveInlineEdit() {
    if (!state.editingMemoryId) return;
    var editable = document.querySelector('.mem-detail-content[contenteditable]');
    if (!editable) return;
    var newContent = editable.textContent || '';
    var originalContent = (state.selectedMemory && state.selectedMemory.content) || '';
    if (newContent === originalContent) {
      cancelInlineEdit();
      return;
    }
    api('/api/memories/' + state.editingMemoryId, {
      method: 'PUT',
      body: JSON.stringify({ content: newContent }),
    }).then(function() {
      var mem = state.nodeMap.get(state.editingMemoryId);
      if (mem) mem.content = newContent;
      if (state.selectedMemory) state.selectedMemory.content = newContent;
      state.editingMemoryId = null;
      renderInspector();
    }).catch(function() {
      state.editingMemoryId = null;
      renderInspector();
    });
  }

  function cancelInlineEdit() {
    state.editingMemoryId = null;
    renderInspector();
  }
```

- [ ] **Step 3: Modify renderInspector for edit mode**

In `renderInspector`, in the `state.inspectorTab === 'memory'` block, check if editing. If `state.editingMemoryId === mem.id`, render the content div with `contenteditable="true"` and add an "editing" indicator. Add keydown handler for Cmd+S (save) and Escape (cancel), and blur handler (auto-save).

- [ ] **Step 4: Add Cmd+E shortcut**

In the keydown handler:

```javascript
    if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
      e.preventDefault();
      if (state.editingMemoryId) saveInlineEdit();
      else startInlineEdit();
    }
```

- [ ] **Step 5: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add inspector inline memory editor with Cmd+E"
```

---

### Task 4: Deep edit overlay

**Files:**
- Modify: `cockpit/web/index.html`

Cmd+Shift+E opens a centered overlay with a larger textarea for deep rewrites.

- [ ] **Step 1: Add overlay CSS**

```css
  .edit-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.4); z-index: 550;
    display: flex; align-items: center; justify-content: center;
    opacity: 0; pointer-events: none; transition: opacity 0.2s;
  }
  .edit-overlay.open { opacity: 1; pointer-events: auto; }
  .edit-overlay-card {
    background: var(--panel-solid); border: 1px solid var(--border);
    border-radius: 16px; padding: 32px; width: 90%; max-width: 640px;
    box-shadow: 0 16px 64px rgba(0,0,0,0.2);
  }
  .edit-overlay-textarea {
    width: 100%; min-height: 300px; border: none; background: transparent;
    font-family: var(--font-mono); font-size: 13px; font-weight: 300;
    color: var(--t1); line-height: 1.7; resize: vertical; outline: none;
  }
  .edit-overlay-footer {
    display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;
  }
```

- [ ] **Step 2: Add overlay DOM**

```html
<div class="edit-overlay" id="edit-overlay"></div>
```

- [ ] **Step 3: Add Cmd+Shift+E handler**

```javascript
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'e') {
      e.preventDefault();
      openDeepEditor();
    }
```

Implement `openDeepEditor()` and `closeDeepEditor()` functions that build the textarea overlay, populate with current memory content, and save via API on confirm.

- [ ] **Step 4: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add deep edit overlay for full memory rewrites"
```

---

### Task 5: Artifact state machine UI

**Files:**
- Modify: `cockpit/web/index.html`

In the inspector, when a memory is an artifact, show the state machine progress bar.

- [ ] **Step 1: Add artifact CSS**

```css
  .artifact-pipeline {
    display: flex; align-items: center; gap: 8px; padding: 12px 0;
    border-top: 1px solid var(--t6); margin-top: 12px;
  }
  .artifact-dot {
    width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid var(--t4);
    transition: all 0.3s;
  }
  .artifact-dot.active { background: var(--sage); border-color: var(--sage); }
  .artifact-dot.trapped { background: var(--danger); border-color: var(--danger); animation: artifact-pulse 2s ease-in-out infinite; }
  .artifact-line { flex: 1; height: 1px; background: var(--t5); }
  .artifact-label { font-size: 8px; font-weight: 500; letter-spacing: 1.5px; text-transform: uppercase; color: var(--t4); font-family: var(--font-mono); }
  @keyframes artifact-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
```

- [ ] **Step 2: Add artifact pipeline to inspector**

In `renderInspector`, in the memory tab section, after the metadata display, check if `mem.memoryType === 'artifact'`. If so, render the pipeline:

```javascript
      if (mem.memoryType === 'artifact') {
        var pipeline = el('div', { className: 'artifact-pipeline' });
        var readiness = mem.readiness || 0;
        var shipped = mem.metadata && mem.metadata.shipped;
        var states = ['draft', 'ready', 'shipped'];
        var currentIdx = shipped ? 2 : (readiness >= 0.8 ? 1 : 0);

        for (var ai = 0; ai < states.length; ai++) {
          if (ai > 0) pipeline.appendChild(el('div', { className: 'artifact-line' }));
          var dot = el('div', { className: 'artifact-dot' + (ai <= currentIdx ? ' active' : '') });
          pipeline.appendChild(dot);
        }
        detail.appendChild(pipeline);

        var readinessLabel = el('div', { className: 'artifact-label', textContent: states[currentIdx] + ' \u00b7 ' + Math.round(readiness * 100) + '% ready' });
        detail.appendChild(readinessLabel);

        if (currentIdx === 1 && !shipped) {
          var shipBtn = el('button', { className: 'grade-btn fire', textContent: 'ship', style: { marginTop: '8px' } });
          shipBtn.addEventListener('click', function() {
            api('/api/memories/' + mem.id + '/ship', { method: 'POST' }).then(function() {
              var m = state.nodeMap.get(mem.id);
              if (m) { m.metadata = m.metadata || {}; m.metadata.shipped = true; }
              renderInspector();
            }).catch(function() {});
          });
          detail.appendChild(shipBtn);
        }
      }
```

- [ ] **Step 3: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add artifact state machine pipeline to inspector"
```

---

### Task 6: Mobile responsive layout

**Files:**
- Modify: `cockpit/web/index.html`

Add responsive breakpoints for tablet and mobile.

- [ ] **Step 1: Add responsive CSS**

```css
  /* Tablet: sidebar collapses to icon strip */
  @media (max-width: 1024px) {
    .cockpit { grid-template-columns: 48px 1fr 280px; }
    .sidebar { padding: 12px 8px; overflow: hidden; }
    .brand { display: none; }
    .nav-label { display: none; }
    .nav-item { justify-content: center; padding: 8px; }
    .nav-item span, .nav-count { display: none; }
    .agent-strip, .guardian-strip, .settings-btn { display: none; }
  }

  /* Mobile: single column, bottom tab bar */
  @media (max-width: 768px) {
    .cockpit {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr 48px;
      grid-template-areas: 'main' 'status';
    }
    .sidebar { display: none; }
    .inspector {
      position: fixed; bottom: 0; left: 0; right: 0; top: auto;
      max-height: 60vh; border-radius: 16px 16px 0 0;
      transform: translateY(100%); transition: transform 0.4s cubic-bezier(0.16,1,0.3,1);
      z-index: 400;
    }
    .inspector.mobile-open { transform: translateY(0); }
    .main-area { grid-area: main; }
    .statusbar { grid-area: status; }
    .signal-overlay { top: 5vh; }
    .signal-overlay-header { padding: 0 20px 16px; }
    .signal-overlay-body { padding: 0 20px; }
    .journal-headline { font-size: 18px; }
    .seed-card { flex-direction: column; }
    .seed-bridge { width: 100%; height: 32px; flex-direction: row; }
    .seed-bridge-line { width: 100%; height: 1px; }
    .tension-pair { flex-direction: column; }
  }
```

- [ ] **Step 2: Add mobile inspector toggle**

On mobile, tapping a node should open the inspector as a bottom sheet:

```javascript
  function openMobileInspector() {
    document.getElementById('inspector').classList.add('mobile-open');
  }

  function closeMobileInspector() {
    document.getElementById('inspector').classList.remove('mobile-open');
  }
```

Wire into `selectNode`: if viewport width < 768, call `openMobileInspector()` when a node is selected, `closeMobileInspector()` when deselected.

- [ ] **Step 3: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add mobile responsive layout with bottom sheet inspector"
```

---

## Verification

1. Right-click a node → context menu appears with Open/Edit/Link/Promote/Tag
2. Settings (Cmd+,) → font size slider works, reduced motion checkbox works
3. Select node → Cmd+E → content becomes editable → Cmd+S saves → Escape cancels
4. Cmd+Shift+E → full overlay editor opens
5. Artifact memories show draft/ready/shipped pipeline in inspector
6. Resize to <768px → single column, inspector slides up from bottom
7. Resize to 768-1024px → sidebar collapses to icons
