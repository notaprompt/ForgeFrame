/**
 * @forgeframe/server — MCP Tool Handlers
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryStore, MemoryRetriever } from '@forgeframe/memory';
import type { ProvenanceLogger } from './provenance.js';
import type { ServerEvents } from './events.js';
import type { ServerConfig } from './config.js';

const startTime = Date.now();

export function registerTools(
  server: McpServer,
  store: MemoryStore,
  retriever: MemoryRetriever,
  provenance: ProvenanceLogger,
  events: ServerEvents,
  config: ServerConfig,
): void {

  server.tool(
    'memory_save',
    'Save a memory for later retrieval',
    {
      content: z.string().describe('The content to remember'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
      metadata: z.record(z.unknown()).optional().describe('Arbitrary metadata'),
    },
    async ({ content, tags, metadata }) => {
      const memory = store.create({
        content,
        tags: tags ?? [],
        metadata: metadata ?? {},
        sessionId: config.sessionId,
      });

      provenance.log({
        timestamp: Date.now(),
        action: 'memory_save',
        memoryId: memory.id,
        sessionId: config.sessionId,
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
      const results = retriever.query({
        text: query,
        limit: limit ?? 10,
        tags,
        minStrength,
      });

      provenance.log({
        timestamp: Date.now(),
        action: 'memory_search',
        query,
        sessionId: config.sessionId,
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
          sessionId: config.sessionId,
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
        sessionId: config.sessionId,
        dbPath: config.dbPath,
        uptimeMs: Date.now() - startTime,
        serverName: config.serverName,
        serverVersion: config.serverVersion,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(status) }],
      };
    },
  );
}
