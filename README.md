# ForgeFrame

**Local intelligence infrastructure. Your data stays on your machine.**

I needed AI agents that remember things between sessions, route to the right model without me thinking about it, scrub sensitive data before it leaves my machine, and coordinate with each other on real codebases. Nothing did all of that. So I built it.

ForgeFrame is four packages, a swarm orchestrator, and a terminal cockpit. One repo. One install. Everything runs locally. The database is a SQLite file on your disk. You own it.

---

## What's in the box

**Memory.** Persistent semantic memory with strength decay. Memories weaken over time unless you use them — access reinforces, neglect fades. Tag something as `principle` and it holds at full strength forever. Constitutional memory. The system gets more opinionated about what matters, not less. SQLite + FTS5 with optional Ollama embeddings for semantic search.

**Router.** Tier-based model dispatch. Register any model — Anthropic, OpenAI-compatible, Ollama, your own endpoint. The router reads intent signals in your message and picks the tier: quick questions go to the cheap model, deep analysis goes to the big one. Override when you want. Auto-route when you don't.

**Proxy.** Localhost PII scrubber. Sits between you and the cloud. Regex tier, dictionary tier, local LLM tier. Strips names, emails, credentials, patterns before anything leaves your machine. Rehydrates on the way back. You send the thought, not the identity.

**Server.** MCP server exposing 12 tools (8 memory, 4 session) over stdio. HTTP daemon mode for the REST API and live viewer. Works with Claude Desktop, Claude Code, Cursor, and anything that speaks MCP.

**Swarm.** Multi-agent orchestration. Launch builders and a skeptic into isolated git worktrees with shared memory. The builders write code. The skeptic stress-tests everything they produce. Constitutional constraints keep them honest. All agents share memory through ForgeFrame — findings compound across runs.

**Forge.** Terminal cockpit. One command launches your workspace. `forge new` spawns sessions. `forge 2` switches between them. Auto-names tabs from your model and project. ForgeFrame daemon runs in a side pane so you see what's alive. Shell commands, Zellij layouts, Claude Code hooks. The thing that makes all of this feel like one system.

---

## Quickstart

```bash
git clone https://github.com/notaprompt/ForgeFrame.git
cd ForgeFrame
npm install
npm run build
```

### Add memory to Claude Code

```bash
claude mcp add forgeframe-memory -- npx @forgeframe/server
```

### Start the daemon

```bash
forgeframe start
# http://localhost:3001 — viewer, API, SSE feed
```

### Launch the cockpit

```bash
forge
```

### Run a swarm

```bash
./swarm/launch.sh ~/my-project "refactor the auth system" --builders 3
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
| `@forgeframe/memory` | MIT | Memory store. Decay, reinforcement, embeddings, sessions. |
| `@forgeframe/server` | MIT | MCP server. HTTP daemon. REST API. SSE feed. |
| `@forgeframe/core` | AGPL-3.0 | Model router. Tier dispatch. Provider registry. |
| `@forgeframe/proxy` | AGPL-3.0 | PII scrub. Regex, dictionary, local LLM. |

---

## Configuration

| Variable | Default | What it does |
|----------|---------|-------------|
| `FORGEFRAME_DB_PATH` | `~/.forgeframe/memory.db` | Where the database lives |
| `FORGEFRAME_OLLAMA_URL` | `http://localhost:11434` | Ollama for embeddings |
| `FORGEFRAME_EMBEDDING_MODEL` | `nomic-embed-text` | Which embedding model |
| `FORGEFRAME_DECAY_ON_STARTUP` | `true` | Apply strength decay on boot |
| `FORGEFRAME_HTTP_PORT` | disabled | Enable HTTP daemon |
| `FORGEFRAME_TOKEN` | disabled | Bearer auth for API |

---

## In production

ForgeFrame is running right now on my machine. 325+ memories across 90+ sessions. Every Claude Code session logs to it automatically. The swarm orchestrator has run concurrent agents across multiple repos — ForgeFrame itself, Reframed, a research project — with shared memory coordination. The cockpit is how I manage all of it.

I built this because I needed it. I use it every day. It works.

---

## What this is not

This is not a hosted service. There is no cloud component in this repo. Your data does not leave your machine unless you point the proxy at a cloud model, and even then the proxy scrubs it first.

This is not a framework for building chatbots. This is infrastructure for people who build with AI and want to own what they build on.

This is not maintained by a team. It's maintained by me. I use it, so I fix it. If it's useful to you, use it. If it breaks, tell me.

---

## API costs

ForgeFrame uses Ollama for embeddings — local inference, no API costs. The MCP server makes no external calls. If you configure cloud providers through the router, those costs are between you and the provider. A typical swarm run with 3 builders and 1 skeptic costs roughly what 4 concurrent Claude Code sessions cost.

---

## License

`packages/memory/` and `packages/server/` — [MIT](LICENSE-MIT)
`packages/core/` and `packages/proxy/` — [AGPL-3.0](LICENSE-AGPL)

The memory is yours. The infrastructure that protects it is copyleft.

---

Nothing invented. Everything reframed.
