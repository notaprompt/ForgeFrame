---
name: status
description: Show current project status -- plan progress, build health, what's next.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash
---

# Project Status

Show current ForgeFrame project state.

## Checks

1. **Build health**
   ```
   cd C:\Users\acamp\Downloads\forgeframe && npm run build 2>&1
   ```

2. **Plan progress** -- read all files in `.claude/plans/` and summarize:
   - Total tasks, pending, in-progress, done, verified
   - Current wave
   - Blocked tasks

3. **Recent git activity**
   ```
   cd C:\Users\acamp\Downloads\forgeframe && git log --oneline -10
   ```

4. **Package status** -- what's in each package:
   - `@forgeframe/memory`: files, exports, tests
   - `@forgeframe/core`: files, exports, tests

## Output format

```
## ForgeFrame Status

**Build**: pass/fail
**Last commit**: [hash] [message] [time ago]

### Packages
- @forgeframe/memory: [N files, M exports, K tests]
- @forgeframe/core: [N files, M exports, K tests]

### Plan: [active plan name]
- Wave 1: [done/in-progress/pending] ([N/M tasks])
- Wave 2: [status]
- Next action: [what to do next]
```
