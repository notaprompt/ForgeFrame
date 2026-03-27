#!/usr/bin/env node

/**
 * @forgeframe/server — CLI Entry Point
 *
 * Runs the MCP memory server over stdio.
 * Optionally starts an HTTP server for the swarm viewer.
 *
 * Usage:
 *   npx @forgeframe/server                    # MCP only
 *   FORGEFRAME_HTTP_PORT=3001 npx @forgeframe/server  # MCP + viewer
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const instance = createServer();
const transport = new StdioServerTransport();

// Start HTTP server if port is configured
const httpPort = process.env.FORGEFRAME_HTTP_PORT
  ? parseInt(process.env.FORGEFRAME_HTTP_PORT, 10)
  : undefined;

if (httpPort) {
  const { startHttpServer } = await import('./http.js');
  startHttpServer({
    store: instance.store,
    events: instance.events,
    port: httpPort,
  });
}

function shutdown() {
  instance.shutdown();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await instance.server.connect(transport);
