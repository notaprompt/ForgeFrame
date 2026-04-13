/**
 * @forgeframe/server — Server Assembly
 */

import { join } from 'path';
import { homedir } from 'os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MemoryStore, MemoryRetriever, OllamaEmbedder, OllamaGenerator } from '@forgeframe/memory';
import type { Session, Embedder, Generator } from '@forgeframe/memory';
import { MEMORY_ORGAN_MANIFEST, createMemoryOrganLifecycle } from '@forgeframe/memory';
import { OrganRegistryImpl, detectResourceBudget, createConsoleLogger } from '@forgeframe/core';
import type { LoraTrainingRun } from '@forgeframe/core';
import { loadConfig, type ServerConfig } from './config.js';
import { ProvenanceLogger } from './provenance.js';
import { ServerEvents } from './events.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';
import { ingestMarkdownDir, syncSource } from './ingest.js';
import { registerOrganTools } from './organ-tools.js';
import { DistilleryIntake } from './distillery.js';
import { LoraDataPrep, LoraTrainer, registerLoraTools } from './lora/index.js';

export interface ServerInstance {
  server: McpServer;
  store: MemoryStore;
  events: ServerEvents;
  session: Session;
  embedder: Embedder | null;
  generator: Generator;
  registry: OrganRegistryImpl;
  shutdown: () => void;
}

export function createServer(overrides?: Partial<ServerConfig>): ServerInstance {
  const config = loadConfig(overrides);
  const log = createConsoleLogger();
  const store = new MemoryStore({ dbPath: config.dbPath });
  const embedder = new OllamaEmbedder({
    ollamaUrl: config.ollamaUrl,
    model: config.embeddingModel,
  });
  const generator = new OllamaGenerator({
    ollamaUrl: config.ollamaUrl,
    model: config.generatorModel ?? 'qwen3:32b',
  });
  const retriever = new MemoryRetriever(store, embedder, { hebbian: true });
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

  registerTools(server, store, retriever, embedder, generator, provenance, events, config, session);
  registerResources(server, store, config);
  registerPrompts(server);

  // --- Organ System ---
  const budget = detectResourceBudget();
  const registry = new OrganRegistryImpl({ logger: log, budget });
  registerOrganTools(server, registry);

  // --- Distillery Intake ---
  let distilleryIntake: DistilleryIntake | null = null;

  // --- LoRA Pipeline ---
  const loraRuns = new Map<string, LoraTrainingRun>();
  let loraDataPrep: LoraDataPrep | null = null;
  let loraTrainer: LoraTrainer | null = null;

  if (config.loraBaseModel) {
    const loraOutputDir = config.loraOutputDir ?? join(homedir(), '.forgeframe', 'lora');
    loraDataPrep = new LoraDataPrep(store, {
      outputDir: loraOutputDir,
      minStrength: 0.5,
      baseModel: config.loraBaseModel,
    }, log);
    loraTrainer = new LoraTrainer({
      baseModel: config.loraBaseModel,
      mlxLmPath: config.loraMlxLmPath ?? 'python',
      outputDir: loraOutputDir,
      maxEpochs: 2,
      learningRate: 1e-4,
      loraRank: 8,
      loraAlpha: 16,
      validationThreshold: 0.05,
      minStrength: 0.5,
    }, log);
  }
  registerLoraTools(server, loraDataPrep, loraTrainer, loraRuns);

  // Distillery sync tool (available even if not configured — returns helpful error)
  server.tool('distillery_sync', 'Sync items from the Distillery pipeline into ForgeFrame memory', {}, async () => {
    if (!distilleryIntake) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Distillery not configured. Set FORGEFRAME_DISTILLERY_DB.' }) }], isError: true };
    const result = await distilleryIntake.sync();
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  if (config.decayOnStartup) {
    applyConstitutionalDecay(store);
    events.emit('memory:decayed', 0);
  }

  // Warn if Ollama is unreachable (semantic search degrades to keyword-only)
  embedder.embed('health-check').then((result) => {
    if (!result) {
      process.stderr.write(
        `[forgeframe] warning: Ollama not reachable at ${config.ollamaUrl} — semantic search disabled, keyword-only mode active\n`,
      );
    }
  });

  // All async initialization runs sequentially in a single async chain
  (async () => {
    // Register built-in organs
    try {
      await registry.register(MEMORY_ORGAN_MANIFEST, createMemoryOrganLifecycle(store, retriever));
    } catch (err) {
      log.warn('Failed to register memory organ:', err);
    }

    // Ollama organ discovery (dynamic import — safe if file missing)
    try {
      const mod = './ollama-organ.js';
      const { OllamaOrganAdapter } = await import(/* webpackIgnore: true */ mod);
      const ollamaAdapter = new OllamaOrganAdapter({
        ollamaUrl: config.ollamaUrl,
        registry,
        logger: log,
      });
      const registered = await ollamaAdapter.discoverAndRegister();
      if (registered.length > 0) {
        log.info(`Ollama organs registered: ${registered.join(', ')}`);
      }
    } catch (err) {
      log.warn('Ollama organ discovery skipped:', err);
    }

    // Wire Distillery intake (conditional)
    if (config.distilleryDbPath) {
      try {
        distilleryIntake = new DistilleryIntake(store, embedder, {
          distilleryDbPath: config.distilleryDbPath,
          pollIntervalMs: config.distilleryPollMs ?? 0,
        }, log);
        const syncResult = await distilleryIntake.sync();
        log.info(`Distillery sync: ${syncResult.imported} imported, ${syncResult.skipped} skipped`);
        if (config.distilleryPollMs && config.distilleryPollMs > 0) {
          distilleryIntake.startPolling();
        }
      } catch (err) {
        log.warn('Distillery intake failed to initialize:', err);
      }
    }

    // Ingestion
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
    if (distilleryIntake) {
      distilleryIntake.stopPolling();
    }
    try { store.endSession(session!.id); } catch {}
    events.emit('session:ended', session!.id);
    store.close();
  }

  return { server, store, events, session, embedder, generator, registry, shutdown };
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
