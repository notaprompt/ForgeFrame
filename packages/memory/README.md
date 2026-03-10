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

const store = new MemoryStore({ dbPath: './memory.db' });
const retriever = new MemoryRetriever(store);

// Create a memory
store.create({ content: 'User prefers dark mode', tags: ['preference'] });

// Search
const results = retriever.query({ text: 'dark mode', limit: 5 });

// Sessions
const session = store.startSession();
store.endSession(session.id);
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
