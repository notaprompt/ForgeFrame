# @forgeframe/memory

Persistent semantic memory with weighted retrieval, strength decay, and session tracking. SQLite-backed. Local-first.

## Install

```bash
npm install @forgeframe/memory
```

## Usage

```typescript
import { MemoryStore, MemoryRetriever, OllamaEmbedder } from '@forgeframe/memory';

const store = new MemoryStore({ dbPath: './memory.db' });

// Save a memory
const memory = store.create({
  content: 'User prefers dark mode',
  tags: ['preference'],
  metadata: { source: 'settings' },
});

// Search with FTS5
const results = store.search('dark mode', 10);

// Weighted retrieval (FTS + strength scoring)
const retriever = new MemoryRetriever(store);
const ranked = retriever.query({ text: 'dark mode', limit: 5, minStrength: 0.3 });

// Sessions
const session = store.startSession({ metadata: { agent: 'builder' } });
store.endSession(session.id);
```

## API

### MemoryStore

The core storage engine. Manages memories and sessions in SQLite with FTS5.

| Method | Description |
|--------|-------------|
| `create(input: MemoryCreateInput)` | Save a new memory. Returns `Memory`. |
| `get(id: string)` | Get memory by ID. |
| `update(id: string, input: MemoryUpdateInput)` | Update content, tags, or metadata. |
| `delete(id: string)` | Delete a memory. |
| `search(text: string, limit?: number)` | FTS5 full-text search. |
| `listByTag(tag: string, limit?: number)` | Filter memories by tag. |
| `listRecent(limit?: number)` | Most recent memories. |
| `getBySession(sessionId: string)` | All memories in a session. |
| `recordAccess(id: string)` | Bump access count and strength. |
| `applyDecay()` | Reduce strength of all non-constitutional memories. |
| `startSession(input?: SessionCreateInput)` | Start a new session. Returns `Session`. |
| `endSession(id: string)` | End a session. |
| `listSessions(options?: SessionListOptions)` | List sessions by status. |

### MemoryRetriever

Combines FTS keyword search with strength-weighted scoring. Optionally uses embeddings for semantic similarity.

| Method | Description |
|--------|-------------|
| `query(q: MemoryQuery)` | Search, score, and rank memories. Returns `MemoryResult[]`. |

### OllamaEmbedder

Generates embeddings via a local Ollama instance.

| Method | Description |
|--------|-------------|
| `embed(text: string)` | Returns `number[]` embedding vector. |
| `isAvailable()` | Check if Ollama is reachable. |

## Configuration

```typescript
const store = new MemoryStore({
  dbPath: './memory.db',      // SQLite file path
  decayRate: 0.02,            // Strength reduction per day (0.0-1.0)
  decayFloor: 0.1,            // Minimum strength after decay
  consolidationThreshold: 100, // Min memories before consolidation
  embeddingDimension: 768,    // Vector dimension (matches nomic-embed-text)
});
```

Constitutional tags (`principle`, `voice`) are exempt from decay. These form the identity kernel -- they persist indefinitely.

## Part of [ForgeFrame](https://github.com/notaprompt/ForgeFrame)

The local-first memory primitive. Used by `@forgeframe/server` to expose memory over MCP, and by `@forgeframe/proxy` for context injection.

## License

MIT
