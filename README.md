# ForgeFrame

**Local intelligence infrastructure. Routing, memory, provenance.**

Every conversation with an AI disappears when the window closes. Every insight lives in someone else's cloud. ForgeFrame keeps it on your machine -- a local layer that remembers, routes, and logs, under your control.

---

## What it does

**Remembers.** Conversations are stored locally with weighted retrieval. Memories strengthen when accessed, fade when forgotten, decay over time like the real thing. Your AI remembers you because the memory lives on your machine, not theirs.

**Routes.** Messages are classified by intent and sent to the right model. Quick questions go to fast models. Deep reasoning goes to frontier models. You set the tiers. ForgeFrame dispatches.

**Protects.** The sovereign proxy scrubs PII before anything reaches a cloud LLM -- names, emails, file paths replaced with tokens on the way out, restored on the way back. Provenance logs every request. Regex and dictionary scrubbing work standalone. The deep scrub tier requires a local model (Ollama) for context-aware detection -- without it, that tier fails open. Full protection means local inference.

**Connects.** MCP server exposes memory to any compatible client -- Claude Desktop, Cursor, anything that speaks MCP. Save, search, tag, update. The memory is yours to wire into whatever tools you use.

---

## Packages

```
packages/
  memory/    Persistent semantic memory       MIT
  core/      Model routing, intent dispatch    AGPL-3.0
  proxy/     Sovereign localhost proxy         AGPL-3.0
  server/    MCP memory server                 MIT
```

**@forgeframe/memory** -- The primitive. SQLite + FTS5 full-text search. Weighted retrieval. Configurable decay. Session-scoped and cross-session queries. Extension points for embeddings. MIT licensed -- use it anywhere.

**@forgeframe/core** -- The engine. Tier-based dispatch (quick / balanced / deep). Intent detection. Provider registry for Anthropic, OpenAI, Ollama, and custom providers. SSE stream normalization. Dependency injection throughout.

**@forgeframe/proxy** -- The border. Localhost reverse proxy with a 3-tier scrub pipeline (regex, dictionary, local LLM). Token map replaces sensitive data with `[FF:CATEGORY_N]` placeholders. Stream rehydrator restores values across SSE chunk boundaries. Provenance logger hashes PII with SHA-256 -- never stores raw. *Scaffolded with 56 tests. LLM scrub tier stubbed, not yet wired to Ollama.*

**@forgeframe/server** -- The interface. MCP server with 12 tools: save, search, update, list, tag, delete, status, plus full session management. Ready to publish.

---

## Current state

Memory and server: production-ready, all tests passing, publishable to npm.
Core: stable, CJS dual-build for Electron compatibility.
Proxy: architecture complete, tests passing, needs real-world integration testing.

```bash
npm install
npm run build
```

---

## License

- `packages/memory/` and `packages/server/` -- [MIT](LICENSE-MIT)
- `packages/core/` and `packages/proxy/` -- [AGPL-3.0](LICENSE-AGPL)

The primitive is open. The infrastructure that protects it is copyleft.
