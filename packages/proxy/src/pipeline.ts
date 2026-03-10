/**
 * @forgeframe/proxy -- ProxyPipeline
 *
 * Orchestrates the full request flow:
 *   scrub -> memory inject -> forward -> rehydrate -> provenance log
 */

import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import type { Logger } from '@forgeframe/core';
import type {
  ScrubEngine,
  MemoryInjector,
  Upstream,
  TokenMap,
  UpstreamRequest,
  UpstreamResponse,
  SSEChunk,
} from './types.js';
import { TokenMapImpl } from './token-map.js';
import { rehydrate, StreamRehydrator } from './rehydrator.js';
import { ProxyProvenanceLogger } from './provenance.js';

export interface PipelineConfig {
  scrubEngine: ScrubEngine;
  memoryInjector: MemoryInjector | null;
  upstream: Upstream;
  provenance: ProxyProvenanceLogger;
  logger: Logger;
  tokenMapPath?: string;
}

interface AnthropicBody {
  messages?: { role: string; content: string | unknown[] }[];
  system?: string | { type: string; text: string }[];
  stream?: boolean;
  [key: string]: unknown;
}

interface OpenAIBody {
  messages?: { role: string; content: string }[];
  stream?: boolean;
  [key: string]: unknown;
}

export class ProxyPipeline {
  private _scrub: ScrubEngine;
  private _memory: MemoryInjector | null;
  private _upstream: Upstream;
  private _provenance: ProxyProvenanceLogger;
  private _logger: Logger;
  private _tokenMap: TokenMapImpl;
  private _tokenMapPath: string | null;

  constructor(config: PipelineConfig, tokenMap?: TokenMapImpl) {
    this._scrub = config.scrubEngine;
    this._memory = config.memoryInjector;
    this._upstream = config.upstream;
    this._provenance = config.provenance;
    this._logger = config.logger;
    this._tokenMapPath = config.tokenMapPath ?? null;
    this._tokenMap = tokenMap ?? this._loadTokenMap();
  }

  private _loadTokenMap(): TokenMapImpl {
    if (!this._tokenMapPath) return new TokenMapImpl();
    try {
      const json = readFileSync(this._tokenMapPath, 'utf-8');
      this._logger.info(`Loaded token map (${JSON.parse(json).forward.length} entries)`);
      return TokenMapImpl.deserialize(json);
    } catch {
      return new TokenMapImpl();
    }
  }

  private _persistTokenMap(): void {
    if (!this._tokenMapPath || this._tokenMap.size === 0) return;
    try {
      writeFileSync(this._tokenMapPath, this._tokenMap.serialize(), 'utf-8');
    } catch (err) {
      this._logger.error('Failed to persist token map:', err);
    }
  }

  get tokenMap(): TokenMap {
    return this._tokenMap;
  }

  /** Process a non-streaming request. */
  async process(request: UpstreamRequest): Promise<UpstreamResponse> {
    const requestId = randomUUID();
    const start = Date.now();

    // 1. Scrub request body
    const { body: scrubbedBody, originalText } = await this._scrubBody(request.body);

    // 2. Inject memory context
    const finalBody = await this._injectMemory(scrubbedBody, originalText);

    // 3. Log request provenance
    this._provenance.log({
      timestamp: Date.now(),
      requestId,
      action: 'proxy_request',
      originalPromptHash: ProxyProvenanceLogger.hash(originalText),
      scrubbed: JSON.stringify(finalBody),
      upstream: request.path,
    });

    // 4. Forward to upstream
    const scrubbedRequest: UpstreamRequest = {
      ...request,
      body: finalBody,
      stream: false,
    };
    const response = await this._upstream.forward(scrubbedRequest);

    // 5. Rehydrate response
    const rehydratedBody = this._rehydrateBody(response.body);

    // 6. Log response provenance
    this._provenance.log({
      timestamp: Date.now(),
      requestId,
      action: 'proxy_response',
      rehydrated: true,
      latencyMs: Date.now() - start,
    });

    this._persistTokenMap();
    return { ...response, body: rehydratedBody };
  }

  /** Process a streaming request, yielding rehydrated SSE chunks. */
  async *processStream(request: UpstreamRequest): AsyncGenerator<SSEChunk> {
    const requestId = randomUUID();
    const start = Date.now();

    // 1. Scrub
    const { body: scrubbedBody, originalText } = await this._scrubBody(request.body);

    // 2. Inject memory
    const finalBody = await this._injectMemory(scrubbedBody, originalText);

    // 3. Log request
    this._provenance.log({
      timestamp: Date.now(),
      requestId,
      action: 'proxy_request',
      originalPromptHash: ProxyProvenanceLogger.hash(originalText),
      scrubbed: JSON.stringify(finalBody),
      upstream: request.path,
    });

    // 4. Forward as stream
    const scrubbedRequest: UpstreamRequest = {
      ...request,
      body: finalBody,
      stream: true,
    };

    const rehydrator = new StreamRehydrator(this._tokenMap);

    for await (const chunk of this._upstream.forwardStream(scrubbedRequest)) {
      const rehydrated = this._rehydrateSSEChunk(chunk, rehydrator);
      if (rehydrated) yield rehydrated;
    }

    // Flush remaining buffer
    const remaining = rehydrator.end();
    if (remaining) {
      yield { data: remaining };
    }

    // 5. Log response
    this._provenance.log({
      timestamp: Date.now(),
      requestId,
      action: 'proxy_response',
      rehydrated: true,
      latencyMs: Date.now() - start,
    });

    this._persistTokenMap();
  }

  private async _scrubBody(body: unknown): Promise<{ body: unknown; originalText: string }> {
    if (!body || typeof body !== 'object') return { body, originalText: '' };

    const bodyObj = body as Record<string, unknown>;
    const cloned = JSON.parse(JSON.stringify(bodyObj));
    let originalText = '';

    // Scrub messages
    if (Array.isArray(cloned.messages)) {
      for (const msg of cloned.messages) {
        if (typeof msg.content === 'string') {
          originalText += msg.content + '\n';
          const result = await this._scrub.scrub(msg.content, this._tokenMap);
          msg.content = result.text;
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              originalText += block.text + '\n';
              const result = await this._scrub.scrub(block.text, this._tokenMap);
              block.text = result.text;
            }
          }
        }
      }
    }

    // Scrub system prompt (Anthropic format: string or array)
    if (typeof cloned.system === 'string') {
      originalText += cloned.system + '\n';
      const result = await this._scrub.scrub(cloned.system, this._tokenMap);
      cloned.system = result.text;
    } else if (Array.isArray(cloned.system)) {
      for (const block of cloned.system) {
        if (block.type === 'text' && typeof block.text === 'string') {
          originalText += block.text + '\n';
          const result = await this._scrub.scrub(block.text, this._tokenMap);
          block.text = result.text;
        }
      }
    }

    return { body: cloned, originalText };
  }

  private async _injectMemory(body: unknown, originalText: string): Promise<unknown> {
    if (!this._memory || !originalText) return body;

    const context = await this._memory.retrieve(originalText);
    if (!context) return body;

    const bodyObj = body as AnthropicBody & OpenAIBody;

    // Anthropic format: system is top-level string or array
    if (typeof bodyObj.system === 'string') {
      bodyObj.system = context + '\n\n' + bodyObj.system;
    } else if (Array.isArray(bodyObj.system)) {
      bodyObj.system = [{ type: 'text', text: context }, ...bodyObj.system];
    } else if (bodyObj.messages && bodyObj.messages[0]?.role === 'system') {
      // OpenAI format: system is first message
      const sysMsg = bodyObj.messages[0];
      if (typeof sysMsg.content === 'string') {
        sysMsg.content = context + '\n\n' + sysMsg.content;
      }
    } else {
      // No system prompt exists -- add one (Anthropic format)
      bodyObj.system = context;
    }

    // Scrub the injected memory context too
    if (typeof bodyObj.system === 'string') {
      const result = await this._scrub.scrub(bodyObj.system, this._tokenMap);
      bodyObj.system = result.text;
    }

    return bodyObj;
  }

  private _rehydrateBody(body: unknown): unknown {
    if (!body || typeof body !== 'object') return body;

    // Deep rehydrate by converting to string and back
    const json = JSON.stringify(body);
    const rehydrated = rehydrate(json, this._tokenMap);
    return JSON.parse(rehydrated);
  }

  private _rehydrateSSEChunk(chunk: SSEChunk, rehydrator: StreamRehydrator): SSEChunk | null {
    // Try to parse as JSON and rehydrate text deltas
    try {
      const parsed = JSON.parse(chunk.data);

      // Anthropic format: content_block_delta with text delta
      if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
        const rehydrated = rehydrator.push(parsed.delta.text);
        if (!rehydrated) return null;
        parsed.delta.text = rehydrated;
        return { event: chunk.event, data: JSON.stringify(parsed) };
      }

      // OpenAI format: choices[0].delta.content
      if (parsed.choices?.[0]?.delta?.content) {
        const rehydrated = rehydrator.push(parsed.choices[0].delta.content);
        if (!rehydrated) return null;
        parsed.choices[0].delta.content = rehydrated;
        return { event: chunk.event, data: JSON.stringify(parsed) };
      }

      // Not a text delta, pass through as-is
      return chunk;
    } catch {
      // Not JSON, rehydrate raw
      const rehydrated = rehydrator.push(chunk.data);
      if (!rehydrated) return null;
      return { event: chunk.event, data: rehydrated };
    }
  }
}
