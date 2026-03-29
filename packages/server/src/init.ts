/**
 * @forgeframe/server — Interactive onboarding CLI
 *
 * `forgeframe init` walks users through first-run setup:
 *   1. Embedding model selection (local via Ollama)
 *   2. LLM provider configuration (optional, for proxy routing)
 *   3. Hardware / environment summary
 *   4. Config file write
 */

import { createInterface, type Interface } from 'readline';
import { execSync, spawnSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = resolve(homedir(), '.forgeframe');
const CONFIG_PATH = resolve(CONFIG_DIR, 'config.json');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingConfig {
  provider: 'ollama';
  model: string;
  url: string;
}

export interface ProviderConfig {
  name: string;
  type: string;
  apiKey?: string;
  baseUrl?: string;
  tier?: string;
}

export interface ForgeFrameConfig {
  embedding: EmbeddingConfig;
  providers: ProviderConfig[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ask(rl: Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

function write(text: string): void {
  process.stdout.write(text);
}

function ollamaRunning(url: string): boolean {
  try {
    execSync(`curl -sf ${url}/api/version`, { timeout: 3000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function ollamaListModels(url: string): string[] {
  try {
    const raw = execSync(`curl -sf ${url}/api/tags`, { timeout: 5000, stdio: 'pipe' });
    const data = JSON.parse(raw.toString());
    return (data.models ?? []).map((m: { name: string }) => m.name);
  } catch {
    return [];
  }
}

function ollamaPull(url: string, model: string): boolean {
  write(`\nPulling ${model}... (this may take a few minutes)\n`);
  const result = spawnSync('curl', [
    '-sf', `${url}/api/pull`,
    '-d', JSON.stringify({ name: model }),
  ], { timeout: 600_000, stdio: 'inherit' });
  return result.status === 0;
}

function loadExistingConfig(): ForgeFrameConfig | null {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch { /* ignore corrupt config */ }
  return null;
}

function saveConfig(config: ForgeFrameConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Embedding models
// ---------------------------------------------------------------------------

const EMBEDDING_MODELS = [
  { key: 'nomic-embed-text',       size: '770MB', note: 'recommended, good quality',  tag: 'LOCAL' },
  { key: 'mxbai-embed-large',      size: '670MB', note: 'high quality',               tag: 'LOCAL' },
  { key: 'all-minilm',             size: '46MB',  note: 'lightweight, fast',          tag: 'LOCAL' },
  { key: 'snowflake-arctic-embed', size: '670MB', note: 'strong multilingual',        tag: 'LOCAL' },
] as const;

// ---------------------------------------------------------------------------
// Provider definitions
// ---------------------------------------------------------------------------

const CLOUD_PROVIDERS = [
  { name: 'anthropic',  display: 'Anthropic',  note: 'Claude',       type: 'anthropic',          keyPrefix: 'sk-ant-' },
  { name: 'openai',     display: 'OpenAI',     note: 'GPT-4, etc',  type: 'openai-compatible',  keyPrefix: 'sk-' },
  { name: 'google',     display: 'Google',     note: 'Gemini',       type: 'openai-compatible',  keyPrefix: '' },
  { name: 'mistral',    display: 'Mistral',    note: '',             type: 'openai-compatible',  keyPrefix: '' },
  { name: 'deepseek',   display: 'DeepSeek',   note: '',             type: 'openai-compatible',  keyPrefix: 'sk-' },
  { name: 'openrouter', display: 'OpenRouter', note: 'any model',   type: 'openai-compatible',  keyPrefix: 'sk-or-' },
] as const;

const BASE_URLS: Record<string, string> = {
  openai:     'https://api.openai.com/v1',
  google:     'https://generativelanguage.googleapis.com/v1beta/openai',
  mistral:    'https://api.mistral.ai/v1',
  deepseek:   'https://api.deepseek.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function stepEmbedding(rl: Interface, ollamaUrl: string, existing: ForgeFrameConfig | null): Promise<EmbeddingConfig> {
  write('\nForgeFrame Setup\n');
  write('================\n\n');
  write('Embedding model (for semantic search):\n\n');

  for (let i = 0; i < EMBEDDING_MODELS.length; i++) {
    const m = EMBEDDING_MODELS[i];
    const num = String(i + 1).padStart(2);
    const label = m.key.padEnd(24);
    write(`  ${num}. ${label}(${m.size}, ${m.note})     [${m.tag}]\n`);
  }
  write(`   5. Keep current / skip\n\n`);

  const choice = await ask(rl, 'Select [1-5]: ');
  const idx = parseInt(choice, 10);

  if (idx === 5 || isNaN(idx) || idx < 1 || idx > 5) {
    if (existing?.embedding) {
      write(`\nKeeping current: ${existing.embedding.model}\n`);
      return existing.embedding;
    }
    return { provider: 'ollama', model: 'nomic-embed-text', url: ollamaUrl };
  }

  const selected = EMBEDDING_MODELS[idx - 1];
  write(`\nSelected: ${selected.key}\n`);

  // Check Ollama
  if (!ollamaRunning(ollamaUrl)) {
    write(`\nOllama is not running at ${ollamaUrl}.\n`);
    write('Install Ollama: https://ollama.com\n');
    write('Then run: ollama serve\n');
    write(`\nSaving config with ${selected.key} anyway — start Ollama before using ForgeFrame.\n`);
    return { provider: 'ollama', model: selected.key, url: ollamaUrl };
  }

  // Check if model already pulled
  const models = ollamaListModels(ollamaUrl);
  const hasModel = models.some((m) => m.startsWith(selected.key));

  if (!hasModel) {
    const pull = await ask(rl, `Pull ${selected.key} now? [Y/n]: `);
    if (pull === '' || pull.toLowerCase() === 'y') {
      ollamaPull(ollamaUrl, selected.key);
    }
  } else {
    write(`Model ${selected.key} already available.\n`);
  }

  return { provider: 'ollama', model: selected.key, url: ollamaUrl };
}

async function stepProvider(rl: Interface, ollamaUrl: string, existing: ForgeFrameConfig | null): Promise<ProviderConfig[]> {
  const providers: ProviderConfig[] = existing?.providers ? [...existing.providers] : [];

  write('\nModel provider for the router (optional — skip if using Claude Code directly):\n\n');
  write('  Cloud providers:\n');
  for (let i = 0; i < CLOUD_PROVIDERS.length; i++) {
    const p = CLOUD_PROVIDERS[i];
    const num = String(i + 1).padStart(2);
    const label = p.display.padEnd(16);
    const note = p.note ? `(${p.note})` : '';
    write(`  ${num}. ${label}${note.padEnd(20)}API key\n`);
  }
  write('\n  Local providers:\n');
  write('   7. Ollama          (local inference)     No key needed\n\n');
  write('   8. Skip — I\'ll configure later\n');
  write('   9. Add custom OpenAI-compatible endpoint\n\n');

  const choice = await ask(rl, 'Select [1-9]: ');
  const idx = parseInt(choice, 10);

  if (idx === 8 || isNaN(idx) || idx < 1 || idx > 9) {
    return providers;
  }

  if (idx >= 1 && idx <= 6) {
    const cloud = CLOUD_PROVIDERS[idx - 1];
    const apiKey = await ask(rl, `${cloud.display} API key: `);
    if (!apiKey) {
      write('No key provided, skipping.\n');
      return providers;
    }

    const tier = await ask(rl, 'Assign to tier (quick/balanced/deep) [deep]: ');
    const entry: ProviderConfig = {
      name: cloud.name,
      type: cloud.type,
      apiKey,
      tier: tier || 'deep',
    };
    if (BASE_URLS[cloud.name]) {
      entry.baseUrl = BASE_URLS[cloud.name];
    }

    // Replace existing provider with same name or append
    const existIdx = providers.findIndex((p) => p.name === cloud.name);
    if (existIdx >= 0) providers[existIdx] = entry;
    else providers.push(entry);
  }

  if (idx === 7) {
    // Ollama for LLM routing
    if (!ollamaRunning(ollamaUrl)) {
      write(`\nOllama is not running at ${ollamaUrl}.\n`);
      write('Start Ollama first, then re-run forgeframe init.\n');
      return providers;
    }

    const models = ollamaListModels(ollamaUrl);
    if (models.length === 0) {
      write('\nNo models found in Ollama. Pull a model first:\n');
      write('  ollama pull llama3.2\n');
      return providers;
    }

    write('\nAvailable Ollama models:\n');
    for (let i = 0; i < models.length; i++) {
      write(`  ${i + 1}. ${models[i]}\n`);
    }

    const tiers = ['quick', 'balanced', 'deep'] as const;
    for (const tier of tiers) {
      const pick = await ask(rl, `Model for ${tier} tier (number, or Enter to skip): `);
      const pickIdx = parseInt(pick, 10);
      if (!isNaN(pickIdx) && pickIdx >= 1 && pickIdx <= models.length) {
        const entry: ProviderConfig = {
          name: `ollama-${tier}`,
          type: 'ollama',
          baseUrl: ollamaUrl,
          tier,
        };
        const existIdx = providers.findIndex((p) => p.name === `ollama-${tier}`);
        if (existIdx >= 0) providers[existIdx] = entry;
        else providers.push(entry);
      }
    }
  }

  if (idx === 9) {
    const baseUrl = await ask(rl, 'Base URL (e.g. http://localhost:8080/v1): ');
    if (!baseUrl) {
      write('No URL provided, skipping.\n');
      return providers;
    }
    const apiKey = await ask(rl, 'API key (Enter for none): ');
    const name = await ask(rl, 'Name for this endpoint [custom]: ');
    const tier = await ask(rl, 'Assign to tier (quick/balanced/deep) [balanced]: ');

    providers.push({
      name: name || 'custom',
      type: 'openai-compatible',
      baseUrl,
      apiKey: apiKey || undefined,
      tier: tier || 'balanced',
    });
  }

  return providers;
}

function stepHardwareInfo(embedding: EmbeddingConfig, ollamaUrl: string): void {
  write('\nHardware requirements:\n\n');

  const vramNote = embedding.model === 'all-minilm' ? '~100MB RAM' : '~2GB VRAM';
  write(`  Embeddings:   ${vramNote} (${embedding.model})\n`);
  write('  Proxy scrub:  ~8GB VRAM for LLM tier (7B+ model) — optional\n');
  write('  Memory DB:    ~10MB disk per 1000 memories\n\n');

  const running = ollamaRunning(ollamaUrl);
  write(`  Your Ollama:  ${running ? 'running' : 'not running'} at ${ollamaUrl}\n`);

  if (running) {
    const models = ollamaListModels(ollamaUrl);
    if (models.length > 0) {
      write(`  Your models:  ${models.join(', ')}\n`);
    } else {
      write('  Your models:  (none)\n');
    }
  }
  write('\n');
}

function stepWriteConfig(config: ForgeFrameConfig): void {
  saveConfig(config);
  write(`Config written to ${CONFIG_PATH}\n\n`);
  write('Add to your shell profile:\n');
  write(`  export FORGEFRAME_EMBEDDING_MODEL=${config.embedding.model}\n`);
  write(`  export FORGEFRAME_OLLAMA_URL=${config.embedding.url}\n`);
  write('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export { CONFIG_DIR, CONFIG_PATH, loadExistingConfig, saveConfig };

export async function runInit(): Promise<void> {
  const ollamaUrl = process.env.FORGEFRAME_OLLAMA_URL ?? 'http://localhost:11434';
  const existing = loadExistingConfig();

  if (existing) {
    write('\nExisting config found. Re-running will update your configuration.\n');
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const embedding = await stepEmbedding(rl, ollamaUrl, existing);
    const providers = await stepProvider(rl, ollamaUrl, existing);

    stepHardwareInfo(embedding, ollamaUrl);

    const config: ForgeFrameConfig = { embedding, providers };
    stepWriteConfig(config);

    write('ForgeFrame is configured. Run `forgeframe start` to launch the daemon.\n');
  } finally {
    rl.close();
  }
}
