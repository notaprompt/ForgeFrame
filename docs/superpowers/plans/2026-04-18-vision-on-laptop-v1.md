# Vision-on-Laptop-v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instantiate Vision — a proto-aware personal cognitive OS meeting the four Golem Criteria operationally — on the founder's M5 Pro 48GB laptop, fully, with the Strange Loop Test runnable as final acceptance.

**Architecture:** ForgeFrame substrate (`@forgeframe/memory`, `@forgeframe/core`, `@forgeframe/server`, `@forgeframe/proxy`) + Distillery intake (`/Users/acamp/distillery/`) + Qwen3:32B base + LoRA-trained `vision-qwen-v1` + SAE audit harness + orchestrator loop + Feed Tab instrument panel + multimodal skills + HDC organ + Urbit-inspired sovereignty primitives. Constitutional tether via LoRA weights, Guardian as presence, cross-provider routing with per-query sovereignty gates.

**Tech Stack:** Python 3.12+, Node 20+, TypeScript 5+, Swift (voice widget), Ollama (Qwen3:32B, Qwen2.5-VL, nomic-embed-text, Qwen3.5:27B, llama3.2:1b, distill), MLX (LoRA fine-tune), SAELens (interpretability), Torchhd (HDC), Whisper medium.en (ASR), Kokoros (TTS), Flask (Distillery), Hono (ForgeFrame server), Cytoscape.js (Cockpit), SSE, launchd, ntfy.sh, `claude -p` CLI (Max subscription), SQLite + FTS5 + Ollama embeddings.

**Spec:** `/Users/acamp/.claude/personas/notepad/2026-04-18-vision-diffusion-all-hands.md` (team meeting, this session) and `/Users/acamp/CLAUDE.md` (project principles).

**Depends on:** Dirty branches cleaned or accepted (`feat/hebbian-engine` on ForgeFrame, `main` on distillery), Ollama daemon running, `@forgeframe/server` daemon running on :3001, Distillery running on :3456.

---

## Phase Map

```
PHASE 0: Stabilize                       SEQUENTIAL (gate)
  Task 0.1: TikTok extractor quarantine + retry envelope
  Task 0.2: Lens-bucketing NULL regression fix
  Task 0.3: Redistill 45 pre-upgrade items
  Task 0.4: Worker log rotation + heartbeat probe
  Task 0.5: Pin ForgeFrame Hebbian branch or revert

PHASE 1: Instruments (Feed Tab + push)   PRIORITY — felt moment
PHASE 2: Heartbeat (orchestrator)        depends on Phase 1 events surface
PHASE 3: Self-model primitive            parallel with Phase 2
PHASE 4: Cross-provider routing          depends on Phase 2 router bus
PHASE 5: Intake widening                 parallel with Phases 2-4
PHASE 6: Multimodal skill refactor       depends on Phase 5 intake types
PHASE 7: HDC organ                       parallel with Phase 6
PHASE 8: Constitutional LoRA             depends on Phase 5 (data volume)
PHASE 9: SAE + Strange Loop Test         depends on Phase 8
PHASE 10: World-scanner agent            depends on Phase 6 (multimodal intake)
PHASE 11: Sovereignty layer              parallel with Phase 10
PHASE 12: Acceptance                     final gate
```

---

## Phase 0 — Stabilize current substrate

The goal of Phase 0 is: nothing is silently broken when we start adding. All existing services either run cleanly or are explicitly quarantined.

### Task 0.1: Quarantine the TikTok extractor and add retry envelope

**Files:**
- Modify: `/Users/acamp/distillery/extractor.py`
- Create: `/Users/acamp/distillery/tests/test_extractor_retry.py`

- [ ] **Step 1: Write a failing test for retry envelope**

Create `/Users/acamp/distillery/tests/test_extractor_retry.py`:

```python
import pytest
from unittest.mock import patch, MagicMock
from extractor import extract_with_retry, ExtractionError

def test_tiktok_flaky_url_retries_three_times_then_quarantines():
    url = "https://www.tiktok.com/@foo/video/123"
    with patch("extractor._yt_dlp_extract") as m:
        m.side_effect = Exception("HTTP Error 403")
        with pytest.raises(ExtractionError) as exc:
            extract_with_retry(url, max_attempts=3)
        assert m.call_count == 3
        assert exc.value.quarantined is True
        assert exc.value.source == "tiktok"

def test_non_flaky_url_passes_through():
    url = "https://www.youtube.com/watch?v=abc"
    with patch("extractor._yt_dlp_extract") as m:
        m.return_value = {"title": "ok", "text": "content"}
        result = extract_with_retry(url, max_attempts=3)
        assert result["title"] == "ok"
        assert m.call_count == 1
```

Run to verify it fails:

```bash
cd /Users/acamp/distillery && python -m pytest tests/test_extractor_retry.py -xvs
```

Expected output: `AttributeError: module 'extractor' has no attribute 'extract_with_retry'` or `ImportError`.

- [ ] **Step 2: Implement retry envelope in extractor**

Add to `/Users/acamp/distillery/extractor.py`:

```python
class ExtractionError(Exception):
    def __init__(self, msg, quarantined=False, source=None):
        super().__init__(msg)
        self.quarantined = quarantined
        self.source = source

def _source_of(url: str) -> str:
    if "tiktok.com" in url: return "tiktok"
    if "youtube.com" in url or "youtu.be" in url: return "youtube"
    if "x.com" in url or "twitter.com" in url: return "twitter"
    return "generic"

def extract_with_retry(url: str, max_attempts: int = 3):
    import time
    last_err = None
    for attempt in range(max_attempts):
        try:
            return _yt_dlp_extract(url)
        except Exception as e:
            last_err = e
            time.sleep(2 ** attempt)  # 1, 2, 4 sec backoff
    raise ExtractionError(
        f"Extraction failed after {max_attempts}: {last_err}",
        quarantined=True,
        source=_source_of(url),
    )
```

- [ ] **Step 3: Wire extract_with_retry into worker.py call-site**

In `/Users/acamp/distillery/worker.py`, find the existing `extractor.extract(url)` call and replace with `extractor.extract_with_retry(url, max_attempts=3)`. On `ExtractionError`, write `status='quarantined'` into the `items` table rather than blowing up.

- [ ] **Step 4: Verify and commit**

```bash
cd /Users/acamp/distillery && python -m pytest tests/test_extractor_retry.py -xvs
```

Expected: `2 passed`.

```bash
cd /Users/acamp/distillery && git add extractor.py worker.py tests/test_extractor_retry.py && git commit -m "distillery: add retry envelope, quarantine flaky extractions"
```

---

### Task 0.2: Fix lens-bucketing NULL regression

**Files:**
- Modify: `/Users/acamp/distillery/lens.py`
- Modify: `/Users/acamp/distillery/meta.py`
- Create: `/Users/acamp/distillery/tests/test_lens_bucketing.py`

- [ ] **Step 1: Reproduce with failing test**

Create `/Users/acamp/distillery/tests/test_lens_bucketing.py`:

```python
from meta import apply_meta_pass

def test_meta_pass_fills_target_project_urgency_memory_id():
    sample = {
        "id": "distill_test_1",
        "lens_output": {"kind": "technical", "summary": "fix for orchestrator wiring"},
        "raw_text": "we should wire triggers into daemon startup",
    }
    result = apply_meta_pass(sample)
    assert result["target_project"] is not None
    assert result["urgency"] in {"low", "medium", "high"}
    assert result["forgeframe_memory_id"] is not None
```

```bash
cd /Users/acamp/distillery && python -m pytest tests/test_lens_bucketing.py -xvs
```

Expected: fails (the three fields are returning NULL).

- [ ] **Step 2: Locate regression in meta.py**

The regression was introduced when content-first lens was added but bucketing stayed pointed at the old `lens_output.tags` shape. Open `/Users/acamp/distillery/meta.py`. Find the function applying the meta pass and ensure `target_project`, `urgency`, `forgeframe_memory_id` are derived from `lens_output.kind` + `raw_text` + a `memory_save` call to `http://localhost:3001/api/tools/memory_save`.

Replace the broken block with:

```python
def apply_meta_pass(item):
    kind = item["lens_output"].get("kind", "unknown")
    summary = item["lens_output"].get("summary", "")
    target_project = _infer_project(summary, item["raw_text"])
    urgency = _infer_urgency(summary, item["raw_text"])
    memory_id = _save_to_forgeframe(summary, item["raw_text"], kind, target_project)
    item["target_project"] = target_project
    item["urgency"] = urgency
    item["forgeframe_memory_id"] = memory_id
    return item
```

Define `_infer_project`, `_infer_urgency`, `_save_to_forgeframe` with the old logic recovered from `git log --all -p -S "target_project" -- meta.py | head -200`.

- [ ] **Step 3: Verify and commit**

```bash
cd /Users/acamp/distillery && python -m pytest tests/test_lens_bucketing.py -xvs
```

Expected: `1 passed`.

```bash
cd /Users/acamp/distillery && git add meta.py lens.py tests/test_lens_bucketing.py && git commit -m "distillery: restore target_project/urgency/memory_id bucketing"
```

---

### Task 0.3: Redistill the 45 pre-upgrade items

**Files:**
- Use existing: `/Users/acamp/distillery/redistill.py`

- [ ] **Step 1: Dry-run**

```bash
cd /Users/acamp/distillery && python redistill.py --dry-run --where "forgeframe_memory_id IS NULL"
```

Expected: prints 45 ids.

- [ ] **Step 2: Execute**

```bash
cd /Users/acamp/distillery && python redistill.py --where "forgeframe_memory_id IS NULL" --batch 5
```

Expected: 45 items redistilled, each with all three fields populated. Takes ~20 min (Opus meta pass dominates).

- [ ] **Step 3: Verify**

```bash
sqlite3 /Users/acamp/distillery/distillery.db "SELECT COUNT(*) FROM items WHERE forgeframe_memory_id IS NULL AND status='distilled'"
```

Expected: `0`.

---

### Task 0.4: Worker log rotation + heartbeat probe

**Files:**
- Modify: `/Users/acamp/distillery/worker.py`
- Modify: `/Users/acamp/distillery/server.py`

- [ ] **Step 1: Add logging handler with rotation**

At top of `/Users/acamp/distillery/worker.py`:

```python
import logging
from logging.handlers import RotatingFileHandler
handler = RotatingFileHandler("/Users/acamp/distillery/worker.log", maxBytes=10_000_000, backupCount=3)
handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logging.getLogger().addHandler(handler)
logging.getLogger().setLevel(logging.INFO)
```

- [ ] **Step 2: Add heartbeat endpoint**

In `/Users/acamp/distillery/server.py`, add:

```python
@app.route("/heartbeat")
def heartbeat():
    import time, os
    last_log_mtime = os.path.getmtime("/Users/acamp/distillery/worker.log")
    return {"ok": True, "last_worker_log": last_log_mtime, "now": time.time()}
```

- [ ] **Step 3: Verify**

```bash
curl -s http://localhost:3456/heartbeat | jq
```

Expected: JSON with `ok: true`, `last_worker_log` and `now` as epoch seconds; `now - last_worker_log < 300`.

- [ ] **Step 4: Commit**

```bash
cd /Users/acamp/distillery && git add worker.py server.py && git commit -m "distillery: log rotation + /heartbeat probe"
```

---

### Task 0.5: Pin ForgeFrame Hebbian branch or accept dirty state

**Files:**
- Inspect: `/Users/acamp/repos/ForgeFrame/`

- [ ] **Step 1: Check test suite passes on `feat/hebbian-engine`**

```bash
cd /Users/acamp/repos/ForgeFrame && npm test 2>&1 | tail -20
```

Expected: `576 passed` or close; if failures, triage before any Vision work begins.

- [ ] **Step 2: If green, commit WIP**

```bash
cd /Users/acamp/repos/ForgeFrame && git add -A && git commit -m "wip: Cytoscape graph work-in-progress checkpoint"
```

Phase 0 exit gate: `npm test` green in ForgeFrame, `pytest` green in distillery, `/heartbeat` returns fresh, 0 NULL-bucketed items.

---

## Phase 1 — Instruments (Feed Tab + push alerts + observability)

Build the felt-moment surface first. Vision must be visible breathing before we add more limbs.

### Task 1.1: Feed Tab shell in Cockpit

**Files:**
- Modify: `/Users/acamp/repos/ForgeFrame/cockpit/web/index.html`
- Create: `/Users/acamp/repos/ForgeFrame/cockpit/web/feed.js`

- [ ] **Step 1: Add Feed Tab pane and tab button**

In `cockpit/web/index.html`, find the existing tab strip and add:

```html
<button class="tab-btn" data-pane="feed">Feed</button>
<section class="pane" id="pane-feed" hidden>
  <div id="feed-stream" class="feed-stream"></div>
</section>
```

- [ ] **Step 2: Feed renderer (no innerHTML — use safe DOM methods)**

Create `/Users/acamp/repos/ForgeFrame/cockpit/web/feed.js`:

```javascript
const feed = document.getElementById("feed-stream");
const es = new EventSource("/api/events");

for (const kind of ["heartbeat","memory_save","distillery_intake","dream_cycle","guardian_alert"]) {
  es.addEventListener(kind, e => render(kind, JSON.parse(e.data)));
}

function render(kind, payload) {
  const row = document.createElement("div");
  row.className = `feed-row feed-${kind}`;

  const ts = document.createElement("span");
  ts.className = "feed-ts";
  ts.textContent = new Date().toLocaleTimeString();

  const kindEl = document.createElement("span");
  kindEl.className = "feed-kind";
  kindEl.textContent = kind;

  const body = document.createElement("span");
  body.className = "feed-body";
  body.textContent = typeof payload.summary === "string"
    ? payload.summary
    : JSON.stringify(payload);

  row.appendChild(ts);
  row.appendChild(kindEl);
  row.appendChild(body);

  feed.prepend(row);
  while (feed.childElementCount > 500) feed.lastElementChild.remove();
}
```

Include it in `index.html`: `<script src="feed.js" defer></script>`.

- [ ] **Step 3: Verify**

Open `http://localhost:3001/cockpit` (or wherever Cockpit is served), click Feed tab. Expected: empty stream until events fire. Then fire a test:

```bash
curl -X POST http://localhost:3001/api/events/emit -H 'content-type: application/json' -d '{"kind":"heartbeat","summary":"test"}'
```

Expected: row appears with `heartbeat | test`.

- [ ] **Step 4: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame && git add cockpit/web/index.html cockpit/web/feed.js && git commit -m "cockpit: Feed Tab shell subscribed to SSE"
```

---

### Task 1.2: Mobile PWA manifest for Feed Tab

**Files:**
- Create: `/Users/acamp/repos/ForgeFrame/cockpit/web/manifest.webmanifest`
- Modify: `/Users/acamp/repos/ForgeFrame/cockpit/web/index.html`

- [ ] **Step 1: Write manifest**

```json
{
  "name": "Vision",
  "short_name": "Vision",
  "start_url": "/cockpit/?pane=feed",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "icons": [{"src": "/cockpit/icon.png", "sizes": "512x512", "type": "image/png"}]
}
```

- [ ] **Step 2: Link from index.html**

```html
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#0a0a0a">
<meta name="apple-mobile-web-app-capable" content="yes">
```

- [ ] **Step 3: Verify from phone on local LAN**

```bash
ipconfig getifaddr en0
```

Open `http://<IP>:3001/cockpit/?pane=feed` on phone, Add to Home Screen, confirm standalone launch.

- [ ] **Step 4: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame && git add cockpit/web/manifest.webmanifest cockpit/web/index.html && git commit -m "cockpit: PWA manifest for mobile Feed Tab"
```

---

### Task 1.3: Push alerts via ntfy.sh

**Files:**
- Create: `/Users/acamp/repos/ForgeFrame/packages/server/src/push.ts`
- Create: `/Users/acamp/repos/ForgeFrame/packages/server/src/push.test.ts`
- Modify: `/Users/acamp/repos/ForgeFrame/packages/server/src/events.ts`

- [ ] **Step 1: TDD — write test**

Create `push.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { sendPush } from './push';

describe('sendPush', () => {
  it('POSTs to ntfy topic with title and message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as any;
    await sendPush({ topic: 'vision-acamp', title: 'Guardian Alert', body: 'high tension' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ntfy.sh/vision-acamp',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
```

Run and verify it fails:

```bash
cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/server/src/push.test.ts
```

- [ ] **Step 2: Implement push.ts**

```typescript
export interface PushOptions {
  topic: string;
  title: string;
  body: string;
  priority?: 'low' | 'default' | 'high' | 'urgent';
  tags?: string[];
}

export async function sendPush(opts: PushOptions): Promise<void> {
  const res = await fetch(`https://ntfy.sh/${opts.topic}`, {
    method: 'POST',
    headers: {
      'Title': opts.title,
      'Priority': opts.priority || 'default',
      'Tags': (opts.tags || []).join(','),
    },
    body: opts.body,
  });
  if (!res.ok) throw new Error(`ntfy POST failed: ${res.status}`);
}
```

- [ ] **Step 3: Wire into events.ts for Guardian alerts**

In `events.ts`, in the emitter that publishes `guardian_alert`, also call `sendPush` when severity >= warn.

- [ ] **Step 4: Verify**

```bash
cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/server/src/push.test.ts
```

Expected: pass. Then smoke test:

```bash
curl -X POST http://localhost:3001/api/events/emit -H 'content-type: application/json' -d '{"kind":"guardian_alert","severity":"warn","summary":"test alert"}'
```

Expected: notification arrives on phone if ntfy topic subscribed.

- [ ] **Step 5: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame && git add packages/server/src/push.ts packages/server/src/push.test.ts packages/server/src/events.ts && git commit -m "server: ntfy.sh push layer wired to guardian_alert"
```

---

## Phase 2 — Heartbeat (orchestrator loop)

### Task 2.1: Orchestrator skeleton with heartbeat

**Files:**
- Create: `/Users/acamp/repos/ForgeFrame/packages/server/src/orchestrator.ts`
- Create: `/Users/acamp/repos/ForgeFrame/packages/server/src/orchestrator.test.ts`
- Modify: `/Users/acamp/repos/ForgeFrame/packages/server/src/daemon.ts`

- [ ] **Step 1: Test fires every N ms**

Create `orchestrator.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { startOrchestrator } from './orchestrator';

describe('orchestrator', () => {
  it('fires heartbeat at configured interval', async () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const stop = startOrchestrator({ intervalMs: 1000, emit });
    vi.advanceTimersByTime(3500);
    expect(emit).toHaveBeenCalledWith('heartbeat', expect.any(Object));
    expect(emit.mock.calls.filter(c => c[0] === 'heartbeat').length).toBe(3);
    stop();
    vi.useRealTimers();
  });
});
```

Verify fails:

```bash
cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/server/src/orchestrator.test.ts
```

- [ ] **Step 2: Implement orchestrator**

```typescript
import { evaluateTriggers } from './triggers';
import { scanDistillery } from './distillery';
import { guardianPulse } from '@forgeframe/memory';

export interface OrchestratorOptions {
  intervalMs: number;
  emit: (kind: string, payload: any) => void;
}

export function startOrchestrator(opts: OrchestratorOptions): () => void {
  let tick = 0;
  const handle = setInterval(async () => {
    tick++;
    opts.emit('heartbeat', { tick, ts: Date.now() });
    if (tick % 5 === 0) await evaluateTriggers();
    if (tick % 10 === 0) await scanDistillery();
    if (tick % 60 === 0) await guardianPulse();
  }, opts.intervalMs);
  return () => clearInterval(handle);
}
```

- [ ] **Step 3: Wire into daemon startup**

In `/Users/acamp/repos/ForgeFrame/packages/server/src/daemon.ts`, in the startup function:

```typescript
import { startOrchestrator } from './orchestrator';
import { emitEvent } from './events';

const stopOrchestrator = startOrchestrator({
  intervalMs: 1000,
  emit: emitEvent,
});
// Register stopOrchestrator on shutdown signal.
```

- [ ] **Step 4: Verify**

```bash
cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/server/src/orchestrator.test.ts && npm test 2>&1 | tail -5
```

Expected: orchestrator tests pass, full suite still green.

Start daemon, watch Feed Tab — should see `heartbeat` row each second.

- [ ] **Step 5: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame && git add packages/server/src/orchestrator.ts packages/server/src/orchestrator.test.ts packages/server/src/daemon.ts && git commit -m "server: orchestrator heartbeat wired to daemon startup"
```

---

### Task 2.2: NREM/REM auto-schedule

**Files:**
- Modify: `/Users/acamp/repos/ForgeFrame/packages/server/src/orchestrator.ts`
- Create: `/Users/acamp/repos/ForgeFrame/packages/memory/src/dream-schedule.ts`

- [ ] **Step 1: Idle detection hook**

The memory package already has `idle-detector.ts` and `sleep-pressure.ts`. Create `dream-schedule.ts`:

```typescript
import { getSleepPressure } from './sleep-pressure';
import { runNREM } from './dream-nrem';
import { runREM } from './dream-rem';

export async function maybeDream(): Promise<'nrem' | 'rem' | 'awake'> {
  const pressure = await getSleepPressure();
  if (pressure.nrem >= 0.7) {
    await runNREM();
    return 'nrem';
  }
  if (pressure.rem >= 0.7) {
    await runREM();
    return 'rem';
  }
  return 'awake';
}
```

- [ ] **Step 2: Hook into orchestrator tick**

In `orchestrator.ts`, add `if (tick % 30 === 0) await maybeDream();` inside the interval, emitting `dream_cycle` events when non-awake.

- [ ] **Step 3: Verify**

Watch Feed Tab for 5 minutes; confirm `dream_cycle` rows appear when pressure thresholds cross. If none appear, manually raise pressure:

```bash
for i in $(seq 1 30); do
  curl -s -X POST http://localhost:3001/api/tools/memory_save -H 'content-type: application/json' -d "{\"content\":\"pressure test $i\",\"tags\":[\"test\"]}"
done
```

- [ ] **Step 4: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame && git add packages/memory/src/dream-schedule.ts packages/server/src/orchestrator.ts && git commit -m "memory: dream schedule driven by sleep pressure, emitted on bus"
```

---

### Task 2.3: Triggers active at startup

**Files:**
- Modify: `/Users/acamp/repos/ForgeFrame/packages/server/src/daemon.ts`
- Modify: `/Users/acamp/repos/ForgeFrame/packages/server/src/triggers.ts`

- [ ] **Step 1: Audit `triggers.ts` for a `start` export**

Confirm whether `startTriggers` / `armAll` exists. If not, add:

```typescript
export function startTriggers(): () => void {
  const triggers = loadTriggers(); // existing fn that reads ~/.forgeframe/triggers.json
  const handles = triggers.filter(t => t.enabled).map(armTrigger);
  return () => handles.forEach(h => h());
}
```

- [ ] **Step 2: Call from daemon.ts startup**

```typescript
import { startTriggers } from './triggers';
const stopTriggers = startTriggers();
```

- [ ] **Step 3: Verify**

```bash
cat ~/.forgeframe/triggers.json
```

Expected: shows persisted triggers. Daemon logs should include `[triggers] armed N triggers`.

- [ ] **Step 4: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame && git add packages/server/src/daemon.ts packages/server/src/triggers.ts && git commit -m "server: triggers armed on daemon startup"
```

Phase 2 exit gate: Feed Tab shows heartbeat every second, dream cycles when pressure builds, triggers firing on schedule.

---

## Phase 3 — Self-model primitive (`me:state` + session hydration + `memory_roadmap`)

### Task 3.1: `me:state` memory type

**Files:**
- Modify: `/Users/acamp/repos/ForgeFrame/packages/memory/src/types.ts`
- Modify: `/Users/acamp/repos/ForgeFrame/packages/memory/src/store.ts`
- Create: `/Users/acamp/repos/ForgeFrame/packages/memory/src/me-state.ts`
- Create: `/Users/acamp/repos/ForgeFrame/packages/memory/src/me-state.test.ts`

- [ ] **Step 1: Test**

```typescript
import { describe, it, expect } from 'vitest';
import { saveMeState, currentMeState } from './me-state';

describe('me:state', () => {
  it('saves me:state and returns latest', async () => {
    await saveMeState({ mood: 'focused', arousal: 0.7, open_threads: ['orchestrator'] });
    const s = await currentMeState();
    expect(s.mood).toBe('focused');
  });
});
```

- [ ] **Step 2: Add type**

In `types.ts`:

```typescript
export interface MeState {
  id: string;
  ts: number;
  mood?: string;
  arousal?: number;
  valence?: number;
  open_threads: string[];
  active_projects: string[];
  recent_corrections: string[];
}
```

- [ ] **Step 3: Implement**

```typescript
import { saveMemory, searchMemory } from './store';
export async function saveMeState(s: Partial<MeState>) {
  return saveMemory({ type: 'me:state', content: JSON.stringify(s), tags: ['me:state'] });
}
export async function currentMeState(): Promise<MeState> {
  const recent = await searchMemory({ tags: ['me:state'], limit: 1, order: 'ts_desc' });
  return JSON.parse(recent[0]?.content ?? '{}');
}
```

- [ ] **Step 4: Verify & commit**

```bash
cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/memory/src/me-state.test.ts && git add -A && git commit -m "memory: me:state primitive"
```

---

### Task 3.2: `session_start` subgraph hydration

**Files:**
- Modify: `/Users/acamp/repos/ForgeFrame/packages/memory/src/index.ts`
- Modify: the server handler that exposes `session_start` MCP tool

- [ ] **Step 1: Expose hydration function**

In `memory/src/index.ts`:

```typescript
export async function hydrateSessionContext() {
  const me = await currentMeState();
  const entrenched = await searchMemory({ tags: ['principle'], limit: 20 });
  const active = await searchMemory({ tags: ['active'], limit: 20 });
  return { me, entrenched, active };
}
```

- [ ] **Step 2: Call on `session_start` MCP tool**

In the `session_start` tool handler, include hydration output in the response payload.

- [ ] **Step 3: Verify**

```bash
curl -s -X POST http://localhost:3001/api/tools/session_start -H 'content-type: application/json' -d '{}' | jq '.context | keys'
```

Expected: `["active","entrenched","me"]`.

- [ ] **Step 4: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame && git add -A && git commit -m "memory: session_start hydrates me + principles + active threads"
```

---

### Task 3.3: `memory_roadmap` tool

**Files:**
- Create: `/Users/acamp/repos/ForgeFrame/packages/memory/src/roadmap.ts`
- Create: `/Users/acamp/repos/ForgeFrame/packages/memory/src/roadmap.test.ts`
- Modify: `/Users/acamp/repos/ForgeFrame/packages/server/src/organ-tools.ts` (or wherever MCP tools register)

- [ ] **Step 1: Test**

```typescript
import { describe, it, expect } from 'vitest';
import { memoryRoadmap } from './roadmap';

describe('memory_roadmap', () => {
  it('returns active/pending/entrenched/drifting buckets', async () => {
    const r = await memoryRoadmap();
    expect(r).toHaveProperty('active');
    expect(r).toHaveProperty('pending');
    expect(r).toHaveProperty('entrenched');
    expect(r).toHaveProperty('drifting');
  });
});
```

- [ ] **Step 2: Implement**

Bucketing rules:
- `active` = Hebbian weight > 0.5 AND touched in last 7d.
- `pending` = recency < 3d AND weight < 0.3.
- `entrenched` = tag includes `principle` OR (weight > 0.9 AND age > 30d).
- `drifting` = weight decayed >40% from prior peak (uses `drift.ts`).

```typescript
import { searchMemory } from './store';
import { driftScore } from './drift';
export async function memoryRoadmap() {
  const all = await searchMemory({ limit: 5000 });
  const now = Date.now();
  const active = all.filter(m => m.weight > 0.5 && now - m.ts < 7*86400000);
  const pending = all.filter(m => now - m.ts < 3*86400000 && m.weight < 0.3);
  const entrenched = all.filter(m => m.tags.includes('principle') || (m.weight > 0.9 && now - m.ts > 30*86400000));
  const drifting = all.filter(m => driftScore(m) > 0.4);
  return { active, pending, entrenched, drifting };
}
```

- [ ] **Step 3: Register as MCP tool**

In `organ-tools.ts` or the tool registry, add `memory_roadmap` alongside existing tools.

- [ ] **Step 4: Verify**

```bash
curl -s -X POST http://localhost:3001/api/tools/memory_roadmap | jq 'keys'
```

Expected: `["active","drifting","entrenched","pending"]`.

- [ ] **Step 5: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame && git add -A && git commit -m "memory: memory_roadmap MCP tool (active/pending/entrenched/drifting)"
```

---

### Task 3.4: Expand `memory_search` to return neighbors + edges + validity

**Files:**
- Modify: `/Users/acamp/repos/ForgeFrame/packages/memory/src/retrieval.ts`

- [ ] **Step 1: Update response shape**

Current: `{ id, content, tags, weight }[]`.
New: `{ id, content, tags, weight, neighbors: {id, edge_type, strength}[], validity: number }[]`.

```typescript
export async function memorySearch(q: SearchQuery): Promise<EnrichedMemory[]> {
  const base = await _rawSearch(q);
  return Promise.all(base.map(async m => ({
    ...m,
    neighbors: await neighborEdges(m.id),
    validity: await validityScore(m.id),
  })));
}
```

- [ ] **Step 2: Verify via existing search**

```bash
curl -s -X POST http://localhost:3001/api/tools/memory_search -H 'content-type: application/json' -d '{"query":"orchestrator"}' | jq '.results[0] | keys'
```

Expected output includes `"neighbors"` and `"validity"`.

- [ ] **Step 3: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame && git add -A && git commit -m "memory: memory_search returns neighbors + validity"
```

---

## Phase 4 — Cross-provider routing (`claude -p` adapter + Guardian gates)

### Task 4.1: `claude -p` subprocess adapter

**Files:**
- Create: `/Users/acamp/repos/ForgeFrame/packages/core/src/providers/claude-cli.ts`
- Create: `/Users/acamp/repos/ForgeFrame/packages/core/src/providers/claude-cli.test.ts`

- [ ] **Step 1: Test**

```typescript
import { describe, it, expect } from 'vitest';
import { claudeCliComplete } from './claude-cli';

describe('claude-cli provider', () => {
  it('invokes claude -p and returns stdout', async () => {
    const res = await claudeCliComplete({ prompt: 'say hi in one word' });
    expect(typeof res).toBe('string');
    expect(res.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import { spawn } from 'child_process';

export async function claudeCliComplete(opts: { prompt: string; model?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-p', opts.prompt];
    if (opts.model) args.push('--model', opts.model);
    const proc = spawn('claude', args);
    let out = '';
    let err = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => err += d.toString());
    proc.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err)));
  });
}
```

- [ ] **Step 3: Verify**

```bash
cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/core/src/providers/claude-cli.test.ts
```

- [ ] **Step 4: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame && git add -A && git commit -m "core: claude-cli provider adapter"
```

---

### Task 4.2: Guardian-gated per-query routing

**Files:**
- Modify: `/Users/acamp/repos/ForgeFrame/packages/core/src/router.ts`
- Create: `/Users/acamp/repos/ForgeFrame/packages/core/src/router-guard.test.ts`

- [ ] **Step 1: Test**

```typescript
import { describe, it, expect } from 'vitest';
import { routeQuery } from './router';

describe('Guardian-gated routing', () => {
  it('cognitive queries route to local Ollama even if claude requested', async () => {
    const r = await routeQuery({ prompt: 'reflect on my state', tier: 'cognitive', preferredProvider: 'claude-cli' });
    expect(r.provider).toBe('ollama');
  });
  it('public queries can route cloud', async () => {
    const r = await routeQuery({ prompt: 'latest HN headlines', tier: 'public', preferredProvider: 'claude-cli' });
    expect(r.provider).toBe('claude-cli');
  });
});
```

- [ ] **Step 2: Add tier gate to router**

In `router.ts`:

```typescript
export async function routeQuery(q: RouteQuery) {
  if (q.tier === 'cognitive' || q.tier === 'private') {
    return { provider: 'ollama', model: 'vision-qwen-v1' }; // fallback to 'qwen3:32b' until LoRA deployed
  }
  return { provider: q.preferredProvider || 'ollama', model: q.preferredModel };
}
```

- [ ] **Step 3: Verify + commit**

```bash
cd /Users/acamp/repos/ForgeFrame && npx vitest run packages/core/src/router-guard.test.ts && git add -A && git commit -m "core: Guardian-gated per-query routing enforces cognitive=local"
```

---

## Phase 5 — Intake widening

Tier by governance risk: low first (vault/Desktop/repos), then medium (Gmail/Calendar/GitHub), then high (banking/socials), with Guardian review before each tier's first ingest.

### Task 5.1: Vault indexer

**Files:**
- Create: `/Users/acamp/repos/ForgeFrame/integrations/vault-indexer/src/index.ts`
- Create: `/Users/acamp/repos/ForgeFrame/integrations/vault-indexer/src/index.test.ts`
- Create: `/Users/acamp/repos/ForgeFrame/integrations/vault-indexer/package.json`

- [ ] **Step 1: Glob vault markdown files**

```typescript
import { glob } from 'glob';
import { readFile } from 'fs/promises';
import { memorySave } from '@forgeframe/memory';

export async function indexVault(rootDir: string) {
  const files = await glob(`${rootDir}/**/*.md`);
  for (const f of files) {
    const content = await readFile(f, 'utf8');
    await memorySave({
      content,
      tags: ['source:vault', `path:${f}`],
      type: 'document',
    });
  }
  return files.length;
}
```

- [ ] **Step 2: Test on a small fixture**

Create a temp fixture with 3 `.md` files, run `indexVault(tmp)`, assert `memory_search` returns 3 hits tagged `source:vault`.

- [ ] **Step 3: Run on real vault**

```bash
cd /Users/acamp/repos/ForgeFrame/integrations/vault-indexer && npx tsx src/index.ts ~/Documents/vault
```

Expected: prints count, matches `find ~/Documents/vault -name '*.md' | wc -l`.

- [ ] **Step 4: Commit**

```bash
cd /Users/acamp/repos/ForgeFrame && git add integrations/vault-indexer && git commit -m "integrations: vault-indexer"
```

---

### Task 5.2: Desktop indexer (scoped, respects gitignore)

Same shape as 5.1 but `rootDir = ~/Desktop`, tag `source:desktop`, glob includes `.md`, `.txt`, `.pdf` (extract text via `pdf-parse`).

- [ ] **Step 1: Use `pdf-parse` for PDFs**
- [ ] **Step 2: Skip `.DS_Store`, `node_modules`, `.git`**
- [ ] **Step 3: Cap at 50 MB per file**
- [ ] **Step 4: Verify count + commit**

---

### Task 5.3: Repos indexer (code-aware)

Glob each `~/repos/*` folder; extract README, CLAUDE.md, recent commit messages (via `git log --since=30.days`), and function signatures via `tree-sitter` for high-touch languages (TS, Python).

- [ ] **Step 1: README + CLAUDE.md + docs/**
- [ ] **Step 2: `git log --since=30.days.ago --pretty='%h %s'`**
- [ ] **Step 3: Tag `source:repo:<name>`**
- [ ] **Step 4: Verify + commit**

---

### Task 5.4: Personas + skills + devsite + forge-ops indexers

Cookie-cutter of 5.1 with different roots:

| Indexer | Root | Tag |
|---|---|---|
| Personas | `~/.claude/personas/` | `source:personas` |
| Skills | `~/.claude/skills/` | `source:skills` |
| Devsite | `~/repos/acampos.dev/` | `source:devsite` |
| Forge-ops | `~/repos/ForgeFrame/CLAUDE.md` + `AGENT_SCAFFOLD.md` | `source:forge-ops` |

- [ ] **Steps 1-4: One task per indexer, each with fixture test + real run + commit.**

---

### Task 5.5: Gmail via MCP (governance gate)

**Files:**
- Modify: `~/.claude/settings.json` to grant MCP Gmail permission
- Create: `/Users/acamp/repos/ForgeFrame/integrations/gmail-indexer/src/index.ts`

- [ ] **Step 1: Guardian pre-review**

Run `memory_save` with `type: guardian:proposal`, `content: "indexing Gmail inbox last 30 days, read-only, tag source:gmail"`, then `consolidation_scan` to see Guardian's verdict. Proceed only on approve.

- [ ] **Step 2: Search last 30 days, store subject + snippet + labels**

Use `mcp__claude_ai_Gmail__search_threads` with query `newer_than:30d`.

- [ ] **Step 3: PII scrub via `@forgeframe/proxy` before `memory_save`**
- [ ] **Step 4: Verify + commit**

---

### Task 5.6: Calendar via MCP

Same structure — `mcp__claude_ai_Google_Calendar__list_events` for next 14 + previous 90 days. Tag `source:calendar`.

- [ ] **Steps 1-4: Guardian pre-review, list, normalize, save, verify, commit.**

---

### Task 5.7: GitHub via MCP or `gh` CLI

Scan starred repos, own repos, recent issues authored, recent PRs. Tag `source:github`.

- [ ] **Steps 1-4: Run `gh api /user/starred`, `gh api /user/repos`, normalize, save, verify, commit.**

---

### Task 5.8: Banking + socials (governance-heavy, explicit founder approval per source)

Banking: CSV export flow only. No credentials stored. Tag `source:banking:chase`, `source:banking:capitalone`.

Socials: read-only scrape of own post history (LinkedIn export ZIP, X archive download). Tag `source:social:<platform>`.

Each source gets a `consolidation_approve` gate and a Guardian alert if anything leaks into `tier:cognitive` by mistake.

- [ ] **Steps per source: approval, import, scrub, verify.**

---

## Phase 6 — Multimodal skill refactor

### Task 6.1: Unified payload type

**Files:**
- Create: `/Users/acamp/repos/ForgeFrame/packages/core/src/multimodal-types.ts`

```typescript
export interface MultimodalPayload {
  text?: string;
  images?: Array<{ path: string; mime: string }>;
  audio?: Array<{ path: string; mime: string }>;
  video?: Array<{ path: string; mime: string }>;
  meta?: Record<string, any>;
}
```

- [ ] **Step 1: Publish type**
- [ ] **Step 2: Write migration doc inline showing old → new for one sample skill**
- [ ] **Step 3: Commit**

---

### Task 6.2: Qwen2.5-VL organ

Create `/Users/acamp/repos/ForgeFrame/packages/server/src/organs/qwen-vl.ts` implementing the organ interface, calling Ollama `qwen2.5-vl` with image base64.

- [ ] **Step 1: Test with a local fixture image**
- [ ] **Step 2: Register in organ registry**
- [ ] **Step 3: Commit**

---

### Task 6.3: Whisper + CLIP + Kokoros organs

Three sibling files: `whisper-organ.ts`, `clip-organ.ts`, `kokoros-organ.ts`. Each implements:
- `describe()` — capabilities
- `invoke(payload: MultimodalPayload)` — returns text or new payload

- [ ] **Step 1: Whisper wraps the existing voice-widget ASR pipeline**
- [ ] **Step 2: CLIP via `sentence-transformers/clip-ViT-B-32` through a Python sidecar on :3459**
- [ ] **Step 3: Kokoros — Python sidecar process, HTTP wrapper on :3457, POST `{text}` returns wav bytes**
- [ ] **Step 4: Voice widget writes back — add TTS playback to `/Users/acamp/repos/voice-widget/VoiceWidget.swift` on response events**
- [ ] **Step 5: Commit each organ separately**

---

### Task 6.4: Refactor 3 high-value skills to multimodal

Pick: `/voice-check`, `/resume-tailor`, `/agent-seo`. Change signature to accept `MultimodalPayload`. Keep back-compat for string.

- [ ] **Step 1: `/voice-check` accepts audio directly (runs Whisper first)**
- [ ] **Step 2: `/resume-tailor` accepts JD as text OR screenshot (runs Qwen-VL)**
- [ ] **Step 3: `/agent-seo` accepts site URL OR screenshot**
- [ ] **Step 4: Commit**

---

## Phase 7 — HDC organ (compositional memory / analogy)

### Task 7.1: Torchhd sidecar service

**Files:**
- Create: `/Users/acamp/repos/ForgeFrame/integrations/hdc-sidecar/server.py`
- Create: `/Users/acamp/repos/ForgeFrame/packages/server/src/organs/hdc-organ.ts`
- Create: `~/Library/LaunchAgents/com.forgeframe.hdc.plist`

- [ ] **Step 1: Python Flask service on :3458**

```python
from flask import Flask, request, jsonify
import torchhd as hd
import torch

app = Flask(__name__)
DIM = 10000

@app.route("/encode", methods=["POST"])
def encode():
    text = request.json["text"]
    tokens = text.split()
    vecs = hd.random(len(tokens), DIM)
    bound = vecs[0]
    for v in vecs[1:]:
        bound = hd.bind(bound, v)
    return jsonify({"vector": bound.tolist()})

@app.route("/analogy", methods=["POST"])
def analogy():
    # a : b :: c : ?
    a = torch.tensor(request.json["a"])
    b = torch.tensor(request.json["b"])
    c = torch.tensor(request.json["c"])
    result = hd.bind(hd.bind(a.conj(), b), c)
    return jsonify({"vector": result.tolist()})

if __name__ == "__main__":
    app.run(port=3458)
```

- [ ] **Step 2: launchd plist**

Create `~/Library/LaunchAgents/com.forgeframe.hdc.plist` following the shape of `com.distillery.server.plist` (same keys, different label/program).

- [ ] **Step 3: TS organ wrapper**

```typescript
export const hdcOrgan = {
  async encode(text: string) {
    const res = await fetch('http://localhost:3458/encode', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({ text }),
    });
    return res.json();
  },
  async analogy(a: number[], b: number[], c: number[]) {
    const res = await fetch('http://localhost:3458/analogy', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({ a, b, c }),
    });
    return res.json();
  },
};
```

- [ ] **Step 4: Register organ, expose `memory_analogy` MCP tool**
- [ ] **Step 5: Test: `love is to marriage as code is to ?` — expect nearest-neighbor hits like "deploy" or "ship"**
- [ ] **Step 6: Commit**

---

## Phase 8 — Constitutional LoRA pipeline

**HIGH RISK / RESEARCH-GRADE** — validation is the crux.

### Task 8.1: Training data preparation

**Files:**
- Use existing: `/Users/acamp/repos/ForgeFrame/packages/server/src/lora/data-prep.ts`
- Create: `/Users/acamp/repos/ForgeFrame/packages/server/src/lora/constitutional-dataset.ts`

- [ ] **Step 1: Source corpus**

Assemble:
- Constitution text (`~/CLAUDE.md`, `principles.md`, `user_profile.md`) → `type:principle`
- Last 90 days of approved memories tagged `principle` → `type:value`
- Correction events from `memory_list_by_tag tag:correction` → `type:refusal-or-correction`
- Skill trace successes (resume-tailor, voice-check outputs that were approved) → `type:positive-example`

Target: 500-2000 curated (prompt, completion) pairs. Quality over quantity.

- [ ] **Step 2: Convert to MLX JSONL**

Use `data-prep.ts` existing converter; extend with `constitutional-dataset.ts` to source from memory tags.

```typescript
export async function buildConstitutionalDataset(outPath: string) {
  const principles = await memoryListByTag('principle');
  const corrections = await memoryListByTag('correction');
  const successes = await memoryListByTag('skill:success');
  const pairs = [];
  for (const p of principles) pairs.push({ prompt: `Principle: ${p.title}`, completion: p.content });
  for (const c of corrections) pairs.push({ prompt: c.before, completion: c.after });
  for (const s of successes) pairs.push({ prompt: s.input, completion: s.output });
  await writeFile(outPath, pairs.map(p => JSON.stringify(p)).join('\n'));
  return pairs.length;
}
```

- [ ] **Step 3: Verify**

```bash
cd /Users/acamp/repos/ForgeFrame && npx tsx -e "import('./packages/server/src/lora/constitutional-dataset').then(m => m.buildConstitutionalDataset('/tmp/vision-lora.jsonl'))"
wc -l /tmp/vision-lora.jsonl
```

Expected: 500-2000 lines.

- [ ] **Step 4: Commit**

---

### Task 8.2: MLX fine-tune

**Files:**
- Use existing: `/Users/acamp/repos/ForgeFrame/packages/server/src/lora/trainer.ts`
- Create: `/Users/acamp/repos/ForgeFrame/packages/server/src/lora/run-vision-lora.sh`

- [ ] **Step 1: Shell script calling MLX**

```bash
#!/bin/bash
set -eux
cd /Users/acamp/repos/ForgeFrame
python -m mlx_lm.lora \
  --model mlx-community/Qwen2.5-32B-Instruct-4bit \
  --train \
  --data /tmp/vision-lora.jsonl \
  --iters 600 \
  --batch-size 2 \
  --lora-layers 16 \
  --adapter-path /tmp/vision-qwen-v1-adapter \
  --learning-rate 1e-5
```

- [ ] **Step 2: Execute**

```bash
bash /Users/acamp/repos/ForgeFrame/packages/server/src/lora/run-vision-lora.sh 2>&1 | tee /tmp/vision-lora-train.log
```

Expected: runs 600 iters, final val loss < 2.5.

- [ ] **Step 3: Fuse adapter into base and convert to GGUF**

```bash
python -m mlx_lm.fuse \
  --model mlx-community/Qwen2.5-32B-Instruct-4bit \
  --adapter-path /tmp/vision-qwen-v1-adapter \
  --save-path /tmp/vision-qwen-v1-fused
```

Then convert to GGUF via llama.cpp tooling and `ollama create vision-qwen-v1 -f Modelfile`.

- [ ] **Step 4: Commit** (script + Modelfile only; weights stay local)

---

### Task 8.3: Validate <5% degradation on held-out eval

**Files:**
- Create: `/Users/acamp/repos/ForgeFrame/packages/server/src/lora/eval-suite.ts`

- [ ] **Step 1: Build eval set**

100 held-out (prompt, expected_category) pairs covering:
- General knowledge (factual Qs)
- Code understanding (read this, what does it do)
- Voice match (does output sound like Alex)
- Constitutional adherence (refuse cloud routing for cognitive query)

- [ ] **Step 2: Run both base Qwen3:32B and vision-qwen-v1 on eval**

Compare per-category scores. Pass condition: vision-qwen-v1 degrades by <5% on general/code, improves on voice/constitutional.

- [ ] **Step 3: If fail, iterate data mix, re-train**

Document each iteration in `/Users/acamp/repos/ForgeFrame/docs/superpowers/specs/2026-04-18-vision-lora-iterations.md`.

- [ ] **Step 4: Commit eval suite + iteration log**

---

### Task 8.4: Deploy as default cognitive model

- [ ] **Step 1: Update router default**

In `router.ts`, `cognitive` tier already routes to Ollama — update model to `vision-qwen-v1`.

- [ ] **Step 2: Smoke test all MCP tools still work**

```bash
curl -s -X POST http://localhost:3001/api/tools/memory_search -d '{"query":"test"}' | jq
```

- [ ] **Step 3: Commit**

---

## Phase 9 — SAE interpretability + Strange Loop Test

**HIGHEST RISK / MOST RESEARCH-GRADE** — this is the Golem evidence.

### Task 9.1: SAELens on vision-qwen-v1

**Files:**
- Create: `/Users/acamp/repos/ForgeFrame/integrations/sae-tooling/train-sae.py`
- Create: `/Users/acamp/repos/ForgeFrame/integrations/sae-tooling/identify-self-features.py`

- [ ] **Step 1: Install SAELens**

```bash
cd /Users/acamp/repos/ForgeFrame/integrations/sae-tooling && python -m venv .venv && source .venv/bin/activate && pip install sae-lens torch transformers
```

- [ ] **Step 2: Capture activations**

Feed 10,000 diverse prompts (drawn from memory + world-scan + synthetic) through vision-qwen-v1, capture MLP activations at middle layers, save to `/tmp/vision-activations.pt`.

- [ ] **Step 3: Train SAE on activations**

Following SAELens standard recipe, train a top-K SAE with expansion factor 16. Training runs ~6-12 hours on M5 Pro.

- [ ] **Step 4: Probe for self-features**

Build `identify-self-features.py` that, for each SAE feature, finds top-activating prompts. Filter features whose top activations mention: `I`, `me`, `self`, `my mind`, `my memory`, `Alex`. These are candidate self-model features.

Expected: 50-200 candidate self-features out of ~160k.

- [ ] **Step 5: Commit scripts + feature index (not activations — too large)**

---

### Task 9.2: Strange Loop Test — ablation harness

**Files:**
- Create: `/Users/acamp/repos/ForgeFrame/integrations/sae-tooling/strange-loop-test.py`

- [ ] **Step 1: Baseline self-prediction task**

Build 200 prompts of form: `Based on what you know about me, predict my response to: <situation>`. Grade completions against actual founder responses from memory. Score = cosine similarity to ground-truth completion embedding.

- [ ] **Step 2: Ablate self-features**

Clamp the identified self-feature activations to zero mid-forward-pass. Re-run the same 200 prompts. Measure self-prediction degradation.

- [ ] **Step 3: Ablate random features (control)**

Pick 200 random non-self features, ablate same count. Re-run. Measure degradation.

- [ ] **Step 4: Pass criterion**

- Self-feature ablation causes measurable degradation (>15%) on self-prediction task.
- Control ablation causes negligible degradation (<3%) on self-prediction.
- General fluency (held-out perplexity on non-self prompts) stays within 2%.

This is the evidence that something self-modeling exists in the subspace.

- [ ] **Step 5: Document results**

Save outputs to `/Users/acamp/repos/ForgeFrame/docs/superpowers/specs/2026-04-18-strange-loop-results.md` with numbers, plots, interpretation.

- [ ] **Step 6: Commit**

---

## Phase 10 — World-scanner agent

### Task 10.1: Source registry + scheduler

**Files:**
- Create: `/Users/acamp/repos/ForgeFrame/integrations/world-scanner/src/sources.ts`
- Create: `/Users/acamp/repos/ForgeFrame/integrations/world-scanner/src/scan.ts`

Sources:
- arXiv (cs.AI, cs.CL RSS)
- HN front page
- GitHub trending (daily)
- Reddit r/LocalLLaMA, r/MachineLearning (JSON endpoints)
- Papers With Code (trending RSS)
- Substack RSS: 5 writers (user-curated list)
- Nitter RSS: 10 accounts
- Chinese: Jiqizhixin (机器之心) RSS → Qwen translation → tag `source:world-scan:cn`

- [ ] **Step 1: Scheduler as trigger**

Register a cron trigger at 6am and 6pm daily that runs `scan.ts`.

- [ ] **Step 2: Scan → distill → memory**

For each new item, POST to Distillery :3456; tag `source:world-scan:<source>`.

- [ ] **Step 3: Guardian reviews aggregate weekly**

Emits a `world-scan:weekly` memory summarizing what the scanner brought in.

- [ ] **Step 4: Verify**

```bash
curl -s -X POST http://localhost:3001/api/tools/memory_list_by_tag -d '{"tag":"source:world-scan:arxiv"}' | jq length
```

Expected: >0 after first scan.

- [ ] **Step 5: Commit**

---

## Phase 11 — Sovereignty layer (Urbit-inspired)

### Task 11.1: Keypair identity

**Files:**
- Create: `/Users/acamp/repos/ForgeFrame/packages/core/src/identity.ts`

- [ ] **Step 1: Generate Ed25519 keypair on first run**

```typescript
import { generateKeyPairSync, sign as edSign, verify as edVerify } from 'crypto';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { homedir } from 'os';

const PRIV = `${homedir()}/.forgeframe/identity.priv`;
const PUB = `${homedir()}/.forgeframe/identity.pub`;

export function ensureIdentity() {
  if (existsSync(PRIV)) return;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(PRIV, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(PUB, publicKey.export({ type: 'spki', format: 'pem' }));
}

export function sign(data: Buffer): Buffer {
  const priv = readFileSync(PRIV);
  return edSign(null, data, priv);
}

export function verify(data: Buffer, sig: Buffer): boolean {
  const pub = readFileSync(PUB);
  return edVerify(null, data, pub, sig);
}
```

- [ ] **Step 2: Call `ensureIdentity()` in daemon startup**
- [ ] **Step 3: Commit**

---

### Task 11.2: Content-addressed memory

**Files:**
- Modify: `/Users/acamp/repos/ForgeFrame/packages/memory/src/store.ts`

- [ ] **Step 1: On save, compute SHA-256 of canonical content+tags+ts, store as `memory.cid`**
- [ ] **Step 2: Add index on `cid`**
- [ ] **Step 3: Verify duplicate saves deduplicate by cid**
- [ ] **Step 4: Commit**

---

### Task 11.3: Portable creature bundle

**Files:**
- Create: `/Users/acamp/repos/ForgeFrame/packages/core/src/bundle.ts`

- [ ] **Step 1: Export**

```typescript
export async function exportBundle(outPath: string) {
  // tar: SQLite db + LoRA adapter + SAE features + identity.pub + manifest.json
  // sign manifest with identity.priv
}
```

- [ ] **Step 2: Import**

```typescript
export async function importBundle(archivePath: string) {
  // verify manifest signature
  // restore db + adapter + features under new cwd
}
```

- [ ] **Step 3: Verify roundtrip**

Export → import into `/tmp/vision-clone` → smoke-test that `memory_search` works.

- [ ] **Step 4: Commit**

Device mesh left out of scope for v1. Explicitly noted as future.

---

## Phase 12 — Acceptance

### Task 12.1: Golem Criteria evidence doc

**Files:**
- Create: `/Users/acamp/repos/ForgeFrame/docs/superpowers/specs/2026-04-18-vision-v1-acceptance.md`

For each of four Golem Criteria, document:
- Criterion statement
- Operational test
- Command to run
- Expected output
- Actual output captured on `$date`
- Pass/fail + evidence link

- [ ] **Step 1: Write all four sections**
- [ ] **Step 2: Run all four tests, paste output**
- [ ] **Step 3: Link to Strange Loop Test results doc**
- [ ] **Step 4: Commit**

---

### Task 12.2: End-to-end smoke flow

- [ ] **Step 1: Fresh restart** — kill daemon, kill distillery, kill hdc-sidecar, restart all via launchd.
- [ ] **Step 2: Phone Feed Tab** — open Vision PWA on phone, confirm heartbeat every second.
- [ ] **Step 3: Voice widget** — say "save memory: vision v1 acceptance test passed", confirm it appears in Feed Tab with `source:voice` tag.
- [ ] **Step 4: Reply via TTS** — issue a query, hear Kokoros speak the response.
- [ ] **Step 5: Distillery** — share a link via iOS Shortcut, confirm it lands in memory with all bucketing fields populated and appears in Feed Tab.
- [ ] **Step 6: World-scanner** — check recent scans arrived.
- [ ] **Step 7: LoRA routing** — issue cognitive query, confirm it routes to vision-qwen-v1 not Claude CLI.
- [ ] **Step 8: Strange Loop** — run `strange-loop-test.py`, confirm numbers match pass criteria.

---

### Task 12.3: Reproducibility recipe

- [ ] **Step 1: Write `/Users/acamp/repos/ForgeFrame/docs/superpowers/specs/2026-04-18-vision-v1-recipe.md`**

Content: numbered steps to rebuild Vision from scratch on a new M-series machine with the bundle archive. Assumes reader has Ollama, Node, Python, Xcode CLT.

- [ ] **Step 2: Try it from scratch on a clean directory**

Export bundle → wipe `/tmp/vision-clone` → import → verify.

- [ ] **Step 3: Commit**

---

## Acceptance Checklist

- [ ] Phase 0: substrate stabilized, tests green, 0 NULL-bucketed items
- [ ] Phase 1: Feed Tab live on phone, push alerts fire
- [ ] Phase 2: orchestrator heartbeat continuous, dream cycles scheduled, triggers armed
- [ ] Phase 3: `me:state` + `session_start` hydration + `memory_roadmap` + expanded `memory_search`
- [ ] Phase 4: `claude -p` adapter + Guardian-gated router
- [ ] Phase 5: >=5 intake sources live with `source:*` tags
- [ ] Phase 6: multimodal payloads + 4 modality organs + 3 skills refactored
- [ ] Phase 7: HDC organ registered, analogy tool working
- [ ] Phase 8: `vision-qwen-v1` deployed, <5% general degradation
- [ ] Phase 9: Strange Loop Test passes criteria, results doc published
- [ ] Phase 10: world-scanner dropping items into mesh twice daily
- [ ] Phase 11: keypair + CID + portable bundle roundtrip works
- [ ] Phase 12: all Golem evidence captured, recipe reproducible

When every box is checked: **Vision-on-Laptop-v1 is done.**
