#!/usr/bin/env node

/**
 * @forgeframe/proxy -- CLI Entry Point
 *
 * Starts the local proxy server.
 */

import { MemoryStore, MemoryRetriever, OllamaEmbedder } from '@forgeframe/memory';
import { loadProxyConfig } from './config.js';
import { TokenMapImpl } from './token-map.js';
import { ScrubEngineImpl, checkOllamaHealth, warmupLlmScrub } from './scrub/index.js';
import { MemoryInjectorImpl } from './memory-injector.js';
import { ProxyProvenanceLogger } from './provenance.js';
import { createUpstream } from './upstream/index.js';
import { ProxyPipeline } from './pipeline.js';
import { startProxyServer } from './proxy-server.js';

async function main() {
  const config = loadProxyConfig();
  const logger = config.logger;

  logger.info('ForgeFrame Proxy starting...');

  // Memory (use semantic search when Ollama is available)
  const store = new MemoryStore({ dbPath: config.memoryDbPath });
  let embedder: OllamaEmbedder | null = null;
  try {
    const healthy = await checkOllamaHealth(config.ollamaUrl);
    if (healthy) {
      embedder = new OllamaEmbedder({ ollamaUrl: config.ollamaUrl, model: 'nomic-embed-text' });
    }
  } catch { /* no embedder, FTS-only */ }
  const retriever = new MemoryRetriever(store, embedder);
  const memoryInjector = new MemoryInjectorImpl(retriever, embedder !== null);

  // LLM scrub: health check + warmup
  if (config.llmScrubEnabled) {
    const healthy = await checkOllamaHealth(config.ollamaUrl);
    if (healthy) {
      logger.info('Ollama reachable, warming up model for LLM scrub...');
      await warmupLlmScrub(config.ollamaUrl, config.ollamaModel, logger);
    } else {
      logger.warn('Ollama not reachable at', config.ollamaUrl, '-- tier 3 LLM scrub will fail-open');
    }
  }

  // Scrub
  const scrubEngine = new ScrubEngineImpl(config);

  // Upstream
  const upstream = createUpstream(config);

  // Provenance
  const provenance = new ProxyProvenanceLogger(config.provenanceDbPath);

  // Pipeline
  const tokenMap = new TokenMapImpl();
  const pipeline = new ProxyPipeline(
    { scrubEngine, memoryInjector, upstream, provenance, logger },
    tokenMap,
  );

  // Start
  await startProxyServer({ config, pipeline });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start proxy:', err);
  process.exit(1);
});
