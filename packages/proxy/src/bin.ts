#!/usr/bin/env node

/**
 * @forgeframe/proxy -- CLI Entry Point
 *
 * Starts the sovereign proxy server.
 */

import { MemoryStore, MemoryRetriever } from '@forgeframe/memory';
import { loadProxyConfig } from './config.js';
import { TokenMapImpl } from './token-map.js';
import { ScrubEngineImpl } from './scrub/index.js';
import { MemoryInjectorImpl } from './memory-injector.js';
import { ProxyProvenanceLogger } from './provenance.js';
import { createUpstream } from './upstream/index.js';
import { ProxyPipeline } from './pipeline.js';
import { startProxyServer } from './proxy-server.js';

async function main() {
  const config = loadProxyConfig();
  const logger = config.logger;

  logger.info('ForgeFrame Proxy starting...');

  // Memory
  const store = new MemoryStore({ dbPath: config.memoryDbPath });
  const retriever = new MemoryRetriever(store);
  const memoryInjector = new MemoryInjectorImpl(retriever);

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
