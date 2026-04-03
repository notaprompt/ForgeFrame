/**
 * @forgeframe/server — LoRA Trainer
 *
 * Orchestrates MLX-LM fine-tuning via child process.
 * Produces safetensors LoRA adapters from approved training manifests.
 *
 * Enforces Guardrail 1 (approved manifest required) and
 * Guardrail 2 (adapter-only, never modify base weights).
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import type { LoraTrainingManifest, LoraTrainingRun, LoraTrainingConfig } from '@forgeframe/core';
import type { Logger } from '@forgeframe/core';
import { createConsoleLogger } from '@forgeframe/core';

export interface TrainResult {
  run: LoraTrainingRun;
  adapterPath: string;
}

export class LoraTrainer {
  private _config: LoraTrainingConfig;
  private _log: Logger;

  constructor(config: LoraTrainingConfig, logger?: Logger) {
    this._config = config;
    this._log = logger ?? createConsoleLogger();
  }

  /**
   * Run MLX-LM LoRA fine-tuning.
   * Guardrail 1: Manifest must be approved (approvedAt !== null).
   * Guardrail 2: Only produces LoRA adapters, never modifies base weights.
   */
  async train(manifest: LoraTrainingManifest, dataPath: string): Promise<TrainResult> {
    // Guardrail 1: require approval
    if (!manifest.approvedAt) {
      throw new Error(`Training manifest ${manifest.id} has not been approved. User must approve before training.`);
    }

    const runId = randomUUID();
    const adapterDir = join(this._config.outputDir, 'adapters', runId);
    await mkdir(adapterDir, { recursive: true });

    const run: LoraTrainingRun = {
      id: runId,
      manifestId: manifest.id,
      startedAt: Date.now(),
      completedAt: null,
      status: 'training',
      baseModel: this._config.baseModel,
      adapterPath: null,
      ggufPath: null,
      ollamaModel: null,
      validationResult: null,
      encryptionKeyHash: null,
      error: null,
    };

    this._log.info(`LoRA training started: run=${runId}, model=${this._config.baseModel}, samples=${manifest.totalSamples}`);

    try {
      // Guardrail 2: We use mlx_lm.lora which only produces adapter weights.
      // We NEVER use mlx_lm.fuse which merges adapters into base weights.
      const adapterPath = await this._runMlx(dataPath, adapterDir);

      run.adapterPath = adapterPath;
      run.status = 'validating';
      run.completedAt = Date.now();

      this._log.info(`LoRA training complete: run=${runId}, adapter=${adapterPath}, duration=${run.completedAt - run.startedAt}ms`);

      return { run, adapterPath };
    } catch (err) {
      run.status = 'failed';
      run.completedAt = Date.now();
      run.error = err instanceof Error ? err.message : String(err);
      this._log.error(`LoRA training failed: run=${runId}`, err);
      throw err;
    }
  }

  /**
   * Spawn MLX-LM LoRA training as a child process.
   * Returns path to the adapter directory containing safetensors.
   */
  private _runMlx(dataPath: string, adapterDir: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '-m', 'mlx_lm.lora',
        '--model', this._config.baseModel,
        '--data', dataPath,
        '--train',
        '--iters', String(this._config.maxEpochs * 100), // iterations, not epochs
        '--learning-rate', String(this._config.learningRate),
        '--lora-layers', String(this._config.loraRank),
        '--adapter-path', adapterDir,
        '--batch-size', '1',
      ];

      this._log.info(`Spawning: python ${args.join(' ')}`);

      const proc = spawn(this._config.mlxLmPath || 'python', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        // Log training progress
        if (text.includes('Iter') || text.includes('loss')) {
          this._log.info(`[mlx] ${text.trim()}`);
        }
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(adapterDir);
        } else {
          reject(new Error(`MLX-LM exited with code ${code}: ${stderr.slice(-500)}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn MLX-LM: ${err.message}`));
      });
    });
  }
}
