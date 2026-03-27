/**
 * @forgeframe/server — HTTP Transport
 *
 * Hono-based HTTP API + SSE for the swarm viewer.
 * Runs alongside the MCP stdio transport.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import type { MemoryStore } from '@forgeframe/memory';
import type { ServerEvents } from './events.js';

export interface HttpServerOptions {
  store: MemoryStore;
  events: ServerEvents;
  port: number;
}

export function startHttpServer({ store, events, port }: HttpServerOptions) {
  const app = new Hono();

  app.use('*', cors());

  // --- Memory endpoints ---

  app.get('/api/memories/recent', (c) => {
    const limit = Number(c.req.query('limit') ?? 50);
    const memories = store.getRecent(limit);
    return c.json(memories.map(sanitize));
  });

  app.get('/api/memories/by-tag/:tag', (c) => {
    const tag = c.req.param('tag');
    const limit = Number(c.req.query('limit') ?? 50);
    const memories = store.listByTag(tag, limit);
    return c.json(memories.map(sanitize));
  });

  app.get('/api/memories/search', (c) => {
    const q = c.req.query('q') ?? '';
    const limit = Number(c.req.query('limit') ?? 20);
    if (!q) return c.json([]);
    const memories = store.search(q, limit);
    return c.json(memories.map(sanitize));
  });

  app.get('/api/memories/:id', (c) => {
    const memory = store.get(c.req.param('id'));
    if (!memory) return c.json({ error: 'Not found' }, 404);
    return c.json(sanitize(memory));
  });

  // --- Session endpoints ---

  app.get('/api/sessions', (c) => {
    const status = (c.req.query('status') ?? 'all') as 'active' | 'ended' | 'all';
    const limit = Number(c.req.query('limit') ?? 50);
    const sessions = store.listSessions({ status, limit });
    return c.json(sessions);
  });

  // --- Status ---

  app.get('/api/status', (c) => {
    const activeSessions = store.listSessions({ status: 'active', limit: 100 });
    return c.json({
      memoryCount: store.count(),
      activeSessions: activeSessions.length,
      sessions: activeSessions,
    });
  });

  // --- SSE live feed ---

  app.get('/api/events', (c) => {
    return streamSSE(c, async (stream) => {
      const handlers: Array<{ event: string; fn: (...args: any[]) => void }> = [];

      function on(event: string, fn: (...args: any[]) => void) {
        events.on(event as any, fn);
        handlers.push({ event, fn });
      }

      on('memory:created', (memory) => {
        stream.writeSSE({
          event: 'memory:created',
          data: JSON.stringify(sanitize(memory)),
        });
      });

      on('memory:updated', (memory) => {
        stream.writeSSE({
          event: 'memory:updated',
          data: JSON.stringify(sanitize(memory)),
        });
      });

      on('memory:deleted', (id) => {
        stream.writeSSE({
          event: 'memory:deleted',
          data: JSON.stringify({ id }),
        });
      });

      on('session:started', (sessionId) => {
        stream.writeSSE({
          event: 'session:started',
          data: JSON.stringify({ sessionId }),
        });
      });

      on('session:ended', (sessionId) => {
        stream.writeSSE({
          event: 'session:ended',
          data: JSON.stringify({ sessionId }),
        });
      });

      // Keep alive
      const keepAlive = setInterval(() => {
        stream.writeSSE({ event: 'ping', data: '' });
      }, 15000);

      // Clean up on disconnect
      stream.onAbort(() => {
        clearInterval(keepAlive);
        for (const { event, fn } of handlers) {
          events.off(event as any, fn);
        }
      });

      // Block until aborted
      await new Promise(() => {});
    });
  });

  // --- Viewer (serve static HTML) ---

  app.get('/', async (c) => {
    const { readFileSync } = await import('fs');
    const { resolve, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    try {
      const html = readFileSync(resolve(__dirname, '../../swarm/viewer/index.html'), 'utf-8');
      return c.html(html);
    } catch {
      // Fallback: try from ForgeFrame repo root
      const { homedir } = await import('os');
      try {
        const html = readFileSync(resolve(homedir(), 'repos/ForgeFrame/swarm/viewer/index.html'), 'utf-8');
        return c.html(html);
      } catch {
        return c.text('Viewer not found. Place index.html in swarm/viewer/', 404);
      }
    }
  });

  const server = serve({ fetch: app.fetch, port });

  // Log to stderr so it doesn't interfere with MCP stdio
  process.stderr.write(`ForgeFrame viewer: http://localhost:${port}\n`);

  return server;
}

/** Strip embeddings from API responses (large binary data) */
function sanitize(memory: any) {
  const { embedding, ...rest } = memory;
  return rest;
}
