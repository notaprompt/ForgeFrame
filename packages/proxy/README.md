# @forgeframe/proxy

Localhost proxy that scrubs sensitive data before it reaches a cloud LLM, then rehydrates the response on the way back. Your data stays on your machine. What leaves is tokenized. What comes back is logged.

## Install

```bash
npm install @forgeframe/proxy
```

## Usage

```typescript
import { loadProxyConfig, startProxyServer, ScrubEngineImpl, TokenMapImpl, ProxyPipeline, ProxyProvenanceLogger, createUpstream } from '@forgeframe/proxy';
import { MemoryStore, MemoryRetriever } from '@forgeframe/memory';
import { MemoryInjectorImpl } from '@forgeframe/proxy';

const config = loadProxyConfig();
const scrubEngine = new ScrubEngineImpl(config);
const upstream = createUpstream(config);
const provenance = new ProxyProvenanceLogger(config.provenanceDbPath);

// Optional: wire memory for context injection
const store = new MemoryStore({ dbPath: config.memoryDbPath });
const memoryInjector = new MemoryInjectorImpl(new MemoryRetriever(store));

const pipeline = new ProxyPipeline({
  scrubEngine, memoryInjector, upstream, provenance, logger: config.logger,
});

await startProxyServer({ config, pipeline });
// Listening on 127.0.0.1:4740
```

Point your client at `http://localhost:4740` instead of the cloud API. The proxy handles the rest.

## Scrub pipeline

Three tiers, applied in sequence:

1. **Regex** -- SSN, email, phone, IP, file paths. Deterministic, instant.
2. **Dictionary** -- User-maintained blocklist/allowlist (JSON files). Instant.
3. **Local LLM** -- Semantic detection via Ollama. 500ms timeout, fails open.

Scrubbed values become `[FF:CATEGORY_N]` tokens. The token map is bidirectional -- outbound tokenizes, inbound detokenizes.

## Rehydration

- **Full responses**: token map replaces all `[FF:*]` tokens in the response body.
- **Streaming**: `StreamRehydrator` buffers partial tokens split across SSE chunk boundaries. Handles both Anthropic and OpenAI response formats.

## Provenance

Every request logs: SHA-256 hash of original text, scrubbed body, redaction count, response hash, latency. Append-only JSONL. Raw PII is never stored in the log.

## HTTP endpoints

- `GET /health` -- `{ status: 'ok', proxy: 'forgeframe' }`
- `POST /v1/messages` -- Anthropic-compatible
- `POST /v1/chat/completions` -- OpenAI-compatible

## Limitations

- LLM scrub tier is implemented but not yet wired to Ollama in production. Regex and dictionary tiers work standalone.
- Needs integration testing against real cloud APIs.
- Latency budget (<100ms overhead) not yet validated under load.

## License

AGPL-3.0
