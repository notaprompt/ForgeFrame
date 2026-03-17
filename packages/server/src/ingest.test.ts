import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { MemoryStore } from '@forgeframe/memory';
import { ingestMarkdownDir, syncSource } from './ingest.js';

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

describe('syncSource', () => {
  let store: MemoryStore;
  let tmpDir: string;

  function setup() {
    store = new MemoryStore({ dbPath: ':memory:' });
    tmpDir = join(tmpdir(), `sync-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
  }

  afterEach(() => {
    try { store?.close(); } catch {}
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('creates memories with correct source tag', async () => {
    setup();
    writeFileSync(join(tmpDir, 'notes.md'), [
      '## Test Note',
      'A note with enough content to pass the minimum length filter easily.',
    ].join('\n'));

    await syncSource({ name: 'test-notes', dir: tmpDir, splitOn: '## ' }, store);

    const tagged = store.listByTag('source:test-notes');
    expect(tagged.length).toBeGreaterThanOrEqual(1);
    expect(tagged[0].tags).toContain('source:test-notes');
  });

  it('is idempotent', async () => {
    setup();
    writeFileSync(join(tmpDir, 'notes.md'), [
      '## Stable Note',
      'This content does not change between sync runs and should be long enough.',
    ].join('\n'));

    const source = { name: 'stable', dir: tmpDir, splitOn: '## ' };
    await syncSource(source, store);
    const stats2 = await syncSource(source, store);

    expect(stats2.created).toBe(0);
    expect(stats2.updated).toBe(0);
    expect(stats2.unchanged).toBeGreaterThanOrEqual(1);
  });

  it('detects content changes', async () => {
    setup();
    writeFileSync(join(tmpDir, 'notes.md'), [
      '## Changing Note',
      'Version one content with enough text for the length filter.',
    ].join('\n'));

    const source = { name: 'change-test', dir: tmpDir, splitOn: '## ' };
    await syncSource(source, store);

    writeFileSync(join(tmpDir, 'notes.md'), [
      '## Changing Note',
      'Version two content that is different from the first version.',
    ].join('\n'));

    const stats2 = await syncSource(source, store);
    expect(stats2.updated).toBe(1);
  });

  it('deletes stale sections', async () => {
    setup();
    writeFileSync(join(tmpDir, 'notes.md'), [
      '## Section Alpha',
      'Alpha content with enough text to pass the minimum length filter.',
      '',
      '## Section Beta',
      'Beta content with enough text to pass the minimum length filter.',
    ].join('\n'));

    const source = { name: 'stale-test', dir: tmpDir, splitOn: '## ' };
    await syncSource(source, store);
    expect(store.listByTag('source:stale-test').length).toBe(2);

    // Remove Section Beta
    writeFileSync(join(tmpDir, 'notes.md'), [
      '## Section Alpha',
      'Alpha content with enough text to pass the minimum length filter.',
    ].join('\n'));

    const stats2 = await syncSource(source, store);
    expect(stats2.deleted).toBe(1);
    expect(store.listByTag('source:stale-test').length).toBe(1);
  });

  it('uses custom splitOn', async () => {
    setup();
    writeFileSync(join(tmpDir, 'todos.md'), [
      '### Task Alpha',
      'Deploy the guardian pipeline to production environment.',
      '',
      '### Task Beta',
      'Buy groceries for the weekend dinner party.',
    ].join('\n'));

    const stats = await syncSource(
      { name: 'todos', dir: tmpDir, splitOn: '### ' },
      store,
    );

    expect(stats.created).toBe(2);
    const tagged = store.listByTag('source:todos');
    expect(tagged.length).toBe(2);
  });

  it('handles nonexistent directory', async () => {
    setup();
    const stats = await syncSource(
      { name: 'missing', dir: '/nonexistent/path', splitOn: '## ' },
      store,
    );
    expect(stats.total).toBe(0);
  });

  it('applies initialStrength', async () => {
    setup();
    writeFileSync(join(tmpDir, 'notes.md'), [
      '## Low Strength Note',
      'This note should have lower strength than default memories.',
    ].join('\n'));

    await syncSource(
      { name: 'weak', dir: tmpDir, splitOn: '## ', initialStrength: 0.6 },
      store,
    );

    const tagged = store.listByTag('source:weak');
    expect(tagged.length).toBe(1);
    expect(tagged[0].strength).toBeCloseTo(0.6);
  });

  it('with classify false skips TRIM detection', async () => {
    setup();
    writeFileSync(join(tmpDir, 'notes.md'), [
      '## Voice and Principle Section',
      'This section has voice and principle keywords but classify is off.',
    ].join('\n'));

    await syncSource(
      { name: 'no-trim', dir: tmpDir, splitOn: '## ', classify: false },
      store,
    );

    const tagged = store.listByTag('source:no-trim');
    expect(tagged.length).toBe(1);
    const meta = tagged[0].metadata as Record<string, unknown>;
    expect(meta.trimLayer).toBe('object');
    expect(meta.constitutional).toBeUndefined();
  });

  it('with classify true applies TRIM detection', async () => {
    setup();
    writeFileSync(join(tmpDir, 'notes.md'), [
      '## Voice and Principle Section',
      'This section has voice and principle keywords and classify is on.',
    ].join('\n'));

    await syncSource(
      { name: 'with-trim', dir: tmpDir, splitOn: '## ', classify: true },
      store,
    );

    const tagged = store.listByTag('source:with-trim');
    expect(tagged.length).toBe(1);
    const meta = tagged[0].metadata as Record<string, unknown>;
    expect(meta.trimLayer).toBe('interpreter');
    expect(meta.constitutional).toBe(true);
  });

  it('skips unreadable files without killing sync', async () => {
    setup();
    writeFileSync(join(tmpDir, 'good.md'), [
      '## Good Section',
      'This file is readable and should be ingested successfully.',
    ].join('\n'));
    writeFileSync(join(tmpDir, 'bad.md'), [
      '## Bad Section',
      'This file will become unreadable during the test run.',
    ].join('\n'));
    chmodSync(join(tmpDir, 'bad.md'), 0o000);

    const stats = await syncSource(
      { name: 'partial', dir: tmpDir, splitOn: '## ' },
      store,
    );

    // Restore permissions for cleanup
    chmodSync(join(tmpDir, 'bad.md'), 0o644);

    expect(stats.created).toBeGreaterThanOrEqual(1);
    const tagged = store.listByTag('source:partial');
    expect(tagged.length).toBeGreaterThanOrEqual(1);
  });
});
