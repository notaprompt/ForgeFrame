# ForgeFrame

**Local intelligence infrastructure. Routing, memory, provenance.**

Local layer that remembers, routes, and logs. On your machine, under your control.

---

## What it does

**Remembers.** Local SQLite with weighted retrieval. Memories strengthen on access, decay over time. Searchable by text and tags.

**Routes.** Intent-based model dispatch. Quick questions go to fast models, deep reasoning goes to frontier models. You configure the tiers.

**Protects.** Localhost proxy scrubs PII before anything reaches a cloud LLM -- tokens out, real values back. Regex and dictionary scrubbing work standalone. Deep scrub requires a local model (Ollama) -- without it, that tier fails open. Full protection means local inference.

**Connects.** MCP server with 12 tools. Works with Claude Desktop, Cursor, anything that speaks MCP.

---

## Packages

```
packages/
  memory/    Persistent semantic memory       MIT
  core/      Model routing, intent dispatch    AGPL-3.0
  proxy/     Sovereign localhost proxy         AGPL-3.0
  server/    MCP memory server                 MIT
```

**@forgeframe/memory** -- SQLite + FTS5. Weighted retrieval. Configurable decay. Session-scoped queries. Embedding extension points. MIT.

**@forgeframe/core** -- Tier-based dispatch (quick / balanced / deep). Provider registry (Anthropic, OpenAI, Ollama, custom). SSE normalization. DI throughout.

**@forgeframe/proxy** -- 3-tier scrub pipeline (regex, dictionary, local LLM). Token map with `[FF:CATEGORY_N]` placeholders. Stream rehydrator across SSE chunks. SHA-256 provenance. *LLM tier not yet wired to Ollama.*

**@forgeframe/server** -- 12 MCP tools. Full session management. Ready to publish.

---

## Current state

Memory and server: production-ready, publishable to npm.
Core: stable, CJS dual-build for Electron compatibility.
Proxy: architecture complete, needs real-world integration testing.

```bash
npm install
npm run build
```

---

## License

- `packages/memory/` and `packages/server/` -- [MIT](LICENSE-MIT)
- `packages/core/` and `packages/proxy/` -- [AGPL-3.0](LICENSE-AGPL)

The primitive is open. The infrastructure that protects it is copyleft.
