/**
 * Loom — sensor (PostToolUse write path)
 *
 * Reads a Claude Code hook JSON payload from stdin, derives a
 * dispatch record, writes a `dispatch:*` memory row.
 *
 * Hot path: must be cheap. Wrapper script invokes us with
 * `async: true` (Claude Code does not wait for our exit). We still
 * keep the work minimal and avoid network / heavy compute.
 */

import { MemoryStore } from '@forgeframe/memory';
import { resolve } from 'path';
import { homedir } from 'os';
import type { HookPayload, DispatchRecord, LoomTool, RouterAction } from './types.js';
import { recordFirstFire, isArmed, DEFAULT_STATE_PATH } from './cold-start.js';

const SUMMARY_MAX = 200;

export function summarizeAgentInput(input: Record<string, unknown>): string {
  const description = typeof input.description === 'string' ? input.description : undefined;
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const text = (description ?? prompt).slice(0, SUMMARY_MAX);
  return text;
}

export function summarizeBashInput(input: Record<string, unknown>): string {
  const cmd = typeof input.command === 'string' ? input.command : '';
  return cmd.split(/\s+/).slice(0, 3).join(' ');
}

export function projectFromCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const parts = cwd.split('/').filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts[parts.length - 1].toLowerCase();
}

export interface RecordOptions {
  store: MemoryStore;
  statePath?: string;
  now?: number;
}

export function recordDispatch(payload: HookPayload, opts: RecordOptions): void {
  const tool = payload.tool_name as LoomTool;
  if (tool !== 'Agent' && tool !== 'Bash') return;

  const statePath = opts.statePath ?? DEFAULT_STATE_PATH;
  const now = opts.now ?? Date.now();
  recordFirstFire(statePath, now);
  const armed = isArmed(statePath, now);

  const project = projectFromCwd(payload.cwd);
  const subagentType = tool === 'Agent' && typeof payload.tool_input.subagent_type === 'string'
    ? (payload.tool_input.subagent_type as string)
    : undefined;
  const inputSummary = tool === 'Agent'
    ? summarizeAgentInput(payload.tool_input)
    : summarizeBashInput(payload.tool_input);
  const commandHead = tool === 'Bash' ? inputSummary : undefined;

  const exitStatus: DispatchRecord['exitStatus'] = payload.tool_response?.is_error ? 'error' : 'success';
  const routerAction: RouterAction = armed ? 'pass' : 'cold-start';

  const record: DispatchRecord = {
    tool,
    inputSummary,
    subagentType,
    commandHead,
    startedAt: now,
    sessionId: payload.session_id,
    exitStatus,
    routerAction,
    project,
  };

  const tags: string[] = ['dispatch', `dispatch:tool:${tool.toLowerCase()}`];
  if (subagentType) tags.push(`dispatch:agent:${subagentType.toLowerCase()}`);
  if (project) tags.push(`project:${project}`);
  if (!armed) tags.push('dispatch:cold-start');

  // Disk contract uses snake_case keys; DispatchRecord is the in-memory
  // TypeScript shape. Do not collapse these — the split is intentional
  // so TypeScript consumers get proper field names while storage/Cockpit
  // get a stable, language-neutral key format.
  const serialized = {
    tool: record.tool,
    input_summary: record.inputSummary,
    subagent_type: record.subagentType,
    command_head: record.commandHead,
    started_at: record.startedAt,
    session_id: record.sessionId,
    exit_status: record.exitStatus,
    router_action: record.routerAction,
    project: record.project,
  };

  try {
    opts.store.create({
      content: JSON.stringify(serialized),
      tags,
      sensitivity: 'public',
      metadata: { kind: 'loom-dispatch' },
    });
  } catch (err) {
    process.stderr.write(`[loom] sensor write failed: ${(err as Error).message}\n`);
  }
}

// Stdin entry point — invoked by ~/.claude/hooks/loom-sensor.sh
async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  let payload: HookPayload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    process.exit(0); // never block on parse errors
  }

  const dbPath = process.env.FORGEFRAME_DB_PATH ?? resolve(homedir(), '.forgeframe', 'memory.db');
  const store = new MemoryStore({ dbPath });
  try {
    // exit(0) in the catch above guarantees payload is defined here
    recordDispatch(payload!, { store });
  } finally {
    store.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`[loom] sensor crashed: ${(err as Error).message}\n`);
    process.exit(0); // never block the next dispatch
  });
}
