/**
 * @forgeframe/server — MCP Resource Handlers
 */

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryStore } from '@forgeframe/memory';
import type { ServerConfig } from './config.js';

export function registerResources(
  server: McpServer,
  store: MemoryStore,
  _config: ServerConfig,
): void {

  server.resource(
    'recent-memories',
    'memory://recent',
    { mimeType: 'application/json', description: 'The 20 most recent memories' },
    async (uri) => {
      const memories = store.getRecent(20);
      const formatted = memories.map((m) => ({
        id: m.id,
        content: m.content,
        strength: m.strength,
        tags: m.tags,
        createdAt: m.createdAt,
      }));

      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(formatted) }],
      };
    },
  );

  server.resource(
    'search-memories',
    new ResourceTemplate('memory://search/{query}', { list: undefined }),
    { mimeType: 'application/json', description: 'Search memories by query' },
    async (uri, { query }) => {
      const q = Array.isArray(query) ? query[0] : query;
      const memories = store.search(String(q), 20);
      const formatted = memories.map((m) => ({
        id: m.id,
        content: m.content,
        strength: m.strength,
        tags: m.tags,
        createdAt: m.createdAt,
      }));

      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(formatted) }],
      };
    },
  );
}
