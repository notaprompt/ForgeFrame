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

function parseSections(filename: string, text: string): Section[] {
  const parts = text.split(/\n## /);
  const sections: Section[] = [];

  for (let i = 0; i < parts.length; i++) {
    const raw = i === 0 ? parts[i] : '## ' + parts[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length < 20) continue;

    // Extract heading for sourceId
    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)/);
    const heading = headingMatch ? headingMatch[1].trim() : `section-${i}`;
    const sourceId = `${filename}::${heading}`;

    const trimLayer = detectTrimLayer(trimmed);
    const constitutional = isConstitutional(trimmed, trimLayer);

    sections.push({ sourceId, content: trimmed, trimLayer, constitutional });
  }

  return sections;
}

export async function ingestMarkdownDir(
  dir: string,
  store: MemoryStore,
  embedder?: Embedder | null,
): Promise<IngestStats> {
  const stats: IngestStats = { created: 0, updated: 0, unchanged: 0, total: 0 };

  // Read all .md files
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return stats;
  }

  // Build existing sourceId -> memory map
  const existing = store.listByTag('source:claude-code', 500);
  const existingMap = new Map<string, { id: string; content: string }>();
  for (const m of existing) {
    const sid = (m.metadata as Record<string, unknown>)?.sourceId as string;
    if (sid) existingMap.set(sid, { id: m.id, content: m.content });
  }

  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf-8');
    const sections = parseSections(file, text);

    for (const section of sections) {
      stats.total++;
      const prev = existingMap.get(section.sourceId);

      if (prev && prev.content === section.content) {
        stats.unchanged++;
        continue;
      }

      const tags = ['source:claude-code', `file:${basename(file, '.md')}`];
      const metadata: Record<string, unknown> = {
        source: 'claude-code',
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
        store.update(prev.id, {
          content: section.content,
          embedding,
          tags,
          metadata,
        });
        stats.updated++;
      } else {
        store.create({
          content: section.content,
          embedding,
          tags,
          metadata,
        });
        stats.created++;
      }
    }
  }

  return stats;
}
