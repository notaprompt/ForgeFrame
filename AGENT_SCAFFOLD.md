# Forge Agent — Scaffold

## What it is

Autonomous task execution loop with memory, routing, self-evaluation, and constitutional constraints. Lives in the forge cockpit as a visible pane between the daemon and shell.

## Cockpit layout (v2)

```
┌──────────────────────────┬──────────────┐
│                          │  forgeframe  │
│   Claude Code (80%)      │  daemon      │
│                          ├──────────────┤
│                          │  agent       │
│                          │  status/log  │
│                          ├──────────────┤
│                          │  shell       │
└──────────────────────────┴──────────────┘
```

Agent pane shows: current task, step count, budget spent, last action, live status.

## CLI commands

```bash
forge agent run "review auth system"                    # one-shot task
forge agent schedule "0 9 * * *" "summarize yesterday"  # cron trigger
forge agent watch ~/repos/ForgeFrame "review new PRs"   # file trigger
forge agent stop                                        # kill switch
forge agent log                                         # recent runs
```

## Core loop

```
forge agent run "task"
     │
     ├─ loadPrinciples()    ← constitutional constraints from ForgeFrame memory
     ├─ resolveModel()      ← router picks tier (quick/balanced/deep)
     │
     ├─ LOOP ──────────────── until done or budget exhausted
     │   ├─ step()          ← model proposes tool call
     │   ├─ execute()       ← run the tool (bash, file, MCP, etc.)
     │   ├─ checkBudget()   ← still within cap?
     │   └─ continue?
     │
     ├─ evaluate()          ← skeptic self-check: "did I do something stupid?"
     ├─ remember()          ← save findings to ForgeFrame memory
     └─ notify()            ← bell + update forge display
```

## Architecture

- Agent runs as its own process, connects to ForgeFrame daemon via HTTP
- Does NOT run inside the daemon — if agent crashes, daemon stays up
- Uses router directly (imported from @forgeframe/core)
- Uses MCP tools via daemon HTTP API for memory operations

```
forgeframe daemon (port 3001) ← always running
     ↑
forge agent run "task" ← spawns, connects, runs, exits
```

## Implementation: packages/server/src/agent.ts

```typescript
interface AgentConfig {
  task: string;
  cwd: string;
  tier?: 'quick' | 'balanced' | 'deep';
  budget?: number;          // max cost in dollars, default $5
  leash?: 'ask' | 'auto';  // human-in-the-loop or autonomous
  thinking?: boolean;       // enable/disable model thinking (off for local qwen)
  principles?: string[];    // constitutional constraints from memory
}

interface AgentStep {
  type: 'think' | 'tool_call' | 'tool_result' | 'evaluate' | 'done';
  content: string;
  cost?: number;
  timestamp: number;
}

class ForgeAgent {
  async run(config: AgentConfig): Promise<AgentStep[]>
  private async loadPrinciples(): Promise<string[]>
  private resolveModel(task: string): ResolvedModel
  private async step(messages: Message[]): Promise<AgentStep>
  private async evaluate(steps: AgentStep[]): Promise<boolean>
  private async remember(steps: AgentStep[]): Promise<void>
  private checkBudget(spent: number, limit: number): boolean
  abort(): void
}
```

## Leash / safety defaults

```typescript
const DEFAULTS = {
  budget: 5.00,           // $5 max per run
  leash: 'ask',           // human confirms each action
  allowedTools: [
    'read', 'glob', 'grep', 'bash(git status)',
    'bash(npm test)', 'bash(npm run build)',
    'memory_search', 'memory_save'
  ],
  blockedTools: [
    'bash(rm)', 'bash(git push)', 'bash(curl)',
    'memory_delete'
  ],
  maxSteps: 50,
  scopeDir: process.cwd()
};
```

## Model routing for agent

```
"check if tests pass"     → quick  → llama3.2:1b (free, local)
"review this PR"           → balanced → qwen3:32b (free, local)
"architect a new system"   → deep  → Claude via subscription or API
```

Local models: disable thinking mode (`/no_think` for Qwen) to prevent reasoning loops in the agent pipeline.

## Triggers (v2)

1. **Manual** — `forge agent run "task"` (MVP)
2. **Cron** — `forge agent schedule "0 9 * * *" "task"`
3. **File watch** — `forge agent watch ~/dir "task"`
4. **Voice** — wake word → local STT → agent (future)
5. **Webhook** — external service pings localhost (future)

## Works with

- Claude subscription (spawns claude CLI subprocess)
- Anthropic API (direct calls)
- Any OpenAI-compatible API (Gemini, Mistral, Deepseek)
- Ollama local models (free, sovereign)

Router handles all of them. Agent just asks for a model.

## Build order

1. `agent.ts` — core class, loop, budget, abort
2. Wire to router — model selection per step
3. Wire to memory — load principles, save results
4. Skeptic evaluate — self-check after execution
5. CLI commands — `forge agent run/stop/log`
6. Cockpit pane — agent status in forge display
7. Cron + file watch — `schedule` and `watch` triggers

Steps 1-5 are MVP. Steps 6-7 are polish.

## ForgeFrame display (v2)

```
━━━ FORGE ━━━

 ● daemon ON  :3001

 ⚡ agent: reviewing auth (step 3/12, $0.42)

 workspaces (3)
 ──────────
  1  opus — cockpit build
  2  opus — readme
  3  sonnet — testing

 forge new   add
 forge <#>   switch
 forge stop  close
 forge mem   memories
```
