/**
 * @forgeframe/proxy -- Public API
 */

export {
  TOKEN_CATEGORIES,
  PROXY_DEFAULTS,
} from './types.js';

export type {
  TokenCategory,
  TokenMap,
  ScrubResult,
  RedactionEntry,
  ScrubEngine,
  MemoryInjector,
  UpstreamRequest,
  UpstreamResponse,
  SSEChunk,
  Upstream,
  ProxyProvenanceEntry,
  ProxyConfig,
} from './types.js';

export { TokenMapImpl } from './token-map.js';
export { loadProxyConfig } from './config.js';
export { ScrubEngineImpl, scrubWithRegex, scrubWithDictionary, scrubWithLlm, loadDictionary, buildAllowlistSet } from './scrub/index.js';
export type { DictionaryEntry, DictionaryConfig } from './scrub/index.js';
export { MemoryInjectorImpl } from './memory-injector.js';
export { rehydrate, StreamRehydrator } from './rehydrator.js';
export { ProxyProvenanceLogger } from './provenance.js';
export { createUpstream, AnthropicUpstream, OpenAIUpstream } from './upstream/index.js';
export { ProxyPipeline } from './pipeline.js';
export type { PipelineConfig } from './pipeline.js';
export { createProxyServer, startProxyServer } from './proxy-server.js';
export type { ProxyServerOptions } from './proxy-server.js';
