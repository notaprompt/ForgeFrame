/**
 * @forgeframe/server — Markdown Directory Ingestion
 *
 * Reads .md files, parses into sections, upserts as memories.
 * Idempotent: only creates/updates when content changes.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import type { MemoryStore, Embedder } from '@forgeframe/memory';

export interface IngestStats {
  created: number;
  updated: number;
  unchanged: number;
  total: number;
}

export interface SourceConfig {
  name: string;
  dir: string;
  splitOn: string;
  initialStrength?: number;
  classify?: boolean;
}

export interface SyncStats {
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  total: number;
}

interface Section {
  sourceId: string;
  content: string;
  trimLayer: 'object' | 'observer' | 'interpreter';
  constitutional: boolean;
}

const INTERPRETER_KEYWORDS = /\b(preference|voice|principle|rule|conviction|positioning|no emoji|no link|never)\b/i;
const OBSERVER_KEYWORDS = /\b(pattern|workflow|dispatch|assessment|evaluation|recurring)\b/i;

function detectTrimLayer(content: string): 'object' | 'observer' | 'interpreter' {
  if (INTERPRETER_KEYWORDS.test(content)) return 'interpreter';
  if (OBSERVER_KEYWORDS.test(content)) return 'observer';
  return 'object';
}

function isConstitutional(content: string, trimLayer: string): boolean {
  if (trimLayer !== 'interpreter') return false;
  return /\b(voice|principle|preference|rule|positioning|sector|governance)\b/i.test(content);
}

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

    const trimLayer = classify ? detectTrimLayer(trimmed) : 'object';
    const constitutional = classify ? isConstitutional(trimmed, trimLayer) : false;

    sections.push({ sourceId, content: trimmed, trimLayer, constitutional });
  }

  return sections;
}

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
      continue;
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
