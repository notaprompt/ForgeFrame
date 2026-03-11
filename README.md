# ForgeFrame

**Your data, your machine, provable.**

Local infrastructure that remembers, routes, and logs. Nothing leaves your machine without your knowledge. Nothing comes back without a record.

Memory and server are [MIT](LICENSE-MIT). Core and proxy are [AGPL-3.0](LICENSE-AGPL).

---

## What it does

**Remembers.** Local SQLite with weighted retrieval. Memories strengthen on access, decay over time. Searchable by text and tags.

**Routes.** Intent-based model dispatch. Quick questions go to fast models, deep reasoning goes to frontier models. You configure the tiers.

**Protects.** Localhost proxy scrubs PII before anything reaches a cloud LLM -- tokens out, real values back. Regex and dictionary scrubbing work standalone. Deep scrub requires a local model (Ollama) -- without it, that tier fails open. Full protection means local inference.

**Connects.** MCP server with 12 tools. Works with Claude Desktop, Cursor, anything that speaks MCP.

---

## Quickstart

```bash
git clone https://github.com/notaprompt/ForgeFrame.git
cd ForgeFrame
npm install
npm run build
npm test
```

---

## Packages

```
packages/
  memory/    Persistent semantic memory       MIT
  core/      Model routing, intent dispatch    AGPL-3.0
  proxy/     Local localhost proxy             AGPL-3.0
  server/    MCP memory server                 MIT
```

**@forgeframe/memory** -- SQLite + FTS5. Weighted retrieval. Configurable decay. Session-scoped queries. Embedding extension points.

**@forgeframe/core** -- Tier-based dispatch (quick / balanced / deep). Provider registry (Anthropic, OpenAI, Ollama, custom). SSE normalization. DI throughout.

**@forgeframe/proxy** -- 3-tier scrub pipeline (regex, dictionary, local LLM). Token map with `[FF:CATEGORY_N]` placeholders. Stream rehydrator across SSE chunks. SHA-256 provenance. *LLM tier not yet wired to Ollama.*

**@forgeframe/server** -- 12 MCP tools. Full session management. Embedding pipeline via Ollama (nomic-embed-text). Boot-context ingestion from markdown directories.

---

## Current state

Memory and server: production-ready, published to npm (v0.1.1).
Core: stable, CJS dual-build for Electron compatibility.
Proxy: architecture complete, needs real-world integration testing.
Embedding pipeline: wired to Ollama (nomic-embed-text). Semantic search with combined FTS + cosine similarity scoring. Graceful fallback to FTS-only when Ollama is unavailable.
Boot-context ingestion: auto-indexes markdown directories at startup. Set `FORGEFRAME_INGEST_DIR` to point at your knowledge base.

---

## License

- `packages/memory/` and `packages/server/` -- [MIT](LICENSE-MIT)
- `packages/core/` and `packages/proxy/` -- [AGPL-3.0](LICENSE-AGPL)

The primitive is open. The infrastructure that protects it is copyleft.
