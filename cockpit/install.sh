#!/bin/bash
# Forge cockpit installer
# Installs Zellij layouts, shell integration, and FORGE_DIR env var.
# Idempotent — safe to run multiple times.
# Usage: ./cockpit/install.sh [--uninstall]

set -euo pipefail

COCKPIT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAYOUT_DIR="$HOME/.config/zellij/layouts"
MARKER="# -- forge cockpit --"

# Detect shell rc file
detect_rc() {
    if [ -n "${ZSH_VERSION:-}" ] || [ "$(basename "$SHELL")" = "zsh" ]; then
        echo "$HOME/.zshrc"
    else
        echo "$HOME/.bashrc"
    fi
}

RC_FILE="$(detect_rc)"

install() {
    echo "Installing Forge cockpit..."
    echo "  cockpit dir: $COCKPIT_DIR"
    echo "  shell rc:    $RC_FILE"

    # Check prerequisites
    if ! command -v zellij >/dev/null 2>&1; then
        echo ""
        echo "  WARNING: zellij not found in PATH."
        echo "  Install it: https://zellij.dev/documentation/installation"
        echo ""
    fi

    if ! command -v claude >/dev/null 2>&1; then
        echo ""
        echo "  WARNING: claude not found in PATH."
        echo "  Install Claude Code: https://docs.anthropic.com/en/docs/claude-code"
        echo ""
    fi

    # Check for existing forge command (not ours)
    if command -v forge >/dev/null 2>&1 && ! grep -q "$MARKER" "$RC_FILE" 2>/dev/null; then
        echo ""
        echo "  WARNING: a 'forge' command already exists in PATH: $(command -v forge)"
        echo "  Installing will shadow it with the Forge cockpit function."
        printf "  Continue? [y/N] "
        read -r answer
        if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then
            echo "Aborted."
            exit 1
        fi
    fi

    # Make scripts executable
    chmod +x "$COCKPIT_DIR/scripts/forge-display.sh"
    chmod +x "$COCKPIT_DIR/scripts/forge-picker.sh"

    # Symlink layouts
    mkdir -p "$LAYOUT_DIR"
    for layout in forge.kdl workspace.kdl; do
        local target="$LAYOUT_DIR/$layout"
        if [ -L "$target" ]; then
            rm "$target"
        elif [ -f "$target" ]; then
            echo "  Backing up existing $layout -> ${target}.bak"
            mv "$target" "${target}.bak"
        fi
        ln -s "$COCKPIT_DIR/layouts/$layout" "$target"
        echo "  Linked $layout"
    done

    # Add shell integration
    if grep -q "$MARKER" "$RC_FILE" 2>/dev/null; then
        echo "  Shell integration already present in $RC_FILE"
    else
        cat >> "$RC_FILE" <<EOF

$MARKER
export FORGE_DIR="$COCKPIT_DIR"
source "$COCKPIT_DIR/forge.sh"
$MARKER
EOF
        echo "  Added shell integration to $RC_FILE"
    fi

    echo ""
    echo "Done. Restart your shell or run:"
    echo "  source $RC_FILE"
}

uninstall() {
    echo "Uninstalling Forge cockpit..."

    # Remove layout symlinks
    for layout in forge.kdl workspace.kdl; do
        local target="$LAYOUT_DIR/$layout"
        if [ -L "$target" ]; then
            rm "$target"
            echo "  Removed $layout symlink"
            # Restore backup if present
            if [ -f "${target}.bak" ]; then
                mv "${target}.bak" "$target"
                echo "  Restored ${target}.bak"
            fi
        fi
    done

    # Remove shell integration
    if grep -q "$MARKER" "$RC_FILE" 2>/dev/null; then
        # Remove everything between the two markers (inclusive)
        sed -i '' "/$MARKER/,/$MARKER/d" "$RC_FILE"
        echo "  Removed shell integration from $RC_FILE"
    else
        echo "  No shell integration found in $RC_FILE"
    fi

    echo ""
    echo "Done. Restart your shell to complete uninstall."
}

case "${1:-}" in
    --uninstall)
        uninstall
        ;;
    ""|--install)
        install
        ;;
    *)
        echo "Usage: $0 [--uninstall]"
        exit 1
        ;;
esac
