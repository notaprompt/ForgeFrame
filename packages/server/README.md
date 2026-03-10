# @forgeframe/server

MCP memory server that gives any MCP client persistent semantic memory across sessions. Local-first, SQLite-backed, no cloud dependency.

## Install

```bash
npm install @forgeframe/server
```

## Usage

### Run directly

```bash
npx @forgeframe/server
# or
npx forgeframe-memory
```

### Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "memory": {
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
    "memory": {
      "command": "npx",
      "args": ["-y", "@forgeframe/server"]
    }
  }
}
```

### Programmatic

```typescript
import { createServer } from '@forgeframe/server';

const { server, store, events } = createServer({
  dbPath: './my-memory.db',
  decayOnStartup: false,
});

events.on('memory:created', (memory) => {
  console.log('New memory:', memory.id);
});
```

## Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `memory_save` | Save a memory | `content` (string, required), `tags` (string[]), `metadata` (object) |
| `memory_search` | Search memories | `query` (string, required), `limit` (number), `tags` (string[]), `minStrength` (number) |
| `memory_list_recent` | List recent memories | `limit` (number, default 20) |
| `memory_update` | Update by ID | `id` (string, required), `content` (string), `tags` (string[]), `metadata` (object) |
| `memory_list_by_tag` | Filter by tag | `tag` (string, required), `limit` (number, default 50) |
| `memory_delete` | Delete by ID | `id` (string, required) |
| `memory_status` | Server status | none |
| `session_start` | Start new session | `metadata` (object) |
| `session_end` | End active session | none |
| `session_list` | List sessions | `status` (active/ended/all), `limit` (number, default 50) |
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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FORGEFRAME_DB_PATH` | `~/.forgeframe/memory.db` | SQLite database path |
| `FORGEFRAME_SESSION_ID` | auto-generated UUID | Session identifier |
| `FORGEFRAME_DECAY_ON_STARTUP` | `true` | Apply memory decay on start |
| `FORGEFRAME_PROVENANCE_PATH` | `~/.forgeframe/provenance.jsonl` | Audit log path |
| `FORGEFRAME_SERVER_NAME` | `forgeframe-memory` | Server name in MCP handshake |

## Architecture

```
MCP Client (Claude Desktop, Cursor, etc.)
    |
    | stdio (JSON-RPC)
    |
@forgeframe/server (this package)
    |
    |-- tools/      11 MCP tools (7 memory + 4 session)
    |-- resources/  2 MCP resources (recent, search)
    |-- prompts/    1 MCP prompt (memory_context)
    |-- provenance  append-only JSONL audit trail
    |-- events      hook point for downstream extensions
    |
@forgeframe/memory (MIT)
    |
    SQLite + FTS5 (local, no network)
```

## License

MIT
