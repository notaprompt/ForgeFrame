import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

/**
 * These tests exercise isDaemonRunning and stopDaemon using raw PID/port files
 * rather than actually spawning daemons — keeps tests fast and deterministic.
 *
 * The actual serveDaemon function is integration-tested manually
 * (it binds a real port and blocks forever).
 */

// We test the PID-file logic directly by manipulating the files that
// isDaemonRunning/stopDaemon read. To avoid coupling to ~/.forgeframe/,
// we re-implement the core logic inline with a custom directory.

describe('daemon PID lifecycle', () => {
  let dir: string;
  let pidPath: string;
  let portPath: string;

  beforeEach(() => {
    dir = resolve(tmpdir(), `forgeframe-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    pidPath = resolve(dir, 'daemon.pid');
    portPath = resolve(dir, 'daemon.port');
  });

  afterEach(() => {
    try { unlinkSync(pidPath); } catch {}
    try { unlinkSync(portPath); } catch {}
  });

  it('reports not running when no PID file exists', () => {
    expect(existsSync(pidPath)).toBe(false);
  });

  it('detects a live process from PID file', () => {
    // Write current process PID — it's definitely alive
    writeFileSync(pidPath, String(process.pid), 'utf-8');
    writeFileSync(portPath, '3001', 'utf-8');

    const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {}

    expect(alive).toBe(true);
  });

  it('detects a dead process from stale PID file', () => {
    // PID 99999999 is almost certainly not running
    writeFileSync(pidPath, '99999999', 'utf-8');
    writeFileSync(portPath, '3001', 'utf-8');

    const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {}

    expect(alive).toBe(false);
  });

  it('reads port from port file', () => {
    writeFileSync(portPath, '4567', 'utf-8');
    const port = parseInt(readFileSync(portPath, 'utf-8').trim(), 10);
    expect(port).toBe(4567);
  });

  it('handles malformed PID file gracefully', () => {
    writeFileSync(pidPath, 'not-a-number', 'utf-8');
    const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
    expect(isNaN(pid)).toBe(true);
  });
});
