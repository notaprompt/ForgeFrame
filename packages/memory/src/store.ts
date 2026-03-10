/**
 * @forgeframe/memory — MemoryStore
 *
 * SQLite-backed persistent memory with FTS5 full-text search.
 * Handles storage, retrieval, decay, and access tracking.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { Memory, MemoryCreateInput, MemoryUpdateInput, MemoryConfig, Session, SessionCreateInput, SessionListOptions } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

export class MemoryStore {
  private _db: Database.Database;
  private _config: MemoryConfig;

  constructor(config: Partial<MemoryConfig> = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._db = new Database(this._config.dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');
    this._init();
  }

  private static readonly SCHEMA_VERSION = 1;

  private static readonly MIGRATIONS: Record<number, string> = {
    1: `
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding BLOB,
        strength REAL NOT NULL DEFAULT 1.0,
        access_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        session_id TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_memories_strength ON memories(strength);
      CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        content='memories',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(ended_at) WHERE ended_at IS NULL;
    `,
  };

  private _init(): void {
    const currentVersion = (this._db.pragma('user_version', { simple: true }) as number) ?? 0;

    for (let v = currentVersion + 1; v <= MemoryStore.SCHEMA_VERSION; v++) {
      const migration = MemoryStore.MIGRATIONS[v];
      if (!migration) throw new Error(`Missing migration for version ${v}`);
      this._db.exec(migration);
    }

    this._db.pragma(`user_version = ${MemoryStore.SCHEMA_VERSION}`);
  }

  create(input: MemoryCreateInput): Memory {
    const now = Date.now();
    const id = randomUUID();
    const embeddingBuf = input.embedding
      ? Buffer.from(new Float32Array(input.embedding).buffer)
      : null;

    this._db.prepare(`
      INSERT INTO memories (id, content, embedding, strength, access_count, created_at, last_accessed_at, session_id, tags, metadata)
      VALUES (?, ?, ?, 1.0, 0, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.content,
      embeddingBuf,
      now,
      now,
      input.sessionId || null,
      JSON.stringify(input.tags || []),
      JSON.stringify(input.metadata || {}),
    );

    return this.get(id)!;
  }

  update(id: string, input: MemoryUpdateInput): Memory | null {
    const existing = this.get(id);
    if (!existing) return null;

    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.content !== undefined) {
      sets.push('content = ?');
      params.push(input.content);
    }
    if (input.tags !== undefined) {
      sets.push('tags = ?');
      params.push(JSON.stringify(input.tags));
    }
    if (input.metadata !== undefined) {
      sets.push('metadata = ?');
      params.push(JSON.stringify(input.metadata));
    }

    if (sets.length === 0) return existing;

    params.push(id);
    this._db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    return this.get(id)!;
  }

  listByTag(tag: string, limit = 50): Memory[] {
    const rows = this._db.prepare(
      "SELECT * FROM memories WHERE tags LIKE ? ORDER BY created_at DESC LIMIT ?"
    ).all(`%${JSON.stringify(tag).slice(1, -1)}%`, limit) as any[];

    return rows.map((r) => this._rowToMemory(r)).filter((m) => m.tags.includes(tag));
  }

  get(id: string): Memory | null {
    const row = this._db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this._rowToMemory(row);
  }

  search(text: string, limit = 20): Memory[] {
    const rows = this._db.prepare(`
      SELECT m.* FROM memories m
      JOIN memories_fts f ON m.rowid = f.rowid
      WHERE memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(text, limit) as any[];

    return rows.map((r) => this._rowToMemory(r));
  }

  getBySession(sessionId: string): Memory[] {
    const rows = this._db.prepare(
      'SELECT * FROM memories WHERE session_id = ? ORDER BY created_at'
    ).all(sessionId) as any[];

    return rows.map((r) => this._rowToMemory(r));
  }

  recordAccess(id: string): void {
    this._db.prepare(`
      UPDATE memories SET access_count = access_count + 1, last_accessed_at = ?, strength = MIN(1.0, strength + 0.1)
      WHERE id = ?
    `).run(Date.now(), id);
  }

  applyDecay(): number {
    const dayMs = 86400000;
    const now = Date.now();

    const result = this._db.prepare(`
      UPDATE memories
      SET strength = MAX(?, strength - ? * ((? - last_accessed_at) / ?))
      WHERE strength > ?
    `).run(
      this._config.decayFloor,
      this._config.decayRate,
      now,
      dayMs,
      this._config.decayFloor,
    );

    return result.changes;
  }

  count(): number {
    const row = this._db.prepare('SELECT COUNT(*) as cnt FROM memories').get() as any;
    return row.cnt;
  }

  delete(id: string): boolean {
    const result = this._db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  getRecent(limit: number): Memory[] {
    const rows = this._db.prepare(
      'SELECT * FROM memories ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as any[];
    return rows.map((r) => this._rowToMemory(r));
  }

  startSession(input: SessionCreateInput = {}): Session {
    const id = randomUUID();
    const now = Date.now();
    this._db.prepare(
      'INSERT INTO sessions (id, started_at, metadata) VALUES (?, ?, ?)'
    ).run(id, now, JSON.stringify(input.metadata ?? {}));
    return this.getSession(id)!;
  }

  endSession(id: string): void {
    const session = this.getSession(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    if (session.endedAt !== null) throw new Error(`Session already ended: ${id}`);
    this._db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(Date.now(), id);
  }

  getSession(id: string): Session | null {
    const row = this._db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this._rowToSession(row);
  }

  listSessions(opts: SessionListOptions = {}): Session[] {
    const { status = 'all', limit = 50 } = opts;
    let sql = 'SELECT * FROM sessions';
    if (status === 'active') sql += ' WHERE ended_at IS NULL';
    else if (status === 'ended') sql += ' WHERE ended_at IS NOT NULL';
    sql += ' ORDER BY started_at DESC, rowid DESC LIMIT ?';
    const rows = this._db.prepare(sql).all(limit) as any[];
    return rows.map((r) => this._rowToSession(r));
  }

  getActiveSession(): Session | null {
    const row = this._db.prepare(
      'SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC, rowid DESC LIMIT 1'
    ).get() as any;
    if (!row) return null;
    return this._rowToSession(row);
  }

  deleteSession(id: string): boolean {
    this._db.prepare('DELETE FROM memories WHERE session_id = ?').run(id);
    const result = this._db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return result.changes > 0;
  }

  close(): void {
    this._db.close();
  }

  private _rowToMemory(row: any): Memory {
    return {
      id: row.id,
      content: row.content,
      embedding: row.embedding ? new Float32Array(row.embedding.buffer) : null,
      strength: row.strength,
      accessCount: row.access_count,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
      sessionId: row.session_id,
      tags: JSON.parse(row.tags),
      metadata: JSON.parse(row.metadata),
    };
  }

  private _rowToSession(row: any): Session {
    return {
      id: row.id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      metadata: JSON.parse(row.metadata),
    };
  }
}
