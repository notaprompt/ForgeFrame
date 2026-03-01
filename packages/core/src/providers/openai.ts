/**
 * @forgeframe/core — OpenAI-Compatible Provider
 *
 * Direct HTTPS to any OpenAI-compatible endpoint.
 * Uses injected KeyStore for API key resolution.
 */

import { EventEmitter } from 'events';
import type { Provider, Message, SendMessageOptions, KeyStore, Logger } from '../types.js';
import { createConsoleLogger } from '../types.js';
import { parseSSEStream } from './sse-parser.js';

export class OpenAIProvider implements Provider {
  protected _keyStore: KeyStore | null;
  protected _baseUrl: string;
  protected _keyName: string;
  protected _name: string;
  protected _noAuth: boolean;
  protected _log: Logger;

  constructor(opts: {
    keyStore?: KeyStore;
    baseUrl?: string;
    name?: string;
    keyName?: string;
    noAuth?: boolean;
    logger?: Logger;
  } = {}) {
    this._keyStore = opts.keyStore ?? null;
    this._baseUrl = (opts.baseUrl || 'https://api.openai.com').replace(/\/$/, '');
    this._keyName = opts.keyName || 'openai';
    this._name = opts.name || 'OpenAI';
    this._noAuth = opts.noAuth || false;
    this._log = opts.logger ?? createConsoleLogger();
  }

  get name(): string { return this._name; }
  get type(): string { return 'openai'; }

  isAvailable(): boolean {
    if (this._noAuth) return true;
    const key = this._keyStore?.getKey(this._keyName);
    return !!key;
  }

  sendMessage(messages: Message[], options: SendMessageOptions = {}): EventEmitter {
    const emitter = new EventEmitter();
    const apiKey = this._keyStore?.getKey(this._keyName);

    if (!apiKey && !this._noAuth) {
      process.nextTick(() => {
        emitter.emit('error', { type: 'error', error: `${this.name} API key not configured` });
      });
      return emitter;
    }

    const model = options.model || 'gpt-4o';
    const maxTokens = options.maxTokens || 4096;
    const stream = options.stream !== false;

    const openaiMessages = this._transformMessages(messages, options.system);

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: openaiMessages,
      stream,
    };

    if (stream && !this._noAuth) {
      body.stream_options = { include_usage: true };
    }

    const url = `${this._baseUrl}/v1/chat/completions`;
    this._doFetch(url, apiKey || '', body, stream, emitter);

    return emitter;
  }

  protected _transformMessages(
    messages: Message[],
    systemPrompt?: string,
  ): { role: string; content: string }[] {
    const result: { role: string; content: string }[] = [];

    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'system') {
        result.unshift({ role: 'system', content: msg.content });
      } else {
        result.push({ role: msg.role, content: msg.content });
      }
    }

    return result;
  }

  protected async _doFetch(
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
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (apiKey) {
        headers['authorization'] = `Bearer ${apiKey}`;
      }
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text();
        emitter.emit('error', {
          type: 'error',
          error: `${this.name} API ${response.status}: ${errBody}`,
        });
        return;
      }

      if (!stream) {
        const result = await response.json() as Record<string, any>;
        const choice = result.choices?.[0];
        emitter.emit('message_start', {
          type: 'message_start',
          message: { id: result.id, model: result.model },
        });
        if (choice?.message?.content) {
          emitter.emit('text_delta', { type: 'text_delta', text: choice.message.content });
        }
        if (result.usage) {
          emitter.emit('result', {
            type: 'result',
            usage: {
              input_tokens: result.usage.prompt_tokens || 0,
              output_tokens: result.usage.completion_tokens || 0,
            },
          });
        }
        emitter.emit('message_stop', { type: 'message_stop' });
        emitter.emit('done', { exitCode: 0 });
        return;
      }

      let messageId: string | null = null;

      for await (const { data } of parseSSEStream(response)) {
        if (aborted) break;
        try {
          const parsed = JSON.parse(data) as Record<string, any>;
          this._normalizeStreamEvent(parsed, emitter, messageId);
          if (parsed.id) messageId = parsed.id;
        } catch {
          // Non-JSON SSE data
        }
      }

      if (!aborted) {
        emitter.emit('message_stop', { type: 'message_stop' });
        emitter.emit('done', { exitCode: 0 });
      }
    } catch (e: any) {
      if (!aborted) {
        this._log.error(`${this.name} API error:`, e.message);
        emitter.emit('error', { type: 'error', error: e.message });
      }
    }
  }

  protected _normalizeStreamEvent(
    parsed: Record<string, any>,
    emitter: EventEmitter,
    messageId: string | null,
  ): void {
    if (parsed.id && !messageId) {
      emitter.emit('message_start', {
        type: 'message_start',
        message: { id: parsed.id, model: parsed.model },
      });
    }

    const delta = parsed.choices?.[0]?.delta;
    if (delta?.content) {
      emitter.emit('text_delta', { type: 'text_delta', text: delta.content });
    }

    if (parsed.usage) {
      emitter.emit('result', {
        type: 'result',
        usage: {
          input_tokens: parsed.usage.prompt_tokens || 0,
          output_tokens: parsed.usage.completion_tokens || 0,
        },
      });
    }
  }
}
