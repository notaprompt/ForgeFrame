#!/usr/bin/env bash
# Clean up swarm worktrees after a run
# Usage: ./cleanup.sh <project-dir>

set -euo pipefail

if ! command -v git &>/dev/null; then
  echo "Error: 'git' is required but not found in PATH." >&2
  exit 1
fi

PROJECT_DIR="${1:?Usage: ./cleanup.sh <project-dir>}"
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
WORKTREE_BASE="${PROJECT_DIR}/.swarm-worktrees"

if [[ ! -d "$WORKTREE_BASE" ]]; then
  echo "No swarm worktrees found at $WORKTREE_BASE"
  exit 0
fi

# Kill any running swarm tmux sessions for this project
PROJECT_NAME="$(basename "$PROJECT_DIR")"
for sess in $(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep "^swarm-${PROJECT_NAME}-" || true); do
  echo "  Killing tmux session: $sess"
  tmux kill-session -t "$sess" 2>/dev/null || true
done

echo "Cleaning up swarm worktrees..."

# Remove sentinel files
rm -f "$WORKTREE_BASE"/.done-* 2>/dev/null

for wt in "$WORKTREE_BASE"/*/; do
  [[ -d "$wt" ]] || continue
  DIRNAME="$(basename "$wt")"
  echo "  Removing worktree: $DIRNAME"
  # Clean up swarm artifacts before removing worktree
  rm -f "$wt/AGENT.md" "$wt/.swarm-prompt.txt" "$wt/.swarm-launch.sh" "$wt/.swarm-output.log" 2>/dev/null
  git -C "$PROJECT_DIR" worktree remove "$wt" --force 2>/dev/null || rm -rf "$wt"
done

rmdir "$WORKTREE_BASE" 2>/dev/null || true

# Clean up swarm branches (optional — keep if you want history)
echo ""
echo "Swarm branches still exist (delete manually if desired):"
git -C "$PROJECT_DIR" branch --list 'swarm/*'

echo ""
echo "Done."
