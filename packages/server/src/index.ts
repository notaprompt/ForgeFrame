/**
 * @forgeframe/server — MCP Memory Server
 *
 * Persistent semantic memory for any MCP client.
 * Local-first, no cloud dependency.
 */

export { createServer } from './server.js';
export type { ServerConfig } from './config.js';
export { ServerEvents } from './events.js';
export { ProvenanceLogger } from './provenance.js';
export { isDaemonRunning, stopDaemon, serveDaemon } from './daemon.js';
export { generateToken, showToken, revokeToken, loadToken } from './token.js';
export type { DaemonOptions, DaemonStatus } from './daemon.js';
// ForgeAgent is internal/experimental — not exported until tool execution is wired.
// See agent.ts and agent-cli.ts for CLI usage via `forgeframe agent run`.
export { TriggerManager } from './triggers.js';
export type { CronTrigger, WatchTrigger, Trigger } from './triggers.js';
export { startProactive } from './proactive.js';
export type { ProactiveConfig, StartProactiveOptions } from './proactive.js';
export { SERVER_ORGAN_MANIFEST, createServerOrganLifecycle } from './organ.js';
export { registerOrganTools } from './organ-tools.js';
export { DistilleryIntake } from './distillery.js';
export type { DistilleryConfig, SyncResult } from './distillery.js';
export { LoraDataPrep, LoraTrainer, LoraValidator, LoraConverter, registerLoraTools } from './lora/index.js';
export { catalogAll, catalogMemory, hasMemorandum } from './catalog.js';
export { LOOM_ORGAN_MANIFEST, createLoomOrganLifecycle } from './loom/index.js';
// OllamaOrganAdapter — re-exported once ollama-organ.ts lands (dynamic import in server.ts)
