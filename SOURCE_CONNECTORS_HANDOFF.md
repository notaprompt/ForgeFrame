# ForgeFrame Source Connectors — Implementation Handoff

**Date:** 2026-03-16
**Replaces:** FALLBACK_CHAIN_HANDOFF.md
**Context:** Memory search couldn't find "Resume Tailoring Tool" because it lived in forge-ops/todos/, outside ForgeFrame's DB. The fallback chain approach was rejected: it bolted keyword search onto a semantic system, making external sources second-class. The right move is to ingest external directories into the same DB with full embeddings, so everything is searchable with the same quality.

---

## Problem

ForgeFrame's `ingestMarkdownDir` already does content-addressed dedup, section splitting, embedding, and source tagging — but only for a single hardcoded directory (`ingestDir`) with a hardcoded source tag (`source:claude-code`) and hardcoded split pattern (`## `). The user has knowledge in multiple directories (auto-memory, forge-ops/todos, project docs) that should all be first-class searchable memories.

---

## Design

### Generalize Ingestion Into Source Connectors

One ingestion function that accepts a source configuration. Each source gets:
- Its own `source:<name>` tag (not all lumped under `source:claude-code`)
- Its own split pattern (todos use `### `, notes use `## `)
- Its own initial strength (hand-curated memories rank higher than background sources)
- Full embeddings via Ollama (same as existing memories)
- Content-addressed dedup (same pattern as existing ingest)
- Stale section cleanup (sections removed from source files get deleted from DB)
- Optional TRIM layer classification (on for identity sources, off for external data)

```
Boot (sequential):
  ingestDir (claude-code): ~/.claude/projects/.../memory/*.md  → split on "## ", strength 1.0, classify on
  Source 1 (forge-ops):    ~/forge-ops/todos/*.md              → split on "### ", strength 0.6, classify off
  Source 2 (obsidian):     ~/Documents/Obsidian/Vault/*.md     → split on "## ", strength 0.5, classify off
```

**Important:** Do not add a source whose directory overlaps with `ingestDir`. Both would ingest the same files under different source tags, creating duplicate memories. `ingestDir` already covers its directory — only add *new* directories as sources.

All sources ingest into the same DB. `memory_search` finds everything with one query — no fallback tiers, no keyword matching, no second-class results. Strength differences ensure hand-curated memories rank above background data when relevance scores are close.

### Backwards Compatibility

`ingestDir` config continues to work as before (maps to a source named `claude-code` with `## ` split, strength 1.0, classify on). New `sources` config is additive.

### Stale Section Cleanup

Current `ingestMarkdownDir` handles "unchanged" and "updated" but never deletes sections that were removed from source files. The connector system tracks which sourceIds were seen during a sync pass and deletes memories whose sourceIds belong to that source but weren't seen. This prevents ghost memories from accumulating.

### Embedding at Boot

First boot with new sources is the slowest — every section needs an Ollama embedding call (~100ms each). Subsequent boots are fast because unchanged sections skip embedding. If Ollama is unavailable, memories are created without embeddings and searchable via FTS only. The existing `memory_reindex` tool backfills embeddings later when Ollama comes back. This is the same graceful degradation pattern used by `ingestMarkdownDir` today.

---

## Files to Change

### 1. `packages/server/src/ingest.ts` — Refactor to accept source config

Current signature:
```typescript
ingestMarkdownDir(dir: string, store: MemoryStore, embedder?: Embedder | null): Promise<IngestStats>
```

New export — a `SourceConfig` interface and a generalized `syncSource` function:

```typescript
export interface SourceConfig {
  name: string;              // e.g. "claude-code", "forge-ops", "obsidian"
  dir: string;               // directory path
  splitOn: string;           // section delimiter, e.g. "## " or "### "
  initialStrength?: number;  // strength for new memories (default 1.0)
  classify?: boolean;        // enable TRIM layer + constitutional detection (default false)
}

export interface SyncStats {
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  total: number;
}
```

Replace the body of `ingestMarkdownDir` so it delegates to `syncSource` for backwards compatibility:

```typescript
export async function ingestMarkdownDir(
  dir: string,
  store: MemoryStore,
  embedder?: Embedder | null,
): Promise<IngestStats> {
  const result = await syncSource(
    { name: 'claude-code', dir, splitOn: '## ', initialStrength: 1.0, classify: true },
    store,
    embedder,
  );
  return {
    created: result.created,
    updated: result.updated,
    unchanged: result.unchanged,
    total: result.total,
  };
}
```

The new `syncSource` function:

```typescript
export async function syncSource(
  source: SourceConfig,
  store: MemoryStore,
  embedder?: Embedder | null,
): Promise<SyncStats> {
  const stats: SyncStats = { created: 0, updated: 0, unchanged: 0, deleted: 0, total: 0 };
  const sourceTag = `source:${source.name}`;
  const strength = source.initialStrength ?? 1.0;
  const classify = source.classify ?? false;

  let files: string[];
  try {
    files = readdirSync(source.dir).filter((f) => f.endsWith('.md'));
  } catch {
    return stats;
  }

  // Build existing sourceId -> memory map for this source
  // Limit 10000 to avoid dedup failures with large sources
  const existing = store.listByTag(sourceTag, 10000);
  const existingMap = new Map<string, { id: string; content: string }>();
  for (const m of existing) {
    const sid = (m.metadata as Record<string, unknown>)?.sourceId as string;
    if (sid) existingMap.set(sid, { id: m.id, content: m.content });
  }

  // Track which sourceIds we see this pass (for stale cleanup)
  const seenSourceIds = new Set<string>();

  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(join(source.dir, file), 'utf-8');
    } catch {
      continue; // skip unreadable files, don't kill the whole source
    }
    const sections = parseSections(file, text, source.splitOn, classify);

    for (const section of sections) {
      stats.total++;
      seenSourceIds.add(section.sourceId);
      const prev = existingMap.get(section.sourceId);

      if (prev && prev.content === section.content) {
        stats.unchanged++;
        continue;
      }

      const tags = [sourceTag, `file:${basename(file, '.md')}`];
      const metadata: Record<string, unknown> = {
        source: source.name,
        sourceId: section.sourceId,
        extractedBy: 'rule',
        trimLayer: section.trimLayer,
      };
      if (section.constitutional) {
        metadata.constitutional = true;
      }

      let embedding: number[] | undefined;
      if (embedder) {
        const vec = await embedder.embed(section.content);
        if (vec) embedding = vec;
      }

      if (prev) {
        store.update(prev.id, { content: section.content, embedding, tags, metadata });
        stats.updated++;
      } else {
        const mem = store.create({ content: section.content, embedding, tags, metadata });
        // Apply initial strength (new memories default to 1.0, external sources may want lower)
        if (strength < 1.0) {
          store.resetStrength(mem.id, strength);
        }
        stats.created++;
      }
    }
  }

  // Delete stale sections (sourceId belongs to this source but wasn't seen)
  for (const [sid, prev] of existingMap) {
    if (!seenSourceIds.has(sid)) {
      store.delete(prev.id);
      stats.deleted++;
    }
  }

  return stats;
}
```

Update `parseSections` to accept `splitOn` and `classify`:

```typescript
function parseSections(filename: string, text: string, splitOn: string, classify: boolean): Section[] {
  const parts = text.split('\n' + splitOn);
  const sections: Section[] = [];

  for (let i = 0; i < parts.length; i++) {
    const raw = i === 0 ? parts[i] : splitOn + parts[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length < 20) continue;

    const headingMatch = trimmed.match(/^#{1,4}\s+(.+)/);
    const heading = headingMatch ? headingMatch[1].trim() : `section-${i}`;
    const sourceId = `${filename}::${heading}`;

    // TRIM classification only for sources that opt in (identity sources like claude-code).
    // External sources default to object layer, never constitutional.
    const trimLayer = classify ? detectTrimLayer(trimmed) : 'object';
    const constitutional = classify ? isConstitutional(trimmed, trimLayer) : false;

    sections.push({ sourceId, content: trimmed, trimLayer, constitutional });
  }

  return sections;
}
```

Note: the existing `parseSections` splits on `/\n## /` (regex). The refactored version splits on string concatenation `'\n' + splitOn`. This is equivalent for `splitOn = '## '` since the regex `/\n## /` matches the literal string `\n## `. String splitting avoids regex escaping issues for arbitrary delimiters.

### 2. `packages/server/src/config.ts` — Add sources config

Add to `ServerConfig` interface:

```typescript
sources?: SourceConfig[];
```

Add import at top:

```typescript
import type { SourceConfig } from './ingest.js';
```

Add to `loadConfig()` return object, after `ingestDir`:

```typescript
sources: overrides.sources
  ?? parseSources(env('SOURCES'))
  ?? undefined,
```

Add helper:

```typescript
/**
 * Parse FORGEFRAME_SOURCES env var.
 * Format: "name|path|splitPattern|strength;name2|path2|splitPattern2|strength2"
 * Example: "forge-ops|~/forge-ops/todos|### |0.6;obsidian|~/Documents/Obsidian/Vault|## |0.5"
 *
 * Uses | as field separator (preserves splitOn trailing spaces).
 * Uses ; as entry separator.
 * Strength is optional (defaults to 0.6 for external sources).
 * classify defaults to false for sources defined via env var.
 */
function parseSources(value: string | undefined): SourceConfig[] | undefined {
  if (!value) return undefined;
  return value.split(';').filter(Boolean).map((entry) => {
    const [name, rawPath, splitOn, strengthStr] = entry.split('|');
    return {
      name: name.trim(),
      dir: rawPath.trim().replace(/^~/, homedir()),
      splitOn: splitOn || '## ',
      initialStrength: strengthStr ? parseFloat(strengthStr) : 0.6,
      classify: false,
    };
  });
}
```

### 3. `packages/server/src/server.ts` — Wire source connectors

Import `syncSource`:

```typescript
import { ingestMarkdownDir, syncSource } from './ingest.js';
```

Replace the existing `ingestDir` fire-and-forget block (lines 59-62) with a single sequential chain:

```typescript
  // All ingestion runs sequentially in a single async chain.
  // This avoids interleaved SQLite writes and Ollama calls between
  // ingestDir and source connectors.
  (async () => {
    // Boot-context ingestion (existing behavior)
    if (config.ingestDir) {
      await ingestMarkdownDir(config.ingestDir, store, embedder).catch(() => {});
    }

    // Source connector ingestion
    if (config.sources) {
      const seen = new Set<string>();
      for (const source of config.sources) {
        if (seen.has(source.name)) continue; // duplicate name — skip
        seen.add(source.name);
        await syncSource(source, store, embedder).catch(() => {});
      }
    }
  })();
```

All ingestion runs sequentially in a single async IIFE (non-blocking to server startup). This ensures `ingestDir` completes before sources start, and sources don't interleave with each other. Duplicate source names are silently dropped — first definition wins.

### 4. `packages/server/src/tools.ts` — No changes needed

`memory_search` calls `retriever.semanticQuery()` which searches the entire DB. Source-tagged memories appear alongside all others. The formatted output (`id`, `content`, `score`, `strength`, `tags`, `createdAt`) already exposes the `source:forge-ops` tag so the caller knows provenance.

### 5. `packages/memory/src/retrieval.ts` — No changes needed

The retriever searches all memories in the DB. Source connectors add memories to the same DB, so they're automatically included in FTS + semantic search. No fallback logic needed. The scoring formula (`textScore * 0.4 + semanticScore * 0.4 + strength * 0.2`) naturally ranks higher-strength memories above lower-strength ones when relevance is similar.

---

## Configuration for Alex's Setup

Set in MCP config or env:

```
FORGEFRAME_SOURCES="forge-ops|~/forge-ops/todos|### |0.6"
```

`FORGEFRAME_INGEST_DIR` already covers `~/.claude/projects/-Users-acamp/memory` (as `source:claude-code`, strength 1.0, classify on). Do not add it again as a source — that would create duplicate memories under a different tag. Only add directories not already covered by `ingestDir`.

---

## Configuration for Other Users

```
FORGEFRAME_SOURCES="obsidian|~/Documents/Obsidian/Vault|## ;project-docs|~/repos/myproject/docs|## "
```

Users who don't set `FORGEFRAME_SOURCES` get no change in behavior. The system degrades gracefully — zero sources means zero extra ingestion.

---

## Tests

### `packages/server/src/ingest.test.ts` — Add to existing

1. `syncSource creates memories with correct source tag` — source named "test-notes" → tagged `source:test-notes`
2. `syncSource is idempotent` — second run produces 0 created, 0 updated, all unchanged
3. `syncSource detects content changes` — update file content, verify stats.updated > 0
4. `syncSource deletes stale sections` — remove a section from file, verify stats.deleted > 0 and memory gone
5. `syncSource uses custom splitOn` — split on `### `, verify sections parse correctly
6. `syncSource handles nonexistent directory` — returns zero stats
7. `syncSource applies initialStrength` — create with strength 0.6, verify stored memory has strength 0.6
8. `syncSource with classify false skips TRIM detection` — content with "voice" keyword → trimLayer still "object", constitutional false
9. `syncSource with classify true applies TRIM detection` — content with "voice" keyword → trimLayer "interpreter", constitutional true
10. `syncSource skips unreadable files without killing sync` — one bad file in directory, other files still ingested
11. `ingestMarkdownDir still works unchanged` — existing tests continue passing (backwards compat)

---

## Execution Order

1. Refactor `parseSections` to accept `splitOn` and `classify` parameters
2. Add `SourceConfig`, `SyncStats`, and `syncSource` to `ingest.ts`
3. Refactor `ingestMarkdownDir` to delegate to `syncSource` with `classify: true`, `initialStrength: 1.0`
4. Run existing ingest tests — all 7 must still pass (backwards compat)
5. Add `sources` config to `config.ts` with `parseSources` helper
6. Wire `syncSource` in `server.ts` with name dedup and sequential execution
7. Add 10 new ingest tests
8. `npm run build` — all packages compile clean
9. `npm test` — all tests pass (existing + 10 new)
10. Manual test: set `FORGEFRAME_SOURCES`, restart server, `memory_search` for "resume tailoring tool"

---

## Key Constraints

- Match existing code style: no emojis, minimal abstractions, every line traces to the request
- `ingestMarkdownDir` signature and behavior must not change (backwards compat)
- `syncSource` follows the same patterns: sync file reads, content-addressed dedup, optional embedding
- Source tag format: `source:<name>` (e.g. `source:forge-ops`) — consistent with existing `source:claude-code`
- Stale cleanup only deletes memories tagged with the source being synced — never touches other sources
- `parseSources` uses `|` as field separator to preserve `splitOn` trailing spaces
- `listByTag` uses limit 10000 (not 500) to avoid dedup failures with large sources
- Duplicate source names silently dropped at registration — first definition wins
- TRIM/constitutional classification off by default for external sources — prevents false constitutional flags
- External sources default to strength 0.6 — hand-curated memories (1.0) rank higher when relevance is close
- All ingestion (ingestDir + sources) runs in a single sequential async chain — no interleaved writes
- Per-file read failures are caught and skipped — one bad file doesn't kill the whole source
- Do not configure a source whose directory overlaps with `ingestDir` — duplicates will result

---

## What This Enables Next

### Near-term (no additional code)
- Any user adds markdown directories via env var → full semantic search over all local knowledge
- Source tags enable filtered search: `memory_search` with `tags: ["source:forge-ops"]`
- Strength differentiation ensures curated memories outrank background data

### Medium-term (small additions)
- **File watching:** Replace boot-time sync with `fs.watch`/chokidar for live updates. `syncSource` already handles create/update/delete — the watcher just calls it on file change events.
- **Resync MCP tool:** Expose `memory_resync` tool that re-runs `syncSource` for all registered sources on demand. One tool definition, no new logic.
- **Per-source decay rates:** Add optional `decayRate` to `SourceConfig`. Todos decay faster than notes. Identity sources never decay.

### Long-term (platform play)
- **Connector ecosystem:** The `SourceConfig` interface is the seed. Future connectors (Obsidian, Apple Notes export, browser bookmarks, Slack archive, email) implement the same pattern: read → split → upsert with source tags.
- **Cross-source linking:** Guardian's KG entities link to ForgeFrame memories by sourceId. The deterministic `filename::heading` format makes this possible without extra coordination.

---

## Why This Over the Fallback Chain

| Dimension | Fallback Chain | Source Connectors |
|-----------|---------------|-------------------|
| Search quality | Keyword-only for external sources | Full semantic search for everything |
| Scoring | Artificial tier weights (0.5, 0.3) | Strength-weighted within same algorithm |
| Short-circuit risk | Tier 2 match blocks Tier 3 | No tiers — all results compete fairly |
| Ranking signal | None (external sources unranked vs internal) | initialStrength preserves curation signal |
| TRIM/constitutional | Applied blindly to all sources | Opt-in per source, off by default |
| Code surface | New search path + new types + new scoring | 1 new function + config field |
| Extensibility | Each source needs search() impl | Each source is just a directory path |
| Cache coherence | 30s TTL, stale reads possible | Ingested at boot, always in DB |
| Scaling | No dedup limit concern (ephemeral) | listByTag limit raised to 10000 |
| Future connectors | Must implement FallbackSource | Just add a directory to config |
