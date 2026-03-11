/**
 * @forgeframe/server — MCP Tool Handlers
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryStore, MemoryRetriever, Session, Embedder } from '@forgeframe/memory';
import type { ProvenanceLogger } from './provenance.js';
import type { ServerEvents } from './events.js';
import type { ServerConfig } from './config.js';

const startTime = Date.now();

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

  server.tool(
    'memory_save',
    'Save a memory for later retrieval',
    {
      content: z.string().describe('The content to remember'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
      metadata: z.record(z.unknown()).optional().describe('Arbitrary metadata'),
    },
    async ({ content, tags, metadata }) => {
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

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(memory) }],
      };
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

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(formatted) }],
      };
    },
  );

  server.tool(
    'memory_list_recent',
    'List most recent memories',
    {
      limit: z.number().optional().describe('Number of memories to return (default 20)'),
    },
    async ({ limit }) => {
      const memories = store.getRecent(limit ?? 20);

      const formatted = memories.map((m) => ({
        id: m.id,
        content: m.content,
        strength: m.strength,
        tags: m.tags,
        createdAt: m.createdAt,
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(formatted) }],
      };
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
      let embedding: number[] | undefined;
      if (content && embedder) {
        const vec = await embedder.embed(content);
        if (vec) embedding = vec;
      }

      const updated = store.update(id, { content, embedding, tags, metadata });

      if (!updated) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Memory not found' }) }],
        };
      }

      provenance.log({
        timestamp: Date.now(),
        action: 'memory_update',
        memoryId: id,
        sessionId: sessionRef.current.id,
      });

      events.emit('memory:updated', updated);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(updated) }],
      };
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
      const memories = store.listByTag(tag, limit ?? 50);

      const formatted = memories.map((m) => ({
        id: m.id,
        content: m.content,
        strength: m.strength,
        tags: m.tags,
        createdAt: m.createdAt,
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(formatted) }],
      };
    },
  );

  server.tool(
    'memory_delete',
    'Delete a memory by ID',
    {
      id: z.string().describe('Memory ID to delete'),
    },
    async ({ id }) => {
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

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ deleted: existed }) }],
      };
    },
  );

  server.tool(
    'memory_status',
    'Get memory server status',
    {},
    async () => {
      const status = {
        memoryCount: store.count(),
        sessionId: sessionRef.current.id,
        dbPath: config.dbPath,
        uptimeMs: Date.now() - startTime,
        serverName: config.serverName,
        serverVersion: config.serverVersion,
        currentSession: sessionRef.current,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(status) }],
      };
    },
  );

  server.tool(
    'session_start',
    'Start a new session, ending the current one if active',
    {
      metadata: z.record(z.unknown()).optional().describe('Arbitrary session metadata'),
    },
    async ({ metadata }) => {
      const active = store.getActiveSession();
      if (active) {
        store.endSession(active.id);
        events.emit('session:ended', active.id);
        provenance.log({
          timestamp: Date.now(),
          action: 'session_end',
          sessionId: active.id,
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

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(newSession) }],
      };
    },
  );

  server.tool(
    'session_end',
    'End the current active session',
    {},
    async () => {
      const active = store.getActiveSession();
      if (!active) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No active session' }) }],
        };
      }

      store.endSession(active.id);

      provenance.log({
        timestamp: Date.now(),
        action: 'session_end',
        sessionId: active.id,
      });

      events.emit('session:ended', active.id);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ended: active.id }) }],
      };
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
      const sessions = store.listSessions({ status: status ?? 'all', limit: limit ?? 50 });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(sessions) }],
      };
    },
  );

  server.tool(
    'session_current',
    'Get the current active session',
    {},
    async () => {
      const active = store.getActiveSession();
      if (!active) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No active session' }) }],
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(active) }],
      };
    },
  );

  server.tool(
    'memory_reindex',
    'Backfill embeddings for memories that have none',
    {
      limit: z.number().optional().describe('Max memories to reindex (default 100)'),
    },
    async ({ limit }) => {
      if (!embedder) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No embedder configured' }) }],
        };
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

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ reindexed: indexed, total: batch.length }) }],
      };
    },
  );
}
