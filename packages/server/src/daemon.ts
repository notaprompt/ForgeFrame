/**
 * @forgeframe/server — Daemon Lifecycle
 *
 * Manages a persistent HTTP server for the swarm viewer and REST API.
 * PID tracked at ~/.forgeframe/daemon.pid, port at ~/.forgeframe/daemon.port.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { MemoryStore, OllamaEmbedder } from '@forgeframe/memory';
import { loadConfig } from './config.js';
import { ServerEvents } from './events.js';
import { startHttpServer } from './http.js';

const FORGEFRAME_DIR = resolve(homedir(), '.forgeframe');
const PID_PATH = resolve(FORGEFRAME_DIR, 'daemon.pid');
const PORT_PATH = resolve(FORGEFRAME_DIR, 'daemon.port');

export interface DaemonOptions {
  port: number;
  hostname: string;
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  port?: number;
}

export function isDaemonRunning(): DaemonStatus {
  if (!existsSync(PID_PATH)) return { running: false };

  let pid: number;
  try {
    pid = parseInt(readFileSync(PID_PATH, 'utf-8').trim(), 10);
  } catch {
    return { running: false };
  }

  if (isNaN(pid)) return { running: false };

  try {
    process.kill(pid, 0);
  } catch {
    // Process not running — clean up stale files
    try { unlinkSync(PID_PATH); } catch {}
    try { unlinkSync(PORT_PATH); } catch {}
    return { running: false };
  }

  let port: number | undefined;
  try {
    port = parseInt(readFileSync(PORT_PATH, 'utf-8').trim(), 10);
    if (isNaN(port)) port = undefined;
  } catch {}

  return { running: true, pid, port };
}

export function stopDaemon(): boolean {
  const status = isDaemonRunning();
  if (!status.running || !status.pid) return false;

  try {
    process.kill(status.pid, 'SIGTERM');
  } catch {
    return false;
  }

  try { unlinkSync(PID_PATH); } catch {}
  try { unlinkSync(PORT_PATH); } catch {}

  return true;
}

export async function serveDaemon(opts: DaemonOptions): Promise<void> {
  const config = loadConfig();
  const store = new MemoryStore({ dbPath: config.dbPath });
  const events = new ServerEvents();

  writeFileSync(PID_PATH, String(process.pid), 'utf-8');
  writeFileSync(PORT_PATH, String(opts.port), 'utf-8');

  startHttpServer({
    store,
    events,
    port: opts.port,
    hostname: opts.hostname,
  });

  process.stderr.write(`ForgeFrame daemon running (pid ${process.pid}, port ${opts.port})\n`);

  function shutdown() {
    try { unlinkSync(PID_PATH); } catch {}
    try { unlinkSync(PORT_PATH); } catch {}
    store.close();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Block until signal
  await new Promise(() => {});
}
