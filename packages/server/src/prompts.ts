/**
 * @forgeframe/server — MCP Prompt Handler
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerPrompts(server: McpServer): void {

  server.prompt(
    'memory_context',
    'Load memory context for the current conversation',
    { topic: z.string().optional().describe('Optional topic to pre-search') },
    ({ topic }) => {
      const lines = [
        'You have access to a persistent memory system via the following tools:',
        '',
        '- memory_save: Store important information for future sessions',
        '- memory_search: Find relevant memories by query',
        '- memory_list_recent: See what was recently remembered',
        '- memory_delete: Remove a memory by ID',
        '- memory_status: Check memory system status',
        '',
        'Use memory_save proactively when the user shares preferences, decisions, or context worth preserving.',
        'Use memory_search at the start of tasks to check for relevant prior context.',
      ];

      if (topic) {
        lines.push(
          '',
          `The user wants to discuss: ${topic}`,
          `Search memories for "${topic}" to load relevant context before responding.`,
        );
      }

      return {
        messages: [{
          role: 'user' as const,
          content: { type: 'text' as const, text: lines.join('\n') },
        }],
      };
    },
  );
}
