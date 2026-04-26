// packages/server/src/loom/router.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStore } from '@forgeframe/memory';
import { decide, formatDecisionForHook } from './router.js';

describe('router.decide', () => {
  let dir: string;
  let store: MemoryStore;
  let statePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loom-router-'));
    store = new MemoryStore({ dbPath: join(dir, 'memory.db') });
    statePath = join(dir, 'loom-state.json');
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns cold-start when first_fire_at is unset (no fire yet)', () => {
    const d = decide({ tool_name: 'Agent', tool_input: {} } as any, { store, statePath });
    expect(d.action).toBe('cold-start');
  });

  it('returns cold-start when within the 7-day window', () => {
    writeFileSync(statePath, JSON.stringify({ firstFireAt: Date.now() - 1000 }), 'utf8');
    const d = decide({ tool_name: 'Bash', tool_input: { command: 'ls' } } as any, { store, statePath });
    expect(d.action).toBe('cold-start');
  });

  it('returns pass when armed and no policies match', () => {
    writeFileSync(statePath, JSON.stringify({ firstFireAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }), 'utf8');
    const d = decide({ tool_name: 'Bash', tool_input: { command: 'ls' } } as any, { store, statePath });
    expect(d.action).toBe('pass');
  });

  it('returns the policy decision when armed and a policy matches', () => {
    writeFileSync(statePath, JSON.stringify({ firstFireAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }), 'utf8');
    store.create({
      content: JSON.stringify({
        id: 'p1', rule: 'no curl', scope: { tool: 'Bash' },
        action: { kind: 'deny', reason: 'curl forbidden' }, approvedAt: 1,
      }),
      tags: ['routing-principle', 'principle', 'routing-principle:approved'],
      sensitivity: 'public',
    });
    const d = decide({ tool_name: 'Bash', tool_input: { command: 'curl x' } } as any, { store, statePath });
    expect(d.action).toBe('deny');
    expect(d.policyId).toBe('p1');
  });

  it('formatDecisionForHook returns null for pass / cold-start (silent)', () => {
    expect(formatDecisionForHook({ action: 'pass' })).toBeNull();
    expect(formatDecisionForHook({ action: 'cold-start' })).toBeNull();
  });

  it('formatDecisionForHook formats deny per Claude Code PreToolUse schema', () => {
    const out = formatDecisionForHook({ action: 'deny', reason: 'r', policyId: 'p1' });
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out!);
    expect(parsed.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput?.permissionDecisionReason).toMatch(/r/);
  });

  it('formatDecisionForHook formats allow per Claude Code PreToolUse schema', () => {
    const out = formatDecisionForHook({ action: 'allow', reason: 'auto-approved by loom' });
    const parsed = JSON.parse(out!);
    expect(parsed.hookSpecificOutput?.permissionDecision).toBe('allow');
  });
});

describe('router latency', () => {
  it('100 invocations against 100 policies stay under 500ms total', () => {
    const dir = mkdtempSync(join(tmpdir(), 'loom-bench-'));
    const store = new MemoryStore({ dbPath: join(dir, 'memory.db') });
    const statePath = join(dir, 'loom-state.json');
    writeFileSync(statePath, JSON.stringify({ firstFireAt: 1 }), 'utf8');

    for (let i = 0; i < 100; i++) {
      store.create({
        content: JSON.stringify({
          id: `p${i}`, rule: 'r', scope: { tool: 'Bash' },
          action: { kind: 'allow' }, approvedAt: i,
        }),
        tags: ['routing-principle', 'principle', 'routing-principle:approved'],
        sensitivity: 'public',
      });
    }

    const t0 = Date.now();
    for (let i = 0; i < 100; i++) {
      decide({ tool_name: 'Bash', tool_input: { command: 'ls' } } as any, { store, statePath });
    }
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(500);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
