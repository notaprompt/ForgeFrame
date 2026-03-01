import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { ProviderRegistry } from './registry.js';
import type { Provider } from '../types.js';

function createMockProvider(name: string, available = true): Provider {
  return {
    name,
    type: name,
    isAvailable: () => available,
    sendMessage: (_msgs, _opts) => new EventEmitter(),
  };
}

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it('register + getProvider round-trip', () => {
    const provider = createMockProvider('ollama');
    registry.register('ollama', provider);
    expect(registry.getProvider('ollama')).toBe(provider);
  });

  it('getProvider returns undefined for unknown type', () => {
    expect(registry.getProvider('nonexistent')).toBeUndefined();
  });

  it('listProviders returns registered types', () => {
    registry.register('ollama', createMockProvider('ollama'));
    registry.register('anthropic', createMockProvider('anthropic'));
    expect(registry.listProviders()).toEqual(['ollama', 'anthropic']);
  });

  it('listAvailable shows availability status', () => {
    registry.register('ollama', createMockProvider('ollama', true));
    registry.register('anthropic', createMockProvider('anthropic', false));
    const available = registry.listAvailable();
    expect(available).toEqual([
      { type: 'ollama', name: 'ollama', available: true },
      { type: 'anthropic', name: 'anthropic', available: false },
    ]);
  });

  it('sendMessage delegates to provider and returns EventEmitter', () => {
    const provider = createMockProvider('ollama');
    registry.register('ollama', provider);
    const emitter = registry.sendMessage('ollama', [], {});
    expect(emitter).toBeInstanceOf(EventEmitter);
  });

  it('sendMessage for unknown provider emits error event', async () => {
    const emitter = registry.sendMessage('nonexistent', [], {});
    const error = await new Promise((resolve) => emitter.on('error', resolve));
    expect(error).toHaveProperty('error');
    expect((error as { error: string }).error).toBe('Unknown provider: nonexistent');
  });
});
