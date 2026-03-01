---
name: plan
description: Create a spec-driven implementation plan for a feature or milestone. Breaks work into dependency-ordered tasks with verification criteria.
disable-model-invocation: true
argument-hint: "[feature-or-milestone]"
allowed-tools: Read, Grep, Glob, Bash, Write, Edit
---

# Plan Phase

Create an implementation plan for: $ARGUMENTS

## Process

1. **Read current state** -- check the codebase, understand what exists, what's built, what's missing
2. **Read private docs** if relevant -- check `C:\Users\acamp\Downloads\forgeframe-private\` for specs and architecture decisions
3. **Break into tasks** -- each task should be:
   - Small enough to complete in one focused subagent session
   - Have clear inputs and outputs
   - Have a verification criteria (how do we know it's done?)
   - Specify which files it touches
4. **Order by dependencies** -- tasks that block others come first
5. **Write the plan** to `.claude/plans/` as a markdown file

## Plan file format

Write to `.claude/plans/PLAN_[feature-name].md`:

```markdown
# Plan: [Feature Name]
## Created: [date]
## Status: draft

### Goal
[One sentence: what does "done" look like?]

### Tasks

#### Task 1: [name]
- **Files**: [which files are created or modified]
- **Depends on**: [none, or task numbers]
- **Spec**: [exactly what to build]
- **Verify**: [how to confirm it works]
- **Status**: pending

#### Task 2: [name]
...

### Wave grouping
- **Wave 1** (parallel): Task 1, Task 2
- **Wave 2** (parallel, after wave 1): Task 3, Task 4
- **Wave 3**: Task 5
```

## Rules

- No task should require more than ~500 lines of code
- If a task is bigger, split it
- Every task must have a verify step that can be checked mechanically (build passes, test passes, command runs)
- Don't plan what you don't understand yet -- if research is needed, make that Task 1
- Match existing code style. Read before planning.
