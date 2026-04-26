// packages/server/src/loom/policy.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStore } from '@forgeframe/memory';
import { loadPolicies, matchPolicy } from './policy.js';
import type { Policy, HookPayload } from './types.js';

describe('policy', () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loom-policy-'));
    store = new MemoryStore({ dbPath: join(dir, 'memory.db') });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function seedPolicy(p: Omit<Policy, 'approvedAt'>): void {
    const body = JSON.stringify({ ...p, approvedAt: Date.now() });
    store.create({
      content: body,
      tags: ['routing-principle', 'principle', 'routing-principle:approved'],
      sensitivity: 'public',
    });
  }

  it('loadPolicies returns only approved principles', () => {
    seedPolicy({ id: 'p1', rule: 'block curl', scope: { tool: 'Bash' }, action: { kind: 'deny', reason: 'no curl' } });
    // A proposed (non-approved) policy must be ignored.
    store.create({
      content: JSON.stringify({ id: 'p2', rule: 'x', scope: {}, action: { kind: 'allow' }, approvedAt: Date.now() }),
      tags: ['routing-principle', 'routing-principle:proposed'],
      sensitivity: 'public',
    });
    const policies = loadPolicies(store);
    expect(policies.length).toBe(1);
    expect(policies[0].id).toBe('p1');
  });

  it('matchPolicy returns pass when no policies match', () => {
    const payload: HookPayload = { tool_name: 'Agent', tool_input: { subagent_type: 'Explore' } };
    const decision = matchPolicy(payload, []);
    expect(decision.action).toBe('pass');
  });

  it('matchPolicy denies when a tool-scoped policy says deny', () => {
    const policies: Policy[] = [{
      id: 'p1', rule: 'no curl', scope: { tool: 'Bash' },
      action: { kind: 'deny', reason: 'curl forbidden' }, approvedAt: 1,
    }];
    const decision = matchPolicy({ tool_name: 'Bash', tool_input: { command: 'curl http://x' } }, policies);
    expect(decision.action).toBe('deny');
    expect(decision.reason).toMatch(/curl/);
    expect(decision.policyId).toBe('p1');
  });

  it('matchPolicy: more specific scope (project + tool) beats broader (tool only)', () => {
    const policies: Policy[] = [
      { id: 'broad', rule: 'allow agent', scope: { tool: 'Agent' }, action: { kind: 'allow' }, approvedAt: 1 },
      { id: 'narrow', rule: 'deny agent in foo', scope: { tool: 'Agent', project: 'foo' }, action: { kind: 'deny', reason: 'no agents in foo' }, approvedAt: 2 },
    ];
    const decision = matchPolicy(
      { tool_name: 'Agent', tool_input: { subagent_type: 'Explore' }, cwd: '/Users/acamp/repos/foo' },
      policies,
    );
    expect(decision.action).toBe('deny');
    expect(decision.policyId).toBe('narrow');
  });

  it('matchPolicy: equal-specificity ties broken by newest approvedAt', () => {
    const policies: Policy[] = [
      { id: 'older', rule: 'allow', scope: { tool: 'Agent' }, action: { kind: 'allow' }, approvedAt: 1 },
      { id: 'newer', rule: 'deny', scope: { tool: 'Agent' }, action: { kind: 'deny', reason: 'r' }, approvedAt: 2 },
    ];
    const d = matchPolicy({ tool_name: 'Agent', tool_input: {} }, policies);
    expect(d.policyId).toBe('newer');
  });

  it('matchPolicy: subagentType scope filters correctly', () => {
    const policies: Policy[] = [{
      id: 'plan-only', rule: 'allow Plan', scope: { tool: 'Agent', subagentType: 'Plan' },
      action: { kind: 'allow' }, approvedAt: 1,
    }];
    const matched = matchPolicy({ tool_name: 'Agent', tool_input: { subagent_type: 'Plan' } }, policies);
    expect(matched.action).toBe('allow');
    const skipped = matchPolicy({ tool_name: 'Agent', tool_input: { subagent_type: 'Explore' } }, policies);
    expect(skipped.action).toBe('pass');
  });
});
