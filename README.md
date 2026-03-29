# ForgeFrame

**Local intelligence infrastructure. Memory, routing, scrubbing, agents — one install.**

```bash
git clone https://github.com/notaprompt/ForgeFrame.git
cd ForgeFrame && npm install && npm run build
```

```bash
claude mcp add forgeframe-memory -- npx @forgeframe/server   # plug into Claude Code
forgeframe start                                              # start daemon on :3001
forge                                                         # launch cockpit
./swarm/launch.sh ~/project "refactor auth" --builders 3      # run agents
```

---

## Architecture

```
You
 │
 ├── forge (cockpit)
 │    ├── forge new          → spawn workspace
 │    ├── forge 2            → switch context
 │    ├── forge show         → list sessions
 │    └── forge mem          → query memory
 │
 ├── @forgeframe/proxy       → scrub PII before cloud
 ├── @forgeframe/core        → route to right model
 ├── @forgeframe/server      → MCP tools + HTTP daemon
 └── @forgeframe/memory      → SQLite, FTS5, decay, embeddings
      │
      └── ~/.forgeframe/memory.db   ← yours
```

---

## Packages

| Package | License | What it does |
|---------|---------|-------------|
| `@forgeframe/memory` | MIT | Persistent memory. Strength decay, reinforcement, embeddings, sessions. |
| `@forgeframe/server` | MIT | MCP server (12 tools). HTTP daemon. REST API. SSE feed. |
| `@forgeframe/core` | AGPL-3.0 | Model router. Tier dispatch (quick/balanced/deep). BYO provider. |
| `@forgeframe/proxy` | AGPL-3.0 | PII scrub. Regex, dictionary, local LLM. Rehydration. |

---

## What's in the box

**Memory.** SQLite + FTS5 with optional Ollama embeddings. Memories weaken over time unless accessed. Tag something `principle` and it never decays. Constitutional memory — the system gets more opinionated about what matters, not less.

**Router.** Register any model — Anthropic, OpenAI-compatible, Ollama, your own endpoint. Intent signals pick the tier automatically. Quick questions go cheap, deep analysis goes frontier. Override anytime.

**Proxy.** Localhost PII scrubber. Three tiers: regex, dictionary, local LLM. Strips sensitive data before it leaves your machine. Rehydrates on return. You send the thought, not the identity.

**Swarm.** Multi-agent orchestration in isolated git worktrees with shared memory. Builders write code. A skeptic stress-tests everything. Constitutional constraints keep them honest. Findings compound across runs.

**Forge.** Terminal cockpit. `forge` launches your workspace. `forge new` picks from recent projects. `forge 2` switches contexts. Auto-names tabs from model and project. ForgeFrame daemon in a side pane. One system.

---

## Configuration

| Variable | Default | What it does |
|----------|---------|-------------|
| `FORGEFRAME_DB_PATH` | `~/.forgeframe/memory.db` | Database location |
| `FORGEFRAME_OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint |
| `FORGEFRAME_EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model |
| `FORGEFRAME_DECAY_ON_STARTUP` | `true` | Decay on boot |
| `FORGEFRAME_HTTP_PORT` | disabled | HTTP daemon port |
| `FORGEFRAME_TOKEN` | disabled | Bearer auth |

---

## Status

Running in production on my machine. 325+ memories, 90+ sessions. Swarm has run concurrent agents across multiple repos with shared memory coordination. The cockpit is how I manage all of it. I built this because I needed it. I use it every day.

---

## API costs

Ollama for embeddings — local, free. MCP server makes no external calls. Cloud provider costs through the router are yours. A swarm run (3 builders + 1 skeptic) costs roughly 4 concurrent Claude Code sessions.

---

## License

`memory/` and `server/` — [MIT](LICENSE-MIT). `core/` and `proxy/` — [AGPL-3.0](LICENSE-AGPL).

The memory is yours. The infrastructure that protects it is copyleft.

---

*Nothing invented. Everything reframed.*
