/**
 * @forgeframe/proxy -- Anthropic Upstream
 *
 * Forwards scrubbed requests to the Anthropic API.
 * Handles both non-streaming and SSE streaming responses.
 */

import type { Upstream, UpstreamRequest, UpstreamResponse, SSEChunk } from '../types.js';

export class AnthropicUpstream implements Upstream {
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

        let currentEvent: string | undefined;
        let currentData: string[] = [];

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            currentData.push(line.slice(6));
          } else if (line === '' && currentData.length > 0) {
            const data = currentData.join('\n');
            if (data !== '[DONE]') {
              yield { event: currentEvent, data };
            }
            currentEvent = undefined;
            currentData = [];
          }
        }
      }

      // Flush remaining
      if (buffer.trim()) {
        const lines = buffer.split('\n');
        let currentEvent: string | undefined;
        let currentData: string[] = [];
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            currentData.push(line.slice(6));
          }
        }
        if (currentData.length > 0) {
          const data = currentData.join('\n');
          if (data !== '[DONE]') {
            yield { event: currentEvent, data };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private _buildHeaders(incoming: Record<string, string>): Record<string, string> {
    return {
      ...incoming,
      'x-api-key': this._apiKey,
      'content-type': 'application/json',
      'anthropic-version': incoming['anthropic-version'] || '2023-06-01',
    };
  }
}
