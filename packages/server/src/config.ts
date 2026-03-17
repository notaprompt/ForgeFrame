/**
 * @forgeframe/server — Configuration
 */

import { mkdirSync } from 'fs';
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
}

const FORGEFRAME_DIR = resolve(homedir(), '.forgeframe');

function env(key: string): string | undefined {
  return process.env[`FORGEFRAME_${key}`];
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  mkdirSync(FORGEFRAME_DIR, { recursive: true });

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
      ?? '0.1.0',
    ollamaUrl: overrides.ollamaUrl
      ?? env('OLLAMA_URL')
      ?? 'http://localhost:11434',
    embeddingModel: overrides.embeddingModel
      ?? env('EMBEDDING_MODEL')
      ?? 'nomic-embed-text',
    ingestDir: overrides.ingestDir
      ?? env('INGEST_DIR')
      ?? undefined,
    sources: overrides.sources
      ?? parseSources(env('SOURCES'))
      ?? undefined,
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
