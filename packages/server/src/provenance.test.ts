import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { ProvenanceLogger, type ProvenanceEntry } from './provenance.js';

describe('ProvenanceLogger', () => {
  const files: string[] = [];

  function tmpFile(): string {
    const p = join(tmpdir(), `prov-${randomUUID()}.jsonl`);
    files.push(p);
    return p;
  }

  afterEach(() => {
    for (const f of files) {
      try { unlinkSync(f); } catch {}
    }
    files.length = 0;
  });

  it('writes a single parseable JSONL line', async () => {
    const path = tmpFile();
    const logger = new ProvenanceLogger(path);
    const entry: ProvenanceEntry = {
      timestamp: Date.now(),
      action: 'memory_save',
      memoryId: 'mem-1',
      sessionId: 'sess-1',
    };

    await logger.log(entry);

    const raw = readFileSync(path, 'utf-8').trim();
    const parsed = JSON.parse(raw);
    expect(parsed.action).toBe('memory_save');
    expect(parsed.memoryId).toBe('mem-1');
    expect(parsed.sessionId).toBe('sess-1');
  });

  it('appends multiple newline-delimited entries', async () => {
    const path = tmpFile();
    const logger = new ProvenanceLogger(path);

    for (let i = 0; i < 3; i++) {
      await logger.log({ timestamp: Date.now(), action: `action-${i}`, sessionId: 'sess' });
    }

    const lines = readFileSync(path, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(3);
    lines.forEach((line, i) => {
      expect(JSON.parse(line).action).toBe(`action-${i}`);
    });
  });

  it('omits optional fields when not provided', async () => {
    const path = tmpFile();
    const logger = new ProvenanceLogger(path);

    await logger.log({ timestamp: 1, action: 'test', sessionId: 's' });

    const parsed = JSON.parse(readFileSync(path, 'utf-8').trim());
    expect(parsed.memoryId).toBeUndefined();
    expect(parsed.query).toBeUndefined();
    expect(parsed.metadata).toBeUndefined();
  });
});
