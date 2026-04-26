import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStore } from '@forgeframe/memory';
import { recordDispatch, summarizeAgentInput, summarizeBashInput, projectFromCwd } from './sensor.js';
import { getState } from './cold-start.js';

describe('sensor.recordDispatch', () => {
  let dir: string;
  let dbPath: string;
  let statePath: string;
  let store: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loom-sensor-'));
    dbPath = join(dir, 'memory.db');
    statePath = join(dir, 'loom-state.json');
    store = new MemoryStore({ dbPath });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a dispatch:* memory for an Agent payload and records first fire', () => {
    const payload = {
      tool_name: 'Agent',
      tool_input: { subagent_type: 'Explore', description: 'survey auth code', prompt: 'find every call site of authenticate()' },
      session_id: 'test-session',
      cwd: '/Users/acamp/repos/reframed',
    };
    recordDispatch(payload as any, { store, statePath });

    expect(getState(statePath).firstFireAt).toBeTypeOf('number');
    const memories = store.getRecent(5);
    expect(memories.length).toBe(1);
    const m = memories[0];
    expect(m.tags).toContain('dispatch');
    expect(m.tags).toContain('dispatch:tool:agent');
    expect(m.tags).toContain('dispatch:agent:explore');
    expect(m.tags).toContain('project:reframed');
    expect(m.tags).toContain('dispatch:cold-start');
    const body = JSON.parse(m.content);
    expect(body.tool).toBe('Agent');
    expect(body.subagent_type).toBe('Explore');
    expect(body.input_summary).toMatch(/survey auth code/);
  });

  it('writes a dispatch:* memory for a Bash payload', () => {
    const payload = {
      tool_name: 'Bash',
      tool_input: { command: 'git status --short', description: 'check tree' },
      session_id: 'test-session',
      cwd: '/Users/acamp/repos/ForgeFrame-loom',
    };
    recordDispatch(payload as any, { store, statePath });
    const memories = store.getRecent(5);
    expect(memories.length).toBe(1);
    const m = memories[0];
    expect(m.tags).toContain('dispatch:tool:bash');
    expect(m.tags).toContain('project:forgeframe-loom');
    const body = JSON.parse(m.content);
    expect(body.command_head).toBe('git status --short');
  });

  it('skips non-Agent/Bash tools', () => {
    const payload = { tool_name: 'Read', tool_input: { file_path: '/x' } };
    recordDispatch(payload as any, { store, statePath });
    expect(store.getRecent(5).length).toBe(0);
  });

  it('does not throw on missing fields', () => {
    expect(() => recordDispatch({ tool_name: 'Agent', tool_input: {} } as any, { store, statePath })).not.toThrow();
    expect(store.getRecent(5).length).toBe(1);
  });

  it('does not tag dispatch:cold-start once router is armed', () => {
    // Pre-set state to look like 8 days ago.
    writeFileSync(statePath, JSON.stringify({ firstFireAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }), 'utf8');
    const payload = { tool_name: 'Agent', tool_input: { subagent_type: 'Plan', prompt: 'do x' }, cwd: '/Users/acamp/repos/foo' };
    recordDispatch(payload as any, { store, statePath });
    const m = store.getRecent(1)[0];
    expect(m.tags).not.toContain('dispatch:cold-start');
  });
});

describe('sensor helpers', () => {
  it('summarizeAgentInput truncates to 200 chars and prefers description over prompt', () => {
    const long = 'a'.repeat(500);
    expect(summarizeAgentInput({ subagent_type: 'Explore', description: 'short desc', prompt: long })).toBe('short desc');
    expect(summarizeAgentInput({ subagent_type: 'Explore', prompt: long }).length).toBeLessThanOrEqual(200);
  });

  it('summarizeBashInput returns the first 3 tokens of the command', () => {
    expect(summarizeBashInput({ command: 'git status --short -uall' })).toBe('git status --short');
    expect(summarizeBashInput({ command: 'ls' })).toBe('ls');
  });

  it('projectFromCwd extracts the last path segment lowercased', () => {
    expect(projectFromCwd('/Users/acamp/repos/Reframed')).toBe('reframed');
    expect(projectFromCwd('/Users/acamp/repos/ForgeFrame-loom')).toBe('forgeframe-loom');
    expect(projectFromCwd(undefined)).toBeUndefined();
  });
});
