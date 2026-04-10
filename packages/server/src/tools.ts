/**
 * @forgeframe/server — MCP Tool Handlers
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryStore, MemoryRetriever, Session, Embedder } from '@forgeframe/memory';
import { GuardianComputer } from '@forgeframe/memory';
import type { ProvenanceLogger } from './provenance.js';
import type { ServerEvents } from './events.js';
import type { ServerConfig } from './config.js';

const startTime = Date.now();

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function toolResult(data: unknown): ToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

function toolError(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function registerTools(
  server: McpServer,
  store: MemoryStore,
  retriever: MemoryRetriever,
  embedder: Embedder | null,
  provenance: ProvenanceLogger,
  events: ServerEvents,
  config: ServerConfig,
  session: Session,
): void {
  const sessionRef = { current: session };
  const guardian = new GuardianComputer();

  server.tool(
    'memory_save',
    'Save a memory for later retrieval',
    {
      content: z.string().describe('The content to remember'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
      metadata: z.record(z.unknown()).optional().describe('Arbitrary metadata'),
    },
    async ({ content, tags, metadata }) => {
      try {
        let embedding: number[] | undefined;
        if (embedder) {
          const vec = await embedder.embed(content);
          if (vec) embedding = vec;
        }

        const memory = store.create({
          content,
          embedding,
          tags: tags ?? [],
          metadata: metadata ?? {},
          sessionId: sessionRef.current.id,
        });

        provenance.log({
          timestamp: Date.now(),
          action: 'memory_save',
          memoryId: memory.id,
          sessionId: sessionRef.current.id,
        });

        events.emit('memory:created', memory);

        return toolResult(memory);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'memory_search',
    'Search memories by query',
    {
      query: z.string().describe('Search query'),
      limit: z.number().optional().describe('Max results (default 10)'),
      tags: z.array(z.string()).optional().describe('Filter by tags'),
      minStrength: z.number().optional().describe('Minimum memory strength (0-1)'),
    },
    async ({ query, limit, tags, minStrength }) => {
      try {
        const results = await retriever.semanticQuery({
          text: query,
          limit: limit ?? 10,
          tags,
          minStrength,
        });

        provenance.log({
          timestamp: Date.now(),
          action: 'memory_search',
          query,
          sessionId: sessionRef.current.id,
          metadata: { resultCount: results.length },
        });

        const formatted = results.map((r) => ({
          id: r.memory.id,
          content: r.memory.content,
          score: r.score,
          strength: r.memory.strength,
          tags: r.memory.tags,
          createdAt: r.memory.createdAt,
        }));

        return toolResult(formatted);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'memory_list_recent',
    'List most recent memories',
    {
      limit: z.number().optional().describe('Number of memories to return (default 20)'),
    },
    async ({ limit }) => {
      try {
        const memories = store.getRecent(limit ?? 20);

        const formatted = memories.map((m) => ({
          id: m.id,
          content: m.content,
          strength: m.strength,
          tags: m.tags,
          createdAt: m.createdAt,
        }));

        return toolResult(formatted);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'memory_update',
    'Update an existing memory by ID',
    {
      id: z.string().describe('Memory ID to update'),
      content: z.string().optional().describe('New content'),
      tags: z.array(z.string()).optional().describe('New tags (replaces existing)'),
      metadata: z.record(z.unknown()).optional().describe('New metadata (replaces existing)'),
    },
    async ({ id, content, tags, metadata }) => {
      try {
        let embedding: number[] | undefined;
        if (content && embedder) {
          const vec = await embedder.embed(content);
          if (vec) embedding = vec;
        }

        const updated = store.update(id, { content, embedding, tags, metadata });

        if (!updated) {
          return toolResult({ error: 'Memory not found' });
        }

        provenance.log({
          timestamp: Date.now(),
          action: 'memory_update',
          memoryId: id,
          sessionId: sessionRef.current.id,
        });

        events.emit('memory:updated', updated);

        return toolResult(updated);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'memory_list_by_tag',
    'List memories filtered by tag',
    {
      tag: z.string().describe('Tag to filter by'),
      limit: z.number().optional().describe('Max results (default 50)'),
    },
    async ({ tag, limit }) => {
      try {
        const memories = store.listByTag(tag, limit ?? 50);

        const formatted = memories.map((m) => ({
          id: m.id,
          content: m.content,
          strength: m.strength,
          tags: m.tags,
          createdAt: m.createdAt,
        }));

        return toolResult(formatted);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'memory_delete',
    'Delete a memory by ID',
    {
      id: z.string().describe('Memory ID to delete'),
    },
    async ({ id }) => {
      try {
        const existed = store.delete(id);

        if (existed) {
          provenance.log({
            timestamp: Date.now(),
            action: 'memory_delete',
            memoryId: id,
            sessionId: sessionRef.current.id,
          });

          events.emit('memory:deleted', id);
        }

        return toolResult({ deleted: existed });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'memory_status',
    'Get memory server status',
    {},
    async () => {
      try {
        const status = {
          memoryCount: store.count(),
          sessionId: sessionRef.current.id,
          dbPath: config.dbPath,
          uptimeMs: Date.now() - startTime,
          serverName: config.serverName,
          serverVersion: config.serverVersion,
          currentSession: sessionRef.current,
        };

        return toolResult(status);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'session_start',
    'Start a new session, ending the current one if active',
    {
      metadata: z.record(z.unknown()).optional().describe('Arbitrary session metadata'),
    },
    async ({ metadata }) => {
      try {
        // End only THIS process's session, not all active sessions.
        // Multiple agents may have concurrent active sessions.
        if (sessionRef.current && !store.isSessionEnded(sessionRef.current.id)) {
          store.endSession(sessionRef.current.id);
          events.emit('session:ended', sessionRef.current.id);
          provenance.log({
            timestamp: Date.now(),
            action: 'session_end',
            sessionId: sessionRef.current.id,
          });
        }

        const newSession = store.startSession({ metadata: metadata ?? {} });
        sessionRef.current = newSession;

        provenance.log({
          timestamp: Date.now(),
          action: 'session_start',
          sessionId: newSession.id,
        });

        events.emit('session:started', newSession.id);

        return toolResult(newSession);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'session_end',
    'End the current active session',
    {},
    async () => {
      try {
        // End THIS process's session, not an arbitrary active one.
        const mySession = sessionRef.current;
        if (store.isSessionEnded(mySession.id)) {
          return toolResult({ error: 'Session already ended' });
        }

        store.endSession(mySession.id);

        provenance.log({
          timestamp: Date.now(),
          action: 'session_end',
          sessionId: mySession.id,
        });

        events.emit('session:ended', mySession.id);

        return toolResult({ ended: mySession.id });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'session_list',
    'List sessions with optional filtering',
    {
      status: z.enum(['active', 'ended', 'all']).optional().describe('Filter by session status (default: all)'),
      limit: z.number().optional().describe('Max results (default 50)'),
    },
    async ({ status, limit }) => {
      try {
        const sessions = store.listSessions({ status: status ?? 'all', limit: limit ?? 50 });

        return toolResult(sessions);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'session_current',
    'Get the current active session',
    {},
    async () => {
      try {
        const active = store.getActiveSession();
        if (!active) {
          return toolResult({ error: 'No active session' });
        }

        return toolResult(active);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'memory_reindex',
    'Backfill embeddings for memories that have none',
    {
      limit: z.number().optional().describe('Max memories to reindex (default 100)'),
    },
    async ({ limit }) => {
      try {
        if (!embedder) {
          return toolResult({ error: 'No embedder configured' });
        }

        const batch = store.getWithoutEmbedding(limit ?? 100);
        let indexed = 0;

        for (const mem of batch) {
          const vec = await embedder.embed(mem.content);
          if (vec) {
            store.update(mem.id, { embedding: vec });
            indexed++;
          }
        }

        return toolResult({ reindexed: indexed, total: batch.length });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'memory_link',
    'Create a typed edge between two memories',
    {
      sourceId: z.string().describe('Source memory ID'),
      targetId: z.string().describe('Target memory ID'),
      relationType: z.enum(['led-to', 'contradicts', 'supersedes', 'implements', 'similar', 'derived-from', 'related']).describe('Relationship type'),
      weight: z.number().min(0).max(1).optional().describe('Edge weight (0-1)'),
    },
    async ({ sourceId, targetId, relationType, weight }) => {
      try {
        const edge = store.createEdge({ sourceId, targetId, relationType, weight });
        events.emit('edge:created', edge);
        return { content: [{ type: 'text' as const, text: JSON.stringify(edge) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    },
  );

  server.tool(
    'memory_graph',
    'Retrieve N-hop subgraph around a memory',
    {
      memoryId: z.string().describe('Center node memory ID'),
      hops: z.number().int().min(1).max(5).optional().describe('Number of hops (default 2)'),
    },
    async ({ memoryId, hops }) => {
      const subgraph = store.getSubgraph(memoryId, hops ?? 2);
      const result = {
        nodes: subgraph.nodes.map((m: any) => ({
          id: m.id,
          content: m.content.slice(0, 200),
          tags: m.tags,
          strength: m.strength,
          memoryType: m.memoryType,
        })),
        edges: subgraph.edges,
        nodeCount: subgraph.nodes.length,
        edgeCount: subgraph.edges.length,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'memory_promote',
    'Promote a memory to artifact status (draft state)',
    {
      memoryId: z.string().describe('Memory ID to promote'),
    },
    async ({ memoryId }) => {
      const promoted = store.promote(memoryId);
      if (!promoted) {
        return { content: [{ type: 'text' as const, text: 'Memory not found' }], isError: true };
      }
      events.emit('memory:promoted', promoted);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ id: promoted.id, memoryType: promoted.memoryType, readiness: promoted.readiness }) }] };
    },
  );

  server.tool(
    'guardian_temp',
    'Query current Guardian temperature and cognitive signals',
    {},
    async () => {
      const totalMemories = store.count();
      const signals = {
        revisitWithoutAction: 0,
        timeSinceLastArtifactExit: Date.now() - (store.lastShippedAt() ?? Date.now()),
        contradictionDensity: totalMemories > 0 ? store.contradictionCount() / totalMemories : 0,
        orphanRatio: totalMemories > 0 ? store.orphanCount() / totalMemories : 0,
        decayVelocity: store.recentDecayCount(24 * 60 * 60 * 1000),
        recursionDepth: 0,
      };
      const temp = guardian.compute(signals);
      return { content: [{ type: 'text' as const, text: JSON.stringify(temp) }] };
    },
  );
}
