#!/bin/bash
# Forge cockpit display — status panel for the forge sidebar

REGISTRY="$HOME/.forge-sessions"
REFRESH="$HOME/.forge-refresh"
touch "$REFRESH"

# Set terminal title
printf '\e]0;Forge\a'

# Start daemon via published CLI
forgeframe stop 2>/dev/null
forgeframe start 2>/dev/null

render() {
    clear
    printf '\033[33m━━━ FORGE ━━━\033[0m\n\n'

    # Daemon status
    if curl -s "http://127.0.0.1:3001/api/status" >/dev/null 2>&1; then
        printf ' \033[32m● daemon ON\033[0m  :3001\n'
    else
        printf ' \033[31m○ daemon OFF\033[0m\n'
    fi
    printf '\n'

    # Workspaces
    local count=0
    if [ -f "$REGISTRY" ]; then
        count=$(wc -l < "$REGISTRY" | tr -d ' ')
    fi
    printf '\033[33m workspaces (%d)\033[0m\n' "$count"
    printf ' ──────────\n'
    if [ -f "$REGISTRY" ]; then
        local n=0
        while IFS= read -r tool; do
            n=$((n + 1))
            printf ' \033[33m %d\033[0m  %s\n' "$n" "$tool"
        done < "$REGISTRY"
    fi
    printf '\n'

    printf '\033[2m forge new   add\033[0m\n'
    printf '\033[2m forge <#>   switch\033[0m\n'
    printf '\033[2m forge stop  close\033[0m\n'
    printf '\033[2m forge mem   memories\033[0m\n'
}

render

while true; do
    if [ "$REFRESH" -nt /tmp/.forge-last-render ] 2>/dev/null; then
        touch /tmp/.forge-last-render
        sleep 0.3
        render
    fi
    sleep 1
done
