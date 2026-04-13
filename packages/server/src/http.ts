/**
 * @forgeframe/server — HTTP Transport
 *
 * Hono-based HTTP API + SSE for the swarm viewer.
 * Runs alongside the MCP stdio transport or as a standalone daemon.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { GuardianComputer, ConsolidationEngine } from '@forgeframe/memory';
import type { GuardianSignals, MemoryEdge, MemoryStore, Generator } from '@forgeframe/memory';
import type { ServerEvents } from './events.js';
import { bearerAuth } from './auth.js';
import { loadToken } from './token.js';

export interface HttpServerOptions {
  store: MemoryStore;
  events: ServerEvents;
  port: number;
  hostname?: string;
  generator?: Generator;
}

export function startHttpServer({ store, events, port, hostname, generator }: HttpServerOptions) {
  const app = new Hono();
  const guardian = new GuardianComputer();

  const allowedOrigins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ];

  app.use('*', cors({
    origin: allowedOrigins,
    allowMethods: ['GET', 'POST'],
    maxAge: 86400,
  }));

  const token = loadToken();
  app.use('/api/*', bearerAuth(token));

  // --- Memory write endpoint ---

  app.post('/api/memories', async (c) => {
    const body = await c.req.json<{ content: string; tags?: string[]; strength?: number; metadata?: Record<string, unknown> }>();
    if (!body.content) return c.json({ error: 'content required' }, 400);
    const memory = store.create({
      content: body.content,
      tags: body.tags,
      metadata: body.metadata,
    });
    if (typeof body.strength === 'number' && body.strength < 1.0) {
      store.resetStrength(memory.id, body.strength);
    }
    events.emit('memory:created', memory);
    return c.json({ id: memory.id, strength: body.strength ?? 1.0 }, 201);
  });

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
      pid: process.pid,
      uptime: process.uptime(),
    });
  });

  // --- Edge endpoints ---

  app.post('/api/memories/:id/edges', async (c) => {
    const sourceId = c.req.param('id');
    const body = await c.req.json();
    try {
      const edge = store.createEdge({
        sourceId,
        targetId: body.targetId,
        relationType: body.relationType,
        weight: body.weight,
        metadata: body.metadata,
      });
      events.emit('edge:created', edge);
      return c.json(edge, 201);
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
  });

  app.get('/api/memories/:id/edges', (c) => {
    return c.json(store.getEdges(c.req.param('id')));
  });

  app.delete('/api/memories/edges/:edgeId', (c) => {
    const edgeId = c.req.param('edgeId');
    const deleted = store.deleteEdge(edgeId);
    if (deleted) events.emit('edge:deleted', edgeId);
    return deleted ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404);
  });

  // --- Graph traversal ---

  app.get('/api/memories/:id/graph', (c) => {
    const hops = parseInt(c.req.query('hops') ?? '2', 10);
    const subgraph = store.getSubgraph(c.req.param('id'), hops);
    return c.json({ nodes: subgraph.nodes.map(sanitize), edges: subgraph.edges });
  });

  app.get('/api/memories/:id/history', (c) => {
    return c.json(store.getSupersessionChain(c.req.param('id')).map(sanitize));
  });

  // --- Artifact endpoints ---

  app.post('/api/memories/:id/promote', (c) => {
    const promoted = store.promote(c.req.param('id'));
    if (!promoted) return c.json({ error: 'not found' }, 404);
    events.emit('memory:promoted', promoted);
    return c.json(sanitize(promoted));
  });

  app.get('/api/artifacts', (c) => {
    return c.json(store.getArtifactMemories().map(sanitize));
  });

  // --- Guardian ---

  app.get('/api/guardian/temperature', (c) => {
    const totalMemories = store.count();
    const weights = store.getAllEdgeWeights();
    const maxWeight = weights.length > 0 ? Math.max(...weights) : 0;
    const meanWeight = weights.length > 0 ? weights.reduce((a, b) => a + b, 0) / weights.length : 1;
    const hebbianImbalance = meanWeight > 0 ? maxWeight / meanWeight : 0;
    const signals: GuardianSignals = {
      revisitWithoutAction: 0,
      timeSinceLastArtifactExit: Date.now() - (store.lastShippedAt() ?? Date.now()),
      contradictionDensity: totalMemories > 0 ? store.contradictionCount() / totalMemories : 0,
      orphanRatio: totalMemories > 0 ? store.orphanCount() / totalMemories : 0,
      decayVelocity: store.recentDecayCount(24 * 60 * 60 * 1000),
      recursionDepth: 0,
      hebbianImbalance,
    };
    const temp = guardian.compute(signals);
    return c.json(temp);
  });

  // --- Consolidation endpoints ---

  app.get('/api/consolidation/proposals', (c) => {
    const status = c.req.query('status') as 'pending' | 'approved' | 'rejected' | undefined;
    const proposals = store.listProposals(status);
    return c.json(proposals);
  });

  app.get('/api/consolidation/proposals/:id', (c) => {
    const proposal = store.getProposal(c.req.param('id'));
    if (!proposal) return c.json({ error: 'Not found' }, 404);
    return c.json(proposal);
  });

  app.post('/api/consolidation/scan', async (c) => {
    if (!generator) return c.json({ error: 'Generator not configured' }, 503);
    const body = await c.req.json<{ propose?: boolean }>().catch(() => ({ propose: undefined }));
    const engine = new ConsolidationEngine(store, generator);
    const candidates = engine.findCandidateClusters();
    if (!body.propose) {
      return c.json({ candidates, count: candidates.length });
    }
    const proposals = [];
    for (const cluster of candidates) {
      const proposal = await engine.propose(cluster);
      if (proposal) {
        proposals.push(proposal);
        events.emit('consolidation:proposed', proposal);
      }
    }
    return c.json({ candidates: candidates.length, proposals, proposalCount: proposals.length });
  });

  app.post('/api/consolidation/proposals/:id/approve', (c) => {
    if (!generator) return c.json({ error: 'Generator not configured' }, 503);
    const engine = new ConsolidationEngine(store, generator);
    const result = engine.approve(c.req.param('id'));
    if (!result) return c.json({ error: 'Proposal not found or not pending' }, 404);
    events.emit('consolidation:complete', result);
    return c.json(result);
  });

  app.post('/api/consolidation/proposals/:id/reject', (c) => {
    if (!generator) return c.json({ error: 'Generator not configured' }, 503);
    const engine = new ConsolidationEngine(store, generator);
    const proposal = engine.reject(c.req.param('id'));
    if (!proposal) return c.json({ error: 'Proposal not found or not pending' }, 404);
    events.emit('consolidation:rejected', proposal);
    return c.json(proposal);
  });

  // --- Catalog endpoint (triggers background enrichment) ---

  app.post('/api/catalog/start', async (c) => {
    const { catalogAll, hasMemorandum } = await import('./catalog.js');

    const all = store.getRecent(5000);
    const uncataloged = all.filter(m => !hasMemorandum(m.content)).length;

    if (uncataloged === 0) {
      return c.json({ status: 'complete', message: 'All memories already cataloged' });
    }

    catalogAll(store, (done, total, memoryId) => {
      const mem = store.get(memoryId);
      if (mem) events.emit('memory:updated', mem);
    }).then(result => {
      process.stderr.write(`Catalog complete: ${result.cataloged} cataloged, ${result.failed} failed\n`);
    });

    return c.json({ status: 'started', uncataloged });
  });

  app.get('/api/catalog/status', async (c) => {
    const { hasMemorandum } = await import('./catalog.js');
    const all = store.getRecent(5000);
    const total = all.length;
    const cataloged = all.filter(m => hasMemorandum(m.content)).length;
    return c.json({ total, cataloged, remaining: total - cataloged });
  });

  // --- Full graph for Cockpit ---

  app.get('/api/graph/full', (c) => {
    const limit = parseInt(c.req.query('limit') ?? '500', 10);
    const memories = store.getRecent(limit);
    const allEdges: MemoryEdge[] = [];
    const edgeIds = new Set<string>();
    for (const mem of memories) {
      for (const edge of store.getEdges(mem.id)) {
        if (!edgeIds.has(edge.id)) {
          edgeIds.add(edge.id);
          allEdges.push(edge);
        }
      }
    }
    return c.json({ nodes: memories.map(sanitize), edges: allEdges, total: store.count() });
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

      on('edge:created', (edge) => {
        stream.writeSSE({
          event: 'edge:created',
          data: JSON.stringify(edge),
        });
      });

      on('edge:deleted', (edgeId) => {
        stream.writeSSE({
          event: 'edge:deleted',
          data: JSON.stringify({ edgeId }),
        });
      });

      on('memory:promoted', (memory) => {
        stream.writeSSE({
          event: 'memory:promoted',
          data: JSON.stringify(sanitize(memory)),
        });
      });

      on('guardian:update', (temp) => {
        stream.writeSSE({
          event: 'guardian:update',
          data: JSON.stringify(temp),
        });
      });

      on('consolidation:proposed', (proposal) => {
        stream.writeSSE({
          event: 'consolidation:proposed',
          data: JSON.stringify(proposal),
        });
      });

      on('consolidation:complete', (result) => {
        stream.writeSSE({
          event: 'consolidation:complete',
          data: JSON.stringify(result),
        });
      });

      on('consolidation:rejected', (proposal) => {
        stream.writeSSE({
          event: 'consolidation:rejected',
          data: JSON.stringify(proposal),
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

  // --- Cockpit / Viewer (serve static HTML) ---

  app.get('/', async (c) => {
    const { readFileSync, existsSync } = await import('fs');
    const { resolve, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = dirname(fileURLToPath(import.meta.url));

    const cockpitOverride = process.env.FORGEFRAME_COCKPIT_PATH;
    const viewerOverride = process.env.FORGEFRAME_VIEWER_PATH;

    const candidates = cockpitOverride
      ? [cockpitOverride]
      : [
          resolve(__dirname, '../../cockpit/web/index.html'),
          resolve(__dirname, '../../../cockpit/web/index.html'),
          ...(viewerOverride
            ? [viewerOverride]
            : [
                resolve(__dirname, '../../swarm/viewer/index.html'),
                resolve(__dirname, '../../../swarm/viewer/index.html'),
              ]),
        ];

    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self'",
      "img-src 'self' data:",
    ].join('; ');

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        const html = readFileSync(candidate, 'utf-8');
        c.header('Content-Security-Policy', csp);
        return c.html(html);
      }
    }

    return c.text('Cockpit not found. Set FORGEFRAME_COCKPIT_PATH or build the cockpit package.', 404);
  });

  const server = serve({ fetch: app.fetch, port, hostname: hostname ?? '127.0.0.1' });

  // Log to stderr so it doesn't interfere with MCP stdio
  process.stderr.write(`ForgeFrame viewer: http://${hostname ?? '127.0.0.1'}:${port}\n`);

  return server;
}

/** Strip embeddings from API responses (large binary data) */
function sanitize(memory: any) {
  const { embedding, ...rest } = memory;
  return rest;
}
