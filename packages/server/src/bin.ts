#!/usr/bin/env node

/**
 * @forgeframe/server — CLI Entry Point
 *
 * Runs the MCP memory server over stdio.
 * Usage: npx @forgeframe/server
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const instance = createServer();
const transport = new StdioServerTransport();

function shutdown() {
  instance.shutdown();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await instance.server.connect(transport);
