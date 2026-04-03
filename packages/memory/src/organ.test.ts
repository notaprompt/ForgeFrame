import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import { MemoryRetriever } from './retrieval.js';
import { MEMORY_ORGAN_MANIFEST, createMemoryOrganLifecycle } from './organ.js';
import type { OrganLifecycle } from '@forgeframe/core';

describe('Memory Organ', () => {
  let store: MemoryStore;
  let retriever: MemoryRetriever;
  let lifecycle: OrganLifecycle;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
    retriever = new MemoryRetriever(store);
    lifecycle = createMemoryOrganLifecycle(store, retriever);
  });

  afterEach(() => {
    store.close();
  });

  describe('MEMORY_ORGAN_MANIFEST', () => {
    it('has correct id', () => {
      expect(MEMORY_ORGAN_MANIFEST.id).toBe('forgeframe.memory.sqlite');
    });

    it('has memory and embedding categories', () => {
      expect(MEMORY_ORGAN_MANIFEST.categories).toContain('memory');
      expect(MEMORY_ORGAN_MANIFEST.categories).toContain('embedding');
    });

    it('has store, retrieve, and embed capabilities', () => {
      const actions = MEMORY_ORGAN_MANIFEST.capabilities.map((c) => c.action);
      expect(actions).toContain('store');
      expect(actions).toContain('retrieve');
      expect(actions).toContain('embed');
    });

    it('declares local-only execution trust', () => {
      expect(MEMORY_ORGAN_MANIFEST.trust.execution).toBe('local-only');
    });

    it('supports all data classifications including cognitive and constitutional', () => {
      expect(MEMORY_ORGAN_MANIFEST.trust.dataClassifications).toContain('cognitive');
      expect(MEMORY_ORGAN_MANIFEST.trust.dataClassifications).toContain('constitutional');
    });
  });

  describe('register', () => {
    it('returns true', async () => {
      const result = await lifecycle.register();
      expect(result).toBe(true);
    });
  });

  describe('execute with action=store', () => {
    it('creates a memory and returns memory_id', async () => {
      const output = await lifecycle.execute({
        requestId: 'req-store-1',
        slots: {
          action: 'store',
          content: 'test memory content',
          tags: ['observation'],
        },
      });

      expect(output.slots.memory_id).toBeTypeOf('string');
      expect(output.slots.memory).toBeDefined();

      // Verify the memory was actually persisted
      const stored = store.get(output.slots.memory_id as string);
      expect(stored).not.toBeNull();
      expect(stored!.content).toBe('test memory content');
    });
  });

  describe('execute with action=retrieve', () => {
    it('returns matching memories', async () => {
      store.create({ content: 'the quick brown fox' });
      store.create({ content: 'lazy dog sleeps' });

      const output = await lifecycle.execute({
        requestId: 'req-retrieve-1',
        slots: {
          action: 'retrieve',
          query: 'fox',
          limit: 10,
        },
      });

      const memories = output.slots.memories as Array<{ memory: { content: string } }>;
      expect(memories.length).toBeGreaterThanOrEqual(1);
      expect(memories[0].memory.content).toContain('fox');
    });
  });

  describe('execute with unknown action', () => {
    it('throws an error', async () => {
      await expect(
        lifecycle.execute({
          requestId: 'req-bad-1',
          slots: { action: 'unknown-action' },
        }),
      ).rejects.toThrow('Unknown memory organ action: unknown-action');
    });
  });

  describe('health', () => {
    it('returns healthy with memory count', async () => {
      store.create({ content: 'memory one' });
      store.create({ content: 'memory two' });

      const health = await lifecycle.health();
      expect(health.status).toBe('healthy');
      expect(health.message).toContain('2');
      expect(health.message).toContain('memories stored');
    });
  });

  describe('provenance', () => {
    it('includes provenance record with correct fields on store', async () => {
      const output = await lifecycle.execute({
        requestId: 'req-prov-1',
        slots: {
          action: 'store',
          content: 'provenance test',
          tags: [],
        },
      });

      expect(output.provenance).toBeDefined();
      expect(output.provenance.organId).toBe('forgeframe.memory.sqlite');
      expect(output.provenance.requestId).toBe('req-prov-1');
      expect(output.provenance.inputHash).toBeTypeOf('string');
      expect(output.provenance.outputHash).toBeTypeOf('string');
      expect(output.provenance.inputHash).toHaveLength(64); // SHA-256 hex
      expect(output.provenance.outputHash).toHaveLength(64);
      expect(output.provenance.durationMs).toBeGreaterThanOrEqual(0);
      expect(output.provenance.trustLevel).toBe('local-only');
    });

    it('includes provenance record on retrieve', async () => {
      store.create({ content: 'something to find' });

      const output = await lifecycle.execute({
        requestId: 'req-prov-2',
        slots: {
          action: 'retrieve',
          query: 'something',
        },
      });

      expect(output.provenance.organId).toBe('forgeframe.memory.sqlite');
      expect(output.provenance.requestId).toBe('req-prov-2');
      expect(output.provenance.inputHash).toHaveLength(64);
      expect(output.provenance.outputHash).toHaveLength(64);
    });

    it('generates different hashes for different inputs', async () => {
      const output1 = await lifecycle.execute({
        requestId: 'req-a',
        slots: { action: 'store', content: 'alpha', tags: [] },
      });

      const output2 = await lifecycle.execute({
        requestId: 'req-b',
        slots: { action: 'store', content: 'beta', tags: [] },
      });

      expect(output1.provenance.inputHash).not.toBe(output2.provenance.inputHash);
      expect(output1.provenance.outputHash).not.toBe(output2.provenance.outputHash);
    });
  });
});
