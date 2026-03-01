---
name: verify
description: Verify completed work against plan criteria. Runs builds, checks outputs, confirms tasks are actually done.
disable-model-invocation: true
argument-hint: "[plan-file]"
allowed-tools: Read, Grep, Glob, Bash
---

# Verify Phase

Verify completed work against plan criteria.

## Process

1. **Read the plan** from `.claude/plans/`
2. **For each task marked `done`**, run its verification:
   - Build check: `cd C:\Users\acamp\Downloads\forgeframe && npm run build`
   - File existence: confirm expected files exist
   - Export check: confirm expected exports are importable
   - Test check: run tests if they exist
   - Custom verification: whatever the task's "Verify" field specifies

3. **Report results** as a table:

```
| Task | Verify | Result | Notes |
|------|--------|--------|-------|
| 1    | build  | pass   |       |
| 2    | test   | fail   | missing test for edge case |
```

4. **Update plan** -- mark verified tasks as `verified`, failed verifications as `needs-fix`

5. **If all tasks in a wave verified**, report wave complete and show next wave

## Rules

- Never mark something verified without actually running the check
- If the build is broken, everything fails -- fix the build first
- Be specific about what failed and why
- Don't fix issues during verify -- just report. Fixes happen in the next `/execute` cycle.
