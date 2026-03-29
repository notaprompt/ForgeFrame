# Forge cockpit — terminal workspace manager for ForgeFrame
# Source this file in your shell rc: source <path>/cockpit/forge.sh

FORGE_DIR="${FORGE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"

_fza() {
    zellij action "$@"
}

forge() {
    case "$1" in
        "")
            if zellij list-sessions 2>/dev/null | grep -q "^forge.*ALIVE"; then
                zellij attach forge
            else
                zellij kill-session forge 2>/dev/null
                zellij delete-session forge 2>/dev/null
                rm -rf ~/Library/Caches/org.Zellij-Contributors.Zellij/sessions/forge 2>/dev/null
                echo "claude" > ~/.forge-sessions
                zellij --layout "$FORGE_DIR/layouts/forge.kdl"
            fi
            ;;
        new)
            local count dir project
            count=$(wc -l < ~/.forge-sessions 2>/dev/null | tr -d ' ')
            local next=$((count + 1))
            if [ -n "$2" ] && [ -d "$2" ]; then
                dir="$(cd "$2" && pwd)"
            else
                dir="$(bash "$FORGE_DIR/scripts/forge-picker.sh")"
            fi
            project="$(basename "$dir")"
            _fza new-tab --layout "$FORGE_DIR/layouts/workspace.kdl" --name "$next" --cwd "$dir"
            echo "claude:$project" >> ~/.forge-sessions
            touch ~/.forge-refresh
            echo "forge $next -> $project"
            ;;
        [0-9]*)
            local count
            count=$(wc -l < ~/.forge-sessions 2>/dev/null | tr -d ' ')
            if [ "$1" -gt "$count" ] 2>/dev/null; then
                echo "forge $1 does not exist — $count open"
            else
                _fza go-to-tab "$1"
            fi
            ;;
        show)
            local count
            count=$(wc -l < ~/.forge-sessions 2>/dev/null | tr -d ' ')
            echo "--- forge: $count workspace(s) ---"
            local n=0
            while IFS= read -r tool; do
                n=$((n + 1))
                printf "  \033[33m%d\033[0m  %s\n" "$n" "$tool"
            done < ~/.forge-sessions
            ;;
        mem)
            curl -s "http://127.0.0.1:3001/api/memories/recent?limit=5" 2>/dev/null | node -e "
                let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
                    try{const m=JSON.parse(d);(Array.isArray(m)?m:[]).forEach((r,i)=>{
                        const line=r.content.split('\n')[0].slice(0,80);
                        console.log('\x1b[33m'+(i+1)+'\x1b[0m '+line);
                        console.log('  \x1b[2m'+(r.tags||[]).join(', ')+' | str:'+(r.strength||'?').toString().slice(0,4)+'\x1b[0m');
                    })}catch(e){console.log('daemon offline')}
                })"
            ;;
        stop)
            _fza close-tab
            sed -i '' '$ d' ~/.forge-sessions 2>/dev/null
            touch ~/.forge-refresh
            echo "workspace closed"
            ;;
        nuke)
            zellij kill-all-sessions -y 2>/dev/null
            zellij delete-all-sessions -y 2>/dev/null
            rm -rf ~/Library/Caches/org.Zellij-Contributors.Zellij/sessions/ 2>/dev/null
            rm -f ~/.forge-sessions
            echo "all sessions nuked"
            ;;
        *)
            echo "usage: forge [new|show|mem|stop|nuke|<N>]"
            ;;
    esac
}
