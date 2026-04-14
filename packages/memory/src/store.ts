/**
 * @forgeframe/memory — MemoryStore
 *
 * SQLite-backed persistent memory with FTS5 full-text search.
 * Handles storage, retrieval, decay, and access tracking.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { Memory, MemoryCreateInput, MemoryUpdateInput, MemoryConfig, ReconsolidationOptions, Session, SessionCreateInput, SessionListOptions, DistilledArtifact, DistilledArtifactInput, MemoryEdge, EdgeCreateInput, ConsolidationCluster, ConsolidationProposal, ContradictionProposal, Valence } from './types.js';
import { DEFAULT_CONFIG, TRIM_TAGS, CONSTITUTIONAL_TAGS, MEMORY_TYPE_STABILITY_MULTIPLIER } from './types.js';

export class MemoryStore {
  private _db: Database.Database;
  private _config: MemoryConfig;

  constructor(config: Partial<MemoryConfig> = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._db = new Database(this._config.dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');
    this._db.pragma('busy_timeout = 5000');
    this._init();
  }

  private static readonly SCHEMA_VERSION = 9;

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
    2: `
      ALTER TABLE memories ADD COLUMN last_decay_at INTEGER;
      UPDATE memories SET last_decay_at = last_accessed_at;
    `,
    3: `
      ALTER TABLE memories ADD COLUMN retrieval_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE memories ADD COLUMN associations TEXT NOT NULL DEFAULT '[]';
    `,
    4: `
      CREATE TABLE IF NOT EXISTS distilled_artifacts (
        id            TEXT PRIMARY KEY,
        source_url    TEXT,
        source_type   TEXT NOT NULL,
        raw_hash      TEXT NOT NULL,
        distilled     TEXT,
        refined       TEXT,
        organ_chain   TEXT DEFAULT '[]',
        memory_id     TEXT,
        tags          TEXT DEFAULT '[]',
        created_at    INTEGER NOT NULL,
        fed_to_memory INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_distilled_source ON distilled_artifacts(source_type);
      CREATE INDEX IF NOT EXISTS idx_distilled_unfed ON distilled_artifacts(fed_to_memory) WHERE fed_to_memory IS NULL;
      CREATE INDEX IF NOT EXISTS idx_distilled_hash ON distilled_artifacts(raw_hash);
    `,
    5: `
      CREATE TABLE IF NOT EXISTS memory_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        created_at INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        UNIQUE(source_id, target_id, relation_type)
      );

      CREATE INDEX IF NOT EXISTS idx_edges_source ON memory_edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON memory_edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_edges_type ON memory_edges(relation_type);

      ALTER TABLE memories ADD COLUMN valid_from INTEGER;
      ALTER TABLE memories ADD COLUMN superseded_by TEXT;
      ALTER TABLE memories ADD COLUMN superseded_at INTEGER;
      ALTER TABLE memories ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'semantic';
      ALTER TABLE memories ADD COLUMN readiness REAL NOT NULL DEFAULT 0;
    `,
    6: `
      ALTER TABLE memory_edges ADD COLUMN last_hebbian_at INTEGER;
    `,
    7: `
      CREATE TABLE IF NOT EXISTS consolidation_proposals (
        id TEXT PRIMARY KEY,
        cluster_memory_ids TEXT NOT NULL,
        cluster_avg_weight REAL NOT NULL,
        cluster_edge_count INTEGER NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        suggested_tags TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        depth INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        rejected_until INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_proposals_status ON consolidation_proposals(status);
    `,
    8: `
      CREATE TABLE IF NOT EXISTS contradiction_proposals (
        id TEXT PRIMARY KEY,
        memory_a_id TEXT NOT NULL,
        memory_b_id TEXT NOT NULL,
        edge_id TEXT NOT NULL,
        analysis TEXT NOT NULL,
        is_constitutional_tension INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        resolution TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_contradiction_status ON contradiction_proposals(status);
    `,
    9: `
      ALTER TABLE memories ADD COLUMN valence TEXT NOT NULL DEFAULT 'neutral';
      UPDATE memories SET valence = 'grounding'
        WHERE tags LIKE '%"principle"%' OR tags LIKE '%"voice"%';
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
    if (input.tags?.length) this._validateTags(input.tags);
    const now = Date.now();
    const id = randomUUID();
    const embeddingBuf = input.embedding
      ? Buffer.from(new Float32Array(input.embedding).buffer)
      : null;

    // Constitutional tags always get grounding, regardless of what was passed
    const tags = input.tags || [];
    const isConstitutional = tags.some(t => t === 'principle' || t === 'voice');
    const valence: Valence = isConstitutional ? 'grounding' : (input.valence ?? 'neutral');

    this._db.prepare(`
      INSERT INTO memories (id, content, embedding, strength, access_count, created_at, last_accessed_at, session_id, tags, metadata, valence)
      VALUES (?, ?, ?, 1.0, 0, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.content,
      embeddingBuf,
      now,
      now,
      input.sessionId || null,
      JSON.stringify(tags),
      JSON.stringify(input.metadata || {}),
      valence,
    );

    return this.get(id)!;
  }

  update(id: string, input: MemoryUpdateInput): Memory | null {
    if (input.tags?.length) this._validateTags(input.tags);
    const existing = this.get(id);
    if (!existing) return null;

    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.content !== undefined) {
      sets.push('content = ?');
      params.push(input.content);
    }
    if (input.embedding !== undefined) {
      sets.push('embedding = ?');
      params.push(Buffer.from(new Float32Array(input.embedding).buffer));
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
    return this._searchWithRank(text, limit).map((r) => r.memory);
  }

  searchWithRank(text: string, limit = 20): Array<{ memory: Memory; bm25Rank: number }> {
    return this._searchWithRank(text, limit);
  }

  private _searchWithRank(text: string, limit: number): Array<{ memory: Memory; bm25Rank: number }> {
    // Sanitize FTS5 input: strip special characters, build OR query with prefix matching
    const terms = text
      .replace(/[^\w\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (terms.length === 0) return [];

    // OR semantics: any term matches; prefix matching: "term"* matches partials
    const ftsQuery = terms.map((t) => `"${t}"*`).join(' OR ');

    const rows = this._db.prepare(`
      SELECT m.*, f.rank as bm25_rank FROM memories m
      JOIN memories_fts f ON m.rowid = f.rowid
      WHERE memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as any[];

    return rows.map((r) => ({ memory: this._rowToMemory(r), bm25Rank: r.bm25_rank as number }));
  }

  getBySession(sessionId: string): Memory[] {
    const rows = this._db.prepare(
      'SELECT * FROM memories WHERE session_id = ? ORDER BY created_at'
    ).all(sessionId) as any[];

    return rows.map((r) => this._rowToMemory(r));
  }

  recordAccess(id: string): void {
    this._db.prepare(`
      UPDATE memories SET access_count = access_count + 1, last_accessed_at = ?
      WHERE id = ?
    `).run(Date.now(), id);
  }

  /**
   * Reconsolidate a memory after retrieval.
   * Restores strength based on relevance, tracks associations and query context,
   * increments retrievalCount, and resets the decay clock.
   */
  reconsolidate(id: string, opts: ReconsolidationOptions): void {
    const now = Date.now();
    const mem = this.get(id);
    if (!mem) return;

    // Strength restoration: high relevance restores half the gap to 1.0,
    // low relevance gives a smaller proportional bump
    const restorationFactor = opts.relevanceScore > 0.5 ? 0.5 : 0.15;
    const newStrength = Math.min(1.0, mem.strength + (1.0 - mem.strength) * restorationFactor);

    // Association merge (keep unique, cap at 20)
    const existingAssociations = new Set(mem.associations);
    if (opts.coRetrievedIds) {
      for (const coId of opts.coRetrievedIds) {
        if (coId !== id) existingAssociations.add(coId);
      }
    }
    const associations = [...existingAssociations].slice(-20);

    // Update metadata with last retrieval query
    const metadata = { ...mem.metadata };
    if (opts.query) {
      metadata.lastRetrievalQuery = opts.query;
      metadata.lastRetrievedAt = now;
    }

    this._db.prepare(`
      UPDATE memories
      SET strength = ?,
          access_count = access_count + 1,
          retrieval_count = retrieval_count + 1,
          last_accessed_at = ?,
          last_decay_at = ?,
          associations = ?,
          metadata = ?
      WHERE id = ?
    `).run(
      newStrength,
      now,
      now,
      JSON.stringify(associations),
      JSON.stringify(metadata),
      id,
    );
  }

  /**
   * Apply strength decay to all non-constitutional memories.
   * Constitutional tags (principle, voice) are excluded at the SQL level
   * to avoid race conditions in multi-process environments.
   */
  applyDecay(): number {
    const dayMs = 86400000;
    const now = Date.now();

    // Exclude constitutional memories directly in the WHERE clause.
    // This avoids the decay-then-restore pattern which races under concurrency.
    const constitutionalPatterns = CONSTITUTIONAL_TAGS.map(
      (tag) => `%${JSON.stringify(tag).slice(1, -1)}%`
    );
    const excludeClauses = constitutionalPatterns.map(() => 'tags NOT LIKE ?').join(' AND ');

    // Fetch all decayable memories
    const rows = this._db.prepare(`
      SELECT id, strength, access_count, last_accessed_at, last_decay_at, memory_type
      FROM memories
      WHERE strength > ? AND ${excludeClauses}
    `).all(this._config.decayFloor, ...constitutionalPatterns) as any[];

    const updateStmt = this._db.prepare(
      'UPDATE memories SET strength = ?, last_decay_at = ? WHERE id = ?'
    );

    const transaction = this._db.transaction(() => {
      let changed = 0;
      for (const row of rows) {
        const lastDecay = row.last_decay_at ?? row.last_accessed_at;
        const daysSinceDecay = (now - lastDecay) / dayMs;
        if (daysSinceDecay <= 0) continue;

        const typeMultiplier = MEMORY_TYPE_STABILITY_MULTIPLIER[row.memory_type] ?? 1.0;
        const stability = this._config.baseStability
          * (1 + row.access_count * this._config.accessMultiplier)
          * typeMultiplier;
        const newStrength = Math.max(
          this._config.decayFloor,
          row.strength * Math.exp(-daysSinceDecay * Math.LN2 / stability)
        );

        if (newStrength !== row.strength) {
          updateStmt.run(newStrength, now, row.id);
          changed++;
        }
      }
      return changed;
    });

    return transaction();
  }

  resetStrength(id: string, strength = 1.0): void {
    this._db.prepare(
      'UPDATE memories SET strength = ?, last_accessed_at = ? WHERE id = ?'
    ).run(strength, Date.now(), id);
  }

  count(): number {
    const row = this._db.prepare('SELECT COUNT(*) as cnt FROM memories').get() as any;
    return row.cnt;
  }

  delete(id: string): boolean {
    const result = this._db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  getAllEmbeddings(): Array<{ id: string; embedding: Float32Array }> {
    const rows = this._db.prepare(
      'SELECT id, embedding FROM memories WHERE embedding IS NOT NULL'
    ).all() as any[];

    return rows.map((r) => ({
      id: r.id,
      embedding: new Float32Array(r.embedding.buffer),
    }));
  }

  getWithoutEmbedding(limit: number): Memory[] {
    const rows = this._db.prepare(
      'SELECT * FROM memories WHERE embedding IS NULL ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as any[];
    return rows.map((r) => this._rowToMemory(r));
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

  isSessionEnded(id: string): boolean {
    const session = this.getSession(id);
    return !session || session.endedAt !== null;
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

  /**
   * Check if a memory has any constitutional tags (exempt from decay).
   */
  hasConstitutionalTag(memory: Memory): boolean {
    return memory.tags.some((t) => (CONSTITUTIONAL_TAGS as readonly string[]).includes(t));
  }

  /**
   * Find a near-duplicate of the given content using FTS5 candidate search
   * and longest-common-substring overlap. Returns the matching memory or null.
   */
  findDuplicate(content: string, threshold = 0.8): Memory | null {
    // Quick FTS check using first 200 chars
    const candidates = this.search(content.slice(0, 200), 5);
    if (candidates.length === 0) return null;

    for (const candidate of candidates) {
      const shorter = Math.min(content.length, candidate.content.length);
      const longer = Math.max(content.length, candidate.content.length);
      if (shorter / longer > threshold) {
        const overlap = longestCommonSubstring(content, candidate.content);
        if (overlap / shorter > threshold) return candidate;
      }
    }

    return null;
  }

  /**
   * Merge new content into an existing memory.
   * Updates content to the newer version, unions tags, bumps access count
   * and strength.
   */
  merge(targetId: string, sourceContent: string, sourceTags: string[]): Memory | null {
    const target = this.get(targetId);
    if (!target) return null;

    if (sourceTags.length) this._validateTags(sourceTags);
    const mergedTags = [...new Set([...target.tags, ...sourceTags])];

    this._db.prepare(`
      UPDATE memories
      SET content = ?,
          tags = ?,
          access_count = access_count + 1,
          strength = MIN(1.0, strength + 0.1),
          last_accessed_at = ?
      WHERE id = ?
    `).run(sourceContent, JSON.stringify(mergedTags), Date.now(), targetId);

    return this.get(targetId);
  }

  // -- Distilled Artifacts --

  createArtifact(input: DistilledArtifactInput): DistilledArtifact {
    const id = randomUUID();
    const now = Date.now();

    this._db.prepare(`
      INSERT INTO distilled_artifacts (id, source_url, source_type, raw_hash, distilled, refined, organ_chain, memory_id, tags, created_at, fed_to_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
    `).run(
      id,
      input.sourceUrl ?? null,
      input.sourceType,
      input.rawHash,
      input.distilled ?? null,
      input.refined ?? null,
      JSON.stringify(input.organChain ?? []),
      JSON.stringify(input.tags ?? []),
      now,
    );

    return this.getArtifact(id)!;
  }

  getArtifact(id: string): DistilledArtifact | null {
    const row = this._db.prepare('SELECT * FROM distilled_artifacts WHERE id = ?').get(id) as any;
    return row ? this._rowToArtifact(row) : null;
  }

  getArtifactByHash(rawHash: string): DistilledArtifact | null {
    const row = this._db.prepare('SELECT * FROM distilled_artifacts WHERE raw_hash = ?').get(rawHash) as any;
    return row ? this._rowToArtifact(row) : null;
  }

  getUnfedArtifacts(limit = 50): DistilledArtifact[] {
    const rows = this._db.prepare(
      'SELECT * FROM distilled_artifacts WHERE fed_to_memory IS NULL ORDER BY created_at ASC LIMIT ?',
    ).all(limit) as any[];
    return rows.map((r) => this._rowToArtifact(r));
  }

  markArtifactFed(id: string, memoryId: string): void {
    this._db.prepare(
      'UPDATE distilled_artifacts SET fed_to_memory = ?, memory_id = ? WHERE id = ?',
    ).run(Date.now(), memoryId, id);
  }

  // -- Edge CRUD --

  createEdge(input: EdgeCreateInput): MemoryEdge {
    const id = randomUUID();
    const now = Date.now();
    this._db.prepare(`
      INSERT INTO memory_edges (id, source_id, target_id, relation_type, weight, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.sourceId,
      input.targetId,
      input.relationType,
      input.weight ?? 1.0,
      now,
      JSON.stringify(input.metadata ?? {}),
    );
    return this.getEdge(id)!;
  }

  getEdge(id: string): MemoryEdge | null {
    const row = this._db.prepare('SELECT * FROM memory_edges WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this._rowToEdge(row);
  }

  getEdges(memoryId: string): MemoryEdge[] {
    const rows = this._db.prepare(
      'SELECT * FROM memory_edges WHERE source_id = ? OR target_id = ? ORDER BY created_at'
    ).all(memoryId, memoryId) as any[];
    return rows.map((r) => this._rowToEdge(r));
  }

  getEdgesByType(memoryId: string, relationType: string): MemoryEdge[] {
    const rows = this._db.prepare(
      'SELECT * FROM memory_edges WHERE (source_id = ? OR target_id = ?) AND relation_type = ? ORDER BY created_at'
    ).all(memoryId, memoryId, relationType) as any[];
    return rows.map((r) => this._rowToEdge(r));
  }

  getEdgesByType_global(relationType: string): MemoryEdge[] {
    const rows = this._db.prepare(
      'SELECT * FROM memory_edges WHERE relation_type = ? ORDER BY created_at'
    ).all(relationType) as any[];
    return rows.map((r) => this._rowToEdge(r));
  }

  deleteEdge(id: string): boolean {
    const result = this._db.prepare('DELETE FROM memory_edges WHERE id = ?').run(id);
    return result.changes > 0;
  }

  updateEdgeWeight(edgeId: string, weight: number): void {
    this._db.prepare(
      'UPDATE memory_edges SET weight = ?, last_hebbian_at = ? WHERE id = ?'
    ).run(weight, Date.now(), edgeId);
  }

  getEdgeBetween(memoryId1: string, memoryId2: string): MemoryEdge | null {
    const row = this._db.prepare(`
      SELECT * FROM memory_edges
      WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
      LIMIT 1
    `).get(memoryId1, memoryId2, memoryId2, memoryId1) as any;
    return row ? this._rowToEdge(row) : null;
  }

  getEdgesBetween(memoryId1: string, memoryId2: string): MemoryEdge[] {
    const rows = this._db.prepare(`
      SELECT * FROM memory_edges
      WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
    `).all(memoryId1, memoryId2, memoryId2, memoryId1) as any[];
    return rows.map((r) => this._rowToEdge(r));
  }

  getAllEdgeWeights(): number[] {
    const rows = this._db.prepare('SELECT weight FROM memory_edges').all() as any[];
    return rows.map((r) => r.weight);
  }

  edgeCount(): number {
    const row = this._db.prepare('SELECT COUNT(*) as cnt FROM memory_edges').get() as any;
    return row.cnt;
  }

  getSubgraph(memoryId: string, hops: number): { nodes: Memory[]; edges: MemoryEdge[] } {
    const visitedNodes = new Set<string>([memoryId]);
    const visitedEdges = new Set<string>();
    const edgeList: MemoryEdge[] = [];
    let frontier = [memoryId];

    for (let hop = 0; hop < hops; hop++) {
      const nextFrontier: string[] = [];
      for (const nodeId of frontier) {
        const edges = this.getEdges(nodeId);
        for (const edge of edges) {
          if (!visitedEdges.has(edge.id)) {
            visitedEdges.add(edge.id);
            edgeList.push(edge);
          }
          const neighborId = edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
          if (!visitedNodes.has(neighborId)) {
            visitedNodes.add(neighborId);
            nextFrontier.push(neighborId);
          }
        }
      }
      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    const nodes = [...visitedNodes].map((id) => this.get(id)).filter(Boolean) as Memory[];
    return { nodes, edges: edgeList };
  }

  supersede(oldId: string, newId: string): void {
    const now = Date.now();
    this._db.prepare(
      'UPDATE memories SET superseded_by = ?, superseded_at = ? WHERE id = ?'
    ).run(newId, now, oldId);
    this._db.prepare(
      'UPDATE memories SET valid_from = ? WHERE id = ?'
    ).run(now, newId);
    this.createEdge({ sourceId: newId, targetId: oldId, relationType: 'supersedes' });
  }

  getSupersessionChain(memoryId: string): Memory[] {
    const chain: Memory[] = [];
    let current = this.get(memoryId);
    while (current) {
      chain.push(current);
      // Follow supersedes edges: find edge where source=current AND type=supersedes
      const edges = this.getEdgesByType(current.id, 'supersedes');
      const outgoing = edges.find((e) => e.sourceId === current!.id);
      if (!outgoing) break;
      current = this.get(outgoing.targetId);
    }
    return chain;
  }

  promote(memoryId: string): Memory | null {
    const mem = this.get(memoryId);
    if (!mem) return null;
    this._db.prepare(
      "UPDATE memories SET memory_type = 'artifact', readiness = 0 WHERE id = ?"
    ).run(memoryId);
    return this.get(memoryId);
  }

  getArtifactMemories(): Memory[] {
    const rows = this._db.prepare(
      "SELECT * FROM memories WHERE memory_type = 'artifact' ORDER BY created_at DESC"
    ).all() as any[];
    return rows.map((r) => this._rowToMemory(r));
  }

  setReadiness(memoryId: string, readiness: number): void {
    const clamped = Math.max(0, Math.min(1, readiness));
    this._db.prepare('UPDATE memories SET readiness = ? WHERE id = ?').run(clamped, memoryId);
  }

  shipArtifact(memoryId: string): Memory | null {
    const mem = this.get(memoryId);
    if (!mem) return null;
    const now = Date.now();
    const metadata = { ...mem.metadata, shipped: true, shippedAt: now };
    this._db.prepare(
      'UPDATE memories SET readiness = 1, metadata = ? WHERE id = ?'
    ).run(JSON.stringify(metadata), memoryId);
    return this.get(memoryId);
  }

  orphanCount(): number {
    const row = this._db.prepare(`
      SELECT COUNT(*) as cnt FROM memories
      WHERE id NOT IN (SELECT source_id FROM memory_edges)
        AND id NOT IN (SELECT target_id FROM memory_edges)
    `).get() as any;
    return row.cnt;
  }

  contradictionCount(): number {
    const row = this._db.prepare(
      "SELECT COUNT(*) as cnt FROM memory_edges WHERE relation_type = 'contradicts'"
    ).get() as any;
    return row.cnt;
  }

  recentDecayCount(sinceMs: number): number {
    const since = Date.now() - sinceMs;
    const row = this._db.prepare(`
      SELECT COUNT(*) as cnt FROM memories
      WHERE last_decay_at >= ? AND strength < 0.5
    `).get(since) as any;
    return row.cnt;
  }

  lastShippedAt(): number | null {
    const rows = this._db.prepare(
      "SELECT metadata FROM memories WHERE memory_type = 'artifact' ORDER BY created_at DESC"
    ).all() as any[];
    for (const row of rows) {
      const meta = JSON.parse(row.metadata ?? '{}');
      if (meta.shipped && meta.shippedAt) return meta.shippedAt as number;
    }
    return null;
  }

  autoLink(memoryId: string, maxLinks = 5): number {
    const mem = this.get(memoryId);
    if (!mem) return 0;

    // Extract meaningful terms (words > 3 chars), sorted by length descending
    // so we pick the most discriminating terms first
    const words = mem.content
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .sort((a, b) => b.length - a.length)
      .slice(0, 5);

    if (words.length === 0) return 0;

    // Search for each term individually and union results (OR semantics)
    const seen = new Set<string>();
    const candidates: ReturnType<typeof this.search> = [];
    for (const word of words) {
      for (const m of this.search(word, maxLinks + 5)) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          candidates.push(m);
        }
      }
    }
    let linked = 0;

    for (const candidate of candidates) {
      if (candidate.id === memoryId) continue;
      if (linked >= maxLinks) break;

      // Check for existing edge between these two nodes with 'similar' type
      const existing = this._db.prepare(`
        SELECT id FROM memory_edges
        WHERE ((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?))
          AND relation_type = 'similar'
      `).get(memoryId, candidate.id, candidate.id, memoryId) as any;

      if (!existing) {
        try {
          this.createEdge({ sourceId: memoryId, targetId: candidate.id, relationType: 'similar' });
          linked++;
        } catch {
          // unique constraint violation — skip
        }
      }
    }

    return linked;
  }

  getConnectedComponents(): ConsolidationCluster[] {
    const allEdges = this._db.prepare('SELECT * FROM memory_edges').all() as any[];
    if (allEdges.length === 0) return [];

    // Build adjacency list
    const adj = new Map<string, Set<string>>();
    const edgesByNode = new Map<string, any[]>();

    for (const row of allEdges) {
      const s = row.source_id;
      const t = row.target_id;

      if (!adj.has(s)) adj.set(s, new Set());
      if (!adj.has(t)) adj.set(t, new Set());
      adj.get(s)!.add(t);
      adj.get(t)!.add(s);

      if (!edgesByNode.has(s)) edgesByNode.set(s, []);
      if (!edgesByNode.has(t)) edgesByNode.set(t, []);
      edgesByNode.get(s)!.push(row);
      edgesByNode.get(t)!.push(row);
    }

    // BFS to find components
    const visited = new Set<string>();
    const components: ConsolidationCluster[] = [];

    for (const nodeId of adj.keys()) {
      if (visited.has(nodeId)) continue;

      const component: string[] = [];
      const componentEdgeIds = new Set<string>();
      const queue = [nodeId];
      visited.add(nodeId);

      while (queue.length > 0) {
        const current = queue.shift()!;
        component.push(current);

        for (const neighbor of adj.get(current) ?? []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }

        for (const edge of edgesByNode.get(current) ?? []) {
          componentEdgeIds.add(edge.id);
        }
      }

      const componentEdges = allEdges.filter((e) => componentEdgeIds.has(e.id));
      const avgWeight = componentEdges.length > 0
        ? componentEdges.reduce((sum: number, e: any) => sum + e.weight, 0) / componentEdges.length
        : 0;

      components.push({
        memoryIds: component,
        avgWeight,
        edgeCount: componentEdges.length,
      });
    }

    return components;
  }

  // -- Consolidation Proposals --

  createProposal(input: {
    cluster: ConsolidationCluster;
    title: string;
    summary: string;
    suggestedTags: string[];
    depth: number;
  }): ConsolidationProposal {
    const id = randomUUID();
    const now = Date.now();
    this._db.prepare(`
      INSERT INTO consolidation_proposals
        (id, cluster_memory_ids, cluster_avg_weight, cluster_edge_count,
         title, summary, suggested_tags, status, depth, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      id,
      JSON.stringify(input.cluster.memoryIds),
      input.cluster.avgWeight,
      input.cluster.edgeCount,
      input.title,
      input.summary,
      JSON.stringify(input.suggestedTags),
      input.depth,
      now,
    );
    return this.getProposal(id)!;
  }

  getProposal(id: string): ConsolidationProposal | null {
    const row = this._db.prepare(
      'SELECT * FROM consolidation_proposals WHERE id = ?'
    ).get(id) as any;
    return row ? this._rowToProposal(row) : null;
  }

  listProposals(status?: 'pending' | 'approved' | 'rejected'): ConsolidationProposal[] {
    let sql = 'SELECT * FROM consolidation_proposals';
    const params: unknown[] = [];
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this._db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this._rowToProposal(r));
  }

  resolveProposal(id: string, status: 'approved' | 'rejected'): ConsolidationProposal | null {
    const now = Date.now();
    const rejectedUntil = status === 'rejected' ? now + 7 * 24 * 60 * 60 * 1000 : null;
    this._db.prepare(`
      UPDATE consolidation_proposals
      SET status = ?, resolved_at = ?, rejected_until = ?
      WHERE id = ?
    `).run(status, now, rejectedUntil, id);
    return this.getProposal(id);
  }

  private _rowToProposal(row: any): ConsolidationProposal {
    return {
      id: row.id,
      cluster: {
        memoryIds: JSON.parse(row.cluster_memory_ids),
        avgWeight: row.cluster_avg_weight,
        edgeCount: row.cluster_edge_count,
      },
      title: row.title,
      summary: row.summary,
      suggestedTags: JSON.parse(row.suggested_tags),
      status: row.status,
      depth: row.depth,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at ?? null,
      rejectedUntil: row.rejected_until ?? null,
    };
  }

  // -- Contradiction Proposals --

  createContradictionProposal(input: {
    memoryAId: string;
    memoryBId: string;
    edgeId: string;
    analysis: string;
    isConstitutionalTension: boolean;
  }): ContradictionProposal {
    const id = randomUUID();
    const now = Date.now();
    this._db.prepare(`
      INSERT INTO contradiction_proposals
        (id, memory_a_id, memory_b_id, edge_id, analysis, is_constitutional_tension, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, input.memoryAId, input.memoryBId, input.edgeId, input.analysis, input.isConstitutionalTension ? 1 : 0, now);
    return this.getContradictionProposal(id)!;
  }

  getContradictionProposal(id: string): ContradictionProposal | null {
    const row = this._db.prepare('SELECT * FROM contradiction_proposals WHERE id = ?').get(id) as any;
    return row ? this._rowToContradictionProposal(row) : null;
  }

  listContradictionProposals(status?: 'pending' | 'resolved'): ContradictionProposal[] {
    let sql = 'SELECT * FROM contradiction_proposals';
    const params: unknown[] = [];
    if (status) { sql += ' WHERE status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC';
    return (this._db.prepare(sql).all(...params) as any[]).map((r) => this._rowToContradictionProposal(r));
  }

  resolveContradictionProposal(id: string, resolution: string): ContradictionProposal | null {
    this._db.prepare(`
      UPDATE contradiction_proposals SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ?
    `).run(resolution, Date.now(), id);
    return this.getContradictionProposal(id);
  }

  private _rowToContradictionProposal(row: any): ContradictionProposal {
    return {
      id: row.id,
      memoryAId: row.memory_a_id,
      memoryBId: row.memory_b_id,
      edgeId: row.edge_id,
      analysis: row.analysis,
      isConstitutionalTension: row.is_constitutional_tension === 1,
      status: row.status,
      resolution: row.resolution ?? null,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at ?? null,
    };
  }

  private _rowToEdge(row: any): MemoryEdge {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      relationType: row.relation_type,
      weight: row.weight,
      createdAt: row.created_at,
      lastHebbianAt: row.last_hebbian_at ?? null,
      metadata: JSON.parse(row.metadata ?? '{}'),
    };
  }

  close(): void {
    this._db.close();
  }

  /**
   * Validate tags against the TRIM taxonomy.
   * Custom tags are allowed. Known TRIM tags must be spelled exactly.
   * Throws if a tag is a case-insensitive match for a TRIM tag but not exact.
   */
  private _validateTags(tags: string[]): void {
    const trimSet = new Set<string>(TRIM_TAGS as readonly string[]);
    const trimLower = new Map<string, string>();
    for (const t of TRIM_TAGS) trimLower.set(t.toLowerCase(), t);

    for (const tag of tags) {
      if (trimSet.has(tag)) continue; // exact match, valid
      const canonical = trimLower.get(tag.toLowerCase());
      if (canonical) {
        throw new Error(`Invalid TRIM tag "${tag}" — did you mean "${canonical}"?`);
      }
      // Unknown tag, not a TRIM tag — allowed
    }
  }

  private _rowToMemory(row: any): Memory {
    return {
      id: row.id,
      content: row.content,
      embedding: row.embedding ? new Float32Array(row.embedding.buffer) : null,
      strength: row.strength,
      accessCount: row.access_count,
      retrievalCount: row.retrieval_count ?? 0,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
      lastDecayAt: row.last_decay_at ?? row.last_accessed_at,
      sessionId: row.session_id,
      tags: JSON.parse(row.tags),
      associations: JSON.parse(row.associations ?? '[]'),
      metadata: JSON.parse(row.metadata),
      validFrom: row.valid_from ?? undefined,
      supersededBy: row.superseded_by ?? undefined,
      supersededAt: row.superseded_at ?? undefined,
      memoryType: row.memory_type ?? 'semantic',
      readiness: row.readiness ?? 0,
      valence: row.valence ?? 'neutral',
    };
  }

  private _rowToArtifact(row: any): DistilledArtifact {
    return {
      id: row.id,
      sourceUrl: row.source_url,
      sourceType: row.source_type,
      rawHash: row.raw_hash,
      distilled: row.distilled,
      refined: row.refined,
      organChain: JSON.parse(row.organ_chain ?? '[]'),
      memoryId: row.memory_id,
      tags: JSON.parse(row.tags ?? '[]'),
      createdAt: row.created_at,
      fedToMemory: row.fed_to_memory,
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

/**
 * Compute the length of the longest common substring between two strings.
 * Uses a rolling-row DP approach to keep memory usage linear.
 */
function longestCommonSubstring(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;

  // Ensure a is the shorter string for memory efficiency
  if (a.length > b.length) [a, b] = [b, a];

  let prev = new Uint16Array(a.length + 1);
  let curr = new Uint16Array(a.length + 1);
  let max = 0;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      if (a[i - 1] === b[j - 1]) {
        curr[i] = prev[i - 1] + 1;
        if (curr[i] > max) max = curr[i];
      } else {
        curr[i] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  return max;
}
