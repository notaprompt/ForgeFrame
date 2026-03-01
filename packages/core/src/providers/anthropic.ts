/**
 * @forgeframe/core — Anthropic API Provider
 *
 * Direct HTTPS to api.anthropic.com (or custom base URL).
 * Uses injected KeyStore for API key resolution.
 */

import { EventEmitter } from 'events';
import type { Provider, Message, SendMessageOptions, KeyStore, Logger } from '../types.js';
import { createConsoleLogger } from '../types.js';
import { parseSSEStream } from './sse-parser.js';

export class AnthropicAPIProvider implements Provider {
  private _keyStore: KeyStore | null;
  private _baseUrl: string;
  private _log: Logger;

  constructor(opts: { keyStore?: KeyStore; baseUrl?: string; logger?: Logger } = {}) {
    this._keyStore = opts.keyStore ?? null;
    this._baseUrl = (opts.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
    this._log = opts.logger ?? createConsoleLogger();
  }

  get name(): string { return 'Anthropic API'; }
  get type(): string { return 'anthropic'; }

  isAvailable(): boolean {
    const key = this._keyStore?.getKey('anthropic');
    return !!key;
  }

  sendMessage(messages: Message[], options: SendMessageOptions = {}): EventEmitter {
    const emitter = new EventEmitter();
    const apiKey = this._keyStore?.getKey('anthropic');

    if (!apiKey) {
      process.nextTick(() => {
        emitter.emit('error', { type: 'error', error: 'Anthropic API key not configured' });
      });
      return emitter;
    }

    const model = options.model || 'claude-sonnet-4-5-20250929';
    const maxTokens = options.maxTokens || 4096;
    const stream = options.stream !== false;

    let systemPrompt: string | undefined = options.system;
    const conversationMessages: { role: string; content: string }[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content;
      } else {
        conversationMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: conversationMessages,
      stream,
    };
    if (systemPrompt) {
      body.system = systemPrompt;
    }

    const url = `${this._baseUrl}/v1/messages`;
    this._doFetch(url, apiKey, body, stream, emitter);

    return emitter;
  }

  private async _doFetch(
    url: string,
    apiKey: string,
    body: Record<string, unknown>,
    stream: boolean,
    emitter: EventEmitter,
  ): Promise<void> {
    let aborted = false;
    const controller = new AbortController();
    (emitter as EventEmitter & { abort?: () => void }).abort = () => {
      aborted = true;
      controller.abort();
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text();
        emitter.emit('error', {
          type: 'error',
          error: `Anthropic API ${response.status}: ${errBody}`,
        });
        return;
      }

      if (!stream) {
        const result = await response.json() as Record<string, any>;
        emitter.emit('message_start', {
          type: 'message_start',
          message: { id: result.id, model: result.model },
        });
        for (const block of (result.content || [])) {
          if (block.type === 'text') {
            emitter.emit('text_delta', { type: 'text_delta', text: block.text });
          }
          if (block.type === 'thinking') {
            emitter.emit('thinking_delta', { type: 'thinking_delta', thinking: block.thinking || '' });
          }
        }
        if (result.usage) {
          emitter.emit('result', {
            type: 'result',
            usage: {
              input_tokens: result.usage.input_tokens || 0,
              output_tokens: result.usage.output_tokens || 0,
            },
          });
        }
        emitter.emit('message_stop', { type: 'message_stop' });
        emitter.emit('done', { exitCode: 0 });
        return;
      }

      for await (const { event, data } of parseSSEStream(response)) {
        if (aborted) break;
        try {
          const parsed = JSON.parse(data);
          this._normalizeEvent(event, parsed, emitter);
        } catch {
          // Non-JSON SSE data
        }
      }

      if (!aborted) {
        emitter.emit('done', { exitCode: 0 });
      }
    } catch (e: any) {
      if (!aborted) {
        this._log.error('Anthropic API error:', e.message);
        emitter.emit('error', { type: 'error', error: e.message });
      }
    }
  }

  private _normalizeEvent(event: string | null, parsed: any, emitter: EventEmitter): void {
    switch (event || parsed.type) {
      case 'message_start':
        emitter.emit('message_start', {
          type: 'message_start',
          message: {
            id: parsed.message?.id || null,
            model: parsed.message?.model || null,
          },
        });
        break;

      case 'content_block_delta':
        if (parsed.delta?.type === 'text_delta') {
          emitter.emit('text_delta', { type: 'text_delta', text: parsed.delta.text });
        }
        if (parsed.delta?.type === 'thinking_delta') {
          emitter.emit('thinking_delta', { type: 'thinking_delta', thinking: parsed.delta.thinking });
        }
        break;

      case 'message_delta':
        if (parsed.usage) {
          emitter.emit('result', {
            type: 'result',
            usage: {
              input_tokens: parsed.usage.input_tokens || 0,
              output_tokens: parsed.usage.output_tokens || 0,
            },
          });
        }
        break;

      case 'message_stop':
        emitter.emit('message_stop', { type: 'message_stop' });
        break;

      case 'error':
        emitter.emit('error', {
          type: 'error',
          error: parsed.error?.message || JSON.stringify(parsed),
        });
        break;

      default:
        break;
    }
  }
}
