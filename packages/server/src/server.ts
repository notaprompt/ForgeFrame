/**
 * @forgeframe/server — Server Assembly
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MemoryStore, MemoryRetriever, OllamaEmbedder } from '@forgeframe/memory';
import type { Session, Embedder } from '@forgeframe/memory';
import { loadConfig, type ServerConfig } from './config.js';
import { ProvenanceLogger } from './provenance.js';
import { ServerEvents } from './events.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';
import { ingestMarkdownDir, syncSource } from './ingest.js';

export interface ServerInstance {
  server: McpServer;
  store: MemoryStore;
  events: ServerEvents;
  session: Session;
  embedder: Embedder | null;
  shutdown: () => void;
}

export function createServer(overrides?: Partial<ServerConfig>): ServerInstance {
  const config = loadConfig(overrides);
  const store = new MemoryStore({ dbPath: config.dbPath });
  const embedder = new OllamaEmbedder({
    ollamaUrl: config.ollamaUrl,
    model: config.embeddingModel,
  });
  const retriever = new MemoryRetriever(store, embedder);
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

  registerTools(server, store, retriever, embedder, provenance, events, config, session);
  registerResources(server, store, config);
  registerPrompts(server);

  if (config.decayOnStartup) {
    applyConstitutionalDecay(store);
    events.emit('memory:decayed', 0);
  }

  // All ingestion runs sequentially in a single async chain
  (async () => {
    if (config.ingestDir) {
      await ingestMarkdownDir(config.ingestDir, store, embedder).catch(() => {});
    }
    if (config.sources) {
      const seen = new Set<string>();
      for (const source of config.sources) {
        if (seen.has(source.name)) continue;
        seen.add(source.name);
        await syncSource(source, store, embedder).catch(() => {});
      }
    }
  })();

  events.emit('session:started', session.id);

  function shutdown() {
    try { store.endSession(session!.id); } catch {}
    events.emit('session:ended', session!.id);
    store.close();
  }

  return { server, store, events, session, embedder, shutdown };
}

/**
 * Apply decay, skipping constitutional memories.
 * Constitutional exclusion is handled at the SQL level in store.applyDecay()
 * to avoid race conditions in multi-process (swarm) environments.
 *
 * Legacy constitutional memories (metadata.constitutional === true) are
 * restored to full strength after decay as they cannot be excluded by tag.
 */
function applyConstitutionalDecay(store: MemoryStore): void {
  // Decay all non-constitutional memories (principle/voice excluded in SQL)
  store.applyDecay();

  // Handle legacy constitutional memories that use metadata instead of tags
  const legacyConstitutional = store.listByTag('source:claude-code', 500)
    .filter((m) => (m.metadata as Record<string, unknown>)?.constitutional === true);

  for (const m of legacyConstitutional) {
    store.resetStrength(m.id, 1.0);
  }
}
