import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import type { Generator } from './generator.js';
import { writeDreamJournal } from './dream-journal.js';
import type { DreamJournalInput } from './dream-journal.js';

class MockGenerator implements Generator {
  async generate(_prompt: string): Promise<string | null> {
    return `---
type: dream-journal
phase: nrem
timestamp: 2026-04-13T04:00:00.000Z
duration_ms: 5000
sleep_pressure_before: 60
sleep_pressure_after: 20
---

## What changed
- Pruned 2 edges below threshold
- Applied strength decay

## What I'm proposing
- 1 deduplication proposal queued

## Graph health
- Total memories: 3
- Total edges: 2
- Avg edge weight: 0.9
- Orphan memories: 1`;
  }
}

class FailingGenerator implements Generator {
  async generate(_prompt: string): Promise<string | null> {
    return null;
  }
}

function makeInput(overrides: Partial<DreamJournalInput> = {}): DreamJournalInput {
  return {
    phase: 'nrem',
    duration: 5000,
    sleepPressureBefore: 60,
    sleepPressureAfter: 20,
    edgesPruned: 2,
    decayApplied: true,
    clustersFound: 1,
    dedupProposals: 1,
    valenceBackfilled: 0,
    errors: [],
    ...overrides,
  };
}

describe('writeDreamJournal — tags', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('writes a journal memory with correct tags', async () => {
    const input = makeInput();
    const memory = await writeDreamJournal(store, input, null);

    expect(memory).not.toBeNull();
    expect(memory!.tags).toContain('dream-journal');
    expect(memory!.tags).toContain('nrem');
    // Date tag matches YYYY-MM-DD format
    const dateTag = memory!.tags.find((t) => /^\d{4}-\d{2}-\d{2}$/.test(t));
    expect(dateTag).toBeDefined();
  });

  it('uses phase in tags matching input', async () => {
    const memory = await writeDreamJournal(store, makeInput({ phase: 'rem' }), null);
    expect(memory).not.toBeNull();
    expect(memory!.tags).toContain('rem');
    expect(memory!.tags).not.toContain('nrem');
  });

  it('uses full phase in tags for full cycle', async () => {
    const memory = await writeDreamJournal(store, makeInput({ phase: 'full' }), null);
    expect(memory).not.toBeNull();
    expect(memory!.tags).toContain('full');
  });
});

describe('writeDreamJournal — graph health stats', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('journal includes graph health stats', async () => {
    const m1 = store.create({ content: 'memory alpha' });
    const m2 = store.create({ content: 'memory beta' });
    const m3 = store.create({ content: 'memory gamma' });
    store.createEdge({ sourceId: m1.id, targetId: m2.id, relationType: 'similar', weight: 1.0 });
    store.createEdge({ sourceId: m2.id, targetId: m3.id, relationType: 'related', weight: 0.8 });

    const memory = await writeDreamJournal(store, makeInput(), null);
    expect(memory).not.toBeNull();

    const content = memory!.content;
    // Should mention 3 total memories
    expect(content).toContain('3');
    // Should mention 2 total edges
    expect(content).toContain('2');
  });

  it('orphan count is included when orphans exist', async () => {
    // Create a memory with no edges — it's an orphan
    store.create({ content: 'isolated memory' });

    const memory = await writeDreamJournal(store, makeInput(), null);
    expect(memory).not.toBeNull();
    expect(memory!.content).toContain('Orphan');
  });
});

describe('writeDreamJournal — template fallback', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('works without LLM generator', async () => {
    const memory = await writeDreamJournal(store, makeInput(), null);
    expect(memory).not.toBeNull();
    expect(memory!.content.length).toBeGreaterThan(0);
    expect(memory!.content).toContain('dream-journal');
  });

  it('template includes frontmatter fields', async () => {
    const input = makeInput({ phase: 'nrem', duration: 12345, sleepPressureBefore: 55, sleepPressureAfter: 10 });
    const memory = await writeDreamJournal(store, input, null);
    expect(memory).not.toBeNull();
    const content = memory!.content;
    expect(content).toContain('phase: nrem');
    expect(content).toContain('duration_ms: 12345');
    expect(content).toContain('sleep_pressure_before: 55');
    expect(content).toContain('sleep_pressure_after: 10');
  });

  it('template mentions pruned edges when > 0', async () => {
    const input = makeInput({ edgesPruned: 5 });
    const memory = await writeDreamJournal(store, input, null);
    expect(memory!.content).toContain('5');
    expect(memory!.content).toContain('Pruned');
  });

  it('template notes no changes when all zeros', async () => {
    const input = makeInput({
      edgesPruned: 0,
      decayApplied: false,
      clustersFound: 0,
      valenceBackfilled: 0,
    });
    const memory = await writeDreamJournal(store, input, null);
    expect(memory!.content).toContain('No structural changes');
  });

  it('falling generator falls back to template', async () => {
    const memory = await writeDreamJournal(store, makeInput(), new FailingGenerator());
    expect(memory).not.toBeNull();
    // Template fallback should still contain frontmatter marker
    expect(memory!.content).toContain('dream-journal');
  });
});

describe('writeDreamJournal — LLM path', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('uses LLM content when generator returns a response', async () => {
    const memory = await writeDreamJournal(store, makeInput(), new MockGenerator());
    expect(memory).not.toBeNull();
    // MockGenerator returns content with "What changed" section
    expect(memory!.content).toContain('What changed');
  });

  it('saves with correct tags even when using LLM', async () => {
    const memory = await writeDreamJournal(store, makeInput({ phase: 'rem' }), new MockGenerator());
    expect(memory).not.toBeNull();
    expect(memory!.tags).toContain('dream-journal');
    expect(memory!.tags).toContain('rem');
  });
});

describe('writeDreamJournal — errors in result', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('includes errors section when errors present', async () => {
    const input = makeInput({ errors: ['hebbian: something broke', 'decay: timeout'] });
    const memory = await writeDreamJournal(store, input, null);
    expect(memory).not.toBeNull();
    expect(memory!.content).toContain('Errors');
    expect(memory!.content).toContain('hebbian: something broke');
  });

  it('omits errors section when no errors', async () => {
    const input = makeInput({ errors: [] });
    const memory = await writeDreamJournal(store, input, null);
    expect(memory!.content).not.toContain('## Errors');
  });
});
