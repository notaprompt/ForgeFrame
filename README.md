# ForgeFrame

**Constitutional memory for AI agents.**

Some memories decay. Some don't. You decide which.

ForgeFrame gives AI agents persistent, local-first memory that strengthens on access, weakens over time, and protects what matters. Principles and voice are constitutional -- they never decay, no matter how old they are. Everything else follows biological memory: use it or lose it.

Works with Claude Desktop, Cursor, and anything that speaks MCP.

---

## What makes it different

- **Constitutional decay.** Tag a memory as `principle` or `voice` and it holds at full strength forever. Everything else decays at 2% per day, floor of 10%. Access strengthens.
- **Semantic + keyword retrieval.** Combined FTS5 full-text search and cosine similarity via Ollama embeddings. Falls back to keyword-only when Ollama is unavailable.
- **Session isolation.** Multiple agents can share one database with concurrent sessions. Each process manages its own session -- no clobbering.
- **Local-first.** SQLite on your machine. Nothing leaves without your knowledge. Provenance logged to JSONL.

---

## Quickstart

```bash
git clone https://github.com/notaprompt/ForgeFrame.git
cd ForgeFrame
npm install
npm run build
npm test
```

### Add to Claude Desktop

```bash
claude mcp add forgeframe-memory -- npx @forgeframe/server
```

Or install from npm:

```bash
npm install -g @forgeframe/server
claude mcp add forgeframe-memory -- forgeframe-memory
```

### Start the viewer daemon

```bash
forgeframe start --port 3001
# Open http://localhost:3001 for the live swarm viewer
```

---

## Architecture

```
                        MCP (stdio)
Claude / Cursor ──────────────────── @forgeframe/server
                                          │
                                    @forgeframe/memory
                                          │
                                    ~/.forgeframe/memory.db
                                          │
                              ┌───────────┴───────────┐
                              │                       │
                         FTS5 search           Ollama embeddings
                        (always works)       (semantic, optional)
```

The server exposes 12 MCP tools (8 memory, 4 session) over stdio. Optionally runs an HTTP daemon for the swarm viewer and REST API.

---

## Packages

| Package | License | Description |
|---------|---------|-------------|
| `@forgeframe/memory` | MIT | SQLite + FTS5 memory store, embeddings, decay, sessions |
| `@forgeframe/server` | MIT | MCP server, HTTP API, daemon CLI |
| `@forgeframe/core` | AGPL-3.0 | Tier-based model routing, provider registry |
| `@forgeframe/proxy` | AGPL-3.0 | PII scrub pipeline (regex, dictionary, local LLM) |

Memory and server are the open-source core. Core and proxy are copyleft infrastructure.

---

## Configuration

All configuration via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `FORGEFRAME_DB_PATH` | `~/.forgeframe/memory.db` | SQLite database path |
| `FORGEFRAME_OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint for embeddings |
| `FORGEFRAME_EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model name |
| `FORGEFRAME_DECAY_ON_STARTUP` | `true` | Apply strength decay when server starts |
| `FORGEFRAME_HTTP_PORT` | (disabled) | Enable HTTP server on this port |
| `FORGEFRAME_TOKEN` | (disabled) | Bearer token for HTTP API auth |
| `FORGEFRAME_INGEST_DIR` | (disabled) | Auto-index markdown files at startup |
| `FORGEFRAME_VIEWER_PATH` | (auto-detect) | Path to swarm viewer HTML |

---

## Daemon mode

The HTTP server runs as a persistent daemon, independent of any Claude session.

```bash
forgeframe start              # start daemon (background, port 3001)
forgeframe start --port 4000  # custom port
forgeframe status             # check if running
forgeframe stop               # stop daemon
forgeframe serve              # run in foreground (debug)
```

The daemon serves:
- `/api/status` -- memory count, active sessions, uptime
- `/api/memories/recent` -- recent memories
- `/api/memories/search?q=...` -- search
- `/api/events` -- SSE live feed (memory created/updated/deleted, sessions)
- `/` -- swarm viewer (real-time pixel visualization)

Set `FORGEFRAME_TOKEN` for bearer auth on all API endpoints.

---

## Swarm orchestration

ForgeFrame includes a swarm launcher that coordinates multiple Claude Code agents in isolated git worktrees with shared memory.

```bash
./swarm/launch.sh ~/project "refactor the auth system" --builders 3
```

Each builder gets full tool access. A skeptic agent runs in parallel with read-only access, stress-testing everything. All agents share memory through ForgeFrame MCP.

---

## API cost note

ForgeFrame uses Ollama for embeddings by default -- **local inference, no API costs**. If you configure a cloud embedding provider, memory operations will incur costs proportional to usage. The MCP server itself makes no external API calls.

---

## License

- `packages/memory/` and `packages/server/` -- [MIT](LICENSE-MIT)
- `packages/core/` and `packages/proxy/` -- [AGPL-3.0](LICENSE-AGPL)

The primitive is open. The infrastructure that protects it is copyleft.
