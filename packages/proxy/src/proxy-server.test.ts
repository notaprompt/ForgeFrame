import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync, unlinkSync } from 'fs';
import { createProxyServer } from './proxy-server.js';
import { ProxyPipeline } from './pipeline.js';
import { TokenMapImpl } from './token-map.js';
import { ProxyProvenanceLogger } from './provenance.js';
import { PROXY_DEFAULTS } from './types.js';
import type {
  ScrubEngine,
  ScrubResult,
  TokenMap,
  Upstream,
  UpstreamRequest,
  UpstreamResponse,
  SSEChunk,
  ProxyConfig,
} from './types.js';
import type { Server } from 'http';

const TMP_PROVENANCE = join(tmpdir(), `server-test-${Date.now()}.jsonl`);
let server: Server | null = null;

afterEach(() => {
  if (server) { server.close(); server = null; }
  if (existsSync(TMP_PROVENANCE)) unlinkSync(TMP_PROVENANCE);
});

// -- Mocks --

class PassthroughScrub implements ScrubEngine {
  async scrub(text: string): Promise<ScrubResult> {
    return { text, redactions: [] };
  }
}

class EchoUpstream implements Upstream {
  async forward(request: UpstreamRequest): Promise<UpstreamResponse> {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { echo: request.body },
    };
  }

  async *forwardStream(): AsyncGenerator<SSEChunk> {
    yield { event: 'content_block_delta', data: JSON.stringify({ type: 'content_block_delta', delta: { text: 'hello' } }) };
    yield { event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) };
  }
}

function makeServer(): { server: Server; port: number } {
  const logger = { info() {}, warn() {}, error() {}, debug() {} };

  const pipeline = new ProxyPipeline({
    scrubEngine: new PassthroughScrub(),
    memoryInjector: null,
    upstream: new EchoUpstream(),
    provenance: new ProxyProvenanceLogger(TMP_PROVENANCE),
    logger,
  }, new TokenMapImpl());

  const config = {
    ...PROXY_DEFAULTS,
    upstream: 'anthropic' as const,
    anthropicApiKey: null,
    openaiApiKey: null,
    anthropicBaseUrl: PROXY_DEFAULTS.anthropicBaseUrl,
    openaiBaseUrl: PROXY_DEFAULTS.openaiBaseUrl,
    llmScrubEnabled: false,
    memoryDbPath: ':memory:',
    provenanceDbPath: TMP_PROVENANCE,
    allowlistPath: null,
    blocklistPath: null,
    logger,
  } satisfies ProxyConfig;

  const s = createProxyServer({ config, pipeline });
  // Listen on random port
  s.listen(0);
  const addr = s.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  server = s;
  return { server: s, port };
}

async function request(port: number, path: string, opts: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: opts.method ?? 'POST',
    headers: { 'content-type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

describe('ProxyServer', () => {
  it('responds to health check', async () => {
    const { port } = makeServer();
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.proxy).toBe('forgeframe');
  });

  it('rejects non-POST methods', async () => {
    const { port } = makeServer();
    const { status, body } = await request(port, '/v1/messages', { method: 'GET' });
    expect(status).toBe(405);
    expect(body.error).toBe('Method not allowed');
  });

  it('rejects unknown paths', async () => {
    const { port } = makeServer();
    const { status } = await request(port, '/v2/unknown', { body: {} });
    expect(status).toBe(404);
  });

  it('forwards non-streaming request through pipeline', async () => {
    const { port } = makeServer();
    const { status, body } = await request(port, '/v1/messages', {
      body: { messages: [{ role: 'user', content: 'Hello' }] },
    });
    expect(status).toBe(200);
    expect(body.echo).toBeDefined();
    expect(body.echo.messages[0].content).toBe('Hello');
  });

  it('handles streaming request', async () => {
    const { port } = makeServer();
    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    const text = await res.text();
    expect(text).toContain('data: ');
    expect(text).toContain('content_block_delta');
  });

  it('rejects empty body', async () => {
    const { port } = makeServer();
    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('Empty request body');
  });

  it('rejects invalid JSON', async () => {
    const { port } = makeServer();
    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json{{{',
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid JSON');
  });
});
