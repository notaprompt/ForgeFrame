#!/bin/bash
# Forge project picker — shows recent repos from ForgeFrame memory
# Falls back to ~/repos/* if no memory available

GOLD='\033[33m'
DIM='\033[2m'
RESET='\033[0m'

# Get recent project directories from ForgeFrame daemon
get_recent_projects() {
    curl -s "http://127.0.0.1:3001/api/memories/recent?limit=50" 2>/dev/null | node -e "
        let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
            try {
                const m=JSON.parse(d);
                const seen=new Map();
                const now=Date.now();
                const home=process.env.HOME||'';
                m.forEach(r=>{
                    const cwd=r.metadata?.cwd||'';
                    if(!cwd) return;
                    if(cwd===home) return;
                    if(cwd.includes('.swarm-worktrees')) return;
                    if(!seen.has(cwd) || r.lastAccessedAt > seen.get(cwd)){
                        seen.set(cwd, r.lastAccessedAt);
                    }
                });
                [...seen.entries()]
                    .sort((a,b)=>b[1]-a[1])
                    .slice(0,8)
                    .forEach(([path,ts])=>{
                        const name=path.split('/').pop();
                        const ago=Math.floor((now-ts)/1000);
                        let label;
                        if(ago<3600) label=Math.floor(ago/60)+'m ago';
                        else if(ago<86400) label=Math.floor(ago/3600)+'h ago';
                        else label=Math.floor(ago/86400)+'d ago';
                        console.log(path+'|'+name+'|'+label);
                    });
            } catch(e){}
        });
    " 2>/dev/null
}

# Fallback: scan ~/repos for git dirs
get_fallback_projects() {
    for dir in ~/repos/*/; do
        if [ -d "$dir/.git" ]; then
            local name
            name=$(basename "$dir")
            echo "${dir%/}|$name|repo"
        fi
    done
}

# Get projects
PROJECTS=$(get_recent_projects)
if [ -z "$PROJECTS" ]; then
    PROJECTS=$(get_fallback_projects)
fi

# Display picker
printf "\n${GOLD}  forge new${RESET}\n\n"

i=0
declare -a PATHS
while IFS='|' read -r path name ago; do
    i=$((i + 1))
    PATHS[$i]="$path"
    printf "  ${GOLD}%d${RESET}  %-20s ${DIM}%s${RESET}\n" "$i" "$name" "$ago"
done <<< "$PROJECTS"

CWD="$(pwd)"
CWD_NAME="$(basename "$CWD")"
printf "  ${GOLD}.${RESET}  here ${DIM}($CWD_NAME)${RESET}\n"
printf "  ${GOLD}0${RESET}  other path...\n"
printf "\n> "

# Read single char
read -r -n 1 CHOICE
echo ""

case "$CHOICE" in
    [1-9])
        if [ -n "${PATHS[$CHOICE]}" ]; then
            echo "${PATHS[$CHOICE]}"
        else
            echo "$CWD"
        fi
        ;;
    .|"")
        echo "$CWD"
        ;;
    0)
        printf "path: "
        read -r CUSTOM
        if [ -d "$CUSTOM" ]; then
            echo "$(cd "$CUSTOM" && pwd)"
        else
            echo "$CWD"
        fi
        ;;
    *)
        echo "$CWD"
        ;;
esac
