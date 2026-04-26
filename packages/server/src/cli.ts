#!/usr/bin/env node

/**
 * @forgeframe/server — CLI
 *
 * Usage:
 *   forgeframe start [--port N] [--hostname H]   Start daemon (background)
 *   forgeframe stop                               Stop daemon
 *   forgeframe status                             Show daemon status
 *   forgeframe serve [--port N] [--hostname H]    Run daemon in foreground
 *   forgeframe agent run "task" [--tier T] [--budget N] [--leash L]
 *   forgeframe agent stop                         Kill running agent
 *   forgeframe agent log                          Show recent agent runs
 *   forgeframe loom reflect [--min-cluster-size N]
 *   forgeframe loom status
 *   forgeframe loom proposals [--limit N]
 */

import { isDaemonRunning, stopDaemon, serveDaemon } from './daemon.js';
import { runInit } from './init.js';
import { runAgent, stopAgent, showAgentLog } from './agent-cli.js';
import { generateToken, showToken, revokeToken } from './token.js';
import { runLoomReflect, runLoomStatus, runLoomProposals } from './loom/cli.js';

const args = process.argv.slice(2);
const command = args[0];

function flag(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}

async function main() {
  switch (command) {
    case 'start': {
      const status = isDaemonRunning();
      if (status.running) {
        process.stderr.write(`ForgeFrame daemon already running (pid ${status.pid}, port ${status.port})\n`);
        process.exit(0);
      }

      const port = parseInt(flag('port', '3001'), 10);
      const hostname = flag('hostname', '127.0.0.1');

      // Spawn detached daemon
      const { spawn } = await import('child_process');
      const { fileURLToPath } = await import('url');
      const bin = fileURLToPath(import.meta.url);

      const child = spawn(process.execPath, [bin, 'serve', '--port', String(port), '--hostname', hostname], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      // Wait briefly for PID file
      await new Promise((r) => setTimeout(r, 1500));

      const check = isDaemonRunning();
      if (check.running) {
        process.stdout.write(`ForgeFrame daemon started (pid ${check.pid}, port ${check.port})\n`);
      } else {
        process.stderr.write('ForgeFrame daemon failed to start.\n');
        process.exit(1);
      }
      break;
    }

    case 'stop': {
      const stopped = stopDaemon();
      if (stopped) {
        process.stdout.write('ForgeFrame daemon stopped.\n');
      } else {
        process.stderr.write('No running daemon found.\n');
        process.exit(1);
      }
      break;
    }

    case 'status': {
      const status = isDaemonRunning();
      process.stdout.write(JSON.stringify(status, null, 2) + '\n');
      break;
    }

    case 'serve': {
      const port = parseInt(flag('port', '3001'), 10);
      const hostname = flag('hostname', '127.0.0.1');
      try {
        await serveDaemon({ port, hostname });
      } catch (err: any) {
        if (err?.code === 'EADDRINUSE') {
          process.stderr.write(`Port ${port} is already in use. Is another daemon running?\n`);
        } else {
          process.stderr.write(`Failed to start daemon: ${err?.message ?? err}\n`);
        }
        process.exit(1);
      }
      break;
    }

    case 'init': {
      await runInit();
      break;
    }

    case 'link': {
      const { MemoryStore } = await import('@forgeframe/memory');
      const config = (await import('./config.js')).loadConfig();
      const store = new MemoryStore({ dbPath: config.dbPath });
      const all = store.getRecent(5000);
      const total = all.length;
      let totalEdges = 0;
      process.stderr.write(`Auto-linking ${total} memories...\n`);

      for (let i = 0; i < all.length; i++) {
        const created = store.autoLink(all[i].id, 5);
        totalEdges += created;
        if ((i + 1) % 50 === 0 || i === all.length - 1) {
          process.stderr.write(`  ${i + 1}/${total} — ${totalEdges} edges created\n`);
        }
      }

      process.stderr.write(`\nDone. ${totalEdges} edges created across ${total} memories.\n`);
      process.stderr.write(`Total edges in graph: ${store.edgeCount()}\n`);
      store.close();
      break;
    }

    case 'catalog': {
      const { catalogAll } = await import('./catalog.js');
      const { MemoryStore } = await import('@forgeframe/memory');
      const config = (await import('./config.js')).loadConfig();
      const store = new MemoryStore({ dbPath: config.dbPath });

      process.stderr.write('Cataloging memories via Ollama...\n');

      const result = await catalogAll(store, (done, total, _id) => {
        if (done % 10 === 0 || done === total) {
          process.stderr.write(`  ${done}/${total}\n`);
        }
      });

      process.stderr.write(`\nDone. ${result.cataloged} cataloged, ${result.skipped} skipped, ${result.failed} failed.\n`);
      store.close();
      break;
    }

    case 'token': {
      const sub = args[1];
      if (sub === 'generate' || sub === 'new') {
        generateToken();
      } else if (sub === 'show') {
        showToken();
      } else if (sub === 'revoke') {
        revokeToken();
      } else {
        // Default: show if exists, generate if not
        const existing = showToken();
        if (!existing) generateToken();
      }
      break;
    }

    case 'loom': {
      const sub = args[1];
      const rest = args.slice(2);
      if (sub === 'reflect') {
        runLoomReflect(rest);
      } else if (sub === 'status') {
        runLoomStatus();
      } else if (sub === 'proposals') {
        runLoomProposals(rest);
      } else {
        process.stderr.write('Usage: forgeframe loom <reflect|status|proposals>\n');
        process.exit(1);
      }
      break;
    }

    case 'agent': {
      const sub = args[1];
      if (sub === 'run') {
        await runAgent(args.slice(2));
      } else if (sub === 'stop') {
        stopAgent();
      } else if (sub === 'log') {
        await showAgentLog();
      } else {
        process.stderr.write([
          'Usage:',
          '  forgeframe agent run "task" [--tier quick|balanced|deep] [--budget N] [--leash ask|auto]',
          '  forgeframe agent stop',
          '  forgeframe agent log',
          '',
        ].join('\n'));
        process.exit(sub ? 1 : 0);
      }
      break;
    }

    default:
      process.stderr.write([
        'ForgeFrame CLI',
        '',
        'Usage:',
        '  forgeframe init                Interactive setup',
        '  forgeframe start [--port N]    Start daemon (background)',
        '  forgeframe stop                Stop daemon',
        '  forgeframe status              Show daemon status',
        '  forgeframe serve [--port N]    Run in foreground',
        '  forgeframe link                Auto-link all memories (create edges)',
        '  forgeframe catalog             Enrich memories with titles/insights via Ollama',
        '  forgeframe token               Show token (or generate if none)',
        '  forgeframe token generate      Generate a new API token',
        '  forgeframe token show          Show current token',
        '  forgeframe token revoke        Remove current token',
        '  forgeframe agent run "task"    Run agent task',
        '  forgeframe agent stop          Kill running agent',
        '  forgeframe agent log           Show recent runs',
        '',
      ].join('\n'));
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  process.stderr.write(`${err}\n`);
  process.exit(1);
});
