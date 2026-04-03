import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStore, LORA_ELIGIBLE_TAGS } from '@forgeframe/memory';
import { LORA_INSTRUCTION_TEMPLATES } from '@forgeframe/core';
import { LoraDataPrep } from './data-prep.js';
import type { DataPrepConfig } from './data-prep.js';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe('LoraDataPrep', () => {
  let store: MemoryStore;
  let tmpDir: string;
  let config: DataPrepConfig;

  beforeEach(async () => {
    store = new MemoryStore({ dbPath: ':memory:' });
    tmpDir = await mkdtemp(join(tmpdir(), 'forgeframe-lora-test-'));
    config = {
      outputDir: tmpDir,
      minStrength: 0.5,
      baseModel: 'qwen3.5:9b',
    };
  });

  afterEach(async () => {
    store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('prepare', () => {
    it('generates JSONL file with correct format', async () => {
      store.create({ content: 'core principle: always be local-first', tags: ['principle'] });

      const prep = new LoraDataPrep(store, config, silentLogger);
      const result = await prep.prepare();

      const data = await readFile(result.dataPath, 'utf-8');
      const lines = data.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed).toHaveProperty('instruction');
      expect(parsed).toHaveProperty('input');
      expect(parsed).toHaveProperty('output');
      expect(parsed.output).toBe('core principle: always be local-first');
    });

    it('only includes memories with LORA_ELIGIBLE_TAGS', async () => {
      store.create({ content: 'eligible principle', tags: ['principle'] });
      store.create({ content: 'eligible voice', tags: ['voice'] });
      store.create({ content: 'eligible pattern', tags: ['pattern'] });
      store.create({ content: 'eligible skill', tags: ['skill'] });
      store.create({ content: 'ineligible observation', tags: ['observation'] });
      store.create({ content: 'ineligible entity', tags: ['entity'] });
      store.create({ content: 'ineligible custom', tags: ['my-custom-tag'] });

      const prep = new LoraDataPrep(store, config, silentLogger);
      const result = await prep.prepare();

      // 4 eligible memories, each gets 1 instruction (all under 500 chars)
      expect(result.sampleCount).toBe(4);
      expect(result.manifest.memoriesIncluded).toHaveLength(4);
    });

    it('excludes memories below minStrength', async () => {
      const strong = store.create({ content: 'strong principle', tags: ['principle'] });
      const weak = store.create({ content: 'weak principle', tags: ['principle'] });
      store.resetStrength(weak.id, 0.3);

      const prep = new LoraDataPrep(store, config, silentLogger);
      const result = await prep.prepare();

      expect(result.manifest.memoriesIncluded).toHaveLength(1);
      expect(result.manifest.memoriesIncluded).toContain(strong.id);
      expect(result.manifest.memoriesIncluded).not.toContain(weak.id);
    });

    it('creates manifest with approvedAt=null', async () => {
      store.create({ content: 'a principle', tags: ['principle'] });

      const prep = new LoraDataPrep(store, config, silentLogger);
      const result = await prep.prepare();

      expect(result.manifest.approvedAt).toBeNull();
      expect(result.manifest.baseModel).toBe('qwen3.5:9b');
      expect(result.manifest.tagFilter).toEqual(expect.arrayContaining([...LORA_ELIGIBLE_TAGS]));
    });

    it('throws descriptive error with no eligible memories', async () => {
      store.create({ content: 'just an observation', tags: ['observation'] });

      const prep = new LoraDataPrep(store, config, silentLogger);
      await expect(prep.prepare()).rejects.toThrow('No eligible memories found');
      await expect(prep.prepare()).rejects.toThrow(LORA_ELIGIBLE_TAGS[0]);
    });

    it('throws when store is empty', async () => {
      const prep = new LoraDataPrep(store, config, silentLogger);
      await expect(prep.prepare()).rejects.toThrow('No eligible memories found');
    });
  });

  describe('instruction templates', () => {
    it('maps principle tag to principle prompt', async () => {
      store.create({ content: 'sovereignty over convenience', tags: ['principle'] });

      const prep = new LoraDataPrep(store, config, silentLogger);
      const result = await prep.prepare();
      const data = await readFile(result.dataPath, 'utf-8');
      const instruction = JSON.parse(data.trim().split('\n')[0]);

      expect(instruction.instruction).toBe(LORA_INSTRUCTION_TEMPLATES['principle']);
    });

    it('maps voice tag to voice prompt', async () => {
      store.create({ content: 'speak directly, no fluff', tags: ['voice'] });

      const prep = new LoraDataPrep(store, config, silentLogger);
      const result = await prep.prepare();
      const data = await readFile(result.dataPath, 'utf-8');
      const instruction = JSON.parse(data.trim().split('\n')[0]);

      expect(instruction.instruction).toBe(LORA_INSTRUCTION_TEMPLATES['voice']);
    });

    it('maps skill tag to skill prompt', async () => {
      store.create({ content: 'deploy with docker compose', tags: ['skill'] });

      const prep = new LoraDataPrep(store, config, silentLogger);
      const result = await prep.prepare();
      const data = await readFile(result.dataPath, 'utf-8');
      const instruction = JSON.parse(data.trim().split('\n')[0]);

      expect(instruction.instruction).toBe(LORA_INSTRUCTION_TEMPLATES['skill']);
    });

    it('maps pattern tag to pattern prompt', async () => {
      store.create({ content: 'user works best after midnight', tags: ['pattern'] });

      const prep = new LoraDataPrep(store, config, silentLogger);
      const result = await prep.prepare();
      const data = await readFile(result.dataPath, 'utf-8');
      const instruction = JSON.parse(data.trim().split('\n')[0]);

      expect(instruction.instruction).toBe(LORA_INSTRUCTION_TEMPLATES['pattern']);
    });
  });

  describe('summarization pairs', () => {
    it('generates additional summarization pair for long memories', async () => {
      const longContent = 'A'.repeat(501);
      store.create({ content: longContent, tags: ['principle'] });

      const prep = new LoraDataPrep(store, config, silentLogger);
      const result = await prep.prepare();

      // 1 base instruction + 1 summarization pair
      expect(result.sampleCount).toBe(2);

      const data = await readFile(result.dataPath, 'utf-8');
      const lines = data.trim().split('\n');
      const summarization = JSON.parse(lines[1]);
      expect(summarization.instruction).toContain('Summarize');
      expect(summarization.input).toBe(longContent);
      expect(summarization.output).toBe(longContent.slice(0, 200) + '...');
    });

    it('does not generate summarization pair for short memories', async () => {
      store.create({ content: 'short content', tags: ['principle'] });

      const prep = new LoraDataPrep(store, config, silentLogger);
      const result = await prep.prepare();

      expect(result.sampleCount).toBe(1);
    });
  });

  describe('approve', () => {
    it('sets approvedAt timestamp', async () => {
      store.create({ content: 'a principle', tags: ['principle'] });

      const prep = new LoraDataPrep(store, config, silentLogger);
      const result = await prep.prepare();

      expect(result.manifest.approvedAt).toBeNull();

      const approved = await prep.approve(result.manifest.id);
      expect(approved.approvedAt).toBeTypeOf('number');
      expect(approved.approvedAt).toBeGreaterThan(0);
    });

    it('throws on already-approved manifest', async () => {
      store.create({ content: 'a principle', tags: ['principle'] });

      const prep = new LoraDataPrep(store, config, silentLogger);
      const result = await prep.prepare();

      await prep.approve(result.manifest.id);
      await expect(prep.approve(result.manifest.id)).rejects.toThrow('already approved');
    });
  });
});
