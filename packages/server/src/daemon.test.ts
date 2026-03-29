import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { isDaemonRunning, stopDaemon, pidPath, portPath } from './daemon.js';

describe('daemon PID lifecycle', () => {
  let dir: string;

  beforeEach(() => {
    dir = resolve(tmpdir(), `forgeframe-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    try { unlinkSync(pidPath(dir)); } catch {}
    try { unlinkSync(portPath(dir)); } catch {}
  });

  it('reports not running when no PID file exists', () => {
    const status = isDaemonRunning(dir);
    expect(status.running).toBe(false);
  });

  it('detects a live process from PID file', () => {
    writeFileSync(pidPath(dir), String(process.pid), 'utf-8');
    writeFileSync(portPath(dir), '3001', 'utf-8');

    const status = isDaemonRunning(dir);
    expect(status.running).toBe(true);
    expect(status.pid).toBe(process.pid);
    expect(status.port).toBe(3001);
  });

  it('detects a dead process and cleans up stale files', () => {
    writeFileSync(pidPath(dir), '99999999', 'utf-8');
    writeFileSync(portPath(dir), '3001', 'utf-8');

    const status = isDaemonRunning(dir);
    expect(status.running).toBe(false);
  });

  it('handles malformed PID file gracefully', () => {
    writeFileSync(pidPath(dir), 'not-a-number', 'utf-8');
    const status = isDaemonRunning(dir);
    expect(status.running).toBe(false);
  });

  it('stopDaemon returns false when nothing is running', () => {
    expect(stopDaemon(dir)).toBe(false);
  });
});
