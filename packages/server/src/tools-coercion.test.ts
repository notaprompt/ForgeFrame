import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import type { ZodTypeAny } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MemoryStore, MemoryRetriever, type Embedder, type Generator } from '@forgeframe/memory';
import { registerTools } from './tools.js';
import { ProvenanceLogger } from './provenance.js';
import { ServerEvents } from './events.js';
import { loadConfig } from './config.js';

/**
 * Pretends to be an MCP bridge that stringifies array and integer args.
 * Wires registerTools directly with stub embedder + generator so tests
 * are deterministic and fast — no Ollama dependency.
 */

interface RegisteredTool {
  inputSchema: ZodTypeAny;
  handler: (args: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
}

interface InternalServer {
  _registeredTools: Record<string, RegisteredTool>;
}

const stubEmbedder: Embedder = {
  embed: async () => [0.1, 0.2, 0.3],
};

const stubGenerator: Generator = {
  generate: async () => 'stub',
} as Generator;

interface Harness {
  server: McpServer;
  store: MemoryStore;
  cleanup: () => void;
}

function makeHarness(provPath: string): Harness {
  const store = new MemoryStore({ dbPath: ':memory:' });
  const retriever = new MemoryRetriever(store, stubEmbedder, { hebbian: true });
  const provenance = new ProvenanceLogger(provPath);
  const events = new ServerEvents();
  const session = store.startSession();
  const config = loadConfig({ dbPath: ':memory:', provenancePath: provPath });
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerTools(server, store, retriever, stubEmbedder, stubGenerator, provenance, events, config, session);
  return {
    server,
    store,
    cleanup: () => { try { store.close(); } catch {} },
  };
}

describe('tools coercion (stringified MCP bridge args)', () => {
  let harness: Harness | undefined;
  const tmpFiles: string[] = [];

  function provTmp(): string {
    const p = join(tmpdir(), `srv-coerce-${randomUUID()}.jsonl`);
    tmpFiles.push(p);
    return p;
  }

  function getTool(name: string): RegisteredTool {
    const reg = (harness!.server as unknown as InternalServer)._registeredTools;
    const tool = reg[name];
    if (!tool) throw new Error(`tool not registered: ${name}`);
    return tool;
  }

  async function callTool(name: string, rawArgs: unknown): Promise<{ result: unknown; isError: boolean }> {
    const tool = getTool(name);
    const parsed = tool.inputSchema.parse(rawArgs);
    const out = await tool.handler(parsed);
    const text = out.content[0]?.text ?? '';
    return { result: JSON.parse(text), isError: out.isError === true };
  }

  afterEach(() => {
    harness?.cleanup();
    harness = undefined;
    for (const f of tmpFiles) {
      try { unlinkSync(f); } catch {}
    }
    tmpFiles.length = 0;
  });

  it('memory_save accepts stringified tags array', async () => {
    harness = makeHarness(provTmp());
    const out = await callTool('memory_save', {
      content: 'coercion test 1',
      tags: '["alpha","beta"]',
    });
    expect(out.isError).toBe(false);
    const mem = out.result as { tags: string[] };
    expect(mem.tags).toEqual(['alpha', 'beta']);
  });

  it('memory_save still accepts native tags array', async () => {
    harness = makeHarness(provTmp());
    const out = await callTool('memory_save', {
      content: 'coercion test 2',
      tags: ['gamma', 'delta'],
    });
    expect(out.isError).toBe(false);
    const mem = out.result as { tags: string[] };
    expect(mem.tags).toEqual(['gamma', 'delta']);
  });

  it('memory_search accepts stringified limit', async () => {
    harness = makeHarness(provTmp());
    const out = await callTool('memory_search', {
      query: 'anything',
      limit: '5',
    });
    expect(out.isError).toBe(false);
    expect(Array.isArray(out.result)).toBe(true);
  });

  it('memory_list_recent accepts stringified limit', async () => {
    harness = makeHarness(provTmp());
    harness.store.create({ content: 'recent-1' });
    const out = await callTool('memory_list_recent', { limit: '3' });
    expect(out.isError).toBe(false);
    expect(Array.isArray(out.result)).toBe(true);
  });

  it('memory_list_by_tag accepts stringified limit', async () => {
    harness = makeHarness(provTmp());
    harness.store.create({ content: 'tagged', tags: ['t1'] });
    const out = await callTool('memory_list_by_tag', { tag: 't1', limit: '10' });
    expect(out.isError).toBe(false);
    expect(Array.isArray(out.result)).toBe(true);
  });

  it('memory_link accepts stringified weight', async () => {
    harness = makeHarness(provTmp());
    const a = harness.store.create({ content: 'a' });
    const b = harness.store.create({ content: 'b' });
    const out = await callTool('memory_link', {
      sourceId: a.id,
      targetId: b.id,
      relationType: 'related',
      weight: '0.7',
    });
    expect(out.isError).toBe(false);
  });

  it('memory_search rejects malformed stringified tags', async () => {
    harness = makeHarness(provTmp());
    expect(() => getTool('memory_search').inputSchema.parse({
      query: 'x',
      tags: 'not-json',
    })).toThrow();
  });

  it('memory_graph accepts stringified hops', async () => {
    harness = makeHarness(provTmp());
    const center = harness.store.create({ content: 'center' });
    const out = await callTool('memory_graph', {
      memoryId: center.id,
      hops: '2',
    });
    expect(out.isError).toBe(false);
  });

  it('memory_roadmap accepts stringified numeric thresholds', async () => {
    harness = makeHarness(provTmp());
    const out = await callTool('memory_roadmap', {
      activeWindowHours: '24',
      entrenchedStrength: '0.85',
      driftingThreshold: '0.6',
      maxPerBucket: '10',
    });
    expect(out.isError).toBe(false);
  });
});
