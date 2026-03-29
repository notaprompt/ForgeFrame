# Forge Cockpit

Terminal workspace manager for ForgeFrame. Runs inside [Zellij](https://zellij.dev/) and gives you a multi-tab environment where each tab has Claude Code, a ForgeFrame status panel, and a shell.

## Prerequisites

- [Zellij](https://zellij.dev/documentation/installation) (terminal multiplexer)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude` CLI)
- ForgeFrame daemon (`npm install -g @forgeframe/server` or `npx @forgeframe/server`)

## Install

```bash
./cockpit/install.sh
```

This will:
- Symlink layouts to `~/.config/zellij/layouts/`
- Add `source .../cockpit/forge.sh` and `FORGE_DIR` to your shell rc
- Check for prerequisites and warn if missing

Re-running is safe (idempotent).

To uninstall:

```bash
./cockpit/install.sh --uninstall
```

## Commands

| Command | Description |
|---|---|
| `forge` | Attach to existing forge session, or start a new one |
| `forge new [dir]` | Open a new workspace tab (prompts for project if no dir given) |
| `forge N` | Switch to workspace N |
| `forge show` | List open workspaces |
| `forge mem` | Show recent memories from the ForgeFrame daemon |
| `forge stop` | Close the current workspace tab |
| `forge nuke` | Kill all Zellij sessions (destructive) |

## How it works

When you run `forge`, it starts a Zellij session with the `forge.kdl` layout. Each tab has three panes:

1. **Claude** (80%) -- Claude Code running in the project directory
2. **ForgeFrame** (12%) -- status panel showing daemon health and open workspaces
3. **Shell** (8%) -- a regular shell for running commands

The status panel starts the ForgeFrame daemon automatically (`forgeframe start`) and refreshes whenever workspaces change. The daemon provides persistent semantic memory that Claude Code accesses via MCP.

`forge new` opens additional tabs using the `workspace.kdl` layout, each in a different project directory. The project picker queries the ForgeFrame daemon for recently-used directories.
