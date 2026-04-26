/**
 * Loom — shared types
 *
 * Hook payload shape mirrors what Claude Code passes on stdin to
 * PreToolUse / PostToolUse hooks (tool_name + tool_input + session
 * fields). Router decision shape mirrors what PreToolUse hooks may
 * emit on stdout to influence the dispatch.
 */

export type LoomTool = 'Agent' | 'Bash';

export interface HookPayload {
  tool_name: LoomTool | string;
  tool_input: Record<string, unknown>;
  session_id?: string;
  cwd?: string;
  hook_event_name?: 'PreToolUse' | 'PostToolUse';
  // PostToolUse only:
  tool_response?: { is_error?: boolean; content?: unknown };
}

export type RouterAction = 'pass' | 'allow' | 'deny' | 'cold-start';

export interface RouterDecision {
  action: RouterAction;
  reason?: string;
  policyId?: string;
}

export interface DispatchRecord {
  tool: LoomTool;
  inputSummary: string;
  subagentType?: string;
  commandHead?: string;
  startedAt: number;
  durationMs?: number;
  sessionId?: string;
  exitStatus: 'success' | 'error' | 'denied' | 'unknown';
  routerAction: RouterAction;
  project?: string;
}

export interface Policy {
  id: string;
  rule: string;
  scope: {
    tool?: LoomTool;
    subagentType?: string;
    project?: string;
    matchers?: Record<string, unknown>;
  };
  action: { kind: RouterAction; reason?: string };
  approvedAt: number;
}

export interface Cluster {
  signature: string;
  members: Array<{ id: string; tags: string[]; createdAt: number }>;
  size: number;
}
