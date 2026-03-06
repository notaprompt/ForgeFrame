/**
 * @forgeframe/proxy -- Upstream Dispatcher
 */

import type { Upstream, ProxyConfig } from '../types.js';
import { AnthropicUpstream } from './anthropic.js';
import { OpenAIUpstream } from './openai.js';

export function createUpstream(config: ProxyConfig): Upstream {
  if (config.upstream === 'anthropic') {
    if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is required');
    return new AnthropicUpstream(config.anthropicBaseUrl, config.anthropicApiKey);
  }

  if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is required');
  return new OpenAIUpstream(config.openaiBaseUrl, config.openaiApiKey);
}

export { AnthropicUpstream } from './anthropic.js';
export { OpenAIUpstream } from './openai.js';
