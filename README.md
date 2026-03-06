# ForgeFrame

Local intelligence infrastructure. Routing, memory, provenance.

Every conversation with an AI disappears when the window closes. Every insight lives in someone else's cloud. ForgeFrame is the fix: a local layer that remembers, routes, and logs -- on your machine, under your control.

## Architecture

```
packages/
  memory/    Persistent semantic memory with weighted retrieval    MIT
  core/      Model routing, provider registry, session management  AGPL-3.0
  proxy/     Sovereign localhost proxy -- scrub, rehydrate, log    AGPL-3.0
  server/    MCP memory server for any MCP client                  MIT
```

## What it does

**Memory** -- Conversations don't disappear. They're stored locally, weighted by recency and access frequency, and decay over time like human memory. Your AI remembers you because the memory lives on your machine.

**Routing** -- Messages are classified by intent and routed to the optimal model. Simple questions go to fast, cheap models. Complex reasoning goes to frontier models. You configure the tiers. ForgeFrame handles dispatch.

**Provenance** -- Every AI output that passes through ForgeFrame is timestamped and logged to an append-only local store. What was generated, when, by which model -- all auditable.

**Local-first** -- All data stays on your machine. No telemetry. No phone home. Your cognitive history belongs to you.

## Quick start

```bash
npm install
npm run build
```

## MCP Integration

ForgeFrame exposes its capabilities as an MCP server compatible with Claude Desktop, Cursor, and any MCP client.

Setup instructions coming soon.

## Packages

### @forgeframe/memory (MIT)

The primitive. Persistent semantic memory with:
- SQLite + FTS5 full-text search
- Weighted retrieval (strength = recency + access frequency)
- Configurable decay (memories fade, frequently accessed ones persist)
- Session-scoped and cross-session queries
- Extension points for embedding-based semantic search

### @forgeframe/core (AGPL-3.0)

The engine. Multi-provider model routing with:
- Tier-based dispatch (quick / balanced / deep)
- Intent detection from message content
- Provider registry (OpenAI-compatible, Anthropic, Ollama, custom)
- SSE stream normalization across providers
- Dependency injection (ConfigStore, KeyStore, Logger)

### @forgeframe/proxy (AGPL-3.0)

The border. Localhost reverse proxy that sits between you and cloud LLMs:
- 3-tier scrub pipeline (regex, dictionary, local LLM) strips PII before it leaves your machine
- Token map replaces sensitive data with `[FF:CATEGORY_N]` placeholders
- Stream rehydrator restores real values on the way back, including across SSE chunk boundaries
- Provenance logger records every request with SHA-256 hashed PII -- never raw
- Anthropic and OpenAI upstream support

### @forgeframe/server (MIT)

The interface. MCP server wrapping @forgeframe/memory for any MCP client:
- 7 memory tools (save, search, update, list recent, list by tag, delete, status)
- 5 session tools (start, end, current, list)
- Resources and prompts for context injection

## License

- `packages/memory/` and `packages/server/` -- [MIT License](LICENSE-MIT)
- `packages/core/` and `packages/proxy/` -- [AGPL-3.0 License](LICENSE-AGPL)

The primitive is open. The infrastructure that protects it is copyleft.
