---
name: execute
description: Execute tasks from a plan file using subagents. Each task runs in a fresh context to prevent context rot.
disable-model-invocation: true
argument-hint: "[plan-file-or-wave-number]"
allowed-tools: Read, Grep, Glob, Bash, Write, Edit, Task
---

# Execute Phase

Execute tasks from a plan.

## Process

1. **Read the plan** -- find the plan file in `.claude/plans/`. If $ARGUMENTS is a wave number, execute only that wave. If it's a plan filename, execute the next pending wave.

2. **For each wave**, launch tasks in parallel using the Task tool:
   - Each task gets its own subagent with fresh context
   - Pass the task spec verbatim as the subagent prompt
   - Include: which files to read first, what to build, verification criteria
   - Use `subagent_type: "general-purpose"` for implementation tasks
   - Use `isolation: "worktree"` only if tasks modify the same files (usually not needed within a well-planned wave)

3. **Collect results** -- when subagents complete, check their output against the verification criteria

4. **Update plan file** -- mark completed tasks as `done`, failed tasks as `failed` with reason

5. **Do NOT proceed to next wave** until all tasks in current wave are verified

## Subagent prompt template

When spawning a subagent for a task, use this structure:

```
You are implementing a task for the ForgeFrame project.

Project: ForgeFrame -- sovereign AI middleware (routing, memory, provenance)
Location: C:\Users\acamp\Downloads\forgeframe
Stack: TypeScript, Node.js 20+, ESM modules, npm workspaces

## Your task
[paste task spec from plan]

## Files to read first
[list from plan]

## Verification
[paste verify criteria]

## Rules
- Match existing code style
- No speculative features
- No unnecessary abstractions
- Every changed line traces to the task spec
- Run `npm run build` to verify compilation before finishing
```

## Rules

- Never execute tasks with unresolved dependencies
- If a task fails, stop the wave and report -- don't continue with broken state
- Keep main context clean -- let subagents do the heavy lifting
- After execution, always run `/verify` to confirm the wave
