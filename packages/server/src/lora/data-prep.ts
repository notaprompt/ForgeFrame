/**
 * @forgeframe/server — LoRA Data Preparation
 *
 * Extracts eligible memories from ForgeFrame and formats them as
 * JSONL instruction-tuning data for MLX-LM fine-tuning.
 *
 * Enforces Guardrail 1 (training data manifest) and
 * Guardrail 3 (classification ceiling).
 */

import { randomUUID } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { MemoryStore, Memory } from '@forgeframe/memory';
import { LORA_ELIGIBLE_TAGS } from '@forgeframe/memory';
import type { LoraTrainingManifest, LoraInstruction } from '@forgeframe/core';
import { LORA_INSTRUCTION_TEMPLATES } from '@forgeframe/core';
import type { Logger } from '@forgeframe/core';
import { createConsoleLogger } from '@forgeframe/core';

export interface DataPrepConfig {
  /** Directory for manifests and training data */
  outputDir: string;
  /** Minimum memory strength to include */
  minStrength: number;
  /** Base model name (for manifest metadata) */
  baseModel: string;
}

export interface DataPrepResult {
  manifest: LoraTrainingManifest;
  dataPath: string;
  sampleCount: number;
}

export class LoraDataPrep {
  private _store: MemoryStore;
  private _config: DataPrepConfig;
  private _log: Logger;

  constructor(store: MemoryStore, config: DataPrepConfig, logger?: Logger) {
    this._store = store;
    this._config = config;
    this._log = logger ?? createConsoleLogger();
  }

  /**
   * Prepare training data from eligible ForgeFrame memories.
   * Returns an UNAPPROVED manifest — user must approve before training.
   */
  async prepare(): Promise<DataPrepResult> {
    const manifestId = randomUUID();

    // Guardrail 3: Classification ceiling — only eligible tags
    const eligibleMemories = this._collectEligible();

    if (eligibleMemories.length === 0) {
      throw new Error('No eligible memories found for LoRA training. Need memories tagged with: ' + LORA_ELIGIBLE_TAGS.join(', '));
    }

    // Generate JSONL instruction data
    const instructions = this._toInstructions(eligibleMemories);

    // Write training data
    const dataDir = join(this._config.outputDir, 'data');
    const manifestDir = join(this._config.outputDir, 'manifests');
    await mkdir(dataDir, { recursive: true });
    await mkdir(manifestDir, { recursive: true });

    const dataPath = join(dataDir, `${manifestId}.jsonl`);
    const jsonl = instructions.map((inst) => JSON.stringify(inst)).join('\n') + '\n';
    await writeFile(dataPath, jsonl, 'utf-8');

    // Guardrail 1: Create manifest with all memory IDs for user review
    const manifest: LoraTrainingManifest = {
      id: manifestId,
      createdAt: Date.now(),
      baseModel: this._config.baseModel,
      memoriesIncluded: eligibleMemories.map((m) => m.id),
      memoriesExcluded: [],
      tagFilter: [...LORA_ELIGIBLE_TAGS],
      totalSamples: instructions.length,
      approvedAt: null, // Must be approved before training
      approvedBy: 'user',
    };

    const manifestPath = join(manifestDir, `${manifestId}.json`);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    this._log.info(`LoRA data prep: ${instructions.length} samples from ${eligibleMemories.length} memories → ${dataPath}`);

    return { manifest, dataPath, sampleCount: instructions.length };
  }

  /**
   * Approve a manifest for training (Guardrail 1).
   */
  async approve(manifestId: string): Promise<LoraTrainingManifest> {
    const manifestPath = join(this._config.outputDir, 'manifests', `${manifestId}.json`);
    const raw = await import('fs').then((fs) => fs.promises.readFile(manifestPath, 'utf-8'));
    const manifest: LoraTrainingManifest = JSON.parse(raw);

    if (manifest.approvedAt) {
      throw new Error(`Manifest ${manifestId} is already approved`);
    }

    manifest.approvedAt = Date.now();
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    this._log.info(`LoRA manifest ${manifestId} approved for training`);
    return manifest;
  }

  /**
   * Collect all memories eligible for LoRA training.
   * Enforces classification ceiling (Guardrail 3).
   */
  private _collectEligible(): Memory[] {
    const seen = new Set<string>();
    const results: Memory[] = [];

    for (const tag of LORA_ELIGIBLE_TAGS) {
      const memories = this._store.listByTag(tag);
      for (const memory of memories) {
        if (seen.has(memory.id)) continue;
        if (memory.strength < this._config.minStrength) continue;
        seen.add(memory.id);
        results.push(memory);
      }
    }

    return results;
  }

  /**
   * Convert memories to JSONL instruction format for fine-tuning.
   */
  private _toInstructions(memories: Memory[]): LoraInstruction[] {
    const instructions: LoraInstruction[] = [];

    for (const memory of memories) {
      // Find the most relevant tag for instruction template
      const instructionTag = this._primaryTag(memory);
      const template = LORA_INSTRUCTION_TEMPLATES[instructionTag]
        ?? LORA_INSTRUCTION_TEMPLATES['pattern']
        ?? 'What have you learned?';

      instructions.push({
        instruction: template,
        input: '',
        output: memory.content,
      });

      // For longer memories, also generate a summarization pair
      if (memory.content.length > 500) {
        instructions.push({
          instruction: `Summarize this ${instructionTag} concisely.`,
          input: memory.content,
          output: memory.content.slice(0, 200) + '...',
        });
      }
    }

    return instructions;
  }

  /**
   * Determine the primary TRIM tag for a memory.
   * Precedence: principle > voice > skill > pattern
   */
  private _primaryTag(memory: Memory): string {
    const tags = new Set(memory.tags);
    if (tags.has('principle')) return 'principle';
    if (tags.has('voice')) return 'voice';
    if (tags.has('skill')) return 'skill';
    if (tags.has('pattern')) return 'pattern';
    return 'pattern'; // fallback
  }
}
