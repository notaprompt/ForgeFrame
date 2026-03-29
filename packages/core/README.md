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

const registry = new ProviderRegistry();
registry.register('anthropic', new AnthropicAPIProvider({ keyStore }));
registry.register('ollama', new OpenAIProvider({
  baseUrl: 'http://localhost:11434',
  noAuth: true,
}));

const router = new ForgeFrameRouter({
  models: [
    { id: 'qwen3:32b', label: 'Qwen 3', provider: 'ollama', tier: 'quick', description: 'Fast local' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet', provider: 'anthropic', tier: 'balanced', description: 'Default' },
    { id: 'claude-opus-4-6', label: 'Opus', provider: 'anthropic', tier: 'deep', description: 'Frontier' },
  ],
});

// Auto-route based on message intent
const resolved = router.resolveModel('Explain the architecture');
// { provider: 'anthropic', modelId: 'claude-opus-4-6', tier: 'deep', auto: true }

// Send through the provider
const emitter = registry.sendMessage(resolved.provider, messages, {
  model: resolved.modelId,
  stream: true,
});
emitter.on('text_delta', (evt) => process.stdout.write(evt.text));
emitter.on('message_stop', () => console.log('\ndone'));
```

## API

### ForgeFrameRouter

Routes messages to models based on intent signals.

| Method | Description |
|--------|-------------|
| `detectIntent(message: string)` | Classify a message as `quick`, `balanced`, or `deep`. |
| `resolveModel(message: string)` | Pick the best model for a message. Returns `ResolvedModel`. |
| `loadModels(models: Model[])` | Load model definitions at runtime. |
| `getModels()` | List all registered models. Returns `ModelInfo[]`. |

### ProviderRegistry

Manages provider instances and dispatches messages.

| Method | Description |
|--------|-------------|
| `register(id: string, provider)` | Register a provider by ID. |
| `sendMessage(providerId, messages, options)` | Send messages through a provider. Returns an event emitter. |

### Providers

| Class | Compatible with |
|-------|----------------|
| `AnthropicAPIProvider` | Anthropic Messages API |
| `OpenAIProvider` | Any OpenAI-compatible endpoint (Ollama, Fireworks, Together, etc.) |

Both providers normalize streaming responses to a common `StreamEvent` interface: `message_start`, `text_delta`, `thinking_delta`, `message_stop`, `result`, `error`.

## Configuration

Models are defined programmatically via the constructor or `loadModels()`. Each model specifies:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Model identifier (e.g. `claude-opus-4-6`) |
| `label` | string | Display name |
| `provider` | string | Registry key for the provider |
| `tier` | `quick` \| `balanced` \| `deep` | Routing tier |
| `description` | string | Human-readable description |

Tiers: `quick` (simple lookups, summaries), `balanced` (default), `deep` (analysis, architecture, reasoning). Within a tier, the cheapest provider wins.

## Part of [ForgeFrame](https://github.com/notaprompt/ForgeFrame)

The routing engine. Pairs with `@forgeframe/proxy` for PII scrubbing and `@forgeframe/memory` for context-aware routing.

## License

AGPL-3.0
