# ForgeFrame

Local intelligence infrastructure. Routing, memory, provenance. Local-first.

## Architecture

Monorepo with npm workspaces. Three packages:

- `packages/memory/` (MIT) -- persistent semantic memory with SQLite + FTS5, weighted retrieval, strength decay
- `packages/core/` (AGPL) -- tier-based model routing, provider registry, SSE normalization
- `packages/server/` (MIT) -- MCP memory server wrapping @forgeframe/memory, exposes 11 tools (7 memory + 4 session), 2 resources, 1 prompt over stdio

## Stack

- TypeScript, strict mode, ESM modules
- Node.js 20+
- npm workspaces (not pnpm)
- better-sqlite3 for storage
- Zero frontend dependencies -- this is a backend/service package

## Code style

- No emojis in code, commits, or output
- No speculative features or unnecessary abstractions
- Match existing patterns before introducing new ones
- Minimal code that solves the problem
- Every changed line traces to the request

## Commit format

```
[short description]

[optional body]
```

No links in commit bodies.

## Build

```
npm install
npm run build
```

All four packages must compile clean with zero errors.

## Development workflow

Use the custom skills:
- `/plan [feature]` -- create a spec-driven implementation plan
- `/execute [plan]` -- run plan tasks via subagents
- `/verify [plan]` -- verify completed work against criteria
- `/status` -- show project state

Plans live in `.claude/plans/`. Tasks execute in waves (parallel within wave, sequential across waves).
