# Signal Cockpit UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Signal overlay, sonar waveform, and inspector dream surface to the ForgeFrame Cockpit — making the dream engine visible and steerable without breaking the graph-first identity.

**Architecture:** Single-file modification to `cockpit/web/index.html`. Four new code sections: sonar waveform renderer (canvas), signal overlay (DOM), inspector dream surface (DOM), and SSE event handlers. All use the existing `el()` helper, `api()` fetch wrapper, `state` object, and CSS custom property theme system. No new files, no build step, no dependencies.

**Tech Stack:** Vanilla JS, Canvas 2D (sonar), CSS custom properties, existing Hono HTTP API endpoints, SSE EventSource

**Spec:** `docs/superpowers/specs/2026-04-14-signal-cockpit-ui-design.md`

---

## Phase Map

```
PHASE 1: Foundation (state + CSS + DOM skeleton)     SEQUENTIAL
  Task 1: State extensions + new CSS                 --- foundation
  Task 2: DOM skeleton (overlay + sonar canvas)      --- depends on 1

PHASE 2: Sonar Waveform                              SEQUENTIAL
  Task 3: Sonar renderer (canvas, 3 dimensions)      --- depends on 2
  Task 4: Wire sonar to API data                     --- depends on 3

PHASE 3: Signal Overlay                              SEQUENTIAL
  Task 5: Overlay shell + open/close animation       --- depends on 2
  Task 6: Journal headline + "what changed" section  --- depends on 5
  Task 7: Dream seed card + grading interaction      --- depends on 5
  Task 8: Tension card + hindsight card              --- depends on 5
  Task 9: Graph health + calibration + silence + drift --- depends on 5

PHASE 4: Inspector Dream Surface                     AFTER Phase 3
  Task 10: Inspector idle state with dream surface   --- depends on 6

PHASE 5: SSE + Polish                                AFTER Phase 4
  Task 11: SSE event handlers for dream events       --- depends on all
  Task 12: Keyboard shortcuts + reduced motion       --- depends on all
```

---

### Task 1: State extensions + new CSS

**Files:**
- Modify: `cockpit/web/index.html` (state object ~line 784, CSS section ~line 10-710)

Add Signal-related state properties and all new CSS rules. This is the foundation — everything else references these.

- [ ] **Step 1: Add Signal state properties**

Find the `var state = {` block (line 784) and add these properties before the closing `};`:

```javascript
    // Signal state
    signalOverlayOpen: false,
    sleepPressure: 0,
    sleepPressureComponents: null,
    latestJournal: null,
    pendingSeeds: [],
    pendingHindsight: [],
    tensions: [],
    silence: [],
    drift: [],
    pinnedTensions: JSON.parse(localStorage.getItem('ff-pinned-tensions') || '[]'),
    sonarPhase: 0,
```

- [ ] **Step 2: Add Signal CSS**

Add the following CSS block before the closing `</style>` tag (after the existing `.feed-strength` rule around line 709):

```css
  /* ===== SIGNAL OVERLAY ===== */
  .signal-overlay {
    position: fixed;
    bottom: 0; left: 0; right: 0; top: 15vh;
    background: var(--panel);
    backdrop-filter: blur(60px) saturate(1.6);
    -webkit-backdrop-filter: blur(60px) saturate(1.6);
    border-top: 1px solid var(--border);
    border-radius: 24px 24px 0 0;
    box-shadow: 0 -20px 80px rgba(0,0,0,0.15), 0 1px 0 rgba(255,255,255,0.06) inset;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 500;
    transform: translateY(100%);
    opacity: 0;
    transition: transform 0.8s cubic-bezier(0.16,1,0.3,1), opacity 0.4s ease;
    pointer-events: none;
  }
  .signal-overlay.open {
    transform: translateY(0);
    opacity: 1;
    pointer-events: auto;
  }
  .signal-overlay-handle {
    display: flex; justify-content: center; padding: 12px 0 8px; flex-shrink: 0; cursor: grab;
  }
  .signal-overlay-handle-bar {
    width: 36px; height: 4px; border-radius: 2px; background: var(--t5);
  }
  .signal-overlay-header {
    padding: 0 40px 20px; flex-shrink: 0;
  }
  .signal-label {
    font-size: 10px; font-weight: 500; letter-spacing: 2.5px; text-transform: uppercase;
    color: var(--sage-dim); margin-bottom: 16px; font-family: var(--font-mono);
  }
  .journal-headline {
    font-size: 22px; font-weight: 200; line-height: 1.5; color: var(--t1);
    letter-spacing: 0.01em; max-width: 640px;
  }
  .journal-headline em { font-style: normal; color: var(--gold); }
  .journal-time {
    font-size: 11px; font-family: var(--font-mono); font-weight: 300;
    color: var(--t4); margin-top: 16px;
  }
  .signal-overlay-body {
    padding: 0 40px; overflow-y: auto; flex: 1;
    mask-image: linear-gradient(to bottom, black 90%, transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, black 90%, transparent 100%);
  }
  .signal-section {
    padding: 28px 0; border-top: 1px solid var(--t6);
  }
  .signal-section-label {
    font-size: 9px; font-weight: 500; letter-spacing: 2px; text-transform: uppercase;
    color: var(--t4); margin-bottom: 14px; font-family: var(--font-mono);
  }
  .signal-change-list { list-style: none; padding: 0; }
  .signal-change-list li {
    font-size: 13px; font-weight: 300; color: var(--t2); line-height: 1.7;
    padding-left: 16px; position: relative;
  }
  .signal-change-list li::before {
    content: ''; position: absolute; left: 0; top: 10px;
    width: 4px; height: 4px; border-radius: 50%; background: var(--sage-dim);
  }

  /* Seed card */
  .seed-card {
    background: rgba(var(--ink-rgb, 0,0,0), 0.03); border: 1px solid var(--t6);
    border-radius: 16px; padding: 24px; display: flex; gap: 24px; align-items: stretch;
    cursor: pointer; transition: all 0.4s cubic-bezier(0.16,1,0.3,1);
  }
  .seed-card:hover { background: rgba(var(--ink-rgb, 0,0,0), 0.05); border-color: var(--border-hover); transform: translateY(-1px); }
  .seed-memory {
    flex: 1; padding: 16px; background: rgba(var(--ink-rgb, 0,0,0), 0.02);
    border-radius: 10px; border: 1px solid var(--t6);
  }
  .seed-memory-tag {
    font-size: 9px; font-weight: 500; letter-spacing: 1.5px; text-transform: uppercase;
    color: var(--sage-dim); margin-bottom: 8px; font-family: var(--font-mono);
  }
  .seed-memory-content { font-size: 13px; font-weight: 300; color: var(--t2); line-height: 1.6; }
  .seed-bridge {
    display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 32px;
  }
  .seed-bridge-line {
    width: 1px; height: 100%; position: relative;
    background: linear-gradient(to bottom, transparent 0%, var(--gold-dim) 30%, var(--gold-dim) 70%, transparent 100%);
  }
  .seed-bridge-dot {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
    width: 6px; height: 6px; border-radius: 50%; background: var(--gold-dim);
    box-shadow: 0 0 12px var(--gold-bg);
  }
  .seed-prompt { font-size: 13px; font-weight: 300; color: var(--t3); margin-top: 16px; font-style: italic; }
  .seed-thread-input {
    width: 100%; border: none; border-bottom: 1px solid var(--t5); background: transparent;
    font-family: var(--font-ui); font-size: 13px; font-weight: 300; color: var(--t1);
    padding: 8px 0; margin-top: 12px; outline: none;
    max-height: 0; overflow: hidden; opacity: 0;
    transition: max-height 0.4s cubic-bezier(0.16,1,0.3,1), opacity 0.3s, margin 0.3s;
  }
  .seed-thread-input.visible { max-height: 40px; opacity: 1; }

  /* Grade buttons */
  .grade-btns { display: flex; gap: 8px; margin-top: 16px; }
  .grade-btn {
    padding: 8px 20px; border-radius: 20px; border: 1px solid var(--t5);
    background: transparent; color: var(--t3); font-size: 12px; font-weight: 400;
    font-family: var(--font-ui); cursor: pointer; transition: all 0.3s; letter-spacing: 0.5px;
  }
  .grade-btn:hover { background: var(--t6); color: var(--t1); border-color: var(--border-hover); }
  .grade-btn.fire:hover { border-color: var(--sage-dim); color: var(--sage); }
  .grade-btn.miss:hover { border-color: var(--danger-dim); color: var(--danger); }
  .grade-btn.confirm { border-color: var(--danger-dim); color: var(--danger); }

  /* Tension card */
  .tension-card {
    background: var(--terra-dim, rgba(176,125,80,0.04)); border: 1px solid rgba(176,125,80,0.1);
    border-radius: 16px; padding: 24px; position: relative;
  }
  .tension-pair { display: flex; gap: 16px; align-items: center; margin-bottom: 12px; }
  .tension-memory { font-size: 13px; font-weight: 300; color: var(--t2); flex: 1; }
  .tension-vs {
    font-size: 10px; font-weight: 500; letter-spacing: 2px; color: var(--terra-dim);
    font-family: var(--font-mono); flex-shrink: 0;
  }
  .tension-note { font-size: 12px; font-weight: 300; color: var(--t3); line-height: 1.6; font-style: italic; }
  .tension-actions {
    position: absolute; top: 12px; right: 12px; display: flex; gap: 8px;
  }
  .tension-action-btn {
    width: 24px; height: 24px; border-radius: 12px; border: 1px solid var(--t6);
    background: transparent; color: var(--t4); font-size: 11px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; transition: all 0.3s;
  }
  .tension-action-btn:hover { border-color: var(--border-hover); color: var(--t2); }

  /* Hindsight card */
  .hindsight-card {
    background: var(--panel); border: 1px solid var(--t6);
    border-radius: 16px; padding: 24px;
  }
  .hindsight-memory { font-size: 14px; font-weight: 300; color: var(--t1); line-height: 1.6; margin-bottom: 8px; }
  .hindsight-stat {
    font-size: 11px; font-family: var(--font-mono); font-weight: 300; color: var(--t4); margin-bottom: 12px;
  }
  .hindsight-question { font-size: 13px; font-weight: 300; color: var(--t3); font-style: italic; margin-bottom: 16px; }
  .hindsight-nuance-input {
    width: 100%; border: none; border-bottom: 1px solid var(--t5); background: transparent;
    font-family: var(--font-ui); font-size: 13px; font-weight: 300; color: var(--t1);
    padding: 8px 0; margin-top: 12px; outline: none;
    max-height: 0; overflow: hidden; opacity: 0;
    transition: max-height 0.4s cubic-bezier(0.16,1,0.3,1), opacity 0.3s;
  }
  .hindsight-nuance-input.visible { max-height: 40px; opacity: 1; }

  /* Graph health */
  .graph-health { display: flex; gap: 32px; padding: 20px 0; }
  .health-stat { display: flex; flex-direction: column; gap: 4px; }
  .health-value { font-size: 18px; font-weight: 200; color: var(--t2); font-family: var(--font-mono); }
  .health-label {
    font-size: 9px; font-weight: 500; letter-spacing: 1.5px; text-transform: uppercase;
    color: var(--t4); font-family: var(--font-mono);
  }

  /* Calibration bars */
  .calibration-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
  .calibration-source { font-size: 12px; font-family: var(--font-mono); font-weight: 400; color: var(--t3); min-width: 120px; }
  .calibration-bar-track { flex: 1; height: 3px; background: var(--t6); border-radius: 2px; max-width: 200px; }
  .calibration-bar-fill { height: 100%; border-radius: 2px; background: var(--sage-dim); transition: width 1s cubic-bezier(0.16,1,0.3,1); }
  .calibration-pct { font-size: 11px; font-family: var(--font-mono); font-weight: 300; color: var(--t4); min-width: 36px; text-align: right; }

  /* Silence + drift entries */
  .silence-entry, .drift-entry {
    font-size: 13px; font-weight: 300; color: var(--t2); line-height: 1.7;
    padding-left: 16px; position: relative;
  }
  .silence-entry::before, .drift-entry::before {
    content: ''; position: absolute; left: 0; top: 10px;
    width: 4px; height: 4px; border-radius: 50%;
  }
  .silence-entry::before { background: var(--t4); }
  .drift-entry::before { background: var(--gold-dim); }
  .drift-arrow { font-family: var(--font-mono); font-weight: 400; }

  /* Sonar waveform */
  .sonar-wrap {
    display: flex; align-items: center; cursor: pointer; padding: 0 8px;
    transition: opacity 0.3s;
  }
  .sonar-wrap:hover { opacity: 0.8; }
  .sonar-canvas-small { width: 120px; height: 32px; }
  .sonar-canvas-large { width: 300px; height: 80px; }

  /* Inspector dream surface */
  .inspector-dream { padding: 16px; }
  .inspector-dream-oneliner {
    font-size: 13px; font-weight: 300; color: var(--t2); line-height: 1.6;
    cursor: pointer; margin-bottom: 16px;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .inspector-dream-oneliner:hover { color: var(--t1); }
  .inspector-dream-health { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
  .inspector-dream-stat { display: flex; flex-direction: column; gap: 2px; }
  .inspector-dream-stat-value { font-size: 14px; font-weight: 200; color: var(--t2); font-family: var(--font-mono); }
  .inspector-dream-stat-label {
    font-size: 8px; font-weight: 500; letter-spacing: 1.5px; text-transform: uppercase;
    color: var(--t4); font-family: var(--font-mono);
  }
  .pinned-tension {
    padding: 12px; background: var(--t6); border-radius: 10px; margin-bottom: 8px;
    font-size: 12px; font-weight: 300; color: var(--t2); line-height: 1.5; position: relative;
  }
  .pinned-tension-dismiss {
    position: absolute; top: 8px; right: 8px; width: 16px; height: 16px;
    border: none; background: transparent; color: var(--t4); cursor: pointer; font-size: 10px;
  }

  /* Overlay dimmer */
  .signal-dimmer {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.3); z-index: 499;
    opacity: 0; pointer-events: none; transition: opacity 0.4s;
  }
  .signal-dimmer.open { opacity: 1; pointer-events: auto; }

  @media (prefers-reduced-motion: reduce) {
    .signal-overlay { transition: none; }
    .seed-thread-input, .hindsight-nuance-input { transition: none; }
    .calibration-bar-fill { transition: none; }
  }
```

- [ ] **Step 3: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add Signal UI state properties and CSS foundation"
```

---

### Task 2: DOM skeleton (overlay + sonar canvas)

**Files:**
- Modify: `cockpit/web/index.html` (HTML body ~line 712-737)

Add the overlay container, dimmer, and sonar canvas elements to the HTML.

- [ ] **Step 1: Add DOM elements**

Find the `<footer class="statusbar" id="statusbar"></footer>` line (around line 736) and add the following BEFORE the `</div>` that closes `.cockpit`:

```html
  <div class="signal-dimmer" id="signal-dimmer"></div>
  <div class="signal-overlay" id="signal-overlay"></div>
```

- [ ] **Step 2: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add Signal overlay and dimmer DOM elements"
```

---

### Task 3: Sonar waveform renderer

**Files:**
- Modify: `cockpit/web/index.html` (new JS section before `// ===== STATUSBAR =====` around line 1906)

Build the canvas-based oscilloscope renderer with 3 dimensions (color, amplitude, frequency).

- [ ] **Step 1: Add sonar renderer**

Insert this new section before `// ===== STATUSBAR =====`:

```javascript
  // ===== SONAR WAVEFORM =====
  function drawSonar(canvas, guardianTemp, guardianState, pressure, time) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var w = canvas.width;
    var h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Dimension 1: Color from Guardian state (sage -> gold -> terra)
    var r, g, b;
    if (guardianTemp < 0.3) {
      // calm: sage
      var t = guardianTemp / 0.3;
      r = Math.round(138 + t * (184 - 138));
      g = Math.round(171 + t * (150 - 171));
      b = Math.round(127 + t * (90 - 127));
    } else if (guardianTemp < 0.6) {
      // warm: gold
      var t2 = (guardianTemp - 0.3) / 0.3;
      r = Math.round(184 + t2 * (196 - 184));
      g = Math.round(150 + t2 * (149 - 150));
      b = Math.round(90 + t2 * (106 - 90));
    } else {
      // trapped: terra
      r = 196; g = 149; b = 106;
    }

    // Dimension 2: Amplitude from sleep pressure (0-100 mapped to 15%-90% of height)
    var normalizedPressure = Math.min(1, Math.max(0, pressure / 80));
    var amplitude = (0.15 + normalizedPressure * 0.75) * (h / 2);

    // Dimension 3: Frequency from urgency (calm=0.5Hz, warm=2Hz, trapped=4Hz)
    var freq;
    if (guardianTemp < 0.3) freq = 0.5 + guardianTemp * 3;
    else if (guardianTemp < 0.6) freq = 1.5 + (guardianTemp - 0.3) * 5;
    else freq = 3 + (guardianTemp - 0.6) * 5;

    // Draw waveform
    var lineWidth = canvas === document.getElementById('sonar-large') ? 2 : 1.5;
    ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.7)';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Glow layer
    ctx.save();
    ctx.shadowColor = 'rgba(' + r + ',' + g + ',' + b + ',0.3)';
    ctx.shadowBlur = 8;

    ctx.beginPath();
    var midY = h / 2;
    var phase = time * freq * 0.003;

    for (var x = 0; x < w; x++) {
      var t3 = x / w;
      // Envelope: fade edges for organic feel
      var envelope = Math.sin(t3 * Math.PI);
      // Primary wave + harmonic for organic shape
      var y = midY + amplitude * envelope * (
        Math.sin(phase + t3 * Math.PI * 4) * 0.7 +
        Math.sin(phase * 1.3 + t3 * Math.PI * 7) * 0.2 +
        Math.sin(phase * 0.7 + t3 * Math.PI * 2) * 0.1
      );
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  var sonarSmallCanvas = null;
  var sonarLargeCanvas = null;

  function initSonarSmall() {
    var existing = document.getElementById('sonar-small');
    if (existing) existing.remove();
    var c = document.createElement('canvas');
    c.id = 'sonar-small';
    c.className = 'sonar-canvas-small';
    c.width = 240; c.height = 64; // 2x for retina
    sonarSmallCanvas = c;
    return c;
  }

  function initSonarLarge() {
    var existing = document.getElementById('sonar-large');
    if (existing) existing.remove();
    var c = document.createElement('canvas');
    c.id = 'sonar-large';
    c.className = 'sonar-canvas-large';
    c.width = 600; c.height = 160; // 2x for retina
    sonarLargeCanvas = c;
    return c;
  }
```

- [ ] **Step 2: Wire sonar into the main loop**

Find the `mainLoop` function (around line 2222) and add sonar drawing:

```javascript
  function mainLoop(time) {
    drawThermal(time);
    simulateForces();
    drawGraph();
    if (sonarSmallCanvas) drawSonar(sonarSmallCanvas, state.guardianTemp, state.guardianState, state.sleepPressure, time);
    if (sonarLargeCanvas && state.signalOverlayOpen) drawSonar(sonarLargeCanvas, state.guardianTemp, state.guardianState, state.sleepPressure, time);
    requestAnimationFrame(mainLoop);
  }
```

- [ ] **Step 3: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add sonar waveform canvas renderer with 3 dimensions"
```

---

### Task 4: Wire sonar to status bar and API data

**Files:**
- Modify: `cockpit/web/index.html` (renderStatusbar ~line 1907, boot/data loading ~line 2165)

Add the sonar waveform to the status bar and load sleep pressure data.

- [ ] **Step 1: Add sonar to status bar**

In `renderStatusbar()`, after the Guardian status section (after `sb.appendChild(sg);` around line 1934), add:

```javascript
    // Sonar waveform — right-anchored
    var sonarWrap = el('div', { className: 'sonar-wrap' });
    var sonarCanvas = initSonarSmall();
    sonarWrap.appendChild(sonarCanvas);
    sonarWrap.addEventListener('click', function() { openSignalOverlay(); });
    sb.appendChild(sonarWrap);
```

- [ ] **Step 2: Add sleep pressure loader**

After the `loadArtifacts` function (around line 2219), add:

```javascript
  function loadSleepPressure() {
    return api('/api/dream/pressure').then(function(data) {
      state.sleepPressure = data.score || 0;
      state.sleepPressureComponents = data.components || null;
    }).catch(function() {});
  }
```

- [ ] **Step 3: Wire into boot sequence**

In the `boot()` function, update the `Promise.all` line to include pressure loading:

```javascript
    Promise.all([loadGraph(), loadStatus(), loadGuardian(), loadArtifacts(), loadSleepPressure()]).then(function() {
```

- [ ] **Step 4: Commit**

```bash
git add cockpit/web/index.html
git commit -m "wire sonar waveform to status bar and sleep pressure API"
```

---

### Task 5: Overlay shell + open/close

**Files:**
- Modify: `cockpit/web/index.html` (new JS section after sonar code)

Build the overlay open/close mechanism with animation and data fetching.

- [ ] **Step 1: Add overlay open/close functions**

Insert after the sonar section:

```javascript
  // ===== SIGNAL OVERLAY =====
  function openSignalOverlay() {
    state.signalOverlayOpen = true;
    document.getElementById('signal-dimmer').classList.add('open');
    document.getElementById('signal-overlay').classList.add('open');
    loadSignalData();
  }

  function closeSignalOverlay() {
    state.signalOverlayOpen = false;
    document.getElementById('signal-dimmer').classList.remove('open');
    document.getElementById('signal-overlay').classList.remove('open');
  }

  function loadSignalData() {
    Promise.all([
      api('/api/dream/journal/latest').catch(function() { return null; }),
      api('/api/dream/seeds/pending').catch(function() { return []; }),
      api('/api/dream/hindsight/pending').catch(function() { return []; }),
      api('/api/dream/tensions').catch(function() { return []; }),
      api('/api/dream/pressure').catch(function() { return { score: 0 }; }),
    ]).then(function(results) {
      state.latestJournal = results[0];
      state.pendingSeeds = Array.isArray(results[1]) ? results[1] : [];
      state.pendingHindsight = Array.isArray(results[2]) ? results[2] : [];
      state.tensions = Array.isArray(results[3]) ? results[3] : [];
      state.sleepPressure = results[4].score || 0;
      state.sleepPressureComponents = results[4].components || null;
      renderSignalOverlay();
    });
  }
```

- [ ] **Step 2: Add dimmer click + Escape handlers**

In the existing `document.addEventListener('keydown', ...)` handler (around line 2010), inside the `if (e.key === 'Escape')` block, add:

```javascript
      if (state.signalOverlayOpen) closeSignalOverlay();
```

After the existing `document.addEventListener('click', ...)` for context menu (around line 2023), add:

```javascript
  document.getElementById('signal-dimmer').addEventListener('click', function() {
    closeSignalOverlay();
  });
```

- [ ] **Step 3: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add Signal overlay open/close with data fetching"
```

---

### Task 6: Journal headline + "what changed" section

**Files:**
- Modify: `cockpit/web/index.html` (continue building renderSignalOverlay)

- [ ] **Step 1: Implement renderSignalOverlay**

Add after the overlay open/close functions:

```javascript
  function renderSignalOverlay() {
    var overlay = document.getElementById('signal-overlay');
    clearEl(overlay);

    // Handle
    var handle = el('div', { className: 'signal-overlay-handle' });
    handle.appendChild(el('div', { className: 'signal-overlay-handle-bar' }));
    overlay.appendChild(handle);

    // Header
    var header = el('div', { className: 'signal-overlay-header' });

    // Label + large sonar
    var headerRow = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } });
    headerRow.appendChild(el('div', { className: 'signal-label', textContent: 'signal' }));
    var largeSonar = initSonarLarge();
    headerRow.appendChild(largeSonar);
    header.appendChild(headerRow);

    // Journal headline
    if (state.latestJournal && state.latestJournal.content) {
      var headlineText = extractJournalHeadline(state.latestJournal.content);
      var headline = el('div', { className: 'journal-headline' });
      headline.textContent = headlineText;
      header.appendChild(headline);

      // Timestamp
      var timeStr = new Date(state.latestJournal.createdAt).toLocaleString();
      header.appendChild(el('div', { className: 'journal-time', textContent: timeStr }));
    } else {
      var headline2 = el('div', { className: 'journal-headline' });
      headline2.textContent = 'No dream cycles yet. The system will dream when sleep pressure builds.';
      header.appendChild(headline2);
    }

    overlay.appendChild(header);

    // Body (scrollable sections)
    var body = el('div', { className: 'signal-overlay-body' });

    // Section: What changed
    if (state.latestJournal) {
      var changesSection = buildChangesSection(state.latestJournal.content);
      if (changesSection) body.appendChild(changesSection);
    }

    // Section: Dream seed
    if (state.pendingSeeds.length > 0) {
      body.appendChild(buildSeedSection(state.pendingSeeds[0]));
    }

    // Section: Tension
    if (state.tensions.length > 0) {
      for (var ti = 0; ti < Math.min(state.tensions.length, 3); ti++) {
        body.appendChild(buildTensionSection(state.tensions[ti]));
      }
    }

    // Section: Hindsight
    if (state.pendingHindsight.length > 0) {
      body.appendChild(buildHindsightSection(state.pendingHindsight[0]));
    }

    // Section: Graph health
    body.appendChild(buildGraphHealthSection());

    overlay.appendChild(body);
  }

  function extractJournalHeadline(content) {
    // Extract the first meaningful paragraph after frontmatter
    var lines = content.split('\n');
    var pastFrontmatter = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line === '---') { pastFrontmatter = !pastFrontmatter; continue; }
      if (pastFrontmatter || !line.startsWith('---')) {
        if (line && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('|')) {
          return line;
        }
      }
    }
    return 'Dream cycle completed. Open to review.';
  }

  function buildChangesSection(content) {
    var section = el('div', { className: 'signal-section' });
    section.appendChild(el('div', { className: 'signal-section-label', textContent: 'what changed' }));

    var list = el('ul', { className: 'signal-change-list' });
    var lines = content.split('\n');
    var inChanges = false;
    var count = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line === '## What changed') { inChanges = true; continue; }
      if (line.startsWith('## ') && inChanges) break;
      if (inChanges && line.startsWith('- ')) {
        list.appendChild(el('li', { textContent: line.slice(2) }));
        count++;
      }
    }

    if (count === 0) return null;
    section.appendChild(list);
    return section;
  }
```

- [ ] **Step 2: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add Signal overlay journal headline and changes section"
```

---

### Task 7: Dream seed card + grading

**Files:**
- Modify: `cockpit/web/index.html` (add buildSeedSection function)

- [ ] **Step 1: Implement seed card builder**

Add after `buildChangesSection`:

```javascript
  function buildSeedSection(seed) {
    var section = el('div', { className: 'signal-section' });
    section.appendChild(el('div', { className: 'signal-section-label', textContent: 'two memories that have never met' }));

    var card = el('div', { className: 'seed-card' });

    // Memory A
    var memA = seed.memories[0];
    var memAEl = el('div', { className: 'seed-memory' });
    var aTag = (memA.tags && memA.tags[0] ? memA.tags[0] : 'memory');
    var aDays = Math.floor((Date.now() - memA.createdAt) / 86400000);
    var aTimeLabel = aDays < 7 ? aDays + ' days ago' : Math.floor(aDays / 7) + ' weeks ago';
    memAEl.appendChild(el('div', { className: 'seed-memory-tag', textContent: aTag + ' / ' + aTimeLabel }));
    memAEl.appendChild(el('div', { className: 'seed-memory-content', textContent: truncate(memA.content, 120) }));
    card.appendChild(memAEl);

    // Bridge
    var bridge = el('div', { className: 'seed-bridge' });
    var bridgeLine = el('div', { className: 'seed-bridge-line' });
    bridgeLine.appendChild(el('div', { className: 'seed-bridge-dot' }));
    bridge.appendChild(bridgeLine);
    card.appendChild(bridge);

    // Memory B
    var memB = seed.memories[1];
    var memBEl = el('div', { className: 'seed-memory' });
    var bTag = (memB.tags && memB.tags[0] ? memB.tags[0] : 'memory');
    var bDays = Math.floor((Date.now() - memB.createdAt) / 86400000);
    var bTimeLabel = bDays < 7 ? bDays + ' days ago' : Math.floor(bDays / 7) + ' weeks ago';
    memBEl.appendChild(el('div', { className: 'seed-memory-tag', textContent: bTag + ' / ' + bTimeLabel }));
    memBEl.appendChild(el('div', { className: 'seed-memory-content', textContent: truncate(memB.content, 120) }));
    card.appendChild(memBEl);

    section.appendChild(card);

    // Prompt
    section.appendChild(el('div', { className: 'seed-prompt', textContent: 'do these know each other?' }));

    // Thread input (hidden, blooms on "real")
    var threadInput = el('input', {
      className: 'seed-thread-input',
      type: 'text',
      placeholder: 'what\'s the thread?',
    });
    section.appendChild(threadInput);

    // Grade buttons
    var grades = el('div', { className: 'grade-btns' });

    var fireBtn = el('button', { className: 'grade-btn fire', textContent: 'real' });
    fireBtn.addEventListener('click', function() {
      threadInput.classList.add('visible');
      setTimeout(function() { threadInput.focus(); }, 100);
      // Submit on enter or on blur
      var submitted = false;
      function submit() {
        if (submitted) return;
        submitted = true;
        gradeSeed(seed, 'fire', threadInput.value || null);
        section.style.opacity = '0.4';
        section.style.pointerEvents = 'none';
      }
      threadInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') submit(); });
      threadInput.addEventListener('blur', function() { setTimeout(submit, 200); });
    });
    grades.appendChild(fireBtn);

    var mehBtn = el('button', { className: 'grade-btn', textContent: 'meh' });
    mehBtn.addEventListener('click', function() {
      gradeSeed(seed, 'shrug', null);
      section.style.opacity = '0.4';
      section.style.pointerEvents = 'none';
    });
    grades.appendChild(mehBtn);

    var missBtn = el('button', { className: 'grade-btn miss', textContent: 'nothing' });
    missBtn.addEventListener('click', function() {
      gradeSeed(seed, 'miss', null);
      section.style.opacity = '0.4';
      section.style.pointerEvents = 'none';
    });
    grades.appendChild(missBtn);

    section.appendChild(grades);
    return section;
  }

  function gradeSeed(seed, grade, thread) {
    var body = {
      grade: grade,
      seedMemoryIds: seed.memories.map(function(m) { return m.id; }),
    };
    if (thread) body.thread = thread;
    api('/api/dream/seeds/' + seed.id + '/grade', {
      method: 'POST',
      body: JSON.stringify(body),
    }).catch(function() {});
  }
```

- [ ] **Step 2: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add dream seed card with grading interaction"
```

---

### Task 8: Tension card + hindsight card

**Files:**
- Modify: `cockpit/web/index.html` (add buildTensionSection and buildHindsightSection)

- [ ] **Step 1: Implement tension card builder**

```javascript
  function buildTensionSection(tension) {
    var section = el('div', { className: 'signal-section' });
    section.appendChild(el('div', { className: 'signal-section-label', textContent: 'productive tension' }));

    var card = el('div', { className: 'tension-card' });

    // Pin + dismiss buttons
    var actions = el('div', { className: 'tension-actions' });

    var pinBtn = el('button', { className: 'tension-action-btn', textContent: '\u25C9' });
    pinBtn.setAttribute('title', 'pin');
    pinBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      pinTension(tension);
      pinBtn.style.color = 'var(--gold)';
    });
    actions.appendChild(pinBtn);

    var dismissBtn = el('button', { className: 'tension-action-btn', textContent: '\u00d7' });
    dismissBtn.setAttribute('title', 'dismiss');
    dismissBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      section.style.opacity = '0';
      setTimeout(function() { section.remove(); }, 300);
    });
    actions.appendChild(dismissBtn);

    card.appendChild(actions);

    // Tension pair
    var pair = el('div', { className: 'tension-pair' });
    pair.appendChild(el('div', { className: 'tension-memory', textContent: '"' + truncate(tension.memoryAContent || '', 80) + '"' }));
    pair.appendChild(el('div', { className: 'tension-vs', textContent: '\u2194' }));
    pair.appendChild(el('div', { className: 'tension-memory', textContent: '"' + truncate(tension.memoryBContent || '', 80) + '"' }));
    card.appendChild(pair);

    // Note placeholder
    card.appendChild(el('div', { className: 'tension-note', textContent: 'Both strongly held. Neither is wrong.' }));

    section.appendChild(card);
    return section;
  }

  function pinTension(tension) {
    var pinned = state.pinnedTensions;
    var key = tension.memoryAId + ':' + tension.memoryBId;
    if (!pinned.some(function(p) { return p.key === key; })) {
      pinned.push({
        key: key,
        memoryA: tension.memoryAContent || '',
        memoryB: tension.memoryBContent || '',
        pinnedAt: Date.now(),
        note: '',
      });
      localStorage.setItem('ff-pinned-tensions', JSON.stringify(pinned));
    }
  }
```

- [ ] **Step 2: Implement hindsight card builder**

```javascript
  function buildHindsightSection(candidate) {
    var section = el('div', { className: 'signal-section' });
    section.appendChild(el('div', { className: 'signal-section-label', textContent: 'does this still feel true?' }));

    var card = el('div', { className: 'hindsight-card' });
    card.appendChild(el('div', { className: 'hindsight-memory', textContent: '"' + truncate(candidate.content || '', 120) + '"' }));

    var statParts = [];
    if (candidate.edgeCount) statParts.push('reinforced ' + candidate.edgeCount + 'x');
    if (candidate.scrutinyScore) statParts.push('scrutiny ' + candidate.scrutinyScore.toFixed(2));
    if (candidate.valence) statParts.push(candidate.valence);
    card.appendChild(el('div', { className: 'hindsight-stat', textContent: statParts.join(' \u00b7 ') }));

    card.appendChild(el('div', { className: 'hindsight-question', textContent: 'does this still feel true?' }));

    // Nuance input (hidden)
    var nuanceInput = el('input', {
      className: 'hindsight-nuance-input',
      type: 'text',
      placeholder: 'add nuance...',
    });
    card.appendChild(nuanceInput);

    // Action buttons
    var actions = el('div', { className: 'grade-btns' });

    var keepBtn = el('button', { className: 'grade-btn', textContent: 'keep' });
    keepBtn.addEventListener('click', function() {
      respondHindsight(candidate.memoryId, 'keep', null);
      section.style.opacity = '0.4';
      section.style.pointerEvents = 'none';
    });
    actions.appendChild(keepBtn);

    var nuanceBtn = el('button', { className: 'grade-btn', textContent: 'add nuance' });
    nuanceBtn.addEventListener('click', function() {
      nuanceInput.classList.add('visible');
      setTimeout(function() { nuanceInput.focus(); }, 100);
      nuanceInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && nuanceInput.value) {
          respondHindsight(candidate.memoryId, 'revise', nuanceInput.value);
          section.style.opacity = '0.4';
          section.style.pointerEvents = 'none';
        }
      });
    });
    actions.appendChild(nuanceBtn);

    var weakenBtn = el('button', { className: 'grade-btn miss', textContent: 'weaken' });
    var weakenConfirmed = false;
    weakenBtn.addEventListener('click', function() {
      if (!weakenConfirmed) {
        weakenConfirmed = true;
        weakenBtn.textContent = 'confirm weaken';
        weakenBtn.classList.add('confirm');
        return;
      }
      respondHindsight(candidate.memoryId, 'weaken', null);
      section.style.opacity = '0.4';
      section.style.pointerEvents = 'none';
    });
    actions.appendChild(weakenBtn);

    card.appendChild(actions);
    section.appendChild(card);
    return section;
  }

  function respondHindsight(memoryId, response, revisedContent) {
    var body = { response: response };
    if (revisedContent) body.revisedContent = revisedContent;
    api('/api/dream/hindsight/' + memoryId + '/respond', {
      method: 'POST',
      body: JSON.stringify(body),
    }).catch(function() {});
  }
```

- [ ] **Step 3: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add tension and hindsight cards with interaction handlers"
```

---

### Task 9: Graph health + calibration + silence + drift

**Files:**
- Modify: `cockpit/web/index.html` (add buildGraphHealthSection)

- [ ] **Step 1: Implement graph health section**

```javascript
  function buildGraphHealthSection() {
    var section = el('div', { className: 'signal-section' });
    section.appendChild(el('div', { className: 'signal-section-label', textContent: 'graph health' }));

    var health = el('div', { className: 'graph-health' });
    var stats = [
      { value: state.memoryCount, label: 'memories' },
      { value: state.edgeCount.toLocaleString(), label: 'edges' },
      { value: state.avgStrength.toFixed(2), label: 'avg weight' },
    ];
    for (var si = 0; si < stats.length; si++) {
      var stat = el('div', { className: 'health-stat' });
      stat.appendChild(el('div', { className: 'health-value', textContent: String(stats[si].value) }));
      stat.appendChild(el('div', { className: 'health-label', textContent: stats[si].label }));
      health.appendChild(stat);
    }
    section.appendChild(health);

    // Source calibration (parsed from journal content)
    if (state.latestJournal && state.latestJournal.content) {
      var calEntries = parseJournalSection(state.latestJournal.content, 'Source calibration');
      if (calEntries.length > 0) {
        section.appendChild(el('div', { className: 'signal-section-label', style: { marginTop: '16px' }, textContent: 'source calibration' }));
        for (var ci = 0; ci < calEntries.length; ci++) {
          var parts = calEntries[ci].match(/^(.+?):\s*(\d+)\/(\d+)\s+survived\s+\((\d+)%\)/);
          if (parts) {
            var row = el('div', { className: 'calibration-row' });
            row.appendChild(el('div', { className: 'calibration-source', textContent: parts[1] }));
            var track = el('div', { className: 'calibration-bar-track' });
            var fill = el('div', { className: 'calibration-bar-fill' });
            fill.style.width = parts[4] + '%';
            if (parseInt(parts[4]) > 60) fill.style.background = 'var(--gold-dim)';
            track.appendChild(fill);
            row.appendChild(track);
            row.appendChild(el('div', { className: 'calibration-pct', textContent: parts[4] + '%' }));
            section.appendChild(row);
          }
        }
      }

      // Silence
      var silenceEntries = parseJournalSection(state.latestJournal.content, 'Gone quiet');
      if (silenceEntries.length > 0) {
        section.appendChild(el('div', { className: 'signal-section-label', style: { marginTop: '16px' }, textContent: 'gone quiet' }));
        for (var qi = 0; qi < silenceEntries.length; qi++) {
          section.appendChild(el('div', { className: 'silence-entry', textContent: silenceEntries[qi] }));
        }
      }

      // Drift
      var driftEntries = parseJournalSection(state.latestJournal.content, 'Drift');
      if (driftEntries.length > 0) {
        section.appendChild(el('div', { className: 'signal-section-label', style: { marginTop: '16px' }, textContent: 'drift' }));
        for (var di = 0; di < driftEntries.length; di++) {
          section.appendChild(el('div', { className: 'drift-entry', textContent: driftEntries[di] }));
        }
      }
    }

    return section;
  }

  function parseJournalSection(content, sectionName) {
    var lines = content.split('\n');
    var entries = [];
    var inSection = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line === '## ' + sectionName) { inSection = true; continue; }
      if (line.startsWith('## ') && inSection) break;
      if (inSection && line.startsWith('- ')) {
        entries.push(line.slice(2));
      }
    }
    return entries;
  }
```

- [ ] **Step 2: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add graph health, calibration, silence, and drift sections"
```

---

### Task 10: Inspector dream surface

**Files:**
- Modify: `cockpit/web/index.html` (modify renderInspector function ~line 1384)

- [ ] **Step 1: Add dream surface to inspector idle state**

In `renderInspector()`, find the block that handles `!state.selectedMemory` (around line 1416). Replace the empty-state content:

```javascript
    if (!state.selectedMemory) {
      // Dream surface — ambient awareness when nothing is selected
      var dream = el('div', { className: 'inspector-dream' });

      // Sonar echo (small waveform)
      var sonarEcho = el('div', { className: 'sonar-wrap', style: { marginBottom: '16px', padding: '0' } });
      var echoCanvas = document.createElement('canvas');
      echoCanvas.width = 200; echoCanvas.height = 48;
      echoCanvas.style.width = '100px'; echoCanvas.style.height = '24px';
      sonarEcho.appendChild(echoCanvas);
      sonarEcho.addEventListener('click', function() { openSignalOverlay(); });
      dream.appendChild(sonarEcho);

      // One-liner from latest journal
      if (state.latestJournal && state.latestJournal.content) {
        var oneliner = el('div', { className: 'inspector-dream-oneliner' });
        oneliner.textContent = extractJournalHeadline(state.latestJournal.content);
        oneliner.addEventListener('click', function() { openSignalOverlay(); });
        dream.appendChild(oneliner);
      }

      // Graph health compact
      var healthRow = el('div', { className: 'inspector-dream-health' });
      var compactStats = [
        { v: state.memoryCount, l: 'memories' },
        { v: state.edgeCount, l: 'edges' },
        { v: state.avgStrength.toFixed(2), l: 'avg wt' },
      ];
      for (var hsi = 0; hsi < compactStats.length; hsi++) {
        var hs = el('div', { className: 'inspector-dream-stat' });
        hs.appendChild(el('div', { className: 'inspector-dream-stat-value', textContent: String(compactStats[hsi].v) }));
        hs.appendChild(el('div', { className: 'inspector-dream-stat-label', textContent: compactStats[hsi].l }));
        healthRow.appendChild(hs);
      }
      dream.appendChild(healthRow);

      // Pinned tensions
      if (state.pinnedTensions.length > 0) {
        dream.appendChild(el('div', { className: 'signal-section-label', textContent: 'pinned tensions' }));
        for (var pti = 0; pti < state.pinnedTensions.length; pti++) {
          (function(pt, idx) {
            var ptCard = el('div', { className: 'pinned-tension' });
            ptCard.textContent = '"' + truncate(pt.memoryA, 40) + '" \u2194 "' + truncate(pt.memoryB, 40) + '"';
            var dismissPt = el('button', { className: 'pinned-tension-dismiss', textContent: '\u00d7' });
            dismissPt.addEventListener('click', function(e) {
              e.stopPropagation();
              state.pinnedTensions.splice(idx, 1);
              localStorage.setItem('ff-pinned-tensions', JSON.stringify(state.pinnedTensions));
              renderInspector();
            });
            ptCard.appendChild(dismissPt);
            dream.appendChild(ptCard);
          })(state.pinnedTensions[pti], pti);
        }
      }

      scroll.appendChild(dream);
      panel.appendChild(scroll);
      renderArtifactsZone(panel);
      return;
    }
```

- [ ] **Step 2: Load latest journal on boot**

After the `loadSleepPressure` function, add:

```javascript
  function loadLatestJournal() {
    return api('/api/dream/journal/latest').then(function(data) {
      state.latestJournal = data;
    }).catch(function() {});
  }
```

Update the boot `Promise.all` to include it:

```javascript
    Promise.all([loadGraph(), loadStatus(), loadGuardian(), loadArtifacts(), loadSleepPressure(), loadLatestJournal()]).then(function() {
```

- [ ] **Step 3: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add inspector dream surface with ambient awareness"
```

---

### Task 11: SSE event handlers for dream events

**Files:**
- Modify: `cockpit/web/index.html` (SSE section ~line 2038)

- [ ] **Step 1: Add dream SSE handlers**

In the `connectSSE()` function, after the existing `guardian:update` handler (around line 2131), add:

```javascript
    es.addEventListener('dream:journal:written', function(e) {
      try {
        var data = JSON.parse(e.data);
        // Refresh journal and pressure data
        loadLatestJournal().then(function() {
          renderInspector();
        });
        loadSleepPressure();
      } catch(err) { /* ignore */ }
    });

    es.addEventListener('dream:nrem:complete', function(e) {
      try {
        loadSleepPressure();
        loadLatestJournal().then(function() { renderInspector(); });
      } catch(err) { /* ignore */ }
    });

    es.addEventListener('dream:rem:complete', function(e) {
      try {
        loadSleepPressure();
        loadLatestJournal().then(function() { renderInspector(); });
      } catch(err) { /* ignore */ }
    });

    es.addEventListener('dream:seed:graded', function(e) {
      try {
        // Reload seeds if overlay is open
        if (state.signalOverlayOpen) loadSignalData();
      } catch(err) { /* ignore */ }
    });

    es.addEventListener('guardian:sleep_pressure', function(e) {
      try {
        var data = JSON.parse(e.data);
        if (data.score !== undefined) state.sleepPressure = data.score;
        if (data.components) state.sleepPressureComponents = data.components;
      } catch(err) { /* ignore */ }
    });

    es.addEventListener('valence:classified', function(e) {
      try {
        var data = JSON.parse(e.data);
        var existing = state.nodeMap.get(data.memoryId);
        if (existing) existing.valence = data.valence;
      } catch(err) { /* ignore */ }
    });
```

- [ ] **Step 2: Commit**

```bash
git add cockpit/web/index.html
git commit -m "add SSE handlers for dream lifecycle events"
```

---

### Task 12: Keyboard shortcuts + reduced motion + final polish

**Files:**
- Modify: `cockpit/web/index.html`

- [ ] **Step 1: Add keyboard shortcut for Signal overlay**

In the existing `keydown` handler (around line 1998), add a shortcut for the Signal overlay:

```javascript
    // Cmd+Shift+S to toggle Signal overlay
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 's') {
      e.preventDefault();
      if (state.signalOverlayOpen) closeSignalOverlay();
      else openSignalOverlay();
    }
```

- [ ] **Step 2: Add reduced motion check to sonar**

At the top of the `drawSonar` function, add:

```javascript
    // Respect reduced motion preference
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      // Draw static waveform at current state
      // (skip animation phase, use fixed phase = 0)
      time = 0;
    }
```

- [ ] **Step 3: Final commit**

```bash
git add cockpit/web/index.html
git commit -m "add keyboard shortcuts and reduced motion support for Signal UI"
```

---

## Verification

After all tasks are complete:

1. Run `npm run build` — all 4 packages must compile clean
2. Run `npx vitest run` — all tests must pass (568+)
3. Start the server: `node packages/server/dist/daemon.js`
4. Open Cockpit in browser at `http://localhost:3001`
5. Verify:
   - Sonar waveform animates in status bar (right side)
   - Click sonar opens Signal overlay with glass animation
   - Escape or click outside dismisses overlay
   - Inspector shows dream surface when no node selected
   - Selecting a node switches inspector to Memory/Edges/History
   - Deselecting returns to dream surface
   - If dream data exists: journal headline, seed card, tension card visible
   - Seed grading: "real" blooms text field, "meh"/"nothing" fade the card
   - Hindsight: "weaken" requires confirm tap
   - Tension: pin/dismiss buttons work
   - Theme switching preserves all Signal UI styling
   - Cmd+Shift+S toggles overlay
