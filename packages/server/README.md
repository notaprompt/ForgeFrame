# @forgeframe/server

MCP memory server. Gives any MCP client persistent semantic memory across sessions. Runs as stdio transport or HTTP daemon. Local-first, no cloud dependency.

## Install

```bash
npm install @forgeframe/server
```

## Usage

### Claude Code

```bash
claude mcp add forgeframe-memory -- npx @forgeframe/server
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "forgeframe-memory": {
      "command": "npx",
      "args": ["-y", "@forgeframe/server"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "forgeframe-memory": {
      "command": "npx",
      "args": ["-y", "@forgeframe/server"]
    }
  }
}
```

### HTTP daemon

```bash
npx @forgeframe/server start --port 3001
```

Exposes the REST API and SSE event feed on `localhost:3001`. Used by the swarm viewer and Forge cockpit.

### Programmatic

```typescript
import { createServer } from '@forgeframe/server';

const { server, store, events, session, shutdown } = createServer({
  dbPath: './my-memory.db',
  decayOnStartup: false,
});

events.on('memory:created', (memory) => {
  console.log('New memory:', memory.id);
});
```

## Tools

12 MCP tools (8 memory + 4 session):

| Tool | Description | Parameters |
|------|-------------|------------|
| `memory_save` | Save a memory | `content` (required), `tags`, `metadata` |
| `memory_search` | Search memories | `query` (required), `limit`, `tags`, `minStrength` |
| `memory_list_recent` | List recent memories | `limit` (default 20) |
| `memory_update` | Update by ID | `id` (required), `content`, `tags`, `metadata` |
| `memory_list_by_tag` | Filter by tag | `tag` (required), `limit` (default 50) |
| `memory_delete` | Delete by ID | `id` (required) |
| `memory_reindex` | Backfill embeddings | `limit` (default 100) |
| `memory_status` | Server status | none |
| `session_start` | Start new session | `metadata` |
| `session_end` | End active session | none |
| `session_list` | List sessions | `status` (active/ended/all), `limit` (default 50) |
| `session_current` | Get active session | none |

## Resources

| URI | Description |
|-----|-------------|
| `memory://recent` | 20 most recent memories |
| `memory://search/{query}` | Search results for query |

## Prompts

| Name | Description |
|------|-------------|
| `memory_context` | System prompt that activates memory tools. Optional `topic` arg pre-searches. |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `FORGEFRAME_DB_PATH` | `~/.forgeframe/memory.db` | SQLite database path |
| `FORGEFRAME_SESSION_ID` | auto-generated UUID | Session identifier |
| `FORGEFRAME_DECAY_ON_STARTUP` | `true` | Apply memory decay on start |
| `FORGEFRAME_PROVENANCE_PATH` | `~/.forgeframe/provenance.jsonl` | Audit log path |
| `FORGEFRAME_SERVER_NAME` | `forgeframe-memory` | Server name in MCP handshake |
| `FORGEFRAME_OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint for embeddings |
| `FORGEFRAME_EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model name |
| `FORGEFRAME_HTTP_PORT` | disabled | HTTP daemon port |
| `FORGEFRAME_TOKEN` | disabled | Bearer auth for HTTP API |
| `FORGEFRAME_TELEGRAM_TOKEN` | disabled | Telegram bot token for outbound push (pairs with chat id) |
| `FORGEFRAME_TELEGRAM_CHAT_ID` | disabled | Telegram chat id to receive proactive pushes |

## Architecture

```
MCP Client (Claude Code, Claude Desktop, Cursor, etc.)
    |
    | stdio (JSON-RPC)
    |
@forgeframe/server
    |
    +-- tools/      12 MCP tools (8 memory + 4 session)
    +-- resources/  2 MCP resources (recent, search)
    +-- prompts/    1 MCP prompt (memory_context)
    +-- provenance  append-only JSONL audit trail
    +-- events      hook point for downstream extensions
    +-- daemon      HTTP server with REST API + SSE
    |
@forgeframe/memory
    |
    SQLite + FTS5 (local, no network)
```

## Part of [ForgeFrame](https://github.com/notaprompt/ForgeFrame)

The MCP interface to ForgeFrame's memory layer. Wraps `@forgeframe/memory` and exposes it as tools, resources, and prompts over the Model Context Protocol.

## License

MIT
