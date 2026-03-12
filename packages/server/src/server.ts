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
import { ingestMarkdownDir } from './ingest.js';

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

  // Boot-context ingestion (async, fire-and-forget)
  if (config.ingestDir) {
    ingestMarkdownDir(config.ingestDir, store, embedder).catch(() => {});
  }

  events.emit('session:started', session.id);

  function shutdown() {
    try { store.endSession(session!.id); } catch {}
    events.emit('session:ended', session!.id);
    store.close();
  }

  return { server, store, events, session, embedder, shutdown };
}

/**
 * Apply decay but skip constitutional memories (identity kernel).
 * Constitutional memories are tagged with TRIM constitutional tags (principle, voice)
 * or have metadata.constitutional === true (legacy).
 */
function applyConstitutionalDecay(store: MemoryStore): void {
  // Collect constitutional memories before decay:
  // 1. Legacy: metadata.constitutional === true
  const legacyConstitutional = store.listByTag('source:claude-code', 500)
    .filter((m) => (m.metadata as Record<string, unknown>)?.constitutional === true);

  // 2. TRIM: memories with constitutional tags (principle, voice)
  const principleMemories = store.listByTag('principle', 500);
  const voiceMemories = store.listByTag('voice', 500);

  // Deduplicate by id
  const seen = new Set<string>();
  const constitutional: Array<{ id: string }> = [];
  for (const m of [...legacyConstitutional, ...principleMemories, ...voiceMemories]) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      constitutional.push(m);
    }
  }

  // Apply decay to all
  store.applyDecay();

  // Restore constitutional memories to full strength
  for (const m of constitutional) {
    store.resetStrength(m.id, 1.0);
  }
}
