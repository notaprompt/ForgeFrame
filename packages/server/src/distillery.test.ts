import { describe, it, expect, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { MemoryStore } from '@forgeframe/memory';
import { DistilleryIntake } from './distillery.js';
import type { DistilleryConfig, SyncResult } from './distillery.js';

const DISTILLERY_SCHEMA = `
  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    source_url TEXT,
    source_type TEXT,
    raw_input TEXT,
    extracted_content TEXT,
    status TEXT,
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    distilled_at TIMESTAMP
  );

  CREATE TABLE distillations (
    id INTEGER PRIMARY KEY,
    item_id INTEGER REFERENCES items(id),
    resonance REAL,
    reframed TEXT,
    connections TEXT,
    action_surface TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

function createDistilleryDb(dir: string): string {
  const dbPath = join(dir, 'distillery.db');
  const db = new Database(dbPath);
  db.exec(DISTILLERY_SCHEMA);
  return dbPath;
}

function insertItem(
  dbPath: string,
  opts: {
    sourceUrl?: string;
    sourceType?: string;
    rawInput?: string;
    extractedContent?: string;
    resonance?: number;
    reframed?: string;
    connections?: string;
    actionSurface?: string;
    status?: string;
    withDistillation?: boolean;
  } = {},
): number {
  const db = new Database(dbPath);
  const info = db.prepare(`
    INSERT INTO items (source_url, source_type, raw_input, extracted_content, status, distilled_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(
    opts.sourceUrl ?? 'https://example.com/article',
    opts.sourceType ?? 'web',
    opts.rawInput ?? 'Some raw input content',
    opts.extractedContent ?? 'Extracted content here',
    opts.status ?? 'done',
  );
  const itemId = info.lastInsertRowid as number;

  if (opts.withDistillation !== false) {
    db.prepare(`
      INSERT INTO distillations (item_id, resonance, reframed, connections, action_surface)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      itemId,
      opts.resonance ?? 0.5,
      opts.reframed ?? 'A distilled insight about the article.',
      opts.connections ?? '["ai", "memory"]',
      opts.actionSurface ?? '',
    );
  }

  db.close();
  return itemId;
}

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe('DistilleryIntake', () => {
  let store: MemoryStore;
  let tmpDir: string;
  let distilleryDbPath: string;

  function setup() {
    tmpDir = join(tmpdir(), `distillery-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
    store = new MemoryStore({ dbPath: ':memory:' });
    distilleryDbPath = createDistilleryDb(tmpDir);
  }

  function makeIntake(overrides: Partial<DistilleryConfig> = {}) {
    return new DistilleryIntake(
      store,
      null,
      {
        distilleryDbPath,
        pollIntervalMs: 0,
        ...overrides,
      },
      silentLogger,
    );
  }

  afterEach(() => {
    try { store?.close(); } catch {}
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('imports correct number of items', async () => {
    setup();
    insertItem(distilleryDbPath, { rawInput: 'item-one' });
    insertItem(distilleryDbPath, { rawInput: 'item-two' });
    insertItem(distilleryDbPath, { rawInput: 'item-three' });

    const intake = makeIntake();
    const result = await intake.sync();

    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('derives skill tag from action_surface', async () => {
    setup();
    insertItem(distilleryDbPath, {
      rawInput: 'skill-item',
      actionSurface: 'Try implementing a RAG pipeline',
      resonance: 0.5,
    });

    const intake = makeIntake();
    await intake.sync();

    const memories = store.listByTag('skill');
    expect(memories.length).toBe(1);
    expect(memories[0].tags).toContain('source:distillery');
    expect(memories[0].tags).toContain('skill');
    expect(memories[0].tags).not.toContain('observation');
  });

  it('derives pattern tag from resonance > 0.8', async () => {
    setup();
    insertItem(distilleryDbPath, {
      rawInput: 'pattern-item',
      resonance: 0.95,
      actionSurface: '',
    });

    const intake = makeIntake();
    await intake.sync();

    const memories = store.listByTag('pattern');
    expect(memories.length).toBe(1);
    expect(memories[0].tags).toContain('pattern');
    expect(memories[0].tags).not.toContain('observation');
  });

  it('defaults to observation when no skill or pattern', async () => {
    setup();
    insertItem(distilleryDbPath, {
      rawInput: 'observation-item',
      resonance: 0.3,
      actionSurface: '',
    });

    const intake = makeIntake();
    await intake.sync();

    const memories = store.listByTag('observation');
    expect(memories.length).toBe(1);
    expect(memories[0].tags).toContain('observation');
    expect(memories[0].tags).not.toContain('skill');
    expect(memories[0].tags).not.toContain('pattern');
  });

  it('skips duplicates on re-sync (idempotent)', async () => {
    setup();
    insertItem(distilleryDbPath, { rawInput: 'idempotent-item' });

    const intake = makeIntake();
    const first = await intake.sync();
    const second = await intake.sync();

    expect(first.imported).toBe(1);
    expect(first.skipped).toBe(0);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('creates artifact records with correct fields', async () => {
    setup();
    insertItem(distilleryDbPath, {
      rawInput: 'artifact-check',
      sourceUrl: 'https://example.com/test',
      sourceType: 'arxiv',
      reframed: 'Distilled arxiv insight.',
    });

    const intake = makeIntake();
    await intake.sync();

    const memories = store.listByTag('source:distillery');
    expect(memories.length).toBe(1);

    const artifactId = (memories[0].metadata as Record<string, unknown>).distilledArtifactId as string;
    const artifact = store.getArtifact(artifactId);
    expect(artifact).not.toBeNull();
    expect(artifact!.sourceUrl).toBe('https://example.com/test');
    expect(artifact!.sourceType).toBe('arxiv');
    expect(artifact!.distilled).toBe('Distilled arxiv insight.');
    expect(artifact!.tags).toContain('source:distillery');
    expect(artifact!.tags).toContain('source-type:arxiv');
  });

  it('creates memory with correct metadata', async () => {
    setup();
    insertItem(distilleryDbPath, {
      rawInput: 'metadata-check',
      sourceUrl: 'https://example.com/meta',
      sourceType: 'video',
      resonance: 0.72,
      reframed: 'A distilled video insight.',
      actionSurface: '',
    });

    const intake = makeIntake();
    await intake.sync();

    const memories = store.listByTag('source:distillery');
    expect(memories.length).toBe(1);

    const meta = memories[0].metadata as Record<string, unknown>;
    expect(meta.source).toBe('distillery');
    expect(meta.sourceUrl).toBe('https://example.com/meta');
    expect(meta.sourceType).toBe('video');
    expect(meta.resonance).toBe(0.72);
    expect(meta.actionSurface).toBeNull();
    expect(meta.distilledArtifactId).toBeDefined();
  });

  it('markArtifactFed sets fed_to_memory and memory_id', async () => {
    setup();
    insertItem(distilleryDbPath, { rawInput: 'fed-check' });

    const intake = makeIntake();
    await intake.sync();

    const memories = store.listByTag('source:distillery');
    expect(memories.length).toBe(1);

    const artifactId = (memories[0].metadata as Record<string, unknown>).distilledArtifactId as string;
    const artifact = store.getArtifact(artifactId);
    expect(artifact).not.toBeNull();
    expect(artifact!.fedToMemory).not.toBeNull();
    expect(artifact!.memoryId).toBe(memories[0].id);
  });

  it('skips items without distillations', async () => {
    setup();
    insertItem(distilleryDbPath, { rawInput: 'has-distillation' });
    insertItem(distilleryDbPath, { rawInput: 'no-distillation', withDistillation: false });

    const intake = makeIntake();
    const result = await intake.sync();

    expect(result.imported).toBe(1);
  });

  it('skips items not in done status', async () => {
    setup();
    insertItem(distilleryDbPath, { rawInput: 'done-item', status: 'done' });
    insertItem(distilleryDbPath, { rawInput: 'error-item', status: 'error' });
    insertItem(distilleryDbPath, { rawInput: 'queued-item', status: 'queued' });

    const intake = makeIntake();
    const result = await intake.sync();

    expect(result.imported).toBe(1);
  });

  it('adds connection strings as tags', async () => {
    setup();
    insertItem(distilleryDbPath, {
      rawInput: 'connections-test',
      connections: '["sovereignty", "local-first", "' + 'x'.repeat(60) + '"]',
    });

    const intake = makeIntake();
    await intake.sync();

    const memories = store.listByTag('sovereignty');
    expect(memories.length).toBe(1);
    expect(memories[0].tags).toContain('local-first');
    // Long connection string (>50 chars) should be excluded
    expect(memories[0].tags).not.toContain('x'.repeat(60));
  });

  it('handles missing distillery DB gracefully', async () => {
    setup();
    const intake = new DistilleryIntake(
      store,
      null,
      { distilleryDbPath: '/nonexistent/distillery.db', pollIntervalMs: 0 },
      silentLogger,
    );

    const result = await intake.sync();
    expect(result.imported).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('continues processing after individual item error', async () => {
    setup();
    // Insert two valid items
    insertItem(distilleryDbPath, { rawInput: 'good-item-1' });
    insertItem(distilleryDbPath, { rawInput: 'good-item-2' });

    // Sabotage getArtifactByHash to fail on first call then work
    const intake = makeIntake();
    let callCount = 0;
    const originalGetByHash = store.getArtifactByHash.bind(store);
    vi.spyOn(store, 'getArtifactByHash').mockImplementation((hash: string) => {
      callCount++;
      if (callCount === 1) throw new Error('Simulated failure');
      return originalGetByHash(hash);
    });

    const result = await intake.sync();
    expect(result.errors.length).toBe(1);
    expect(result.imported).toBe(1);
  });

  it('calls embedder when provided (fire and forget)', async () => {
    setup();
    insertItem(distilleryDbPath, { rawInput: 'embed-item', reframed: 'Embeddable insight.' });

    const mockEmbedder = { embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) };
    const intake = new DistilleryIntake(
      store,
      mockEmbedder,
      { distilleryDbPath, pollIntervalMs: 0 },
      silentLogger,
    );

    await intake.sync();

    // Give the fire-and-forget promise time to resolve
    await new Promise((r) => setTimeout(r, 50));

    expect(mockEmbedder.embed).toHaveBeenCalledWith('Embeddable insight.');
  });

  it('polling can be started and stopped', () => {
    setup();
    const intake = makeIntake({ pollIntervalMs: 60000 });
    intake.startPolling();
    // No error thrown, timer is set
    intake.stopPolling();
    // No error thrown, timer is cleared
  });
});
