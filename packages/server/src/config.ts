/**
 * @forgeframe/server — Configuration
 */

import { mkdirSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import type { SourceConfig } from './ingest.js';

export interface ServerConfig {
  dbPath: string;
  sessionId?: string;
  decayOnStartup: boolean;
  provenancePath: string;
  serverName: string;
  serverVersion: string;
  ollamaUrl: string;
  embeddingModel: string;
  ingestDir?: string;
  sources?: SourceConfig[];

  // Distillery intake
  distilleryDbPath?: string;
  distilleryPollMs?: number;

  // LoRA pipeline
  loraBaseModel?: string;
  loraOutputDir?: string;
  loraMlxLmPath?: string;
}

const FORGEFRAME_DIR = resolve(homedir(), '.forgeframe');
const CONFIG_FILE = resolve(FORGEFRAME_DIR, 'config.json');

function env(key: string): string | undefined {
  return process.env[`FORGEFRAME_${key}`];
}

function readConfigFile(): Record<string, any> | null {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch { /* ignore corrupt config */ }
  return null;
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  mkdirSync(FORGEFRAME_DIR, { recursive: true });

  const file = readConfigFile();

  return {
    dbPath: overrides.dbPath
      ?? env('DB_PATH')
      ?? resolve(FORGEFRAME_DIR, 'memory.db'),
    sessionId: overrides.sessionId
      ?? env('SESSION_ID')
      ?? undefined,
    decayOnStartup: overrides.decayOnStartup
      ?? (env('DECAY_ON_STARTUP') !== 'false'),
    provenancePath: overrides.provenancePath
      ?? env('PROVENANCE_PATH')
      ?? resolve(FORGEFRAME_DIR, 'provenance.jsonl'),
    serverName: overrides.serverName
      ?? env('SERVER_NAME')
      ?? 'forgeframe-memory',
    serverVersion: overrides.serverVersion
      ?? '0.2.0',
    ollamaUrl: overrides.ollamaUrl
      ?? env('OLLAMA_URL')
      ?? file?.embedding?.url
      ?? 'http://localhost:11434',
    embeddingModel: overrides.embeddingModel
      ?? env('EMBEDDING_MODEL')
      ?? file?.embedding?.model
      ?? 'nomic-embed-text',
    ingestDir: overrides.ingestDir
      ?? env('INGEST_DIR')
      ?? undefined,
    sources: overrides.sources
      ?? parseSources(env('SOURCES'))
      ?? undefined,
    distilleryDbPath: overrides.distilleryDbPath
      ?? env('DISTILLERY_DB')
      ?? undefined,
    distilleryPollMs: overrides.distilleryPollMs
      ?? (env('DISTILLERY_POLL') ? parseInt(env('DISTILLERY_POLL')!, 10) : undefined),
    loraBaseModel: overrides.loraBaseModel
      ?? env('LORA_BASE_MODEL')
      ?? undefined,
    loraOutputDir: overrides.loraOutputDir
      ?? env('LORA_OUTPUT_DIR')
      ?? resolve(homedir(), '.forgeframe', 'lora'),
    loraMlxLmPath: overrides.loraMlxLmPath
      ?? env('LORA_MLX_PATH')
      ?? 'python',
  };
}

/**
 * Parse FORGEFRAME_SOURCES env var.
 * Format: "name|path|splitPattern|strength;name2|path2|splitPattern2|strength2"
 *
 * Uses | as field separator (preserves splitOn trailing spaces).
 * Uses ; as entry separator.
 */
function parseSources(value: string | undefined): SourceConfig[] | undefined {
  if (!value) return undefined;
  return value.split(';').filter(Boolean).map((entry) => {
    const [name, rawPath, splitOn, strengthStr] = entry.split('|');
    return {
      name: name.trim(),
      dir: rawPath.trim().replace(/^~/, homedir()),
      splitOn: splitOn || '## ',
      initialStrength: strengthStr ? parseFloat(strengthStr) : 0.6,
      classify: false,
    };
  });
}
