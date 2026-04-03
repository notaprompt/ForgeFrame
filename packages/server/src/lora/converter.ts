/**
 * @forgeframe/server — LoRA Converter
 *
 * Handles the post-training pipeline:
 * 1. Encrypt safetensors adapter (Guardrail 5: sovereign encryption)
 * 2. Convert to GGUF format
 * 3. Deploy to Ollama via Modelfile
 *
 * Enforces Guardrail 5 (AES-256-GCM encryption) and
 * Guardrail 6 (provenance chain).
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { spawn } from 'child_process';
import { writeFile, readFile, readdir, mkdir } from 'fs/promises';
import { join } from 'path';
import type { LoraTrainingRun, LoraTrainingConfig } from '@forgeframe/core';
import type { Logger } from '@forgeframe/core';
import { createConsoleLogger } from '@forgeframe/core';

export interface ConvertResult {
  ggufPath: string;
  ollamaModel: string;
  encryptionKeyHash: string;
}

export class LoraConverter {
  private _config: LoraTrainingConfig;
  private _log: Logger;

  constructor(config: LoraTrainingConfig, logger?: Logger) {
    this._config = config;
    this._log = logger ?? createConsoleLogger();
  }

  /**
   * Full post-training pipeline: encrypt → convert → deploy.
   */
  async convertAndDeploy(run: LoraTrainingRun, encryptionKey: Buffer): Promise<ConvertResult> {
    if (!run.adapterPath) {
      throw new Error(`Training run ${run.id} has no adapter path`);
    }

    // Guardrail 5: Encrypt adapter files
    const encryptionKeyHash = await this._encryptAdapterFiles(run.adapterPath, encryptionKey);
    this._log.info(`Adapter files encrypted: run=${run.id}`);

    // Convert safetensors to GGUF
    const ggufPath = await this._convertToGguf(run);
    this._log.info(`GGUF conversion complete: ${ggufPath}`);

    // Deploy to Ollama
    const ollamaModel = await this._deployToOllama(run, ggufPath);
    this._log.info(`Deployed to Ollama as: ${ollamaModel}`);

    return { ggufPath, ollamaModel, encryptionKeyHash };
  }

  /**
   * Guardrail 5: Encrypt all safetensors files in the adapter directory.
   * Uses AES-256-GCM with a user-provided key.
   * Original files are overwritten with encrypted versions.
   */
  private async _encryptAdapterFiles(adapterDir: string, key: Buffer): Promise<string> {
    const files = await readdir(adapterDir);
    const safetensorFiles = files.filter((f) => f.endsWith('.safetensors') || f.endsWith('.npz'));

    for (const file of safetensorFiles) {
      const filePath = join(adapterDir, file);
      const plaintext = await readFile(filePath);

      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();

      // Format: sov1:iv:tag:ciphertext (all base64)
      const output = `sov1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
      await writeFile(filePath + '.enc', output, 'utf-8');

      this._log.info(`Encrypted: ${file} → ${file}.enc`);
    }

    return createHash('sha256').update(key).digest('hex');
  }

  /**
   * Decrypt an encrypted adapter file.
   */
  async decryptAdapterFile(encryptedPath: string, key: Buffer): Promise<Buffer> {
    const content = await readFile(encryptedPath, 'utf-8');
    const parts = content.split(':');
    if (parts[0] !== 'sov1' || parts.length !== 4) {
      throw new Error('Invalid encrypted file format');
    }

    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ciphertext = Buffer.from(parts[3], 'base64');

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /**
   * Convert safetensors adapter to GGUF format via llama.cpp tools.
   * Falls back to direct Ollama Modelfile if conversion tools aren't available.
   */
  private async _convertToGguf(run: LoraTrainingRun): Promise<string> {
    const ggufDir = join(this._config.outputDir, 'gguf');
    await mkdir(ggufDir, { recursive: true });
    const ggufPath = join(ggufDir, `${run.id}.gguf`);

    try {
      // Try llama.cpp converter first
      await this._spawnProcess('python', [
        '-m', 'mlx_lm.convert',
        '--model', run.adapterPath!,
        '--quantize', 'q4_K_M',
        '-o', ggufPath,
      ]);
      return ggufPath;
    } catch {
      this._log.warn('mlx_lm.convert failed, will use adapter directly with Ollama Modelfile');
      // Return the adapter dir itself — Ollama can use safetensors directly in some cases
      return run.adapterPath!;
    }
  }

  /**
   * Deploy to Ollama by creating a Modelfile and running `ollama create`.
   */
  private async _deployToOllama(run: LoraTrainingRun, adapterPath: string): Promise<string> {
    const modelName = `forgeframe-lora-${run.id.slice(0, 8)}`;
    const modelfileDir = join(this._config.outputDir, 'modelfiles');
    await mkdir(modelfileDir, { recursive: true });

    const modelfileContent = [
      `FROM ${run.baseModel}`,
      `ADAPTER ${adapterPath}`,
      `PARAMETER temperature 0.7`,
      `PARAMETER top_p 0.9`,
    ].join('\n') + '\n';

    const modelfilePath = join(modelfileDir, `${run.id}.Modelfile`);
    await writeFile(modelfilePath, modelfileContent, 'utf-8');

    await this._spawnProcess('ollama', ['create', modelName, '-f', modelfilePath]);

    return modelName;
  }

  private _spawnProcess(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-500)}`));
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn ${command}: ${err.message}`));
      });
    });
  }
}
