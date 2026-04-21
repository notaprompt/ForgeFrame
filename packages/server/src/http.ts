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
import { GuardianComputer, ConsolidationEngine, ContradictionEngine, HebbianEngine, NremPhase, computeSleepPressure, selectSeeds, applySeedGrade, findHindsightCandidates, applyHindsightResponse, findTensionCandidates, RemPhase, computeClusters } from '@forgeframe/memory';
import type { GuardianSignals, MemoryEdge, MemoryStore, Generator, SeedGrade, HindsightResponse } from '@forgeframe/memory';
import type { ServerEvents } from './events.js';
import { bearerAuth } from './auth.js';
import { loadToken } from './token.js';
import { sendPush } from './push.js';

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
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    maxAge: 86400,
  }));

  const token = loadToken();
  app.use('/api/*', bearerAuth(token));

  // --- Phase 1: ntfy push bridge for guardian:alert (once per server lifecycle) ---
  events.on('guardian:alert', async (evt) => {
    if (evt.severity === 'info') return;
    try {
      await sendPush({
        title: `Vision · ${evt.severity.toUpperCase()}`,
        body: evt.summary,
        priority: evt.severity === 'error' ? 'urgent' : 'high',
        tags: ['warning', evt.severity],
      });
    } catch (err) {
      console.error('[push] guardian:alert push failed:', err);
    }
  });

  // --- Phase 1: dev-only event emit endpoint for smoke-testing (gated by env) ---
  if (process.env.FORGEFRAME_DEV_EMIT === '1') {
    app.post('/api/events/emit', async (c) => {
      const body = await c.req.json();
      const { kind, payload } = body;
      (events.emit as any)(kind, payload);
      return c.json({ ok: true });
    });
  }

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
    const signals = buildGuardianSignals(store);
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

  // --- Contradiction endpoints ---

  app.get('/api/contradictions/proposals', (c) => {
    const status = c.req.query('status') as 'pending' | 'resolved' | undefined;
    const proposals = store.listContradictionProposals(status);
    return c.json(proposals);
  });

  app.get('/api/contradictions/proposals/:id', (c) => {
    const proposal = store.getContradictionProposal(c.req.param('id'));
    if (!proposal) return c.json({ error: 'Not found' }, 404);
    return c.json(proposal);
  });

  app.post('/api/contradictions/scan', async (c) => {
    if (!generator) return c.json({ error: 'Generator not configured' }, 503);
    const engine = new ContradictionEngine(store, generator);
    const proposals = await engine.scan();
    events.emit('contradiction:scanned', proposals);
    return c.json({ proposals, count: proposals.length });
  });

  app.post('/api/contradictions/proposals/:id/resolve', async (c) => {
    if (!generator) return c.json({ error: 'Generator not configured' }, 503);
    const body = await c.req.json<{ action: string }>().catch(() => ({ action: '' }));
    const validActions = ['supersede-a-with-b', 'supersede-b-with-a', 'merge', 'keep-both'] as const;
    type Action = typeof validActions[number];
    if (!validActions.includes(body.action as Action)) {
      return c.json({ error: 'Invalid action. Must be one of: supersede-a-with-b, supersede-b-with-a, merge, keep-both' }, 400);
    }
    const engine = new ContradictionEngine(store, generator);
    const result = engine.resolve(c.req.param('id'), body.action as Action);
    if (!result) return c.json({ error: 'Proposal not found, not pending, or is a constitutional tension' }, 404);
    events.emit('contradiction:resolved', result);
    return c.json(result);
  });

  // --- Dream control endpoints ---

  app.get('/api/dream/pressure', (c) => {
    return c.json(computeSleepPressure(store));
  });

  app.post('/api/dream/trigger', async (c) => {
    const pressure = computeSleepPressure(store);
    const guardianTemp = guardian.compute(buildGuardianSignals(store));
    if (guardianTemp.state === 'trapped') {
      return c.json({ error: 'Guardian is trapped — dreaming suppressed' }, 409);
    }

    if (pressure.recommendation === 'nrem' || pressure.recommendation === 'full') {
      const nrem = new NremPhase(store, new HebbianEngine(store), new ConsolidationEngine(store, generator!), generator ?? null);
      const nremResult = await nrem.run();

      if (pressure.recommendation === 'full') {
        const rem = new RemPhase(store, generator ?? null);
        const remResult = await rem.run(pressure.score);
        return c.json({ phase: 'full', nrem: nremResult, rem: remResult });
      }

      return c.json({ phase: 'nrem', nrem: nremResult });
    }

    return c.json({ phase: 'sleep', message: 'Pressure below threshold', pressure });
  });

  let dreamSettings = { suppressDreaming: false, nremOnly: false, nremThreshold: 20, remThreshold: 50 };

  app.get('/api/dream/settings', (c) => {
    return c.json(dreamSettings);
  });

  app.put('/api/dream/settings', async (c) => {
    const body = await c.req.json();
    if (body.suppressDreaming !== undefined) dreamSettings.suppressDreaming = !!body.suppressDreaming;
    if (body.nremOnly !== undefined) dreamSettings.nremOnly = !!body.nremOnly;
    if (typeof body.nremThreshold === 'number') dreamSettings.nremThreshold = body.nremThreshold;
    if (typeof body.remThreshold === 'number') dreamSettings.remThreshold = body.remThreshold;
    return c.json(dreamSettings);
  });

  app.get('/api/dream/journal/latest', (c) => {
    const journals = store.listByTag('dream-journal', 1);
    if (journals.length === 0) return c.json(null);
    return c.json(sanitize(journals[0]));
  });

  app.get('/api/dream/seeds/pending', (c) => {
    const seeds = selectSeeds(store, 5);
    return c.json(seeds);
  });

  app.post('/api/dream/seeds/:id/grade', async (c) => {
    const body = await c.req.json<{ grade: string; seedMemoryIds: string[] }>();
    const validGrades = ['fire', 'shrug', 'miss'];
    if (!validGrades.includes(body.grade)) {
      return c.json({ error: 'Invalid grade. Must be: fire, shrug, miss' }, 400);
    }
    if (!body.seedMemoryIds || body.seedMemoryIds.length < 2) {
      return c.json({ error: 'seedMemoryIds must contain at least 2 memory IDs' }, 400);
    }
    const memories = body.seedMemoryIds.map(id => store.get(id)).filter(Boolean);
    if (memories.length < 2) {
      return c.json({ error: 'One or more memories not found' }, 404);
    }
    const seed = { id: c.req.param('id'), memories: memories as any[], clusterIds: [], hasCharged: false, createdAt: Date.now() };
    const result = applySeedGrade(store, seed, body.grade as SeedGrade);
    return c.json(result);
  });

  app.get('/api/dream/hindsight/pending', (c) => {
    const candidates = findHindsightCandidates(store, 3);
    return c.json(candidates.map(c => ({
      memoryId: c.memory.id,
      content: c.memory.content,
      tags: c.memory.tags,
      avgEdgeWeight: c.avgEdgeWeight,
      edgeCount: c.edgeCount,
      scrutinyScore: c.scrutinyScore,
      ageInDays: Math.round(c.ageInDays),
      valence: c.memory.valence,
    })));
  });

  app.post('/api/dream/hindsight/:id/respond', async (c) => {
    const memoryId = c.req.param('id');
    const body = await c.req.json<{ response: string; revisedContent?: string }>();
    const validResponses = ['keep', 'weaken', 'revise'];
    if (!validResponses.includes(body.response)) {
      return c.json({ error: 'Invalid response. Must be: keep, weaken, revise' }, 400);
    }
    const candidates = findHindsightCandidates(store, 10);
    const candidate = candidates.find(c => c.memory.id === memoryId);
    if (!candidate) {
      return c.json({ error: 'Memory is not a hindsight candidate' }, 404);
    }
    const result = applyHindsightResponse(store, candidate, body.response as HindsightResponse, body.revisedContent);
    return c.json(result);
  });

  app.get('/api/dream/tensions', (c) => {
    const tensions = findTensionCandidates(store, 10);
    return c.json(tensions.map(t => ({
      memoryAId: t.memoryA.id,
      memoryAContent: t.memoryA.content,
      memoryAAvgWeight: t.avgWeightA,
      memoryBId: t.memoryB.id,
      memoryBContent: t.memoryB.content,
      memoryBAvgWeight: t.avgWeightB,
      tagOverlap: t.tagOverlap,
      tensionScore: t.tensionScore,
    })));
  });

  // --- Hermes control endpoints ---

  let hermesState = { status: 'idle' as 'idle' | 'running' | 'paused', lastCycleAt: null as number | null };

  app.get('/api/hermes/status', (c) => {
    return c.json(hermesState);
  });

  app.post('/api/hermes/pause', (c) => {
    hermesState.status = 'paused';
    return c.json(hermesState);
  });

  app.post('/api/hermes/resume', (c) => {
    hermesState.status = 'idle';
    return c.json(hermesState);
  });

  app.post('/api/hermes/cycle', (c) => {
    // Stub: Hermes cycle trigger. Actual Hermes integration runs externally.
    if (hermesState.status === 'paused') {
      return c.json({ error: 'Hermes is paused' }, 409);
    }
    hermesState.lastCycleAt = Date.now();
    return c.json({ triggered: true, ...hermesState });
  });

  // --- Guardian control endpoints ---

  app.get('/api/guardian/signals', (c) => {
    const signals = buildGuardianSignals(store);
    const temp = guardian.compute(signals);
    return c.json({ temperature: temp, signals });
  });

  let signalOverrides: Partial<GuardianSignals> = {};

  app.put('/api/guardian/override', async (c) => {
    const body = await c.req.json<Partial<GuardianSignals>>();
    signalOverrides = { ...signalOverrides, ...body };
    const signals = { ...buildGuardianSignals(store), ...signalOverrides };
    const temp = guardian.compute(signals);
    return c.json({ temperature: temp, signals, overrides: signalOverrides });
  });

  app.delete('/api/guardian/override', (c) => {
    signalOverrides = {};
    return c.json({ cleared: true });
  });

  app.get('/api/guardian/idle', (c) => {
    const pressure = computeSleepPressure(store);
    return c.json({
      pressure,
      memoryCount: store.count(),
      orphanCount: store.orphanCount(),
    });
  });

  // --- Hebbian control endpoints ---

  let hebbianFrozen = false;
  let hebbianRates = { ltp: 0.05, ltd: 0.02 };

  app.get('/api/hebbian/weights', (c) => {
    const weights = store.getAllEdgeWeights();
    if (weights.length === 0) {
      return c.json({ count: 0, min: 0, max: 0, mean: 0, median: 0 });
    }
    weights.sort((a, b) => a - b);
    const sum = weights.reduce((a, b) => a + b, 0);
    return c.json({
      count: weights.length,
      min: weights[0],
      max: weights[weights.length - 1],
      mean: Math.round((sum / weights.length) * 100) / 100,
      median: weights[Math.floor(weights.length / 2)],
      frozen: hebbianFrozen,
    });
  });

  app.put('/api/hebbian/freeze', async (c) => {
    const body = await c.req.json<{ frozen: boolean }>();
    hebbianFrozen = !!body.frozen;
    return c.json({ frozen: hebbianFrozen });
  });

  app.put('/api/hebbian/rates', async (c) => {
    const body = await c.req.json<{ ltp?: number; ltd?: number }>();
    if (typeof body.ltp === 'number') hebbianRates.ltp = body.ltp;
    if (typeof body.ltd === 'number') hebbianRates.ltd = body.ltd;
    return c.json(hebbianRates);
  });

  app.get('/api/hebbian/rates', (c) => {
    return c.json({ ...hebbianRates, frozen: hebbianFrozen });
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

  app.get('/api/graph/clustered', (c) => {
    const result = computeClusters(store);
    return c.json(result);
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

      on('contradiction:scanned', (proposals) => {
        stream.writeSSE({
          event: 'contradiction:scanned',
          data: JSON.stringify(proposals),
        });
      });

      on('contradiction:resolved', (result) => {
        stream.writeSSE({
          event: 'contradiction:resolved',
          data: JSON.stringify(result),
        });
      });

      // --- Phase 1: Vision Feed Tab event mirrors ---

      on('guardian:alert', (evt) => {
        stream.writeSSE({ event: 'guardian:alert', data: JSON.stringify(evt) });
      });

      on('distillery:intake', (evt) => {
        stream.writeSSE({ event: 'distillery:intake', data: JSON.stringify(evt) });
      });

      on('heartbeat', (evt) => {
        stream.writeSSE({ event: 'heartbeat', data: JSON.stringify(evt) });
      });

      for (const k of [
        'daemon:task:merged',
        'daemon:task:dispatched',
        'daemon:review:queued',
        'daemon:trust:denied',
      ] as const) {
        on(k, (evt) => stream.writeSSE({ event: k, data: JSON.stringify(evt) }));
      }

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

  // --- PWA manifest + home-screen icons (Phase 1 Stream B) ---

  // Resolve a cockpit-web asset path using the same candidate-list pattern as
  // the '/' handler above, so overrides and monorepo layouts behave identically.
  async function resolveCockpitAsset(relative: string): Promise<string | null> {
    const { existsSync } = await import('fs');
    const { resolve, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = dirname(fileURLToPath(import.meta.url));

    const cockpitOverride = process.env.FORGEFRAME_COCKPIT_PATH;
    const candidates = cockpitOverride
      ? [resolve(dirname(cockpitOverride), relative)]
      : [
          resolve(__dirname, '../../cockpit/web', relative),
          resolve(__dirname, '../../../cockpit/web', relative),
        ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  app.get('/manifest.webmanifest', async (c) => {
    const { readFile } = await import('fs/promises');
    const p = await resolveCockpitAsset('manifest.webmanifest');
    if (!p) return c.text('not found', 404);
    const buf = await readFile(p);
    c.header('content-type', 'application/manifest+json');
    return c.body(buf);
  });

  // Explicit routes per icon; prevents path traversal by construction.
  const serveIcon = (name: string) => async (c: any) => {
    const { readFile } = await import('fs/promises');
    const p = await resolveCockpitAsset(`icon-${name}.png`);
    if (!p) return c.text('not found', 404);
    const buf = await readFile(p);
    c.header('content-type', 'image/png');
    return c.body(buf);
  };
  app.get('/icon-512.png', serveIcon('512'));
  app.get('/icon-192.png', serveIcon('192'));
  app.get('/icon-apple-180.png', serveIcon('apple-180'));

  const server = serve({ fetch: app.fetch, port, hostname: hostname ?? '127.0.0.1' });

  // Log to stderr so it doesn't interfere with MCP stdio
  process.stderr.write(`ForgeFrame viewer: http://${hostname ?? '127.0.0.1'}:${port}\n`);

  return server;
}

/** Build Guardian signals from current store state. */
function buildGuardianSignals(store: MemoryStore): GuardianSignals {
  const totalMemories = store.count();
  const weights = store.getAllEdgeWeights();
  const maxWeight = weights.length > 0 ? Math.max(...weights) : 0;
  const meanWeight = weights.length > 0 ? weights.reduce((a, b) => a + b, 0) / weights.length : 1;
  const hebbianImbalance = meanWeight > 0 ? maxWeight / meanWeight : 0;
  return {
    revisitWithoutAction: 0,
    timeSinceLastArtifactExit: Date.now() - (store.lastShippedAt() ?? Date.now()),
    contradictionDensity: totalMemories > 0 ? store.contradictionCount() / totalMemories : 0,
    orphanRatio: totalMemories > 0 ? store.orphanCount() / totalMemories : 0,
    decayVelocity: store.recentDecayCount(24 * 60 * 60 * 1000),
    recursionDepth: 0,
    hebbianImbalance,
  };
}

/** Strip embeddings from API responses (large binary data) */
function sanitize(memory: any) {
  const { embedding, ...rest } = memory;
  return rest;
}
