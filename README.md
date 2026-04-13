# ForgeFrame

Local intelligence infrastructure. Memory, routing, scrubbing, agents -- one install.

## Quick start

```bash
git clone https://github.com/notaprompt/ForgeFrame.git
cd ForgeFrame && npm install && npm run build
claude mcp add forgeframe-memory -- npx @forgeframe/server
```

## What's in the box

**Memory.** SQLite + FTS5 with optional Ollama embeddings. Memories weaken over time unless accessed. Tag something `principle` and it never decays. Constitutional memory -- the system gets more opinionated about what matters, not less.

**Router.** Register any model -- Anthropic, OpenAI-compatible, Ollama, your own endpoint. Intent signals pick the tier automatically. Quick questions go cheap, deep analysis goes frontier. Override anytime.

**Proxy.** Localhost PII scrubber. Three tiers: regex, dictionary, local LLM. Strips sensitive data before it leaves your machine. Rehydrates on return. You send the thought, not the identity.

**Swarm.** Multi-agent orchestration in isolated git worktrees with shared memory. Builders write code. A skeptic stress-tests everything. Constitutional constraints keep them honest. Findings compound across runs.

**Forge cockpit.** Terminal workspace manager. `forge` launches your session. `forge new` picks from recent projects. `forge 2` switches contexts. Auto-names tabs from model and project. ForgeFrame daemon in a side pane. One system.

## Architecture

```
You
 |
 +-- forge (cockpit)
 |    +-- forge new          -> spawn workspace
 |    +-- forge 2            -> switch context
 |    +-- forge show         -> list sessions
 |    +-- forge mem          -> query memory
 |
 +-- @forgeframe/proxy       -> scrub PII before cloud
 +-- @forgeframe/core        -> route to right model
 +-- @forgeframe/server      -> MCP tools + HTTP daemon
 +-- @forgeframe/memory      -> SQLite, FTS5, decay, embeddings
 |    |
 |    +-- ~/.forgeframe/memory.db   <- yours
 |
 +-- swarm/
      +-- launch.sh          -> spawn builder + skeptic agents
      +-- viewer/            -> real-time swarm monitor (localhost:3001)
      +-- overlays/          -> agent role definitions
```

## Packages

| Package | License | What it does |
|---------|---------|-------------|
| [`@forgeframe/memory`](packages/memory/) | MIT | Persistent memory. Strength decay, reinforcement, embeddings, sessions. |
| [`@forgeframe/server`](packages/server/) | MIT | MCP server (12 tools). HTTP daemon. REST API. SSE feed. |
| [`@forgeframe/core`](packages/core/) | AGPL-3.0 | Model router. Tier dispatch (quick/balanced/deep). BYO provider. |
| [`@forgeframe/proxy`](packages/proxy/) | AGPL-3.0 | PII scrub. Regex, dictionary, local LLM. Rehydration. |

## Forge cockpit

Terminal workspace manager built on Zellij. Commands:

| Command | What it does |
|---------|-------------|
| `forge` | Launch cockpit (Zellij session with ForgeFrame daemon pane) |
| `forge new` | Spawn a new workspace from recent projects |
| `forge 2` | Switch to workspace 2 |
| `forge show` | List active workspaces |
| `forge mem <query>` | Search memory from the terminal |

The cockpit auto-names tabs based on the active model and project (`opus:ForgeFrame -- auth fix`). ForgeFrame daemon runs in a side pane, providing the MCP server and SSE feed for connected agents.

## Configuration

| Variable | Default | What it does |
|----------|---------|-------------|
| `FORGEFRAME_DB_PATH` | `~/.forgeframe/memory.db` | Database location |
| `FORGEFRAME_OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint |
| `FORGEFRAME_EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model |
| `FORGEFRAME_DECAY_ON_STARTUP` | `true` | Apply memory decay on boot |
| `FORGEFRAME_HTTP_PORT` | disabled | HTTP daemon port |
| `FORGEFRAME_TOKEN` | disabled | Bearer auth for HTTP API |
| `FORGEFRAME_PROVENANCE_PATH` | `~/.forgeframe/provenance.jsonl` | Audit log path |
| `FORGEFRAME_SERVER_NAME` | `forgeframe-memory` | Server name in MCP handshake |

## Requirements

- **Node.js 20+** -- required for all packages
- **Zellij** -- required for the Forge cockpit (not needed for memory/server/proxy)
- **Ollama** (optional) -- for embeddings (`nomic-embed-text`, ~2GB VRAM) and LLM scrub tier (~8GB VRAM for 7B+ model)

## Status

Active daily driver. All four packages build and test clean. Memory and server on npm at 0.2.0.

## Cost

ForgeFrame is model-agnostic and adds zero cost. Your models, your keys, your bill. ForgeFrame itself makes no external API calls.

For local inference: Ollama embeddings need ~2GB VRAM (`nomic-embed-text`). The proxy LLM scrub tier needs a 7B+ model (~8GB VRAM). Both are optional -- everything works without them, you just lose semantic search and LLM-tier scrubbing.

## License

`memory/` and `server/` -- [MIT](LICENSE-MIT). `core/` and `proxy/` -- [AGPL-3.0](LICENSE-AGPL).

The memory is yours. The infrastructure that protects it is copyleft.

## Need help setting this up?

[campos.works/services](https://campos.works/services) — setup, integration, and consulting.

