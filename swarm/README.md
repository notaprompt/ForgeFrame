# ForgeFrame Swarm

Multi-agent orchestration with shared memory. Builders write code in isolated git worktrees. A skeptic stress-tests everything. Coordination happens through ForgeFrame's MCP memory server -- no external framework required.

## How it works

```
launch.sh
    |
    +-- creates isolated git worktree per agent
    +-- copies role overlay (builder.md or skeptic.md) as AGENT.md
    +-- spawns Claude Code in a tmux pane per agent
    +-- starts ForgeFrame daemon for shared memory + viewer
    |
    v
Agent 1 (builder)  --+
Agent 2 (builder)  --+-- All share ForgeFrame MCP -- ~/.forgeframe/memory.db
Agent 3 (skeptic)  --+
```

Each agent gets its own git branch and working directory. All agents connect to the same ForgeFrame memory server. They coordinate through tagged memories, not message passing.

## Run

```bash
./swarm/launch.sh ~/project "refactor auth" --builders 3
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--builders N` | 1 | Number of builder agents |
| `--roles "a,b,c"` | -- | Named roles for builders (e.g. `"security,payments,resilience"`) |
| `--no-skeptic` | -- | Skip the skeptic agent |
| `--no-memory` | -- | Run without ForgeFrame memory tools |
| `--dry-run` | -- | Print commands without executing |

### What happens

1. Verifies dependencies (git, tmux, claude)
2. Checks ForgeFrame MCP is configured, starts HTTP daemon if needed
3. Creates a tmux session with one pane per agent
4. For each agent: creates a git worktree, copies the role overlay, writes the task prompt
5. Launches Claude Code in each pane with appropriate tool permissions
6. Opens the swarm viewer at `http://localhost:3001`

Builders get full tool access. The skeptic gets read-only access -- it can read code and search memory, but cannot edit files or run destructive commands.

## Agent roles

### Builder

Defined in `overlays/builder.md`. Writes code, ships features, documents decisions. Boot sequence:

1. Start a ForgeFrame session
2. Load house style (principles, patterns, conventions)
3. Search for prior decisions in the task area
4. Check active tasks to avoid conflicts
5. Save own task as `active-task`
6. Work, committing discoveries to memory as it goes

### Skeptic

Defined in `overlays/skeptic.md`. Adversarial auditor. Does not modify code -- only analyzes and reports. Responsibilities:

- Reads all `decision` and `architecture` tagged memories
- Challenges assumptions with `challenge` tagged memories
- Rates findings by severity: `load-bearing`, `cosmetic`, `time-bomb`
- Must cite specific evidence (file:line, memory ID, or logical proof)

## Overlays

Role definitions live in `overlays/`. Each is a markdown file that gets copied into the agent's worktree as `AGENT.md`. The overlay defines:

- Boot sequence (which memories to load, in what order)
- Work protocol (how to tag and save decisions)
- Constraints (what the agent can and cannot do)

| File | Role |
|------|------|
| `overlays/builder.md` | Constructive agent -- writes code, saves decisions |
| `overlays/skeptic.md` | Adversarial auditor -- reads everything, challenges assumptions |

## Viewer

A single-page HTML app at `swarm/viewer/index.html`. Connects to the ForgeFrame HTTP daemon's SSE feed and renders real-time agent activity:

- Memory events (created, accessed, decayed)
- Session lifecycle (started, ended)
- Agent coordination (active tasks, challenges, resolutions)

Served at `http://localhost:3001` when the daemon is running.

## Coordination protocol

Documented in full in `AGENT_PROTOCOL.md`. Key points:

- **Tag conventions:** `active-task` for in-progress work, `decision` for architectural choices, `challenge` for skeptic concerns, `principle` for constitutional knowledge (never decays)
- **Memory format:** `[AGENT:<role>] [TAG:<primary-tag>] <content>`
- **Conflict resolution:** contradictory findings both get saved, next agent runs first-principles analysis, winner becomes a `decision`
- **Session lifecycle:** every agent starts with `session_start` and ends with `session_end` plus a summary

## Cleanup

```bash
./swarm/cleanup.sh ~/project
```

Removes worktrees created by the swarm launcher.

## Prerequisites

- **tmux** -- session and pane management for agent processes
- **Claude Code** (`claude` CLI) -- the agent runtime
- **ForgeFrame MCP** -- shared memory (`claude mcp add forgeframe-memory -- npx @forgeframe/server`)
- **git** -- worktree isolation requires a git repository

## Part of [ForgeFrame](https://github.com/notaprompt/ForgeFrame)

The orchestration layer. Uses `@forgeframe/memory` (via `@forgeframe/server`) as the shared coordination substrate. Agents don't talk to each other -- they talk to memory, and memory talks to everyone.
