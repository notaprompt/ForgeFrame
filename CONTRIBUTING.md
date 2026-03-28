# Contributing to ForgeFrame

## Prerequisites

- Node.js 20+
- npm (not pnpm or yarn)
- Git

## Setup

```bash
git clone https://github.com/notaprompt/ForgeFrame.git
cd ForgeFrame
npm install
npm run build
npm test
```

## Architecture

Monorepo with npm workspaces. Four packages:

| Package | License | Description |
|---------|---------|-------------|
| `packages/memory` | MIT | SQLite + FTS5 memory store, embeddings, sessions |
| `packages/server` | MIT | MCP server, HTTP API, daemon, CLI |
| `packages/core` | AGPL-3.0 | Model routing, provider registry |
| `packages/proxy` | AGPL-3.0 | PII scrub pipeline |

## Code Style

- TypeScript strict mode, ESM modules
- No emojis in code, commits, or output
- No speculative features or unnecessary abstractions
- Match existing patterns before introducing new ones
- Minimal code that solves the problem
- Every changed line traces to the request

## Commit Format

```
[short description]

[optional body]
```

No links in commit bodies. No co-author tags unless requested.

## Testing

```bash
npm test              # run all tests
npm test -- --watch   # watch mode
```

All tests use Vitest. Tests live alongside source files (`*.test.ts`).

## Pull Requests

- One logical change per PR
- All tests must pass
- All packages must compile clean (`npm run build`)
- Describe what changed and why

## License

By contributing, you agree that your contributions will be licensed under the same license as the package you are modifying (MIT for memory/server, AGPL-3.0 for core/proxy).
