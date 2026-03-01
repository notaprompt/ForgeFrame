/**
 * @forgeframe/core — Types & Interfaces
 *
 * All public types for the ForgeFrame routing engine.
 * No runtime dependencies — pure type definitions + a console logger factory.
 */

// -- Dependency Injection Interfaces --

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

export interface ConfigStore {
  read<T>(key: string, fallback: T): T;
  write(key: string, data: unknown): void;
}

export interface KeyStore {
  getKey(providerId: string): string | null;
}

// -- Model & Routing Types --

export type Tier = 'quick' | 'balanced' | 'deep';

export type ProviderType = 'openai-compatible' | 'ollama' | 'anthropic';

export interface Model {
  id: string;
  label: string;
  provider: string;
  providerName?: string | null;
  providerType?: string;
  baseUrl?: string | null;
  description: string;
  tier: Tier;
}

export interface ResolvedModel {
  provider: string;
  modelId: string;
  tier: Tier;
  auto: boolean;
}

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  providerName: string | null;
  description: string;
  tier: Tier;
}

// -- Messaging Types --

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type StreamEvent =
  | { type: 'message_start'; message: { id: string | null; model: string | null } }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'message_stop' }
  | { type: 'result'; usage: { input_tokens: number; output_tokens: number } }
  | { type: 'error'; error: string };

export interface SendMessageOptions {
  model?: string;
  stream?: boolean;
  maxTokens?: number;
  system?: string;
}

// -- Provider Interface --

export interface Provider {
  name: string;
  type: string;
  isAvailable(): boolean;
  sendMessage(messages: Message[], options?: SendMessageOptions): import('events').EventEmitter;
}

// -- Defaults --

export function createConsoleLogger(): Logger {
  return {
    info: (...args) => console.log('[forgeframe:INFO]', ...args),
    warn: (...args) => console.warn('[forgeframe:WARN]', ...args),
    error: (...args) => console.error('[forgeframe:ERROR]', ...args),
    debug: (...args) => console.debug('[forgeframe:DEBUG]', ...args),
  };
}
