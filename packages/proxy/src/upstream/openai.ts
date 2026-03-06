/**
 * @forgeframe/proxy -- OpenAI-Compatible Upstream
 *
 * Forwards scrubbed requests to OpenAI or any compatible API.
 * Handles both non-streaming and SSE streaming responses.
 */

import type { Upstream, UpstreamRequest, UpstreamResponse, SSEChunk } from '../types.js';

export class OpenAIUpstream implements Upstream {
  private _baseUrl: string;
  private _apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this._baseUrl = baseUrl.replace(/\/$/, '');
    this._apiKey = apiKey;
  }

  async forward(request: UpstreamRequest): Promise<UpstreamResponse> {
    const url = `${this._baseUrl}${request.path}`;
    const headers = this._buildHeaders(request.headers);

    const res = await fetch(url, {
      method: request.method,
      headers,
      body: JSON.stringify(request.body),
    });

    const body = await res.json();
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { responseHeaders[k] = v; });

    return { status: res.status, headers: responseHeaders, body };
  }

  async *forwardStream(request: UpstreamRequest): AsyncGenerator<SSEChunk> {
    const url = `${this._baseUrl}${request.path}`;
    const headers = this._buildHeaders(request.headers);

    const res = await fetch(url, {
      method: request.method,
      headers,
      body: JSON.stringify(request.body),
    });

    if (!res.body) throw new Error('No response body for streaming request');

    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          yield { data };
        }
      }

      // Flush remaining
      if (buffer.trim() && buffer.startsWith('data: ')) {
        const data = buffer.slice(6);
        if (data !== '[DONE]') yield { data };
      }
    } finally {
      reader.releaseLock();
    }
  }

  private _buildHeaders(incoming: Record<string, string>): Record<string, string> {
    return {
      ...incoming,
      'authorization': `Bearer ${this._apiKey}`,
      'content-type': 'application/json',
    };
  }
}
