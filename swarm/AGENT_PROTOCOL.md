# ForgeFrame Swarm Protocol

## Overview

This protocol defines how multiple Claude Code agents coordinate through ForgeFrame's MCP memory server. No external coordination framework required — ForgeFrame IS the shared brain.

## Architecture

```
Agent 1 (builder)  ──┐
Agent 2 (builder)  ──┤── All share ForgeFrame MCP ── ~/.forgeframe/memory.db
Agent 3 (skeptic)  ──┤
Agent N             ──┘
```

Each agent runs in an isolated git worktree. All agents connect to the same ForgeFrame MCP server instance. Coordination happens through tagged memories, not message passing.

## Agent Lifecycle

### 1. Session Start
Every agent MUST begin with:
```
session_start({ metadata: { agent: "<role>", task: "<description>" } })
```

### 2. Context Load — House Style First
Before starting work, every agent MUST load in this order:

**a) Constitutional knowledge (the walls):**
```
memory_list_by_tag({ tag: "principle" })
memory_list_by_tag({ tag: "pattern" })
```
Principles never decay — they are the accumulated wisdom of every prior swarm run, team meeting, and human decision. Patterns are established conventions. Together they define how this project builds. Follow them unless you have strong evidence to challenge.

**b) Task-specific context:**
```
memory_search({ query: "<task area>", tags: ["decision", "architecture"] })
memory_list_by_tag({ tag: "active-task" })
```
This surfaces prior decisions and avoids re-deriving what another agent already learned.

**c) Project-level context:**
Read the project's `CLAUDE.md` if one exists. It defines code style, stack constraints, and team agreements.

### Why this order matters
An agent that builds without loading house style will reinvent existing patterns, violate conventions, and produce work that "functions but feels foreign." The swarm compounds knowledge — but only if agents read before they write.

### 3. Work Phase
During work, agents save discoveries as they go:
- Architectural decisions → tag: `decision`, `architecture`
- Bugs found → tag: `observation`, `bug`
- Patterns noticed → tag: `pattern`
- Principles derived → tag: `principle` (constitutional, no decay)
- Task status → tag: `active-task`

### 4. Session End
```
memory_save({ content: "<summary of work done and findings>", tags: ["session-summary", "agent:<role>"] })
session_end()
```

## Tag Convention

### Agent Identity
- `agent:builder` — constructive agent
- `agent:skeptic` — adversarial reviewer
- `agent:coordinator` — orchestrator (if used)

### TRIM Taxonomy (inherited from ForgeFrame)
| Layer | Tags | Decay |
|-------|------|-------|
| Object | `observation`, `entity`, `milestone` | Normal |
| Observer | `pattern`, `evaluation` | Normal |
| Interpreter | `principle`, `voice` | Exempt |
| Cross-layer | `decision`, `thread` | Normal |

### Coordination Tags
- `active-task` — currently in-progress work (agents check before starting)
- `blocker` — something preventing progress
- `challenge` — skeptic-raised concern requiring response
- `resolved` — addressed challenge

## Memory Format

All memories MUST follow this structure:
```
[AGENT:<role>] [TAG:<primary-tag>]
<content>
Context: <why this matters>
Confidence: <high|medium|low>
```

## Conflict Resolution

1. If two agents discover contradictory information, both save with `conflict` tag
2. Next agent to encounter both runs first-principles analysis
3. Winner saved as `decision`, loser saved as `evaluation` (for the reasoning trail)

## Skeptic Protocol

The skeptic agent has special responsibilities:
- Reads all `decision` and `architecture` tagged memories
- Challenges assumptions by saving `challenge` tagged memories
- Does NOT modify code — only analyzes and reports
- Findings saved with severity: `load-bearing`, `cosmetic`, `time-bomb`
- Must cite specific evidence (file:line, memory ID, or logical proof)
