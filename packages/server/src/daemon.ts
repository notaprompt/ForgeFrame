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

export function pidPath(dir = FORGEFRAME_DIR) { return resolve(dir, 'daemon.pid'); }
export function portPath(dir = FORGEFRAME_DIR) { return resolve(dir, 'daemon.port'); }

const PID_PATH = pidPath();
const PORT_PATH = portPath();

export interface DaemonOptions {
  port: number;
  hostname: string;
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  port?: number;
}

export function isDaemonRunning(dir?: string): DaemonStatus {
  const pid_file = dir ? pidPath(dir) : PID_PATH;
  const port_file = dir ? portPath(dir) : PORT_PATH;

  if (!existsSync(pid_file)) return { running: false };

  let pid: number;
  try {
    pid = parseInt(readFileSync(pid_file, 'utf-8').trim(), 10);
  } catch {
    return { running: false };
  }

  if (isNaN(pid)) return { running: false };

  try {
    process.kill(pid, 0);
  } catch {
    // Process not running — clean up stale files
    try { unlinkSync(pid_file); } catch {}
    try { unlinkSync(port_file); } catch {}
    return { running: false };
  }

  let port: number | undefined;
  try {
    port = parseInt(readFileSync(port_file, 'utf-8').trim(), 10);
    if (isNaN(port)) port = undefined;
  } catch {}

  return { running: true, pid, port };
}

export function stopDaemon(dir?: string): boolean {
  const status = isDaemonRunning(dir);
  if (!status.running || !status.pid) return false;

  try {
    process.kill(status.pid, 'SIGTERM');
  } catch {
    return false;
  }

  const pid_file = dir ? pidPath(dir) : PID_PATH;
  const port_file = dir ? portPath(dir) : PORT_PATH;
  try { unlinkSync(pid_file); } catch {}
  try { unlinkSync(port_file); } catch {}

  return true;
}

export async function serveDaemon(opts: DaemonOptions): Promise<void> {
  const config = loadConfig();
  const store = new MemoryStore({ dbPath: config.dbPath });
  const events = new ServerEvents();

  const server = startHttpServer({
    store,
    events,
    port: opts.port,
    hostname: opts.hostname,
  });

  // Wait for server to bind before writing PID/port
  await new Promise<void>((resolve, reject) => {
    server.on('listening', resolve);
    server.on('error', reject);
  });

  writeFileSync(PID_PATH, String(process.pid), 'utf-8');
  writeFileSync(PORT_PATH, String(opts.port), 'utf-8');

  process.stderr.write(`ForgeFrame daemon running (pid ${process.pid}, port ${opts.port})\n`);

  function shutdown() {
    try { unlinkSync(PID_PATH); } catch {}
    try { unlinkSync(PORT_PATH); } catch {}
    store.close();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
  process.on('SIGPIPE', () => {});

  // Block until signal
  await new Promise(() => {});
}
