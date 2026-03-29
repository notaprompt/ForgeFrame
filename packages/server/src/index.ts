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
export type { DaemonOptions, DaemonStatus } from './daemon.js';
export { ForgeAgent } from './agent.js';
export type { AgentConfig, AgentStep } from './agent.js';
export { TriggerManager } from './triggers.js';
export type { CronTrigger, WatchTrigger, Trigger } from './triggers.js';
