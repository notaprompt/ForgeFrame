# ForgeFrame

Local intelligence infrastructure. Routing, memory, provenance.

ForgeFrame sits between you and every AI interface you use. It makes your interactions persistent, auditable, and yours.

## Architecture

```
packages/
  memory/    Persistent semantic memory with weighted retrieval    MIT
  core/      Model routing, provider registry, session management  AGPL-3.0
```

## What it does

**Memory** -- Every conversation you have through ForgeFrame is stored locally. Memories are weighted by recency and access frequency, decay over time like human memory, and consolidate into patterns. Your AI remembers you across sessions, across tools, across models.

**Routing** -- Messages are classified by intent and routed to the optimal model. Simple questions go to fast, cheap models. Complex reasoning goes to frontier models. You configure the tiers. ForgeFrame handles dispatch.

**Provenance** -- Every AI output that passes through ForgeFrame is signed, timestamped, and logged to an append-only local store. You can prove what was generated, when, by which model.

**Local-first** -- All data stays on your machine. No cloud dependency. No telemetry. No phone home. Your cognitive history belongs to you.

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

## License

This project uses a dual-license structure:

- `packages/memory/` is licensed under the [MIT License](LICENSE-MIT)
- `packages/core/` is licensed under the [AGPL-3.0 License](LICENSE-AGPL)

See each package's LICENSE file for details.
