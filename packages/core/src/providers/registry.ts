/**
 * @forgeframe/core — Provider Registry
 *
 * Manages provider instances. No default registrations --
 * consumers register their own providers.
 */

import { EventEmitter } from 'events';
import type { Provider, Message, SendMessageOptions } from '../types.js';

export class ProviderRegistry {
  private _providers = new Map<string, Provider>();

  register(type: string, provider: Provider): void {
    this._providers.set(type, provider);
  }

  getProvider(type: string): Provider | undefined {
    return this._providers.get(type);
  }

  listProviders(): string[] {
    return Array.from(this._providers.keys());
  }

  listAvailable(): { type: string; name: string; available: boolean }[] {
    const result: { type: string; name: string; available: boolean }[] = [];
    for (const [type, provider] of this._providers) {
      result.push({
        type,
        name: provider.name,
        available: provider.isAvailable(),
      });
    }
    return result;
  }

  sendMessage(type: string, messages: Message[], options: SendMessageOptions = {}): EventEmitter {
    const provider = this._providers.get(type);
    if (!provider) {
      const emitter = new EventEmitter();
      process.nextTick(() => {
        emitter.emit('error', { type: 'error', error: `Unknown provider: ${type}` });
      });
      return emitter;
    }
    return provider.sendMessage(messages, options);
  }
}
