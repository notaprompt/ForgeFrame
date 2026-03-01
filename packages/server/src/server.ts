/**
 * @forgeframe/server — Server Assembly
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MemoryStore, MemoryRetriever } from '@forgeframe/memory';
import type { Session } from '@forgeframe/memory';
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
  session: Session;
  shutdown: () => void;
}

export function createServer(overrides?: Partial<ServerConfig>): ServerInstance {
  const config = loadConfig(overrides);
  const store = new MemoryStore({ dbPath: config.dbPath });
  const retriever = new MemoryRetriever(store);
  const provenance = new ProvenanceLogger(config.provenancePath);
  const events = new ServerEvents();

  let session: Session | null = null;
  if (config.sessionId) {
    session = store.getSession(config.sessionId);
    if (session && session.endedAt !== null) session = null;
  }
  if (!session) {
    session = store.startSession();
  }

  const server = new McpServer(
    { name: config.serverName, version: config.serverVersion },
    { capabilities: { logging: {} } },
  );

  registerTools(server, store, retriever, provenance, events, config, session);
  registerResources(server, store, config);
  registerPrompts(server);

  if (config.decayOnStartup) {
    const decayed = store.applyDecay();
    if (decayed > 0) {
      events.emit('memory:decayed', decayed);
    }
  }

  events.emit('session:started', session.id);

  function shutdown() {
    try { store.endSession(session!.id); } catch {}
    events.emit('session:ended', session!.id);
    store.close();
  }

  return { server, store, events, session, shutdown };
}
