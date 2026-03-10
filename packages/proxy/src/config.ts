/**
 * @forgeframe/proxy -- Configuration
 */

import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { createConsoleLogger } from '@forgeframe/core';
import type { ProxyConfig } from './types.js';
import { PROXY_DEFAULTS } from './types.js';

const FORGEFRAME_DIR = resolve(homedir(), '.forgeframe');

function env(key: string): string | undefined {
  return process.env[`FORGEFRAME_PROXY_${key}`];
}

function envGlobal(key: string): string | undefined {
  return process.env[key];
}

export function loadProxyConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  mkdirSync(FORGEFRAME_DIR, { recursive: true });

  const upstream = overrides.upstream
    ?? (env('UPSTREAM') as ProxyConfig['upstream'] | undefined)
    ?? 'anthropic';

  return {
    port: overrides.port
      ?? (env('PORT') ? parseInt(env('PORT')!, 10) : undefined)
      ?? PROXY_DEFAULTS.port,
    host: overrides.host
      ?? env('HOST')
      ?? PROXY_DEFAULTS.host,
    upstream,
    anthropicApiKey: overrides.anthropicApiKey
      ?? envGlobal('ANTHROPIC_API_KEY')
      ?? null,
    openaiApiKey: overrides.openaiApiKey
      ?? envGlobal('OPENAI_API_KEY')
      ?? null,
    anthropicBaseUrl: overrides.anthropicBaseUrl
      ?? env('ANTHROPIC_BASE_URL')
      ?? PROXY_DEFAULTS.anthropicBaseUrl,
    openaiBaseUrl: overrides.openaiBaseUrl
      ?? env('OPENAI_BASE_URL')
      ?? PROXY_DEFAULTS.openaiBaseUrl,
    ollamaUrl: overrides.ollamaUrl
      ?? env('OLLAMA_URL')
      ?? PROXY_DEFAULTS.ollamaUrl,
    ollamaModel: overrides.ollamaModel
      ?? env('OLLAMA_MODEL')
      ?? PROXY_DEFAULTS.ollamaModel,
    llmScrubTimeout: overrides.llmScrubTimeout
      ?? (env('LLM_SCRUB_TIMEOUT') ? parseInt(env('LLM_SCRUB_TIMEOUT')!, 10) : undefined)
      ?? PROXY_DEFAULTS.llmScrubTimeout,
    llmScrubEnabled: overrides.llmScrubEnabled
      ?? (env('LLM_SCRUB') !== undefined ? env('LLM_SCRUB') === 'true' : undefined)
      ?? false,
    memoryDbPath: overrides.memoryDbPath
      ?? envGlobal('FORGEFRAME_DB_PATH')
      ?? resolve(FORGEFRAME_DIR, 'memory.db'),
    provenanceDbPath: overrides.provenanceDbPath
      ?? env('PROVENANCE_PATH')
      ?? resolve(FORGEFRAME_DIR, 'proxy-provenance.jsonl'),
    tokenMapPath: overrides.tokenMapPath
      ?? env('TOKEN_MAP_PATH')
      ?? resolve(FORGEFRAME_DIR, 'token-map.json'),
    maxMemoryResults: overrides.maxMemoryResults
      ?? (env('MAX_MEMORY') ? parseInt(env('MAX_MEMORY')!, 10) : undefined)
      ?? PROXY_DEFAULTS.maxMemoryResults,
    allowlistPath: overrides.allowlistPath
      ?? env('ALLOWLIST')
      ?? null,
    blocklistPath: overrides.blocklistPath
      ?? env('BLOCKLIST')
      ?? null,
    logger: overrides.logger ?? createConsoleLogger(),
  };
}
