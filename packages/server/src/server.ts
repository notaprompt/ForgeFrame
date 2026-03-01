/**
 * @forgeframe/server — Server Assembly
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MemoryStore, MemoryRetriever } from '@forgeframe/memory';
import { loadConfig, type ServerConfig } from './config.js';
import { ProvenanceLogger } from './provenance.js';
import { ServerEvents } from './events.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';

export interface ServerInstance {
  server: McpServer;
  store: MemoryStore;
  events: ServerEvents;
}

export function createServer(overrides?: Partial<ServerConfig>): ServerInstance {
  const config = loadConfig(overrides);
  const store = new MemoryStore({ dbPath: config.dbPath });
  const retriever = new MemoryRetriever(store);
  const provenance = new ProvenanceLogger(config.provenancePath);
  const events = new ServerEvents();

  const server = new McpServer(
    { name: config.serverName, version: config.serverVersion },
    { capabilities: { logging: {} } },
  );

  registerTools(server, store, retriever, provenance, events, config);
  registerResources(server, store, config);
  registerPrompts(server);

  if (config.decayOnStartup) {
    const decayed = store.applyDecay();
    if (decayed > 0) {
      events.emit('memory:decayed', decayed);
    }
  }

  events.emit('session:started', config.sessionId);

  return { server, store, events };
}
