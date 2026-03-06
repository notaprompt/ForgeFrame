import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ProxyProvenanceLogger } from './provenance.js';

const TMP_PATH = join(tmpdir(), `proxy-provenance-test-${Date.now()}.jsonl`);

afterEach(() => {
  if (existsSync(TMP_PATH)) unlinkSync(TMP_PATH);
});

describe('ProxyProvenanceLogger', () => {
  it('appends JSONL entries', () => {
    const logger = new ProxyProvenanceLogger(TMP_PATH);

    logger.log({
      timestamp: 1000,
      requestId: 'req-1',
      action: 'proxy_request',
      scrubbed: 'Hello [FF:PERSON_1]',
      redactions: [{ category: 'PERSON', count: 1 }],
    });

    logger.log({
      timestamp: 2000,
      requestId: 'req-1',
      action: 'proxy_response',
      rehydrated: true,
      latencyMs: 450,
    });

    const lines = readFileSync(TMP_PATH, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const entry1 = JSON.parse(lines[0]!);
    expect(entry1.action).toBe('proxy_request');
    expect(entry1.scrubbed).toBe('Hello [FF:PERSON_1]');

    const entry2 = JSON.parse(lines[1]!);
    expect(entry2.action).toBe('proxy_response');
    expect(entry2.latencyMs).toBe(450);
  });

  it('hashes text without storing PII', () => {
    const hash1 = ProxyProvenanceLogger.hash('Andrew Campos');
    const hash2 = ProxyProvenanceLogger.hash('Andrew Campos');
    const hash3 = ProxyProvenanceLogger.hash('Different text');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });
});
