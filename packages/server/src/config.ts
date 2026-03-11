/**
 * @forgeframe/server — Configuration
 */

import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

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
  };
}
