// packages/server/src/loom/reflector.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStore } from '@forgeframe/memory';
import { reflect, signatureOf } from './reflector.js';
import type { DispatchRecord } from './types.js';

describe('reflector.signatureOf', () => {
  it('combines tool + subagentType + project (lowercased)', () => {
    expect(signatureOf({
      tool: 'Agent', inputSummary: '', startedAt: 0, exitStatus: 'success',
      routerAction: 'pass', subagentType: 'Explore', project: 'reframed',
    } as DispatchRecord)).toBe('agent:explore:reframed');
  });

  it('uses _ for missing project', () => {
    expect(signatureOf({
      tool: 'Bash', inputSummary: '', startedAt: 0, exitStatus: 'success', routerAction: 'pass',
    } as DispatchRecord)).toBe('bash:_:_');
  });
});

describe('reflector.reflect', () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loom-reflect-'));
    store = new MemoryStore({ dbPath: join(dir, 'memory.db') });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function seed(rec: Partial<DispatchRecord>): string {
    const full: DispatchRecord = {
      tool: 'Agent', inputSummary: '', startedAt: Date.now(),
      exitStatus: 'success', routerAction: 'pass', ...rec,
    };
    const tags: string[] = ['dispatch', `dispatch:tool:${full.tool.toLowerCase()}`];
    if (full.subagentType) tags.push(`dispatch:agent:${full.subagentType.toLowerCase()}`);
    if (full.project) tags.push(`project:${full.project}`);
    // Serialize to snake_case to match the on-disk contract that
    // sensor.ts emits, so reflector parses dispatches as they appear
    // in production memory rows.
    const serialized = {
      tool: full.tool,
      input_summary: full.inputSummary,
      subagent_type: full.subagentType,
      command_head: full.commandHead,
      started_at: full.startedAt,
      session_id: full.sessionId,
      exit_status: full.exitStatus,
      router_action: full.routerAction,
      project: full.project,
    };
    const m = store.create({
      content: JSON.stringify(serialized),
      tags,
      sensitivity: 'public',
      metadata: { kind: 'loom-dispatch' },
    });
    return m.id;
  }

  it('proposes nothing when no cluster reaches the minimum size', () => {
    seed({ tool: 'Agent', subagentType: 'Explore', project: 'reframed' });
    seed({ tool: 'Agent', subagentType: 'Plan', project: 'forgeframe' });
    const result = reflect({ store, minClusterSize: 5 });
    expect(result.proposed).toBe(0);
  });

  it('proposes one routing-principle for each cluster that hits the minimum', () => {
    for (let i = 0; i < 6; i++) seed({ tool: 'Agent', subagentType: 'Explore', project: 'reframed' });
    for (let i = 0; i < 3; i++) seed({ tool: 'Bash', project: 'forgeframe' });
    const result = reflect({ store, minClusterSize: 5 });
    expect(result.proposed).toBe(1);

    const proposals = store.listByTag('routing-principle:proposed', 10);
    expect(proposals.length).toBe(1);
    const p = JSON.parse(proposals[0].content);
    expect(p.scope.tool).toBe('Agent');
    expect(p.scope.subagentType).toBe('Explore');
    expect(p.scope.project).toBe('reframed');
    expect(p.derived_from_count).toBe(6);
    expect(Array.isArray(p.sample_dispatch_ids)).toBe(true);
    expect(p.sample_dispatch_ids.length).toBeGreaterThan(0);
    expect(p.sample_dispatch_ids.length).toBeLessThanOrEqual(5);
  });

  it('does not re-propose a cluster that already has an approved principle covering it', () => {
    for (let i = 0; i < 6; i++) seed({ tool: 'Agent', subagentType: 'Explore', project: 'reframed' });
    store.create({
      content: JSON.stringify({
        id: 'existing', rule: 'x',
        scope: { tool: 'Agent', subagentType: 'Explore', project: 'reframed' },
        action: { kind: 'allow' }, approvedAt: 1,
      }),
      tags: ['routing-principle', 'principle', 'routing-principle:approved'],
      sensitivity: 'public',
    });
    const result = reflect({ store, minClusterSize: 5 });
    expect(result.proposed).toBe(0);
  });

  it('does not re-propose a cluster that already has a pending proposal covering it', () => {
    for (let i = 0; i < 6; i++) seed({ tool: 'Agent', subagentType: 'Explore', project: 'reframed' });
    reflect({ store, minClusterSize: 5 });
    const second = reflect({ store, minClusterSize: 5 });
    expect(second.proposed).toBe(0);
  });
});
