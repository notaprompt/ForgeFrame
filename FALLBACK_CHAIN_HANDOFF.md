# ForgeFrame Fallback Chain — Implementation Handoff

**Date:** 2026-03-16
**Context:** Memory search failed to find "Resume Tailoring Tool" concept because it only existed in forge-ops/todos/, not in ForgeFrame's semantic DB. This feature makes ForgeFrame search fall back to external markdown directories when the DB returns 0 results.

---

## Problem

ForgeFrame memory DB has 6 memories (all identity/architecture/principles). Project state, todos, and product ideas live in separate markdown files that ForgeFrame can't search. When `memory_search` returns nothing, the user gets nothing — even when the answer exists on disk.

For other users (not just Alex): anyone using ForgeFrame alongside markdown-based note systems (Obsidian, flat files, Claude auto-memory) hits the same gap. The fallback chain makes ForgeFrame a unified search layer over all local knowledge, not just its own DB.

---

## Design

### Three-Tier Fallback Chain

Triggers **only when Tier 1 returns 0 results** (not as supplement — avoids noise):

```
Tier 1: ForgeFrame semantic DB (existing — FTS + embedding + strength)
  |  0 results?
  v
Tier 2: Auto-memory / notes directories (configurable)
  |  0 results?
  v
Tier 3: Todos / task directories (configurable)
```

Short-circuits at first tier with results.

### Scoring

- Tier 2 results: base score `0.5` (below any real semantic match)
- Tier 3 results: base score `0.3`
- Within tier: rank by `(keyword matches in section / total words) * tier_base_score`
- Synthetic Memory objects with deterministic IDs: `fallback:<source-name>::<filename>::<heading>`
- Tagged `source:fallback-<source-name>` so callers can distinguish
- `strength: 0`, `accessCount: 0`, `embedding: null` — read-only ephemeral results

---

## Files to Change

### 1. `packages/memory/src/types.ts` — Add interfaces

```typescript
export interface FallbackSource {
  name: string;
  tier: number;           // 2, 3, etc.
  baseScore: number;      // 0.5, 0.3
  search(query: string, limit: number): FallbackHit[];
}

export interface FallbackHit {
  id: string;             // deterministic, e.g. "fallback:auto-memory::user_profile.md::Builder background"
  content: string;
  source: string;         // display name
  matchCount: number;     // keyword occurrences
  totalWords: number;     // for density scoring
}
```

Export both from `packages/memory/src/index.ts`.

### 2. `packages/memory/src/retrieval.ts` — Add fallback to MemoryRetriever

Add to the class:

```typescript
private _fallbackSources: FallbackSource[] = [];

registerFallback(source: FallbackSource): void {
  this._fallbackSources.push(source);
  this._fallbackSources.sort((a, b) => a.tier - b.tier);
}
```

At the end of `semanticQuery()`, after line 135 (`const final = results.slice(0, limit);`), before access recording:

```typescript
// Fallback: if primary search returned nothing, try external sources
if (final.length === 0 && q.text && this._fallbackSources.length > 0) {
  const fallbackResults = this._searchFallbacks(q.text, limit);
  if (fallbackResults.length > 0) {
    return fallbackResults; // skip access recording — these aren't real memories
  }
}
```

Add private method:

```typescript
private _searchFallbacks(query: string, limit: number): MemoryResult[] {
  for (const source of this._fallbackSources) {
    const hits = source.search(query, limit);
    if (hits.length === 0) continue;

    // Convert FallbackHits to MemoryResults with synthetic Memory shells
    return hits.map((hit) => {
      const density = hit.totalWords > 0 ? hit.matchCount / hit.totalWords : 0;
      const score = density * source.baseScore;

      const syntheticMemory: Memory = {
        id: hit.id,
        content: hit.content,
        embedding: null,
        strength: 0,
        accessCount: 0,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        sessionId: null,
        tags: [`source:fallback-${source.name}`],
        metadata: { fallback: true, source: hit.source },
      };

      return { memory: syntheticMemory, score };
    }).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  return [];
}
```

### 3. `packages/server/src/config.ts` — Add fallback config

Add to `ServerConfig` interface:

```typescript
fallbackDirs?: Array<{ name: string; path: string; tier: number; splitOn: string }>;
```

Add to `loadConfig()`:

```typescript
fallbackDirs: overrides.fallbackDirs
  ?? parseFallbackDirs(env('FALLBACK_DIRS'))
  ?? undefined,
```

Helper:

```typescript
/**
 * Parse FORGEFRAME_FALLBACK_DIRS env var.
 * Format: "name:path:tier:splitPattern;name2:path2:tier2:splitPattern2"
 * Example: "auto-memory:~/.claude/projects/-Users-acamp/memory:2:## ;forge-ops:/Users/acamp/forge-ops/todos:3:### "
 */
function parseFallbackDirs(value: string | undefined): ServerConfig['fallbackDirs'] | undefined {
  if (!value) return undefined;
  return value.split(';').map((entry) => {
    const [name, rawPath, tierStr, splitOn] = entry.split(':');
    return {
      name: name.trim(),
      path: rawPath.trim().replace(/^~/, homedir()),
      tier: parseInt(tierStr, 10) || 2,
      splitOn: splitOn?.trim() || '## ',
    };
  });
}
```

### 4. `packages/server/src/fallback.ts` — NEW FILE

Two concrete FallbackSource implementations:

```typescript
/**
 * @forgeframe/server — Fallback Search Sources
 *
 * Keyword-based search over local markdown directories.
 * Used when semantic DB returns 0 results.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import type { FallbackSource, FallbackHit } from '@forgeframe/memory';

interface CachedDir {
  sections: ParsedSection[];
  cachedAt: number;
}

interface ParsedSection {
  filename: string;
  heading: string;
  content: string;
  wordCount: number;
}

const CACHE_TTL_MS = 30_000; // 30 seconds

export class MarkdownFallback implements FallbackSource {
  readonly name: string;
  readonly tier: number;
  readonly baseScore: number;

  private _dir: string;
  private _splitOn: string;
  private _cache: CachedDir | null = null;

  constructor(opts: { name: string; dir: string; tier: number; splitOn?: string }) {
    this.name = opts.name;
    this.tier = opts.tier;
    this.baseScore = opts.tier === 2 ? 0.5 : opts.tier === 3 ? 0.3 : 0.2;
    this._dir = opts.dir;
    this._splitOn = opts.splitOn ?? '## ';
  }

  search(query: string, limit: number): FallbackHit[] {
    const sections = this._loadSections();
    const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (queryWords.length === 0) return [];

    const hits: FallbackHit[] = [];

    for (const section of sections) {
      const lower = section.content.toLowerCase();
      let matchCount = 0;
      for (const word of queryWords) {
        if (lower.includes(word)) matchCount++;
      }

      if (matchCount === 0) continue;

      hits.push({
        id: `fallback:${this.name}::${section.filename}::${section.heading}`,
        content: section.content,
        source: `${this.name}/${section.filename}`,
        matchCount,
        totalWords: section.wordCount,
      });
    }

    // Sort by match density descending
    hits.sort((a, b) => {
      const densA = a.totalWords > 0 ? a.matchCount / a.totalWords : 0;
      const densB = b.totalWords > 0 ? b.matchCount / b.totalWords : 0;
      return densB - densA;
    });

    return hits.slice(0, limit);
  }

  private _loadSections(): ParsedSection[] {
    if (this._cache && (Date.now() - this._cache.cachedAt) < CACHE_TTL_MS) {
      return this._cache.sections;
    }

    const sections: ParsedSection[] = [];
    let files: string[];
    try {
      files = readdirSync(this._dir).filter((f) => f.endsWith('.md'));
    } catch {
      return [];
    }

    for (const file of files) {
      const text = readFileSync(join(this._dir, file), 'utf-8');
      const parts = text.split('\n' + this._splitOn);

      for (let i = 0; i < parts.length; i++) {
        const raw = i === 0 ? parts[i] : this._splitOn + parts[i];
        const trimmed = raw.trim();
        if (!trimmed || trimmed.length < 20) continue;

        const headingMatch = trimmed.match(/^#{1,4}\s+(.+)/);
        const heading = headingMatch ? headingMatch[1].trim() : `section-${i}`;
        const words = trimmed.split(/\s+/).length;

        sections.push({
          filename: basename(file),
          heading,
          content: trimmed,
          wordCount: words,
        });
      }
    }

    this._cache = { sections, cachedAt: Date.now() };
    return sections;
  }
}
```

One class handles both tiers — the `splitOn` param adapts to different heading levels (`## ` for notes, `### ` for todos).

### 5. `packages/server/src/server.ts` — Wire fallback sources

After line 32 (`const retriever = new MemoryRetriever(store, embedder);`):

```typescript
import { MarkdownFallback } from './fallback.js';

// Register fallback search sources
if (config.fallbackDirs) {
  for (const fd of config.fallbackDirs) {
    retriever.registerFallback(new MarkdownFallback({
      name: fd.name,
      dir: fd.path,
      tier: fd.tier,
      splitOn: fd.splitOn,
    }));
  }
}
```

### 6. `packages/server/src/tools.ts` — No changes needed

`memory_search` already calls `retriever.semanticQuery()` which now includes fallback. Provenance logging already records `resultCount`. The formatted output accesses `r.memory.id`, `r.memory.content`, `r.score`, `r.memory.strength`, `r.memory.tags`, `r.memory.createdAt` — all provided by synthetic Memory objects.

---

## Configuration for Alex's Setup

Set in MCP config or env:

```
FORGEFRAME_FALLBACK_DIRS="auto-memory:~/.claude/projects/-Users-acamp/memory:2:## ;forge-ops:/Users/acamp/forge-ops/todos:3:### "
```

---

## Configuration for Other Users

Any user can register markdown directories. The `FORGEFRAME_FALLBACK_DIRS` env var accepts `name:path:tier:splitPattern` entries separated by `;`. Examples:

- Obsidian vault: `notes:~/Documents/Obsidian/MyVault:2:## `
- Project docs: `docs:~/repos/myproject/docs:3:## `
- Personal todos: `todos:~/todos:3:### `

Users without a todo list simply don't set Tier 3. The system degrades gracefully — unused tiers are skipped.

---

## Guardian Integration: How This Flows Into the Workflow

When Guardian's librarian pipeline runs (post-chat: awareness-trap → summarize → embeddings → KG → librarian), it produces notes, artifacts, reframes, and awareness topics. These currently live in Guardian's local SQLite and sync to ForgeFrame via the dual-write bridge.

With fallback search:
1. **Guardian session context** — When Guardian starts a session, it queries ForgeFrame for relevant memories. If the user mentions "resume tool" or "job search", the fallback chain finds the todo item even if no one explicitly saved it to ForgeFrame.
2. **Librarian enrichment** — The librarian can surface related project context from forge-ops when generating notes. "You mentioned job search — you have a Resume Tailoring Tool in your backlog."
3. **Cross-system discovery** — Guardian's KG knows about entities and sessions. ForgeFrame's fallback knows about todos and notes. Together they close the loop: the user's projects are discoverable regardless of which system originally captured them.

Future: Guardian could auto-ingest forge-ops todos as entities in its KG, creating bidirectional links. But that's a separate feature — the fallback chain is the minimal bridge that makes it work today.

---

## Tests

### `packages/memory/src/retrieval.test.ts` (add to existing)

1. `semanticQuery with no results and no fallbacks returns empty` — baseline
2. `semanticQuery with no results triggers fallback` — register mock FallbackSource, verify synthetic results
3. `semanticQuery with results does NOT trigger fallback` — ensure fallback skipped
4. `fallback stops at first tier with results` — register two sources, first returns hits, second never called

### `packages/server/src/fallback.test.ts` (new)

5. `MarkdownFallback finds keyword matches across sections`
6. `MarkdownFallback returns empty for no matches`
7. `MarkdownFallback parses headings correctly with different splitOn patterns`
8. `TTL cache returns cached data within window`

---

## Execution Order

1. Add `FallbackSource` + `FallbackHit` to `types.ts`, export from `index.ts`
2. Add `registerFallback()` + `_searchFallbacks()` to `MemoryRetriever` in `retrieval.ts`
3. Add retrieval tests (4 tests)
4. Add config fields to `config.ts`
5. Create `fallback.ts` with `MarkdownFallback`
6. Add fallback tests (4 tests)
7. Wire in `server.ts`
8. `npm run build` — all packages must compile clean
9. `npm test` — all tests pass (existing 178 + 8 new)
10. Test manually: `memory_search` for "resume tailoring tool" should now return the todo item

---

## Key Constraints

- Match existing code style: no emojis, minimal abstractions, every line traces to the request
- The `@forgeframe/memory` package defines the interfaces; `@forgeframe/server` provides concrete implementations
- `registerFallback()` is additive — does not change constructor signature or break existing API
- Sync file reads are fine (target files are <200KB total)
- This is ForgeFrame CLAUDE.md compliant: use `/plan`, `/execute`, `/verify` workflow
