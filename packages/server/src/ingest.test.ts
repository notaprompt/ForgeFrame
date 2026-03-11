import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { MemoryStore } from '@forgeframe/memory';
import { ingestMarkdownDir } from './ingest.js';

describe('ingestMarkdownDir', () => {
  let store: MemoryStore;
  let tmpDir: string;

  function setup() {
    store = new MemoryStore({ dbPath: ':memory:' });
    tmpDir = join(tmpdir(), `ingest-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
  }

  afterEach(() => {
    try { store?.close(); } catch {}
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('ingests sections from markdown files', async () => {
    setup();
    writeFileSync(join(tmpDir, 'test.md'), [
      '# Header',
      'Some intro content that is long enough to pass the minimum length filter.',
      '',
      '## Section One',
      'Content for section one with enough text to be meaningful for testing.',
      '',
      '## Section Two',
      'Content for section two with enough text to be meaningful for testing.',
    ].join('\n'));

    const stats = await ingestMarkdownDir(tmpDir, store);

    expect(stats.created).toBeGreaterThanOrEqual(2);
    expect(stats.unchanged).toBe(0);
    expect(stats.updated).toBe(0);
  });

  it('is idempotent — second run changes nothing', async () => {
    setup();
    writeFileSync(join(tmpDir, 'test.md'), [
      '## Stable Section',
      'This content does not change between runs and should be long enough.',
    ].join('\n'));

    await ingestMarkdownDir(tmpDir, store);
    const stats2 = await ingestMarkdownDir(tmpDir, store);

    expect(stats2.created).toBe(0);
    expect(stats2.unchanged).toBeGreaterThanOrEqual(1);
  });

  it('detects content changes and updates', async () => {
    setup();
    writeFileSync(join(tmpDir, 'test.md'), [
      '## Mutable Section',
      'Version one of the content with enough text for the filter.',
    ].join('\n'));

    await ingestMarkdownDir(tmpDir, store);

    writeFileSync(join(tmpDir, 'test.md'), [
      '## Mutable Section',
      'Version two of the content with different text for the filter.',
    ].join('\n'));

    const stats2 = await ingestMarkdownDir(tmpDir, store);
    expect(stats2.updated).toBe(1);
    expect(stats2.created).toBe(0);
  });

  it('tags memories with source:claude-code', async () => {
    setup();
    writeFileSync(join(tmpDir, 'notes.md'), [
      '## Test Note',
      'A note with enough content to pass the minimum length filter easily.',
    ].join('\n'));

    await ingestMarkdownDir(tmpDir, store);

    const tagged = store.listByTag('source:claude-code');
    expect(tagged.length).toBeGreaterThanOrEqual(1);
  });

  it('marks voice/principle sections as constitutional', async () => {
    setup();
    writeFileSync(join(tmpDir, 'prefs.md'), [
      '## User Preferences',
      'No emojis in any output. This is a voice rule and principle for all communication.',
    ].join('\n'));

    await ingestMarkdownDir(tmpDir, store);

    const tagged = store.listByTag('source:claude-code');
    const constitutional = tagged.filter(
      (m) => (m.metadata as Record<string, unknown>)?.constitutional === true,
    );
    expect(constitutional.length).toBeGreaterThanOrEqual(1);
  });

  it('returns zero stats for nonexistent directory', async () => {
    setup();
    const stats = await ingestMarkdownDir('/nonexistent/path', store);
    expect(stats.total).toBe(0);
  });

  it('calls embedder when provided', async () => {
    setup();
    const mockEmbedder = { embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) };

    writeFileSync(join(tmpDir, 'embed.md'), [
      '## Embeddable',
      'Content that should get embedded with a long enough body for the filter.',
    ].join('\n'));

    await ingestMarkdownDir(tmpDir, store, mockEmbedder);
    expect(mockEmbedder.embed).toHaveBeenCalled();
  });
});
