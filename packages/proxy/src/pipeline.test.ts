import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { ProxyPipeline } from './pipeline.js';
import type { PipelineConfig } from './pipeline.js';
import { TokenMapImpl } from './token-map.js';
import { ProxyProvenanceLogger } from './provenance.js';
import type {
  ScrubEngine,
  ScrubResult,
  TokenMap,
  Upstream,
  UpstreamRequest,
  UpstreamResponse,
  SSEChunk,
  MemoryInjector,
} from './types.js';

const TMP_PROVENANCE = join(tmpdir(), `pipeline-test-${Date.now()}.jsonl`);

afterEach(() => {
  if (existsSync(TMP_PROVENANCE)) unlinkSync(TMP_PROVENANCE);
});

// -- Mocks --

class MockScrubEngine implements ScrubEngine {
  async scrub(text: string, tokenMap: TokenMap): Promise<ScrubResult> {
    // Simple: replace "Andrew" with a token
    let result = text;
    const redactions: ScrubResult['redactions'] = [];
    const pattern = /\bAndrew\b/gi;
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const token = tokenMap.tokenize(match[0], 'PERSON');
      redactions.push({ original: match[0], token, category: 'PERSON', tier: 1 });
    }
    // Replace after tokenizing to preserve order
    for (const r of redactions) {
      result = result.replace(new RegExp(`\\b${r.original}\\b`, 'i'), r.token);
    }
    return { text: result, redactions };
  }
}

class MockUpstream implements Upstream {
  lastRequest: UpstreamRequest | null = null;

  async forward(request: UpstreamRequest): Promise<UpstreamResponse> {
    this.lastRequest = request;
    const body = request.body as { messages?: { content: string }[] };
    const lastMsg = body.messages?.[body.messages.length - 1]?.content ?? '';
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: {
        content: [{ type: 'text', text: `Response to: ${lastMsg}` }],
      },
    };
  }

  async *forwardStream(request: UpstreamRequest): AsyncGenerator<SSEChunk> {
    this.lastRequest = request;
    yield {
      event: 'content_block_delta',
      data: JSON.stringify({ type: 'content_block_delta', delta: { text: 'Hello ' } }),
    };
    yield {
      event: 'content_block_delta',
      data: JSON.stringify({ type: 'content_block_delta', delta: { text: '[FF:PERSON_1]' } }),
    };
    yield {
      event: 'content_block_delta',
      data: JSON.stringify({ type: 'content_block_delta', delta: { text: '!' } }),
    };
    yield {
      event: 'message_stop',
      data: JSON.stringify({ type: 'message_stop' }),
    };
  }
}

function createPipeline(upstream?: MockUpstream, memory?: MemoryInjector | null) {
  const tokenMap = new TokenMapImpl();
  const config: PipelineConfig = {
    scrubEngine: new MockScrubEngine(),
    memoryInjector: memory ?? null,
    upstream: upstream ?? new MockUpstream(),
    provenance: new ProxyProvenanceLogger(TMP_PROVENANCE),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };
  return { pipeline: new ProxyPipeline(config, tokenMap), tokenMap };
}

describe('ProxyPipeline', () => {
  describe('process (non-streaming)', () => {
    it('scrubs request and rehydrates response', async () => {
      const upstream = new MockUpstream();
      const { pipeline } = createPipeline(upstream);

      const response = await pipeline.process({
        method: 'POST',
        path: '/v1/messages',
        headers: {},
        body: {
          messages: [{ role: 'user', content: 'Hello Andrew' }],
        },
        stream: false,
      });

      // Upstream should have received scrubbed content
      const sentBody = upstream.lastRequest!.body as { messages: { content: string }[] };
      expect(sentBody.messages[0]!.content).toContain('[FF:PERSON_1]');
      expect(sentBody.messages[0]!.content).not.toContain('Andrew');

      // Response should be rehydrated (tokens replaced back to real values)
      expect(response.status).toBe(200);
      const resBody = response.body as { content: { text: string }[] };
      expect(resBody.content[0]!.text).toContain('Andrew');
      expect(resBody.content[0]!.text).not.toContain('[FF:PERSON_1]');
    });

    it('logs provenance entries', async () => {
      const { pipeline } = createPipeline();

      await pipeline.process({
        method: 'POST',
        path: '/v1/messages',
        headers: {},
        body: { messages: [{ role: 'user', content: 'Test' }] },
        stream: false,
      });

      const lines = readFileSync(TMP_PROVENANCE, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!).action).toBe('proxy_request');
      expect(JSON.parse(lines[1]!).action).toBe('proxy_response');
    });

    it('scrubs system prompt (Anthropic string format)', async () => {
      const upstream = new MockUpstream();
      const { pipeline } = createPipeline(upstream);

      await pipeline.process({
        method: 'POST',
        path: '/v1/messages',
        headers: {},
        body: {
          system: 'You are helping Andrew',
          messages: [{ role: 'user', content: 'Hi' }],
        },
        stream: false,
      });

      const sentBody = upstream.lastRequest!.body as { system: string };
      expect(sentBody.system).toContain('[FF:PERSON_1]');
      expect(sentBody.system).not.toContain('Andrew');
    });
  });

  describe('processStream', () => {
    it('rehydrates streamed text deltas', async () => {
      const upstream = new MockUpstream();
      const { pipeline, tokenMap } = createPipeline(upstream);

      // Pre-populate the token map so rehydration works
      tokenMap.tokenize('Andrew', 'PERSON');

      const chunks: SSEChunk[] = [];
      const request: UpstreamRequest = {
        method: 'POST',
        path: '/v1/messages',
        headers: {},
        body: { messages: [{ role: 'user', content: 'Hi' }], stream: true },
        stream: true,
      };

      for await (const chunk of pipeline.processStream(request)) {
        chunks.push(chunk);
      }

      // Should have rehydrated [FF:PERSON_1] -> Andrew in the stream
      const textChunks = chunks
        .filter((c) => {
          try {
            const p = JSON.parse(c.data);
            return p.type === 'content_block_delta';
          } catch { return false; }
        })
        .map((c) => JSON.parse(c.data).delta.text);

      const fullText = textChunks.join('');
      expect(fullText).toContain('Andrew');
      expect(fullText).not.toContain('[FF:PERSON_1]');
    });
  });

  describe('memory injection', () => {
    it('injects memory context into system prompt', async () => {
      const upstream = new MockUpstream();
      const mockMemory: MemoryInjector = {
        async retrieve() {
          return '[ForgeFrame Context]\n- User prefers TypeScript\n[End ForgeFrame Context]';
        },
      };
      const { pipeline } = createPipeline(upstream, mockMemory);

      await pipeline.process({
        method: 'POST',
        path: '/v1/messages',
        headers: {},
        body: {
          system: 'You are a helpful assistant',
          messages: [{ role: 'user', content: 'Hi' }],
        },
        stream: false,
      });

      const sentBody = upstream.lastRequest!.body as { system: string };
      expect(sentBody.system).toContain('ForgeFrame Context');
      expect(sentBody.system).toContain('User prefers TypeScript');
    });
  });
});
