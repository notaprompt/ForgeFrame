import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses full overrides when provided', () => {
    const cfg = loadConfig({
      dbPath: '/tmp/over.db',
      sessionId: 'sess-1',
      decayOnStartup: false,
      provenancePath: '/tmp/prov.jsonl',
      serverName: 'test-server',
      serverVersion: '9.9.9',
    });

    expect(cfg.dbPath).toBe('/tmp/over.db');
    expect(cfg.sessionId).toBe('sess-1');
    expect(cfg.decayOnStartup).toBe(false);
    expect(cfg.provenancePath).toBe('/tmp/prov.jsonl');
    expect(cfg.serverName).toBe('test-server');
    expect(cfg.serverVersion).toBe('9.9.9');
  });

  it('applies defaults when no overrides or env vars', () => {
    const cfg = loadConfig();

    expect(cfg.dbPath).toContain('.forgeframe');
    expect(cfg.dbPath).toContain('memory.db');
    expect(cfg.sessionId).toBeTruthy();
    expect(cfg.decayOnStartup).toBe(true);
    expect(cfg.provenancePath).toContain('provenance.jsonl');
    expect(cfg.serverName).toBe('forgeframe-memory');
    expect(cfg.serverVersion).toBe('0.1.0');
  });

  it('reads FORGEFRAME_ env vars', () => {
    vi.stubEnv('FORGEFRAME_DB_PATH', '/tmp/env.db');
    vi.stubEnv('FORGEFRAME_SESSION_ID', 'env-sess');
    vi.stubEnv('FORGEFRAME_PROVENANCE_PATH', '/tmp/env-prov.jsonl');
    vi.stubEnv('FORGEFRAME_SERVER_NAME', 'env-server');

    const cfg = loadConfig();

    expect(cfg.dbPath).toBe('/tmp/env.db');
    expect(cfg.sessionId).toBe('env-sess');
    expect(cfg.provenancePath).toBe('/tmp/env-prov.jsonl');
    expect(cfg.serverName).toBe('env-server');
  });

  it('overrides take precedence over env vars', () => {
    vi.stubEnv('FORGEFRAME_DB_PATH', '/tmp/env.db');
    vi.stubEnv('FORGEFRAME_SERVER_NAME', 'env-server');

    const cfg = loadConfig({
      dbPath: '/tmp/override.db',
      serverName: 'override-server',
    });

    expect(cfg.dbPath).toBe('/tmp/override.db');
    expect(cfg.serverName).toBe('override-server');
  });
});
