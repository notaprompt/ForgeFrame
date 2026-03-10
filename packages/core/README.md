# @forgeframe/core

Tier-based model routing with a provider registry. Route requests to the right model based on intent -- quick questions to fast models, deep reasoning to frontier models.

## Install

```bash
npm install @forgeframe/core
```

## Usage

```typescript
import {
  ForgeFrameRouter,
  ProviderRegistry,
  AnthropicAPIProvider,
  OpenAIProvider,
} from '@forgeframe/core';

// Set up providers
const registry = new ProviderRegistry();
registry.register('anthropic', new AnthropicAPIProvider({ keyStore }));
registry.register('ollama', new OpenAIProvider({
  baseUrl: 'http://localhost:11434',
  noAuth: true,
}));

// Configure router with models
const router = new ForgeFrameRouter({
  models: [
    { id: 'qwen3:32b', label: 'Qwen 3', provider: 'ollama', tier: 'quick', description: 'Fast local' },
    { id: 'claude-opus-4-6', label: 'Opus', provider: 'anthropic', tier: 'deep', description: 'Frontier' },
  ],
});

// Auto-route based on message intent
const resolved = router.resolveModel('Explain the architecture of this system');
// { provider: 'anthropic', modelId: 'claude-opus-4-6', tier: 'deep', auto: true }

// Send through provider
const emitter = registry.sendMessage(resolved.provider, messages, {
  model: resolved.modelId,
  stream: true,
});

emitter.on('text_delta', (evt) => process.stdout.write(evt.text));
emitter.on('message_stop', () => console.log('\ndone'));
```

## Features

- **Tier-based dispatch** -- quick, balanced, deep. Intent detection selects the tier; cheapest model in tier wins.
- **Provider registry** -- Anthropic, OpenAI-compatible (Ollama, Fireworks, any /v1/chat/completions endpoint), custom.
- **SSE normalization** -- Anthropic and OpenAI stream formats normalized to a common event interface.
- **Dependency injection** -- Logger, ConfigStore, KeyStore are injected interfaces. No singletons, no global state.
- **CJS/ESM dual build** -- ESM for modern tooling, CJS for Electron compatibility.

## License

AGPL-3.0
