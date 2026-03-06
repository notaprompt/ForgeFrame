# @forgeframe/memory

Persistent semantic memory with weighted retrieval. Local-first. SQLite-backed.

## What it does

Stores memories in a local SQLite database with FTS5 full-text search. Memories have strength scores that decay over time -- frequently accessed memories persist, neglected ones fade. Sessions group related memories and track lifecycle.

## Install

```bash
npm install @forgeframe/memory
```

## Usage

```typescript
import { MemoryStore, MemoryRetriever } from '@forgeframe/memory';

const store = new MemoryStore('./memory.db');
const retriever = new MemoryRetriever(store);

// Save a memory
store.save({ content: 'User prefers dark mode', tags: ['preference'] });

// Search
const results = retriever.search({ query: 'dark mode', limit: 5 });

// Sessions
store.startSession();
store.endSession();
```

## Features

- SQLite + FTS5 full-text search
- Weighted retrieval (recency + access frequency)
- Configurable strength decay
- Session-scoped and cross-session queries
- Extension point for embedding-based semantic search
- Zero cloud dependency

## License

MIT
