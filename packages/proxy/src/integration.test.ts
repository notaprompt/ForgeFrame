import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProxyPipeline } from './pipeline.js';
import { ScrubEngineImpl } from './scrub/index.js';
import { TokenMapImpl } from './token-map.js';
import { ProxyProvenanceLogger } from './provenance.js';
import type { Upstream, UpstreamResponse, SSEChunk, ProxyConfig } from './types.js';
import type { Logger } from '@forgeframe/core';

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    port: 4740,
    host: '127.0.0.1',
    upstream: 'anthropic',
    anthropicApiKey: null,
    openaiApiKey: null,
    anthropicBaseUrl: 'https://api.anthropic.com',
    openaiBaseUrl: 'https://api.openai.com',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'qwen3:32b',
    llmScrubTimeout: 2000,
    llmScrubEnabled: false,
    memoryDbPath: ':memory:',
    provenanceDbPath: '',
    tokenMapPath: '',
    maxMemoryResults: 5,
    allowlistPath: null,
    blocklistPath: null,
    logger,
    ...overrides,
  };
}

function mockUpstream(body: unknown): Upstream {
  return {
    async forward(): Promise<UpstreamResponse> {
      return { status: 200, headers: {}, body };
    },
    async *forwardStream(): AsyncGenerator<SSEChunk> {
      yield { data: JSON.stringify({ type: 'content_block_delta', delta: { text: 'Hello' } }) };
    },
  };
}

describe('ProxyPipeline integration', () => {
  let provenance: ProxyProvenanceLogger;

  beforeEach(() => {
    vi.restoreAllMocks();
    provenance = { log: vi.fn() } as unknown as ProxyProvenanceLogger;
  });

  it('scrubs PII and rehydrates in non-streaming request', async () => {
    const config = makeConfig();
    const scrubEngine = new ScrubEngineImpl(config);
    const upstream = mockUpstream({
      content: [{ type: 'text', text: 'Hello [FF:EMAIL_1], your SSN is safe.' }],
    });

    const pipeline = new ProxyPipeline(
      { scrubEngine, memoryInjector: null, upstream, provenance, logger },
    );

    const response = await pipeline.process({
      method: 'POST',
      path: '/v1/messages',
      headers: {},
      body: {
        messages: [{ role: 'user', content: 'My email is test@example.com and SSN is 123-45-6789' }],
      },
      stream: false,
    });

    expect(response.status).toBe(200);
    // Provenance should be logged twice (request + response)
    expect(provenance.log).toHaveBeenCalledTimes(2);
  });

  it('records tier timings in provenance', async () => {
    const config = makeConfig();
    const scrubEngine = new ScrubEngineImpl(config);
    const upstream = mockUpstream({ content: [{ type: 'text', text: 'OK' }] });

    const pipeline = new ProxyPipeline(
      { scrubEngine, memoryInjector: null, upstream, provenance, logger },
    );

    await pipeline.process({
      method: 'POST',
      path: '/v1/messages',
      headers: {},
      body: { messages: [{ role: 'user', content: 'Hello world' }] },
      stream: false,
    });

    const requestLog = (provenance.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(requestLog.tierTimings).toBeDefined();
    expect(requestLog.tierTimings.t1).toBeTypeOf('number');
    expect(requestLog.tierTimings.t2).toBeTypeOf('number');
  });

  it('handles streaming with rehydration', async () => {
    const config = makeConfig();
    const scrubEngine = new ScrubEngineImpl(config);
    const upstream = mockUpstream(null);

    const pipeline = new ProxyPipeline(
      { scrubEngine, memoryInjector: null, upstream, provenance, logger },
    );

    const chunks: SSEChunk[] = [];
    for await (const chunk of pipeline.processStream({
      method: 'POST',
      path: '/v1/messages',
      headers: {},
      body: { messages: [{ role: 'user', content: 'Test' }], stream: true },
      stream: true,
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
  });

  it('scrubs regex patterns from real-world content', async () => {
    const config = makeConfig();
    const scrubEngine = new ScrubEngineImpl(config);
    const upstream = mockUpstream({ content: [{ type: 'text', text: 'Noted.' }] });

    const pipeline = new ProxyPipeline(
      { scrubEngine, memoryInjector: null, upstream, provenance, logger },
    );

    const response = await pipeline.process({
      method: 'POST',
      path: '/v1/messages',
      headers: {},
      body: {
        messages: [{
          role: 'user',
          content: 'Contact me at john@acme.com, my IP is 192.168.1.100, SSN 078-05-1120',
        }],
      },
      stream: false,
    });

    // The request should have been scrubbed before forwarding
    const requestLog = (provenance.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const scrubbed = requestLog.scrubbed;
    expect(scrubbed).not.toContain('john@acme.com');
    expect(scrubbed).not.toContain('078-05-1120');
  });
});
