/**
 * @forgeframe/server — LoRA Validator
 *
 * Validates that a LoRA-adapted model hasn't degraded beyond threshold.
 * Enforces Guardrail 4: reject if general capability drops >5%.
 */

import { spawn } from 'child_process';
import type { LoraTrainingRun, LoraValidationResult, LoraTrainingConfig } from '@forgeframe/core';
import type { Logger } from '@forgeframe/core';
import { createConsoleLogger } from '@forgeframe/core';

/** Simple benchmark questions for general capability testing */
type ExactQuestion = { input: string; expected: string };
type KeywordQuestion = { input: string; keywords: string[] };
type BenchmarkQuestion = ExactQuestion | KeywordQuestion;

const BENCHMARK_QUESTIONS: BenchmarkQuestion[] = [
  { input: 'What is 15 * 23?', expected: '345' },
  { input: 'What is the capital of France?', expected: 'Paris' },
  { input: 'Explain what a hash function does in one sentence.', keywords: ['input', 'output', 'fixed', 'deterministic'] },
  { input: 'What is the time complexity of binary search?', keywords: ['log', 'O(log n)', 'logarithmic'] },
  { input: 'Name three primary colors.', keywords: ['red', 'blue', 'yellow'] },
  { input: 'What does HTTP stand for?', keywords: ['hypertext', 'transfer', 'protocol'] },
  { input: 'Summarize the concept of recursion in programming.', keywords: ['function', 'calls', 'itself', 'base'] },
  { input: 'What is the boiling point of water in Celsius?', expected: '100' },
  { input: 'Convert 32 Fahrenheit to Celsius.', expected: '0' },
  { input: 'What is the square root of 144?', expected: '12' },
];

export class LoraValidator {
  private _config: LoraTrainingConfig;
  private _log: Logger;

  constructor(config: LoraTrainingConfig, logger?: Logger) {
    this._config = config;
    this._log = logger ?? createConsoleLogger();
  }

  /**
   * Validate a LoRA-adapted model against the base model.
   * Guardrail 4: reject if degradation > threshold (default 5%).
   */
  async validate(run: LoraTrainingRun): Promise<LoraValidationResult> {
    this._log.info(`Validating LoRA run ${run.id}: comparing base vs adapted model`);

    // Score base model
    const baselineScore = await this._scoreModel(run.baseModel);
    this._log.info(`Baseline score: ${baselineScore.toFixed(3)}`);

    // Score adapted model (if deployed to Ollama)
    const adaptedModelName = run.ollamaModel ?? `forgeframe-lora-${run.id}`;
    const adaptedScore = await this._scoreModel(adaptedModelName);
    this._log.info(`Adapted score: ${adaptedScore.toFixed(3)}`);

    const degradation = Math.max(0, (baselineScore - adaptedScore) / baselineScore);
    const passed = degradation <= this._config.validationThreshold;

    const result: LoraValidationResult = {
      baselineScore,
      adaptedScore,
      degradation,
      passed,
      benchmarkSuite: 'forgeframe-general-v1',
      testedAt: Date.now(),
    };

    if (passed) {
      this._log.info(`Validation PASSED: ${(degradation * 100).toFixed(1)}% degradation (threshold: ${(this._config.validationThreshold * 100).toFixed(0)}%)`);
    } else {
      this._log.warn(`Validation FAILED: ${(degradation * 100).toFixed(1)}% degradation exceeds ${(this._config.validationThreshold * 100).toFixed(0)}% threshold`);
    }

    return result;
  }

  /**
   * Score a model on the benchmark suite using Ollama.
   * Returns score between 0.0 and 1.0.
   */
  private async _scoreModel(modelName: string): Promise<number> {
    let correct = 0;

    for (const question of BENCHMARK_QUESTIONS) {
      try {
        const response = await this._queryOllama(modelName, question.input);
        const normalized = response.toLowerCase().trim();

        if ('expected' in question) {
          if (normalized.includes((question as ExactQuestion).expected.toLowerCase())) {
            correct++;
          }
        } else if ('keywords' in question) {
          const kws = (question as KeywordQuestion).keywords;
          const matchCount = kws.filter((kw) => normalized.includes(kw.toLowerCase())).length;
          if (matchCount >= Math.ceil(kws.length / 2)) {
            correct++;
          }
        }
      } catch {
        // Model failed to respond — counts as incorrect
        this._log.warn(`Model ${modelName} failed on: ${question.input.slice(0, 50)}`);
      }
    }

    return correct / BENCHMARK_QUESTIONS.length;
  }

  /**
   * Query Ollama API for a single response.
   */
  private async _queryOllama(model: string, prompt: string): Promise<string> {
    const ollamaUrl = process.env['FORGEFRAME_OLLAMA_URL'] ?? 'http://localhost:11434';
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 200 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }

    const data = await response.json() as { response: string };
    return data.response;
  }
}
