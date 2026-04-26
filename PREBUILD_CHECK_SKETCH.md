# Loom prebuild_check tier — design sketch

Status: DESIGN ONLY. Do not implement until A1 router scaffold exists.
Author: Stream F (consolidation-sweep), 2026-04-25.

## What this is

A new tier in the Loom router. Before Loom dispatches a build/run/scrape job, it runs a fast intent-anchor scan to check whether the user's request maps to a known recent context. The check returns a scored rollup; Loom uses the score to decide route (cache hit → reuse, cold → full dispatch, conflict → ask user).

Pattern absorbed from `idea-reality-mcp` (recon transcript at `/private/tmp/claude-501/.../tasks/a415c8eb7b9e03e16.output`). Adapted to ForgeFrame primitives so the whole tier stays sovereign.

## Sources scanned (parallel, ~6)

1. **ForgeFrame memory** — `memory_search` with extracted keywords, top 10 by score+strength.
2. **Recent sessions** — `session_list` last 7 days, match keywords against session metadata.
3. **Dispatch log** — `~/.creature/logs/dispatch-*.jsonl` grep for keywords.
4. **Open worktrees** — `git worktree list` + branch name match.
5. **Sprint coordination doc** — `~/.creature/sprint/*master-sprint*.md` grep.
6. **Local notepad** — `~/.claude/personas/notepad/*.md` grep.

All six fire concurrently via `httpx.AsyncClient` (Python) or Node `Promise.all` with the MCP client + fs reads. Total budget: 800ms p95.

## Intent-anchor extraction

Local-only. Use Ollama (`qwen2.5:7b-instruct` is fine — no need for the 32b for keyword extraction) with a prompt:

```
Extract 3-5 noun-phrase keywords from this user request. Output JSON array of strings, no prose.

Request: <user input>
```

No phone-home. Sovereignty intact. Cache by hash(request) → keywords for 1h.

## Scoring rollup

Per source, score = num_matches * source_weight. Weights:

| Source     | Weight | Why                                                      |
|------------|--------|----------------------------------------------------------|
| memory     | 1.0    | semantic match is highest signal                         |
| sessions   | 0.7    | recent intent                                            |
| dispatch   | 0.6    | "have we done this exact thing"                          |
| worktrees  | 0.8    | "are we in the middle of this"                           |
| sprint doc | 0.5    | "is this on the official plan"                           |
| notepad    | 0.4    | low-fi but catches stuff that hasn't memory_save'd yet   |

Total score → bucket:
- **>= 5**: hot — likely cache hit, suggest reuse path. Example: "yes, you started this 2 hours ago in worktree X, branch Y."
- **2-5**: warm — adjacent context, mention but proceed.
- **< 2**: cold — fresh dispatch, no rollup shown.

## Output shape

```json
{
  "score": 6.4,
  "bucket": "hot",
  "matches": {
    "memory":    [{"id": "...", "content": "...", "score": 0.83}],
    "sessions":  [...],
    "worktrees": [{"path": "/Users/acamp/repos/foo", "branch": "feat/foo"}]
  },
  "suggested_route": "reuse",
  "rationale": "active worktree + 3 strong memories from last 48h"
}
```

## Where this lives in the Loom router

Tier order:
1. **prebuild_check** ← this. Cheap, local, parallel.
2. **router** (existing) — picks model tier.
3. **dispatch** (existing) — runs the job.

prebuild_check returns a hint, not a decision. The router still owns routing; it just gets the rollup as one more input.

## MCP bridge note

As of 2026-04-25, the forgeframe-memory MCP server accepts both native and JSON-stringified arrays/integers (Stream F shipped the coercion fix in commit 6e1fb87). Loom can pass `tags: ["a","b"]` or `limit: 10` as native types — no workarounds needed.

## Sovereignty

Every source is local. No API calls. Ollama runs on-device. The whole tier could run on a plane.

## Open questions for Worktree A

1. Should prebuild_check be opt-in per request or always-on? (Recommend: always-on with a `--no-precheck` flag for the rare case the user wants a clean slate.)
2. Cache invalidation for the keyword extractor — is 1h right, or should it be session-scoped?
3. Conflict resolution UI: when the rollup says "you have an open worktree on this", does Loom hard-stop and prompt, or just include the path in its plan output?

These are A1's call. This sketch just locks the shape.
