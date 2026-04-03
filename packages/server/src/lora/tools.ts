/**
 * @forgeframe/server — LoRA MCP Tools
 *
 * Four MCP tools for managing the LoRA training pipeline:
 * - lora_prepare: prepare training data, return manifest for review
 * - lora_approve: approve a manifest (user confirmation)
 * - lora_train: start training run (requires approved manifest)
 * - lora_status: check status of active/completed runs
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LoraDataPrep } from './data-prep.js';
import type { LoraTrainer } from './trainer.js';
import type { LoraTrainingRun } from '@forgeframe/core';

function toolResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function toolError(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true as const };
}

export function registerLoraTools(
  server: McpServer,
  dataPrep: LoraDataPrep | null,
  trainer: LoraTrainer | null,
  runs: Map<string, LoraTrainingRun>,
) {
  server.tool(
    'lora_prepare',
    'Prepare LoRA training data from eligible ForgeFrame memories. Returns an unapproved manifest for review.',
    {},
    async () => {
      if (!dataPrep) return toolError('LoRA pipeline not configured');
      try {
        const result = await dataPrep.prepare();
        return toolResult({
          manifestId: result.manifest.id,
          sampleCount: result.sampleCount,
          memoriesIncluded: result.manifest.memoriesIncluded.length,
          tagFilter: result.manifest.tagFilter,
          baseModel: result.manifest.baseModel,
          dataPath: result.dataPath,
          status: 'awaiting_approval',
          note: 'Call lora_approve with this manifestId to approve training.',
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    'lora_approve',
    'Approve a LoRA training manifest. Required before training can begin.',
    { manifest_id: z.string().describe('The manifest ID to approve') },
    async ({ manifest_id }) => {
      if (!dataPrep) return toolError('LoRA pipeline not configured');
      try {
        const manifest = await dataPrep.approve(manifest_id);
        return toolResult({
          manifestId: manifest.id,
          approvedAt: manifest.approvedAt,
          totalSamples: manifest.totalSamples,
          status: 'approved',
          note: 'Call lora_train with this manifestId to start training.',
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    'lora_train',
    'Start LoRA fine-tuning with an approved manifest. Training runs asynchronously.',
    {
      manifest_id: z.string().describe('The approved manifest ID'),
      data_path: z.string().describe('Path to the JSONL training data'),
    },
    async ({ manifest_id, data_path }) => {
      if (!trainer || !dataPrep) return toolError('LoRA pipeline not configured');
      try {
        // Load and verify manifest
        const manifestPath = `${(dataPrep as any)._config.outputDir}/manifests/${manifest_id}.json`;
        const raw = await import('fs').then((fs) => fs.promises.readFile(manifestPath, 'utf-8'));
        const manifest = JSON.parse(raw);

        const result = await trainer.train(manifest, data_path);
        runs.set(result.run.id, result.run);

        return toolResult({
          runId: result.run.id,
          status: result.run.status,
          adapterPath: result.adapterPath,
          startedAt: result.run.startedAt,
          completedAt: result.run.completedAt,
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    'lora_status',
    'Check status of LoRA training runs.',
    {
      run_id: z.string().optional().describe('Specific run ID, or omit for all runs'),
    },
    async ({ run_id }) => {
      if (run_id) {
        const run = runs.get(run_id);
        if (!run) return toolError(`Run ${run_id} not found`);
        return toolResult(run);
      }
      return toolResult({
        runs: [...runs.values()].map((r) => ({
          id: r.id,
          status: r.status,
          baseModel: r.baseModel,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          ollamaModel: r.ollamaModel,
        })),
        total: runs.size,
      });
    },
  );
}
