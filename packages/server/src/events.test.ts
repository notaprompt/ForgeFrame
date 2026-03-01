import { describe, it, expect } from 'vitest';
import { ServerEvents } from './events.js';
import type { Memory } from '@forgeframe/memory';

function fakeMemory(id = 'mem-1'): Memory {
  return {
    id,
    content: 'test',
    embedding: null,
    strength: 1.0,
    accessCount: 0,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    sessionId: null,
    tags: [],
    metadata: {},
  };
}

describe('ServerEvents', () => {
  it('emits and receives memory:created', () => {
    const events = new ServerEvents();
    const mem = fakeMemory();
    let received: Memory | undefined;

    events.on('memory:created', (m) => { received = m; });
    events.emit('memory:created', mem);

    expect(received).toBe(mem);
  });

  it('emits and receives memory:deleted', () => {
    const events = new ServerEvents();
    let received: string | undefined;

    events.on('memory:deleted', (id) => { received = id; });
    events.emit('memory:deleted', 'del-1');

    expect(received).toBe('del-1');
  });

  it('emits and receives session:started', () => {
    const events = new ServerEvents();
    let received: string | undefined;

    events.on('session:started', (sid) => { received = sid; });
    events.emit('session:started', 'sess-abc');

    expect(received).toBe('sess-abc');
  });

  it('emits and receives memory:decayed', () => {
    const events = new ServerEvents();
    let received: number | undefined;

    events.on('memory:decayed', (count) => { received = count; });
    events.emit('memory:decayed', 42);

    expect(received).toBe(42);
  });
});
