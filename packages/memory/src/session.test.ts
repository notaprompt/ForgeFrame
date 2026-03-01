import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './store.js';

describe('MemoryStore — Sessions', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  describe('startSession', () => {
    it('returns a Session with default metadata', () => {
      const session = store.startSession();

      expect(session.id).toBeTypeOf('string');
      expect(session.startedAt).toBeTypeOf('number');
      expect(session.endedAt).toBeNull();
      expect(session.metadata).toEqual({});
    });

    it('stores provided metadata', () => {
      const session = store.startSession({ metadata: { env: 'test', tier: 3 } });

      expect(session.metadata).toEqual({ env: 'test', tier: 3 });
    });
  });

  describe('getSession', () => {
    it('returns session when found', () => {
      const created = store.startSession();
      const found = store.getSession(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.startedAt).toBe(created.startedAt);
    });

    it('returns null when not found', () => {
      expect(store.getSession('nonexistent-id')).toBeNull();
    });
  });

  describe('endSession', () => {
    it('sets endedAt timestamp', () => {
      const session = store.startSession();
      store.endSession(session.id);

      const ended = store.getSession(session.id)!;
      expect(ended.endedAt).toBeTypeOf('number');
      expect(ended.endedAt).not.toBeNull();
    });

    it('throws on missing session', () => {
      expect(() => store.endSession('nonexistent')).toThrow('Session not found');
    });

    it('throws on already ended session', () => {
      const session = store.startSession();
      store.endSession(session.id);

      expect(() => store.endSession(session.id)).toThrow('Session already ended');
    });
  });

  describe('getActiveSession', () => {
    it('returns the most recent active session', () => {
      const s1 = store.startSession();
      const s2 = store.startSession();

      const active = store.getActiveSession();
      expect(active).not.toBeNull();
      expect(active!.id).toBe(s2.id);
    });

    it('returns null when no active sessions', () => {
      const session = store.startSession();
      store.endSession(session.id);

      expect(store.getActiveSession()).toBeNull();
    });
  });

  describe('listSessions', () => {
    it('returns all sessions by default', () => {
      const s1 = store.startSession();
      const s2 = store.startSession();
      store.endSession(s1.id);

      const all = store.listSessions();
      expect(all.length).toBe(2);
    });

    it('filters active sessions', () => {
      const s1 = store.startSession();
      store.startSession();
      store.endSession(s1.id);

      const active = store.listSessions({ status: 'active' });
      expect(active.length).toBe(1);
      expect(active[0].endedAt).toBeNull();
    });

    it('filters ended sessions', () => {
      const s1 = store.startSession();
      store.startSession();
      store.endSession(s1.id);

      const ended = store.listSessions({ status: 'ended' });
      expect(ended.length).toBe(1);
      expect(ended[0].endedAt).not.toBeNull();
    });

    it('respects limit', () => {
      store.startSession();
      store.startSession();
      store.startSession();

      const limited = store.listSessions({ limit: 2 });
      expect(limited.length).toBe(2);
    });

    it('returns newest first', () => {
      const s1 = store.startSession();
      const s2 = store.startSession();

      const all = store.listSessions();
      expect(all[0].id).toBe(s2.id);
      expect(all[1].id).toBe(s1.id);
    });
  });

  describe('deleteSession', () => {
    it('returns true and removes the session', () => {
      const session = store.startSession();
      expect(store.deleteSession(session.id)).toBe(true);
      expect(store.getSession(session.id)).toBeNull();
    });

    it('returns false for missing session', () => {
      expect(store.deleteSession('nonexistent')).toBe(false);
    });

    it('cascades to memories with matching sessionId', () => {
      const session = store.startSession();
      store.create({ content: 'session memory', sessionId: session.id });
      store.create({ content: 'other memory', sessionId: 'other-session' });

      store.deleteSession(session.id);

      expect(store.count()).toBe(1);
      expect(store.getRecent(10)[0].content).toBe('other memory');
    });
  });
});
