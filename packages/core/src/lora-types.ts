/**
 * @forgeframe/core — LoRA Training Pipeline Types
 *
 * Types for memory transformation: compiling ForgeFrame memories
 * into LoRA adapters that modify local model weights.
 *
 * Six guardrails are enforced:
 * 1. Training data manifest — user reviews and approves before fine-tuning
 * 2. Base model preservation — LoRA adapters only, never modify base weights
 * 3. Classification ceiling — only principle/voice/pattern/skill eligible
 * 4. Validation benchmark — reject if general capability drops >5%
 * 5. Sovereign encryption on adapter files (AES-256-GCM)
 * 6. Full provenance chain on every training run
 */

// -- Training Manifest (Guardrail 1: user-reviewed data) --

export interface LoraTrainingManifest {
  /** Unique manifest ID */
  id: string;
  /** When this manifest was created */
  createdAt: number;
  /** Base model to fine-tune (e.g. 'qwen3.5:9b') */
  baseModel: string;
  /** Memory IDs included in training data */
  memoriesIncluded: string[];
  /** Memory IDs explicitly excluded by user */
  memoriesExcluded: string[];
  /** Tags used to filter eligible memories (classification ceiling) */
  tagFilter: string[];
  /** Total training samples generated */
  totalSamples: number;
  /** When the user approved this manifest (null = unapproved) */
  approvedAt: number | null;
  /** Who approved ('user' for v1) */
  approvedBy: string;
}

// -- Training Run --

export type LoraRunStatus =
  | 'preparing'
  | 'training'
  | 'validating'
  | 'converting'
  | 'deploying'
  | 'complete'
  | 'failed'
  | 'rejected';

export interface LoraTrainingRun {
  /** Unique run ID */
  id: string;
  /** Manifest this run is based on */
  manifestId: string;
  /** When training started */
  startedAt: number;
  /** When training completed (null if in progress) */
  completedAt: number | null;
  /** Current status */
  status: LoraRunStatus;
  /** Base model used */
  baseModel: string;
  /** Path to safetensors adapter (after training) */
  adapterPath: string | null;
  /** Path to GGUF adapter (after conversion) */
  ggufPath: string | null;
  /** Ollama model name (after deployment) */
  ollamaModel: string | null;
  /** Validation results (after benchmark) */
  validationResult: LoraValidationResult | null;
  /** Hash of encryption key used for adapter files */
  encryptionKeyHash: string | null;
  /** Error message if failed */
  error: string | null;
}

// -- Validation (Guardrail 4: benchmark with 5% threshold) --

export interface LoraValidationResult {
  /** Score on benchmark before LoRA */
  baselineScore: number;
  /** Score on benchmark after LoRA */
  adaptedScore: number;
  /** Percentage degradation (0.0–1.0) */
  degradation: number;
  /** Whether degradation is within threshold */
  passed: boolean;
  /** Name of benchmark suite used */
  benchmarkSuite: string;
  /** When validation was run */
  testedAt: number;
}

// -- Configuration --

export interface LoraTrainingConfig {
  /** Base model to fine-tune */
  baseModel: string;
  /** Path to mlx_lm Python module */
  mlxLmPath: string;
  /** Output directory for adapters (default: ~/.forgeframe/lora/) */
  outputDir: string;
  /** Maximum training epochs */
  maxEpochs: number;
  /** Learning rate for LoRA (default: 1e-4) */
  learningRate: number;
  /** LoRA rank (default: 8) */
  loraRank: number;
  /** LoRA alpha (default: 16) */
  loraAlpha: number;
  /** Degradation threshold for validation (default: 0.05 = 5%) */
  validationThreshold: number;
  /** Minimum memory strength to include in training data (default: 0.5) */
  minStrength: number;
}

export const DEFAULT_LORA_CONFIG: Omit<LoraTrainingConfig, 'baseModel' | 'mlxLmPath' | 'outputDir'> = {
  maxEpochs: 2,
  learningRate: 1e-4,
  loraRank: 8,
  loraAlpha: 16,
  validationThreshold: 0.05,
  minStrength: 0.5,
};

// -- Instruction Format (training data) --

export interface LoraInstruction {
  /** System context for the instruction */
  instruction: string;
  /** Optional input to process */
  input: string;
  /** Expected output (from memory content) */
  output: string;
}

/** Maps TRIM tags to instruction prompts for LoRA training data generation */
export const LORA_INSTRUCTION_TEMPLATES: Record<string, string> = {
  principle: 'What is a core principle that guides your thinking?',
  voice: 'How should you communicate and express yourself?',
  pattern: 'What recurring pattern have you observed?',
  skill: 'How do you perform this task based on experience?',
};
