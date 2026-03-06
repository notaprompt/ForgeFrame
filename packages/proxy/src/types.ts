/**
 * @forgeframe/proxy -- Types & Interfaces
 *
 * All public types for the sovereign proxy layer.
 */

import type { Logger } from '@forgeframe/core';

// -- Token Categories --

export const TOKEN_CATEGORIES = {
  PERSON: 'PERSON',
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  SSN: 'SSN',
  IP: 'IP',
  PATH: 'PATH',
  ORG: 'ORG',
  PROJECT: 'PROJECT',
  CUSTOM: 'CUSTOM',
} as const;

export type TokenCategory = typeof TOKEN_CATEGORIES[keyof typeof TOKEN_CATEGORIES];

// -- Token Map --

export interface TokenMap {
  tokenize(value: string, category: TokenCategory): string;
  detokenize(token: string): string | null;
  detokenizeAll(text: string): string;
  serialize(): string;
  readonly size: number;
}

// -- Scrub --

export interface ScrubResult {
  text: string;
  redactions: RedactionEntry[];
}

export interface RedactionEntry {
  original: string;
  token: string;
  category: TokenCategory;
  tier: 1 | 2 | 3;
}

export interface ScrubEngine {
  scrub(text: string, tokenMap: TokenMap): Promise<ScrubResult>;
}

// -- Memory Injection --

export interface MemoryInjector {
  retrieve(text: string, limit?: number): Promise<string>;
}

// -- Upstream --

export interface UpstreamRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  stream: boolean;
}

export interface UpstreamResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface SSEChunk {
  event?: string;
  data: string;
}

export interface Upstream {
  forward(request: UpstreamRequest): Promise<UpstreamResponse>;
  forwardStream(request: UpstreamRequest): AsyncGenerator<SSEChunk>;
}

// -- Provenance --

export interface ProxyProvenanceEntry {
  timestamp: number;
  requestId: string;
  action: 'proxy_request' | 'proxy_response';
  originalPromptHash?: string;
  scrubbed?: string;
  redactions?: { category: string; count: number }[];
  memoryInjected?: string[];
  tierTimings?: { t1: number; t2: number; t3: number | null };
  rehydrated?: boolean;
  tokensUsed?: { input: number; output: number };
  latencyMs?: number;
  upstream?: string;
}

// -- Config --

export const PROXY_DEFAULTS = {
  port: 4740,
  host: '127.0.0.1',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen3:32b',
  llmScrubTimeout: 500,
  maxMemoryResults: 5,
  bufferHoldMax: 64,
  anthropicBaseUrl: 'https://api.anthropic.com',
  openaiBaseUrl: 'https://api.openai.com',
} as const;

export interface ProxyConfig {
  port: number;
  host: string;
  upstream: 'anthropic' | 'openai';
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  anthropicBaseUrl: string;
  openaiBaseUrl: string;
  ollamaUrl: string;
  ollamaModel: string;
  llmScrubTimeout: number;
  llmScrubEnabled: boolean;
  memoryDbPath: string;
  provenanceDbPath: string;
  maxMemoryResults: number;
  allowlistPath: string | null;
  blocklistPath: string | null;
  logger: Logger;
}
