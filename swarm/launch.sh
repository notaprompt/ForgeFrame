#!/usr/bin/env bash
# ForgeFrame Swarm Launcher
# Spawns builder + skeptic agents in isolated git worktrees with shared ForgeFrame memory
#
# Usage:
#   ./launch.sh <project-dir> "<task-description>"
#   ./launch.sh ~/repos/ForgeFrame "refactor the retrieval scoring pipeline"
#
# Options:
#   --builders N    Number of builder agents (default: 1)
#   --roles "a,b,c" Named roles for builders (e.g. "security,payments,resilience")
#   --no-skeptic    Skip the skeptic agent
#   --dry-run       Print commands without executing
#   --no-memory     Skip ForgeFrame memory tools (if MCP is unavailable)

set -euo pipefail

# --- Dependency checks ---
for cmd in git tmux claude; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: '$cmd' is required but not found in PATH." >&2
    exit 1
  fi
done

# --- Defaults ---
BUILDERS=1
ROLES=""
SKEPTIC=true
DRY_RUN=false
USE_MEMORY=true
SWARM_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Parse args ---
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --builders)   BUILDERS="$2"; shift 2 ;;
    --roles)      ROLES="$2"; shift 2 ;;
    --no-skeptic) SKEPTIC=false; shift ;;
    --no-memory)  USE_MEMORY=false; shift ;;
    --dry-run)    DRY_RUN=true; shift ;;
    *)            POSITIONAL+=("$1"); shift ;;
  esac
done

PROJECT_DIR="${POSITIONAL[0]:-}"
TASK="${POSITIONAL[1]:-}"

if [[ -z "$PROJECT_DIR" || -z "$TASK" ]]; then
  echo "Usage: ./launch.sh <project-dir> \"<task-description>\""
  echo "  --builders N    Number of builder agents (default: 1)"
  echo "  --no-skeptic    Skip the skeptic agent"
  echo "  --no-memory     Skip ForgeFrame memory tools"
  echo "  --dry-run       Print commands without executing"
  exit 1
fi

PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)" || { echo "Error: '$PROJECT_DIR' is not a valid directory." >&2; exit 1; }

# Verify it's a git repo
if ! git -C "$PROJECT_DIR" rev-parse --git-dir &>/dev/null; then
  echo "Error: '$PROJECT_DIR' is not a git repository. Worktrees require git." >&2
  exit 1
fi

# Check ForgeFrame MCP — warn but don't block if unavailable
if $USE_MEMORY; then
  if ! claude mcp list 2>/dev/null | grep -q forgeframe-memory; then
    echo "Warning: ForgeFrame MCP 'forgeframe-memory' not configured. Running without shared memory."
    echo "  Add it with: claude mcp add forgeframe-memory -e FORGEFRAME_HTTP_PORT=3001 -- npx @forgeframe/server"
    USE_MEMORY=false
  fi
fi

# Ensure ForgeFrame HTTP server is running for the viewer
if $USE_MEMORY; then
  if ! curl -s --max-time 2 http://localhost:3001/api/status >/dev/null 2>&1; then
    echo "Starting ForgeFrame daemon..."
    npx @forgeframe/server start --port 3001 2>/dev/null || {
      echo "Warning: ForgeFrame daemon failed to start. Viewer won't have live feed."
    }
    sleep 2
    if curl -s --max-time 2 http://localhost:3001/api/status >/dev/null 2>&1; then
      echo "ForgeFrame daemon running on :3001"
    else
      echo "Warning: ForgeFrame HTTP not responding. Viewer won't have live feed."
    fi
  fi
fi

# Sanitize project name for tmux (no dots or colons)
PROJECT_NAME="$(basename "$PROJECT_DIR" | tr './:' '-')"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
WORKTREE_BASE="${PROJECT_DIR}/.swarm-worktrees"

echo ""
echo "=== ForgeFrame Swarm ==="
echo "Project:  $PROJECT_NAME"
echo "Task:     $TASK"
echo "Builders: $BUILDERS"
echo "Skeptic:  $SKEPTIC"
echo "Memory:   $USE_MEMORY"
echo "========================"

# --- Ensure tmux session ---
TMUX_SESSION="swarm-${PROJECT_NAME}-${TIMESTAMP}"

if $DRY_RUN; then
  echo "[DRY RUN] Would create tmux session: $TMUX_SESSION"
else
  tmux new-session -d -s "$TMUX_SESSION" -x 200 -y 50
fi

# --- Create worktrees and launch agents ---
mkdir -p "$WORKTREE_BASE"

AGENT_COUNT=0

launch_agent() {
  local ROLE="$1"
  local AGENT_ID="$2"
  local OVERLAY_FILE="$3"
  local AGENT_TASK="$4"

  local BRANCH="swarm/${ROLE}-${AGENT_ID}-${TIMESTAMP}"
  local WORKTREE_PATH="${WORKTREE_BASE}/${ROLE}-${AGENT_ID}"

  echo "  Launching ${ROLE}-${AGENT_ID} → branch: $BRANCH"

  if $DRY_RUN; then
    echo "  [DRY RUN] git worktree add $WORKTREE_PATH -b $BRANCH"
    return
  fi

  # Create worktree
  git -C "$PROJECT_DIR" worktree add "$WORKTREE_PATH" -b "$BRANCH" HEAD 2>/dev/null || {
    git -C "$PROJECT_DIR" worktree add "$WORKTREE_PATH" "$BRANCH" 2>/dev/null || {
      echo "  Warning: Could not create worktree for ${ROLE}-${AGENT_ID}, skipping"
      return
    }
  }

  # Copy overlay
  cp "$OVERLAY_FILE" "$WORKTREE_PATH/AGENT.md"

  # Write prompt
  cat > "$WORKTREE_PATH/.swarm-prompt.txt" <<PROMPT_EOF
You are a ${ROLE} agent in a ForgeFrame swarm. Read AGENT.md in this directory for your role protocol.

Your task: ${AGENT_TASK}

IMPORTANT: Follow the boot sequence in AGENT.md exactly. Start with session_start, then memory_search for prior context, then begin work.
PROMPT_EOF

  # Build tool permissions
  local ALLOWED_TOOLS

  if [[ "$ROLE" == "skeptic" ]]; then
    # Skeptic: read-only. No Edit, Write, Bash, Agent.
    ALLOWED_TOOLS="Read,Glob,Grep,WebSearch,WebFetch"
  else
    # Builder: full access
    ALLOWED_TOOLS="Read,Edit,Write,Bash,Glob,Grep,Agent,WebSearch,WebFetch"
  fi

  # Add ForgeFrame memory tools if available
  if $USE_MEMORY; then
    local MEM_TOOLS="mcp__forgeframe-memory__memory_save"
    MEM_TOOLS+=",mcp__forgeframe-memory__memory_search"
    MEM_TOOLS+=",mcp__forgeframe-memory__memory_update"
    MEM_TOOLS+=",mcp__forgeframe-memory__memory_list_by_tag"
    MEM_TOOLS+=",mcp__forgeframe-memory__memory_list_recent"
    MEM_TOOLS+=",mcp__forgeframe-memory__memory_status"
    MEM_TOOLS+=",mcp__forgeframe-memory__session_start"
    MEM_TOOLS+=",mcp__forgeframe-memory__session_end"
    MEM_TOOLS+=",mcp__forgeframe-memory__session_current"
    MEM_TOOLS+=",mcp__forgeframe-memory__session_list"

    if [[ "$ROLE" != "skeptic" ]]; then
      MEM_TOOLS+=",mcp__forgeframe-memory__memory_delete"
      MEM_TOOLS+=",mcp__forgeframe-memory__memory_reindex"
    fi

    ALLOWED_TOOLS+=",${MEM_TOOLS}"
  fi

  # Write launcher script (runs in worktree dir, captures output, sends macOS notification)
  local LAUNCHER="${WORKTREE_PATH}/.swarm-launch.sh"
  local SENTINEL="${WORKTREE_BASE}/.done-${ROLE}-${AGENT_ID}"

  cat > "$LAUNCHER" <<LAUNCH_EOF
#!/usr/bin/env bash
cd "\$(dirname "\$0")"
echo "[\$(date +%H:%M:%S)] ${ROLE}-${AGENT_ID} starting..."
PROMPT=\$(cat .swarm-prompt.txt)
claude -p "\$PROMPT" --allowedTools '${ALLOWED_TOOLS}' 2>&1 | tee .swarm-output.log
EXIT_CODE=\${PIPESTATUS[0]}

# Write sentinel with metadata
cat > "${SENTINEL}" <<SENTINEL_EOF
role=${ROLE}
agent_id=${AGENT_ID}
exit_code=\$EXIT_CODE
finished_at=\$(date -Iseconds)
worktree=${WORKTREE_PATH}
branch=${BRANCH}
---
\$(grep -v '^\$' .swarm-output.log | tail -30)
SENTINEL_EOF

# macOS notification
osascript -e "display notification \"${ROLE}-${AGENT_ID} finished (exit \$EXIT_CODE)\" with title \"Swarm: ${PROJECT_NAME}\"" 2>/dev/null || true

echo "[\$(date +%H:%M:%S)] ${ROLE}-${AGENT_ID} finished (exit \$EXIT_CODE)"
exit \$EXIT_CODE
LAUNCH_EOF
  chmod +x "$LAUNCHER"

  # Launch in tmux — use first window for first agent, new windows after
  if [[ $AGENT_COUNT -eq 0 ]]; then
    # Rename the default window
    tmux rename-window -t "${TMUX_SESSION}:0" "${ROLE}-${AGENT_ID}"
    sleep 0.3
    tmux send-keys -t "${TMUX_SESSION}:${ROLE}-${AGENT_ID}" "'${LAUNCHER}'" Enter
  else
    tmux new-window -t "$TMUX_SESSION" -n "${ROLE}-${AGENT_ID}"
    sleep 0.3
    tmux send-keys -t "${TMUX_SESSION}:${ROLE}-${AGENT_ID}" "'${LAUNCHER}'" Enter
  fi

  AGENT_COUNT=$((AGENT_COUNT + 1))
}

# Launch builders — use named roles if provided, otherwise numbered
if [[ -n "$ROLES" ]]; then
  IFS=',' read -ra ROLE_ARRAY <<< "$ROLES"
  BUILDERS=${#ROLE_ARRAY[@]}
  for role in "${ROLE_ARRAY[@]}"; do
    role="$(echo "$role" | xargs)" # trim whitespace
    launch_agent "$role" "1" "$SWARM_DIR/overlays/builder.md" "$TASK"
  done
else
  for i in $(seq 1 "$BUILDERS"); do
    launch_agent "builder" "$i" "$SWARM_DIR/overlays/builder.md" "$TASK"
  done
fi

# Launch skeptic
if $SKEPTIC; then
  SKEPTIC_TASK="Audit and stress-test everything related to: ${TASK}. Read the code, read ForgeFrame memories from builder agents, and challenge every assumption."
  launch_agent "skeptic" "1" "$SWARM_DIR/overlays/skeptic.md" "$SKEPTIC_TASK"
fi

echo ""
echo "=== Swarm launched ==="
echo "  tmux attach -t $TMUX_SESSION"
echo "  Viewer:    http://localhost:3456"
echo "  ForgeFrame: http://localhost:3001"
echo ""
echo "  Worktrees: $WORKTREE_BASE"
echo "  Sentinels: $WORKTREE_BASE/.done-*"
echo "  Logs:      $WORKTREE_BASE/*/.swarm-output.log"
echo ""
echo "  Cleanup:   $SWARM_DIR/cleanup.sh $PROJECT_DIR"
