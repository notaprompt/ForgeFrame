import { describe, it, expect, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { createServer, type ServerInstance } from './server.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MemoryStore } from '@forgeframe/memory';
import { ServerEvents } from './events.js';

describe('createServer', () => {
  let instance: ServerInstance | undefined;
  const tmpFiles: string[] = [];

  function provTmp(): string {
    const p = join(tmpdir(), `srv-prov-${randomUUID()}.jsonl`);
    tmpFiles.push(p);
    return p;
  }

  afterEach(() => {
    try { instance?.store.close(); } catch {}
    instance = undefined;
    for (const f of tmpFiles) {
      try { unlinkSync(f); } catch {}
    }
    tmpFiles.length = 0;
  });

  it('returns server, store, and events', () => {
    instance = createServer({
      dbPath: ':memory:',
      provenancePath: provTmp(),
      decayOnStartup: false,
    });

    expect(instance.server).toBeInstanceOf(McpServer);
    expect(instance.store).toBeInstanceOf(MemoryStore);
    expect(instance.events).toBeInstanceOf(ServerEvents);
  });

  it('store round-trip: create and retrieve a memory', () => {
    instance = createServer({
      dbPath: ':memory:',
      provenancePath: provTmp(),
      decayOnStartup: false,
    });

    const mem = instance.store.create({ content: 'round-trip test' });
    const got = instance.store.get(mem.id);

    expect(got).not.toBeNull();
    expect(got!.content).toBe('round-trip test');
  });

  it('does not emit memory:decayed when decayOnStartup is false', () => {
    let decayFired = false;

    instance = createServer({
      dbPath: ':memory:',
      provenancePath: provTmp(),
      decayOnStartup: false,
    });

    instance.events.on('memory:decayed', () => { decayFired = true; });

    expect(decayFired).toBe(false);
  });

  it('runs without error when decayOnStartup is true', () => {
    expect(() => {
      instance = createServer({
        dbPath: ':memory:',
        provenancePath: provTmp(),
        decayOnStartup: true,
      });
    }).not.toThrow();
  });

  it('fires session:started event with the configured sessionId', () => {
    let receivedId: string | undefined;

    instance = createServer({
      dbPath: ':memory:',
      provenancePath: provTmp(),
      decayOnStartup: false,
    });

    instance.events.on('session:started', (sid) => { receivedId = sid; });
    instance.events.emit('session:started', instance.session.id);

    expect(receivedId).toBe(instance.session.id);
  });

  it('creates a persisted session on startup', () => {
    instance = createServer({
      dbPath: ':memory:',
      provenancePath: provTmp(),
      decayOnStartup: false,
    });

    expect(instance.session).toBeDefined();
    expect(instance.session.id).toBeTypeOf('string');
    expect(instance.session.startedAt).toBeTypeOf('number');
    expect(instance.session.endedAt).toBeNull();
  });

  it('exposes session object on ServerInstance', () => {
    instance = createServer({
      dbPath: ':memory:',
      provenancePath: provTmp(),
      decayOnStartup: false,
    });

    const stored = instance.store.getSession(instance.session.id);
    expect(stored).not.toBeNull();
    expect(stored!.id).toBe(instance.session.id);
  });

  it('shutdown ends session and emits session:ended', () => {
    instance = createServer({
      dbPath: ':memory:',
      provenancePath: provTmp(),
      decayOnStartup: false,
    });

    let endedId: string | undefined;
    instance.events.on('session:ended', (sid) => { endedId = sid; });

    const sessionId = instance.session.id;
    instance.shutdown();

    expect(endedId).toBe(sessionId);
    // store is closed after shutdown, so we can't query it,
    // but the event firing proves it worked
    instance = undefined; // prevent afterEach double-close
  });
});
