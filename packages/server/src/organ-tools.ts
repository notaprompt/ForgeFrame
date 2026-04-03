/**
 * @forgeframe/server — Organ MCP Tool Handlers
 *
 * Registers organ_list, organ_status, and organ_resolve tools
 * on the MCP server, backed by an OrganRegistry.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OrganRegistry } from '@forgeframe/core';

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

export function registerOrganTools(
  server: McpServer,
  registry: OrganRegistry,
): void {
  server.tool(
    'organ_list',
    'List all registered organs with their status',
    {},
    async () => {
      try {
        const organs = registry.list();
        const formatted = organs.map((o) => ({
          id: o.manifest.id,
          name: o.manifest.name,
          version: o.manifest.version,
          categories: o.manifest.categories,
          state: o.state,
          executionCount: o.executionCount,
          averageLatencyMs: o.averageLatencyMs,
          errors: o.errors,
          activeSince: o.activeSince,
          lastExecuted: o.lastExecuted,
        }));
        return toolResult(formatted);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'organ_status',
    'Get detailed status of a specific organ',
    {
      organ_id: z.string().describe('Unique organ identifier'),
    },
    async ({ organ_id }) => {
      try {
        const status = registry.status(organ_id);
        if (!status) {
          return toolResult({ error: `Organ not found: ${organ_id}` });
        }
        return toolResult(status);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'organ_resolve',
    'Resolve a capability query to find matching organs',
    {
      action: z.string().describe('Capability action to resolve (e.g. "store", "scrub", "route")'),
      input_modality: z.string().optional().describe('Required input modality'),
      data_classification: z.string().optional().describe('Data classification constraint'),
      prefer_speed: z.boolean().optional().describe('Prefer faster organs'),
      prefer_quality: z.boolean().optional().describe('Prefer higher quality organs'),
    },
    async ({ action, input_modality, data_classification, prefer_speed, prefer_quality }) => {
      try {
        const matches = registry.resolve({
          action,
          inputModality: input_modality as any,
          dataClassification: data_classification as any,
          preferSpeed: prefer_speed,
          preferQuality: prefer_quality,
        });
        const formatted = matches.map((m) => ({
          organId: m.organ.id,
          organName: m.organ.name,
          capability: m.capability.action,
          quality: m.capability.quality,
          speed: m.capability.speed,
          score: m.score,
          state: m.state,
        }));
        return toolResult(formatted);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
