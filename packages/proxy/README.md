# @forgeframe/proxy

Localhost proxy that scrubs sensitive data before it reaches a cloud LLM, then rehydrates the response on the way back. Your data stays on your machine. What leaves is tokenized. What comes back is logged.

## Install

```bash
npm install @forgeframe/proxy
```

## Usage

```typescript
import {
  loadProxyConfig,
  startProxyServer,
  ScrubEngineImpl,
  TokenMapImpl,
  ProxyPipeline,
  ProxyProvenanceLogger,
  createUpstream,
  MemoryInjectorImpl,
} from '@forgeframe/proxy';
import { MemoryStore, MemoryRetriever } from '@forgeframe/memory';

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

Scrubbed values become `[FF:CATEGORY_N]` tokens (e.g. `[FF:EMAIL_1]`, `[FF:SSN_2]`). The token map is bidirectional -- outbound tokenizes, inbound detokenizes.

## API

### ScrubEngineImpl

Runs the three-tier scrub pipeline.

| Method | Description |
|--------|-------------|
| `scrub(text: string, tokenMap: TokenMap)` | Scrub text, populate token map. Returns `ScrubResult`. |

Standalone scrub functions are also exported: `scrubWithRegex`, `scrubWithDictionary`, `scrubWithLlm`.

### TokenMapImpl

Bidirectional map between original values and `[FF:*]` tokens.

| Method | Description |
|--------|-------------|
| `tokenize(category: string, value: string)` | Map a value to a token. Returns the token string. |
| `detokenize(token: string)` | Resolve a token back to its original value. |

### Rehydration

| Export | Description |
|--------|-------------|
| `rehydrate(text, tokenMap)` | Replace all `[FF:*]` tokens in a complete response. |
| `StreamRehydrator` | Handles partial tokens split across SSE chunk boundaries. |

### ProxyPipeline

Full request lifecycle: scrub, inject memory context, send upstream, rehydrate response, log provenance.

### ProxyProvenanceLogger

Append-only JSONL audit trail. Logs SHA-256 hash of original text, scrubbed body, redaction count, response hash, latency. Raw PII is never stored.

## HTTP endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | `{ status: 'ok', proxy: 'forgeframe' }` |
| POST | `/v1/messages` | Anthropic-compatible |
| POST | `/v1/chat/completions` | OpenAI-compatible |

Both endpoints support streaming and non-streaming requests.

## Configuration

Configuration via `loadProxyConfig()`, which reads from environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `FORGEFRAME_PROXY_PORT` | `4740` | Proxy listen port |
| `FORGEFRAME_PROXY_HOST` | `127.0.0.1` | Bind address |
| `FORGEFRAME_PROXY_UPSTREAM` | -- | Cloud API base URL |
| `FORGEFRAME_DB_PATH` | `~/.forgeframe/memory.db` | Memory DB for context injection |

## Limitations

- LLM scrub tier is implemented but not yet wired to Ollama in production. Regex and dictionary tiers work standalone.
- Needs integration testing against real cloud APIs.
- Latency budget (<100ms overhead) not yet validated under load.

## Part of [ForgeFrame](https://github.com/notaprompt/ForgeFrame)

The data protection layer. Sits between your client and the cloud API. Pairs with `@forgeframe/core` for routing and `@forgeframe/memory` for context injection.

## License

AGPL-3.0
