# Consolidation Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the MCP bridge bug that's blocking native arrays/integers in tool calls, then absorb three high-leverage workflow skills (/caveman, /skill-creator, /insights) and sketch a Loom prebuild_check tier.

**Architecture:** Stream F is the unblock-the-others stream. F1 patches `packages/server/src/tools.ts` so zod schemas accept stringified arrays/numbers (some MCP clients stringify; the schemas reject). F2-F4 add filesystem skills under `~/.claude/skills/`. F5 is a static design doc dropped into the Loom worktree.

**Tech Stack:** TypeScript (strict, ESM), zod ^3.24, vitest, @modelcontextprotocol/sdk ^1.27, Markdown for skill files.

---

## File Structure

**Created:**
- `packages/server/src/zod-coerce.ts` — coercion helpers (`coerceArray`, `coerceInt`, `coerceNumber`) that accept stringified values
- `packages/server/src/zod-coerce.test.ts` — direct unit tests for the helpers
- `packages/server/src/tools-coercion.test.ts` — integration tests confirming registered tools accept stringified params end-to-end via the McpServer's request handler
- `~/.claude/skills/caveman/SKILL.md` — filler-strip prompt
- `~/.claude/skills/skill-creator/SKILL.md` — eval-first skill scaffolder
- `~/.claude/skills/insights/SKILL.md` — 30-day session retro
- `~/repos/ForgeFrame-loom/PREBUILD_CHECK_SKETCH.md` — Loom router sketch (design only)
- `~/.creature/insights/.keep` — directory for /insights output

**Modified:**
- `packages/server/src/tools.ts` — replace `z.array(z.string()).optional()` and `z.number().optional()` (and friends) with the coercion helpers across all tool registrations

---

## Task F1: MCP bridge coercion fix

**Goal:** Make every zod schema in `tools.ts` accept either native values or JSON-stringified equivalents from MCP clients. The MCP SDK validates incoming arguments against the zod shape; some bridges stringify nested types before serialization, so `tags: ["a","b"]` arrives as `tags: '["a","b"]'`. Zod then rejects with `expected array, received string`.

**Files:**
- Create: `packages/server/src/zod-coerce.ts`
- Create: `packages/server/src/zod-coerce.test.ts`
- Create: `packages/server/src/tools-coercion.test.ts`
- Modify: `packages/server/src/tools.ts` (lines 151, 197-199, 254, 281, 319, 468, 503, 536, 554, 723-729 and any other `z.array` / `z.number` uses inside `registerTools`)

### Step 1: npm install (worktree boot)

- [ ] Install workspace deps so vitest can run.

```bash
cd /Users/acamp/repos/ForgeFrame-sweep
npm install
```

Expected: completes with no errors. (If lockfile drift causes failures, run `npm install --no-audit --no-fund` and report — do NOT use `--force`.)

### Step 2: Write the failing helper tests

- [ ] Create `packages/server/src/zod-coerce.test.ts` with the full content below. These tests exercise the helpers directly so we have fast, focused coverage of coercion behavior.

```typescript
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { coerceArray, coerceInt, coerceNumber } from './zod-coerce.js';

describe('coerceArray', () => {
  const schema = coerceArray(z.string());

  it('passes through native arrays unchanged', () => {
    expect(schema.parse(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('parses JSON-stringified arrays', () => {
    expect(schema.parse('["a","b"]')).toEqual(['a', 'b']);
  });

  it('rejects malformed JSON strings', () => {
    expect(() => schema.parse('not-json')).toThrow();
  });

  it('rejects strings that JSON-parse to non-arrays', () => {
    expect(() => schema.parse('"single"')).toThrow();
    expect(() => schema.parse('42')).toThrow();
  });

  it('preserves item validation', () => {
    const numbers = coerceArray(z.number());
    expect(numbers.parse('[1,2,3]')).toEqual([1, 2, 3]);
    expect(() => numbers.parse('["x"]')).toThrow();
  });
});

describe('coerceInt', () => {
  const schema = coerceInt();

  it('passes through native integers', () => {
    expect(schema.parse(42)).toBe(42);
  });

  it('parses integer strings', () => {
    expect(schema.parse('42')).toBe(42);
  });

  it('rejects non-integer strings', () => {
    expect(() => schema.parse('1.5')).toThrow();
    expect(() => schema.parse('abc')).toThrow();
  });

  it('rejects native floats', () => {
    expect(() => schema.parse(1.5)).toThrow();
  });
});

describe('coerceNumber', () => {
  const schema = coerceNumber();

  it('passes through native numbers (int and float)', () => {
    expect(schema.parse(42)).toBe(42);
    expect(schema.parse(0.5)).toBe(0.5);
  });

  it('parses numeric strings', () => {
    expect(schema.parse('1.5')).toBe(1.5);
    expect(schema.parse('42')).toBe(42);
  });

  it('rejects non-numeric strings', () => {
    expect(() => schema.parse('abc')).toThrow();
  });
});
```

### Step 3: Run the failing tests

- [ ] Confirm the helpers don't exist yet.

```bash
npx vitest run packages/server/src/zod-coerce.test.ts
```

Expected: FAIL — module not found (`zod-coerce.js`).

### Step 4: Implement the helpers

- [ ] Create `packages/server/src/zod-coerce.ts` with the full content below.

```typescript
/**
 * Zod coercion helpers for MCP bridges that stringify nested arguments.
 *
 * Some MCP clients (notably some Claude Code dispatch paths) JSON-stringify
 * arrays and numbers before serializing tool calls over JSON-RPC. The MCP SDK
 * passes those values straight to zod, which then rejects with
 *   "expected array, received string" / "expected number, received string".
 *
 * These helpers wrap the underlying zod schema in a preprocess step that
 * accepts either the native type or its JSON-string form. The fix lives at
 * the schema layer so every tool registration in tools.ts gets it for free.
 */

import { z } from 'zod';

function tryJsonParse(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Array schema that accepts either a native array or a JSON-stringified one. */
export function coerceArray<T extends z.ZodTypeAny>(item: T): z.ZodEffects<z.ZodArray<T>, T['_output'][], unknown> {
  return z.preprocess(tryJsonParse, z.array(item));
}

/** Integer schema that accepts either a native integer or a numeric string. */
export function coerceInt(): z.ZodEffects<z.ZodNumber, number, unknown> {
  return z.preprocess((v) => {
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    }
    return v;
  }, z.number().int());
}

/** Number schema (int or float) that accepts either a native number or a numeric string. */
export function coerceNumber(): z.ZodEffects<z.ZodNumber, number, unknown> {
  return z.preprocess((v) => {
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    }
    return v;
  }, z.number());
}
```

### Step 5: Run the helper tests — expect green

- [ ] Run.

```bash
npx vitest run packages/server/src/zod-coerce.test.ts
```

Expected: PASS — all 14 cases above.

### Step 6: Write the integration test (failing)

- [ ] Create `packages/server/src/tools-coercion.test.ts` with the full content below. This wires up a real `McpServer` + `MemoryStore` + `registerTools` and asserts that calls with stringified params succeed end-to-end.

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { createServer, type ServerInstance } from './server.js';

/**
 * These tests pretend to be a misbehaving MCP bridge that stringifies array
 * and integer args. They go through the same _serverRequestHandler the SDK
 * uses for `tools/call` JSON-RPC requests, so a green test means the wire
 * format works.
 */

describe('tools coercion (stringified MCP bridge args)', () => {
  let instance: ServerInstance | undefined;
  const tmpFiles: string[] = [];

  function provTmp(): string {
    const p = join(tmpdir(), `srv-coerce-${randomUUID()}.jsonl`);
    tmpFiles.push(p);
    return p;
  }

  function makeInstance(): ServerInstance {
    return createServer({
      dbPath: ':memory:',
      provenancePath: provTmp(),
      decayOnStartup: false,
    });
  }

  // The McpServer exposes ._registeredTools internally. We hit the registered
  // callback after letting zod parse the incoming args — exactly the path the
  // SDK uses on every JSON-RPC `tools/call`.
  async function callTool(name: string, rawArgs: unknown): Promise<{ result: unknown; isError: boolean }> {
    const reg = (instance!.server as unknown as { _registeredTools: Record<string, { inputSchema: import('zod').ZodTypeAny; callback: (args: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> }> })._registeredTools;
    const tool = reg[name];
    if (!tool) throw new Error(`tool not registered: ${name}`);
    const parsed = tool.inputSchema.parse(rawArgs);
    const out = await tool.callback(parsed);
    const text = out.content[0]?.text ?? '';
    return { result: JSON.parse(text), isError: out.isError === true };
  }

  afterEach(() => {
    try { instance?.store.close(); } catch {}
    instance = undefined;
    for (const f of tmpFiles) {
      try { unlinkSync(f); } catch {}
    }
    tmpFiles.length = 0;
  });

  it('memory_save accepts stringified tags array', async () => {
    instance = makeInstance();
    const out = await callTool('memory_save', {
      content: 'coercion test 1',
      tags: '["alpha","beta"]',
    });
    expect(out.isError).toBe(false);
    const mem = out.result as { tags: string[] };
    expect(mem.tags).toEqual(['alpha', 'beta']);
  });

  it('memory_save still accepts native tags array', async () => {
    instance = makeInstance();
    const out = await callTool('memory_save', {
      content: 'coercion test 2',
      tags: ['gamma', 'delta'],
    });
    expect(out.isError).toBe(false);
    const mem = out.result as { tags: string[] };
    expect(mem.tags).toEqual(['gamma', 'delta']);
  });

  it('memory_search accepts stringified limit', async () => {
    instance = makeInstance();
    const out = await callTool('memory_search', {
      query: 'anything',
      limit: '5',
    });
    expect(out.isError).toBe(false);
    expect(Array.isArray(out.result)).toBe(true);
  });

  it('memory_list_recent accepts stringified limit', async () => {
    instance = makeInstance();
    instance.store.create({ content: 'recent-1' });
    const out = await callTool('memory_list_recent', { limit: '3' });
    expect(out.isError).toBe(false);
    expect(Array.isArray(out.result)).toBe(true);
  });

  it('memory_list_by_tag accepts stringified limit', async () => {
    instance = makeInstance();
    instance.store.create({ content: 'tagged', tags: ['t1'] });
    const out = await callTool('memory_list_by_tag', { tag: 't1', limit: '10' });
    expect(out.isError).toBe(false);
    expect(Array.isArray(out.result)).toBe(true);
  });

  it('memory_link accepts stringified weight', async () => {
    instance = makeInstance();
    const a = instance.store.create({ content: 'a' });
    const b = instance.store.create({ content: 'b' });
    const out = await callTool('memory_link', {
      sourceId: a.id,
      targetId: b.id,
      relationType: 'related',
      weight: '0.7',
    });
    expect(out.isError).toBe(false);
  });

  it('memory_search rejects malformed stringified tags', async () => {
    instance = makeInstance();
    const reg = (instance.server as unknown as { _registeredTools: Record<string, { inputSchema: import('zod').ZodTypeAny }> })._registeredTools;
    expect(() => reg['memory_search'].inputSchema.parse({
      query: 'x',
      tags: 'not-json',
    })).toThrow();
  });
});
```

### Step 7: Confirm the integration test fails

- [ ] Run.

```bash
npx vitest run packages/server/src/tools-coercion.test.ts
```

Expected: FAIL — most cases throw `expected array, received string` or `expected number, received string`. The native-array case may pass; the stringified ones will not.

### Step 8: Patch tools.ts to use the coercion helpers

- [ ] Edit `packages/server/src/tools.ts`. At the top of the file, add the import after line 18:

```typescript
import { sovereigntyCheck } from './sovereignty.js';
import { coerceArray, coerceInt, coerceNumber } from './zod-coerce.js';
```

- [ ] Replace each affected schema field. The full replacement table:

| Line(s) | Old | New |
|---------|-----|-----|
| 151 | `tags: z.array(z.string()).optional().describe('Tags for categorization')` | `tags: coerceArray(z.string()).optional().describe('Tags for categorization')` |
| 197 | `limit: z.number().optional().describe('Max results (default 10)')` | `limit: coerceInt().optional().describe('Max results (default 10)')` |
| 198 | `tags: z.array(z.string()).optional().describe('Filter by tags')` | `tags: coerceArray(z.string()).optional().describe('Filter by tags')` |
| 199 | `minStrength: z.number().optional().describe('Minimum memory strength (0-1)')` | `minStrength: coerceNumber().optional().describe('Minimum memory strength (0-1)')` |
| 254 | `limit: z.number().optional().describe('Number of memories to return (default 20)')` | `limit: coerceInt().optional().describe('Number of memories to return (default 20)')` |
| 281 | `tags: z.array(z.string()).optional().describe('New tags (replaces existing)')` | `tags: coerceArray(z.string()).optional().describe('New tags (replaces existing)')` |
| 319 | `limit: z.number().optional().describe('Max results (default 50)')` | `limit: coerceInt().optional().describe('Max results (default 50)')` |
| 468 | `limit: z.number().optional().describe('Max results (default 50)')` | `limit: coerceInt().optional().describe('Max results (default 50)')` |
| 503 | `limit: z.number().optional().describe('Max memories to reindex (default 100)')` | `limit: coerceInt().optional().describe('Max memories to reindex (default 100)')` |
| 536 | `weight: z.number().min(0).max(1).optional().describe('Edge weight (0-1)')` | `weight: coerceNumber().pipe(z.number().min(0).max(1)).optional().describe('Edge weight (0-1)')` |
| 554 | `hops: z.number().int().min(1).max(5).optional().describe('Number of hops (default 2)')` | `hops: coerceInt().pipe(z.number().int().min(1).max(5)).optional().describe('Number of hops (default 2)')` |
| 723 | `activeWindowHours: z.number().optional()` | `activeWindowHours: coerceNumber().optional()` |
| 725 | `entrenchedStrength: z.number().optional()` | `entrenchedStrength: coerceNumber().optional()` |
| 727 | `driftingThreshold: z.number().optional()` | `driftingThreshold: coerceNumber().optional()` |
| 729 | `maxPerBucket: z.number().optional()` | `maxPerBucket: coerceInt().optional()` |

After editing, search for any remaining `z.array(` / `z.number(` inside the `registerTools` body and convert them too. (Skip schemas outside `registerTools` like the `HydrationMemory` type defs — those are not tool inputs.)

```bash
grep -n "z\.array\|z\.number" packages/server/src/tools.ts
```

Expected after patch: only matches inside `pipe(z.number()...)` chain calls.

### Step 9: Run all tests in packages/server

- [ ] Confirm green across the whole package — make sure we didn't regress anything.

```bash
npx vitest run --root packages/server
```

Expected: PASS, all suites including the new ones.

### Step 10: Build typecheck

- [ ] Confirm tsc clean.

```bash
npm run build --workspace @forgeframe/server
```

Expected: 0 errors.

### Step 11: Commit and push

- [ ] Stage and commit.

```bash
git add packages/server/src/zod-coerce.ts packages/server/src/zod-coerce.test.ts packages/server/src/tools-coercion.test.ts packages/server/src/tools.ts
git commit -m "$(cat <<'EOF'
server: coerce stringified array/number tool args at the zod boundary

Some MCP bridges stringify nested array and number arguments before
serializing tools/call requests. Zod then rejects with "expected array,
received string". Add coerceArray / coerceInt / coerceNumber helpers
that accept either the native value or its JSON-string form, and apply
them across every tool registration in tools.ts.

Adds direct unit tests for the helpers and an integration suite that
drives the registered tool callbacks with stringified inputs end-to-end.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin feat/consolidation-sweep
```

Expected: push succeeds.

### Step 12: Update master sprint status table

- [ ] Edit `~/.creature/sprint/2026-04-25-master-sprint.md`. In the status table, change row F to `Status: F1 done | Last update: <ISO date> | Next checkpoint: F2 caveman`.

### Step 13: Append the unblock signal to coordination doc

- [ ] After F1+F2+F3 are all complete (so do this after Step 24 below, not now). Append a new heading dated today to the cross-stream notes section:

```markdown
### 2026-04-25 <HH:MM> — F1-F3 complete

MCP bridge fixed - other streams cleared to launch. Native arrays + integer params now accepted on memory_save, memory_search, memory_list_recent, memory_list_by_tag, memory_link, memory_update, session_list, memory_reindex, memory_graph, memory_roadmap. /caveman + /skill-creator skills landed under ~/.claude/skills/.
```

Note: the brief says "after F1-F3" — defer this signal to after F3 ships. F1 alone unblocks the bridge; F2-F3 are skill-side absorptions the brief wants bundled before signaling.

---

## Task F2: /caveman skill

**Goal:** Filler-stripping prompt skill that cuts ~45% of output tokens on dispatch by removing pleasantries, repetition, and pre-amble.

**Files:**
- Create: `~/.claude/skills/caveman/SKILL.md`

### Step 14: Write the SKILL.md

- [ ] Create `~/.claude/skills/caveman/SKILL.md` with the content below.

```markdown
---
name: caveman
description: Strip filler from output. Caveman speech only - load-bearing words, raw evidence, no pleasantries. Use when the user invokes /caveman, asks for "terse mode", "no fluff", or in any dispatch where token economy matters more than tone (cron jobs, batch scrapes, headless agents).
---

# /caveman — strip filler from output

Caveman speech: drop everything that does not carry information. Pleasantries, hedges, transitional summaries, "I will now…", "Let me…", "As you can see…", confidence performance ("This is great!"), recap-of-what-just-happened, and trailing "let me know if…" all gone.

Roughly 45% token cut measured on a sample dispatch (sweep coordination doc, 2026-04-25). Use whenever output is going to a machine, a log, or an attention-budget-constrained reader.

## Activation

When user types `/caveman`, prepends `caveman:` to a request, or sets a session preference for terse mode, follow these rules for every response in that scope until reverted.

## Rules

1. **No pre-amble.** Do not announce what you are about to do. Just do it. The first word of the reply is load-bearing.
2. **No recap.** Do not restate what the user asked. Do not summarize the prior turn.
3. **No hedge stacks.** Pick one qualifier max. "Maybe X" is fine. "I think it might possibly be the case that maybe X" is not.
4. **No filler closers.** Strip "let me know if…", "happy to help", "feel free to ask", "hope this helps".
5. **No emoji.** Default project rule, doubly enforced here.
6. **No section headers when one paragraph suffices.** Headers are for actual structural decomposition, not decoration.
7. **No code-block-explained-twice.** Code is the explanation. One sentence of context if non-obvious, none if obvious.
8. **Short sentences.** Strunk-and-White subject-verb-object. Lists when comparing, prose when narrating.
9. **Direct verbs.** "Run X" not "You should consider running X". "Yes / no / unknown" not "I would say that probably yes".
10. **Tool calls speak for themselves.** Don't narrate "Now I will read the file" before a Read call. The tool call is visible.

## Anti-rules

- Do NOT compress code, error messages, or quoted user content. Caveman applies to *prose*, not artifacts.
- Do NOT skip safety checks, confirmations on destructive ops, or required disclosures. Token economy never overrides correctness.
- Do NOT remove file paths, line numbers, or commands the user needs to act on. Those are signal.

## Reverting

When user says "normal mode", "verbose", "off", or `/caveman off`, drop the rules and return to default tone for the rest of the session.

## Source

Pattern documented by Sabrina Ramonov, "Secret Commands for Claude Code" (sabrina.dev/p/secret-commands-for-claude-code). Absorbed into ForgeFrame skill set 2026-04-25.
```

### Step 15: Quick token-count sanity check

- [ ] Run `wc -w` on a sample-before / sample-after to confirm the rule list shrinks output. (Not gated — informational only.)

```bash
wc -w ~/.claude/skills/caveman/SKILL.md
```

Expected: ~300-400 words. (If much longer, the skill itself violates its own caveman rule — trim.)

### Step 16: Commit

- [ ] Stage and commit. Note: `~/.claude/skills/` is not a git repo by default, but if it is, commit there. If not, the file is already persistent on disk and counts as "shipped" — log it in the worktree commit instead by adding a pointer to `docs/superpowers/plans/2026-04-25-consolidation-sweep.md` STATUS section.

```bash
# Check if ~/.claude is a git repo
git -C ~/.claude rev-parse --git-dir 2>/dev/null && {
  cd ~/.claude
  git add skills/caveman/SKILL.md
  git commit -m "skills: add /caveman filler-strip skill" || true
} || {
  # Not a git repo — log via worktree commit
  cd /Users/acamp/repos/ForgeFrame-sweep
  echo "- 2026-04-25: /caveman skill landed at ~/.claude/skills/caveman/SKILL.md" >> docs/superpowers/plans/2026-04-25-consolidation-sweep.md
  git add docs/superpowers/plans/2026-04-25-consolidation-sweep.md
  git commit -m "plan: log /caveman skill landing"
}
```

### Step 17: Update sprint status

- [ ] Edit `~/.creature/sprint/2026-04-25-master-sprint.md` row F: `Status: F2 done | Last update: <ISO> | Next checkpoint: F3 skill-creator`.

---

## Task F3: /skill-creator pattern

**Goal:** Eval-disciplined wrapper over `superpowers:writing-skills`. Every new skill ships with three benchmark prompts and pass criteria; eval runs before registration.

**Files:**
- Create: `~/.claude/skills/skill-creator/SKILL.md`

### Step 18: Write the SKILL.md

- [ ] Create `~/.claude/skills/skill-creator/SKILL.md` with the content below.

```markdown
---
name: skill-creator
description: Scaffold a new skill with built-in evals. Wraps superpowers:writing-skills with mandatory benchmark generation and a pre-registration eval gate. Use when the user wants to "create a skill", "scaffold a skill", "make a /command", or invokes /skill-creator. Curbs skill sprawl by refusing to register skills that fail their own benchmarks.
---

# /skill-creator — eval-first skill scaffolder

The repo accumulates skills fast. Most ship without acceptance criteria; a fraction get used; the rest become noise. This skill enforces eval discipline: a skill cannot land until it passes three concrete benchmark prompts that exercise the trigger conditions and the rule body.

Built on top of `superpowers:writing-skills` — that skill defines the SKILL.md format and authoring patterns. This skill adds the test layer.

## Activation

Invoke when:
- User types `/skill-creator <name>`.
- User asks to "create a skill", "make a slash command", "scaffold a skill called X".
- A new behavior pattern is being absorbed from an external source (Sabrina, Ramonov, Anthropic docs, etc.) and the user wants it persisted.

## Workflow

### 1. Brief intake

Ask the user — once, terse:
1. Skill name (kebab-case).
2. One-sentence purpose.
3. Three trigger phrases the user expects will activate it.
4. The rule body (what should the skill make Claude do differently?).

If any are unclear, ask. Do not generate a skill from a vague brief — that is exactly the failure mode this skill exists to prevent.

### 2. Scaffold via superpowers:writing-skills

Invoke `superpowers:writing-skills` with the gathered intake. Output goes to `~/.claude/skills/<name>/SKILL.md` with the standard frontmatter.

### 3. Generate three benchmark prompts

Write `~/.claude/skills/<name>/EVAL.md` containing:

```
# <name> — eval bench

## Bench 1 — trigger fires
Prompt: "<one of the user's trigger phrases, slightly paraphrased>"
Pass criteria: skill activates AND output respects rule body.

## Bench 2 — trigger does not fire
Prompt: "<a phrase that sounds adjacent but should NOT activate the skill>"
Pass criteria: skill does not activate. (Negative test — guards against over-eager match.)

## Bench 3 — rule body load test
Prompt: "<a request that requires the skill's rule to actually apply, not just activate>"
Pass criteria: <specific observable evidence the rule shaped the output>.
```

The third bench is the load-bearing one. It is the difference between a skill that gets recognized and a skill that produces value.

### 4. Run the evals

For each bench, dispatch a fresh agent (Agent tool, general-purpose subagent) with the trigger phrase as the entire prompt. Compare output against pass criteria. Record results in `EVAL.md` under each bench.

### 5. Gate

If 3/3 pass: the skill is registered (file already on disk; no further action).
If <3/3 pass: do NOT announce the skill as ready. Show the user the failing bench(es) and ask whether to revise the rule body, the bench, or abandon. Iterate.

## Anti-pattern checks (refuse to scaffold if any apply)

- The skill duplicates an existing one in `~/.claude/skills/` or under any installed plugin. Search first.
- The "rule body" is tone-only with no observable behavior change. ("Be more thoughtful.") Skills must produce diff-able output behavior.
- The trigger phrases are so generic they would fire on every message. ("when the user asks a question")
- The skill is a wrapper around a single shell command with no decision logic. Use a shell alias or `/run` instead.

## Output structure

```
~/.claude/skills/<name>/
  SKILL.md     ← the skill itself (frontmatter + rule body)
  EVAL.md      ← three benchmarks + pass/fail record
```

## Rationale

Sprawl is a tax on every future dispatch. The model has to scan the skill list to decide which apply; longer lists = more scanning = more tokens and more false positives. Evals make the cost of adding a skill non-zero, which is the right incentive.
```

### Step 19: Commit

- [ ] Same dual-path as Step 16 (commit in `~/.claude` if it's a git repo, else log in the worktree).

```bash
git -C ~/.claude rev-parse --git-dir 2>/dev/null && {
  cd ~/.claude
  git add skills/skill-creator/SKILL.md
  git commit -m "skills: add /skill-creator eval-disciplined scaffolder"
} || {
  cd /Users/acamp/repos/ForgeFrame-sweep
  echo "- 2026-04-25: /skill-creator skill landed at ~/.claude/skills/skill-creator/SKILL.md" >> docs/superpowers/plans/2026-04-25-consolidation-sweep.md
  git add docs/superpowers/plans/2026-04-25-consolidation-sweep.md
  git commit -m "plan: log /skill-creator skill landing"
}
```

### Step 20: Sprint status + cross-stream signal

- [ ] Update sprint status row F: `Status: F3 done | Last update: <ISO> | Next checkpoint: F4 insights`.
- [ ] Append to cross-stream notes:

```markdown
### 2026-04-25 <HH:MM> — F1-F3 complete

MCP bridge fixed - other streams cleared to launch. Native arrays + integer params now work end-to-end. /caveman and /skill-creator skills landed under ~/.claude/skills/.
```

This is the unblock signal the brief asked for.

---

## Task F4: /insights skill

**Goal:** 30-day session retrospective. Pulls from ForgeFrame `memory_search` + `session_list` + dispatch logs, clusters via Hebbian neighbors, writes a "what worked / what stalled / what compounded" report.

**Files:**
- Create: `~/.claude/skills/insights/SKILL.md`
- Create: `~/.creature/insights/.keep`

### Step 21: Ensure output directory exists

- [ ] Run.

```bash
mkdir -p ~/.creature/insights
touch ~/.creature/insights/.keep
```

Expected: directory exists.

### Step 22: Write the SKILL.md

- [ ] Create `~/.claude/skills/insights/SKILL.md` with the content below.

```markdown
---
name: insights
description: Generate a 30-day session retrospective. Queries ForgeFrame memory + session_list + dispatch logs, clusters via Hebbian neighbors, writes a "what worked / what stalled / what compounded" report. Use when the user invokes /insights, asks for "monthly review", "what have I been working on", or "30-day retro". Output lands at ~/.creature/insights/YYYY-MM-DD-30d.md.
---

# /insights — 30-day session retrospective

Validates the Strange Loop architecture at the user-visible layer: ForgeFrame already keeps the data (memory + sessions + dispatch logs + Hebbian edges); /insights just renders it.

## Activation

Invoke when:
- User types `/insights` or `/insights 30d`.
- User asks "what did I work on this month", "30-day review", "monthly retro", "what's compounding".

## Workflow

### 1. Compute window

```bash
END=$(date +%Y-%m-%d)
START=$(date -v -30d +%Y-%m-%d 2>/dev/null || date -d "30 days ago" +%Y-%m-%d)
OUT=~/.creature/insights/${END}-30d.md
```

### 2. Pull raw data

Three parallel queries via the forgeframe-memory MCP server:

a. **Sessions in window** — `session_list` with `status: "all"`, then filter by `startedAt >= $START`.

b. **Memories created in window** — `memory_search` with empty query + filter to `createdAt >= $START` (or just `memory_list_recent` with a generous limit, then filter). Capture id, content snippet, tags, strength.

c. **Strong-edge memories** — for each memory in (b), fetch `neighbors` from `memory_search` enrichment. Build adjacency: tag clusters that co-occur on edges weighted >= 0.5.

Dispatch logs (if available) live under `~/.creature/logs/dispatch-*.jsonl` — grep for entries in window.

### 3. Cluster

Group memories by:
- **Strong edges** — connected components in the adjacency graph from step 2c.
- **Tag overlap** — memories sharing >= 2 tags.

Each cluster gets a label = the most common tag, fallback = the noun phrase appearing most in cluster contents.

### 4. Score clusters

Per cluster:
- **What worked** — clusters with rising avg strength over the window AND non-zero edge count. (Hebbian "fired together, wired together".)
- **What stalled** — clusters with falling avg strength OR zero edges (one-off memories that never connected).
- **What compounded** — clusters that grew in member count week-over-week.

### 5. Render report

Write to `$OUT`:

```markdown
# 30-day retro — $END

Window: $START → $END
Sessions: <count>  |  Memories created: <count>  |  Strong edges: <count>

## What worked

<for each "worked" cluster>
### <cluster label> — strength <avg>
<2-3 sentence summary synthesized from cluster member contents>
Member memories: <ids comma-separated>

## What stalled

<same shape>

## What compounded

<same shape — emphasize the week-over-week growth>

## Open threads

<memories with strength > 0.6 but zero edges — high-value but disconnected. Candidates for the next consolidation pass.>
```

### 6. Print path + a one-paragraph summary to the user

Do not dump the full report inline — the file is the artifact. Just say "wrote $OUT — N clusters, X compounded, Y stalled. Top theme: <cluster label>."

## Anti-patterns

- Do NOT pull frontier memories without sovereigntyCheck. `/insights` reads local; report stays local; if the user wants to share it, that's their call.
- Do NOT include raw memory IDs in user-visible prose. IDs go in the "Member memories:" footer line per cluster, not in the body.
- Do NOT block on missing dispatch logs. If absent, skip section, note it in the report metadata.

## Why this validates the Strange Loop

Hebbian wiring is the substrate; /insights is the surface. If the surface report feels coherent (clusters look like real themes, "compounded" matches your gut), the substrate is working. If the report feels random, the wiring layer is mis-tuned. The skill is a free test of the engine.
```

### Step 23: Commit

- [ ] Same dual-path as Step 16/19.

```bash
git -C ~/.claude rev-parse --git-dir 2>/dev/null && {
  cd ~/.claude
  git add skills/insights/SKILL.md
  git commit -m "skills: add /insights 30-day retro skill"
} || {
  cd /Users/acamp/repos/ForgeFrame-sweep
  echo "- 2026-04-25: /insights skill landed at ~/.claude/skills/insights/SKILL.md" >> docs/superpowers/plans/2026-04-25-consolidation-sweep.md
  git add docs/superpowers/plans/2026-04-25-consolidation-sweep.md
  git commit -m "plan: log /insights skill landing"
}
```

### Step 24: Sprint status

- [ ] Update sprint status row F: `Status: F4 done | Last update: <ISO> | Next checkpoint: F5 loom-sketch`.

---

## Task F5: Loom prebuild_check sketch (DESIGN ONLY)

**Goal:** Static design doc that lives in the Loom worktree. Worktree A (Loom) reads it when designing the Loom router. Do NOT implement.

**Files:**
- Create: `~/repos/ForgeFrame-loom/PREBUILD_CHECK_SKETCH.md`

### Step 25: Verify the Loom worktree exists

- [ ] Check.

```bash
test -d ~/repos/ForgeFrame-loom && echo OK || echo "MISSING — write to ~/.creature/sprint/F5-loom-sketch.md instead and note in coordination doc"
```

Expected: `OK`. If missing, fall back to writing the file under `~/.creature/sprint/` and note the deviation in the coordination doc.

### Step 26: Write the sketch

- [ ] Create `~/repos/ForgeFrame-loom/PREBUILD_CHECK_SKETCH.md` (or fallback path) with the content below.

```markdown
# Loom prebuild_check tier — design sketch

Status: DESIGN ONLY. Do not implement until A1 router scaffold exists.
Author: Stream F (consolidation-sweep), 2026-04-25.

## What this is

A new tier in the Loom router. Before Loom dispatches a build/run/scrape job, it runs a fast intent-anchor scan to check whether the user's request maps to a known recent context. The check returns a scored rollup; Loom uses the score to decide route (cache hit → reuse, cold → full dispatch, conflict → ask user).

Pattern absorbed from `idea-reality-mcp` (recon transcript at `/private/tmp/claude-501/.../tasks/a415c8eb7b9e03e16.output`). Adapted to ForgeFrame primitives so the whole tier stays sovereign.

## Sources scanned (parallel, ~6)

1. **ForgeFrame memory** — `memory_search` with extracted keywords, top 10 by score+strength.
2. **Recent sessions** — `session_list` last 7 days, match keywords against session metadata.
3. **Dispatch log** — `~/.creature/logs/dispatch-*.jsonl` grep for keywords.
4. **Open worktrees** — `git worktree list` + branch name match.
5. **Sprint coordination doc** — `~/.creature/sprint/*master-sprint*.md` grep.
6. **Local notepad** — `~/.claude/personas/notepad/*.md` grep.

All six fire concurrently via `httpx.AsyncClient` (or Node `Promise.all` with the MCP client + fs reads). Total budget: 800ms p95.

## Intent-anchor extraction

Local-only. Use Ollama (`qwen2.5:7b-instruct` is fine — no need for the 32b for keyword extraction) with a prompt:

```
Extract 3-5 noun-phrase keywords from this user request. Output JSON array of strings, no prose.

Request: <user input>
```

No phone-home. Sovereignty intact. Cache by hash(request) → keywords for 1h.

## Scoring rollup

Per source, score = num_matches * source_weight. Weights:

| Source | Weight | Why |
|--------|--------|-----|
| memory | 1.0 | semantic match is highest signal |
| sessions | 0.7 | recent intent |
| dispatch | 0.6 | "have we done this exact thing" |
| worktrees | 0.8 | "are we in the middle of this" |
| sprint doc | 0.5 | "is this on the official plan" |
| notepad | 0.4 | low-fi but catches stuff that hasn't memory_save'd yet |

Total score → bucket:
- **>= 5**: hot — likely cache hit, suggest reuse path. Example: "yes, you started this 2 hours ago in worktree X, branch Y."
- **2-5**: warm — adjacent context, mention but proceed.
- **< 2**: cold — fresh dispatch, no rollup shown.

## Output shape

```json
{
  "score": 6.4,
  "bucket": "hot",
  "matches": {
    "memory": [{"id": "...", "content": "...", "score": 0.83}],
    "sessions": [...],
    "worktrees": [{"path": "/Users/acamp/repos/foo", "branch": "feat/foo"}],
    ...
  },
  "suggested_route": "reuse",
  "rationale": "active worktree + 3 strong memories from last 48h"
}
```

## Where this lives in the Loom router

Tier order:
1. **prebuild_check** ← this. Cheap, local, parallel.
2. **router** (existing) — picks model tier.
3. **dispatch** (existing) — runs the job.

prebuild_check returns a hint, not a decision. The router still owns routing; it just gets the rollup as one more input.

## Sovereignty

Every source is local. No API calls. Ollama runs on-device. The whole tier could run on a plane.

## Open questions for Worktree A

1. Should prebuild_check be opt-in per request or always-on? (Recommend: always-on with a `--no-precheck` flag for the rare case the user wants a clean slate.)
2. Cache invalidation for the keyword extractor — is 1h right, or should it be session-scoped?
3. Conflict resolution UI: when the rollup says "you have an open worktree on this", does Loom hard-stop and prompt, or just include the path in its plan output?

These are A1's call. This sketch just locks the shape.
```

### Step 27: Commit

- [ ] Stage in the loom worktree (separate git tree). The Loom worktree is a different git checkout — committing there lands the file on `feat/loom-organ` branch.

```bash
cd ~/repos/ForgeFrame-loom
git add PREBUILD_CHECK_SKETCH.md
git commit -m "design: prebuild_check tier sketch (from Stream F)"
# Do NOT push - that's Worktree A's call.
cd /Users/acamp/repos/ForgeFrame-sweep
```

If `~/repos/ForgeFrame-loom` does not exist, the file goes to `~/.creature/sprint/F5-loom-sketch.md` and we note the deviation in the coordination doc.

### Step 28: Sprint status — final

- [ ] Update sprint status row F: `Status: complete | Last update: <ISO> | Next checkpoint: -`.

### Step 29: Final verification

- [ ] Run.

```bash
cd /Users/acamp/repos/ForgeFrame-sweep
git log --oneline origin/main..feat/consolidation-sweep
npx vitest run --root packages/server
```

Expected: at least one F1 commit visible (server/coerce); all server tests green.

---

## Self-review notes (filled in during plan authoring)

**Spec coverage:** F1-F5 each map to a task block above. F1 has 13 steps (the load-bearing one); F2-F5 are smaller. Cross-stream unblock signal scheduled at end of F3 per brief language.

**Placeholder scan:** No "TBD" / "implement later" / "similar to". Every code block is concrete. Every shell command is runnable as written.

**Type consistency:** `coerceArray`, `coerceInt`, `coerceNumber` names are stable across the plan. The `pipe()` chain pattern in step 8 keeps existing constraints (`.min(0).max(1)` on weight, `.int().min(1).max(5)` on hops) intact after preprocessing.

**Risk: SKILL.md word count.** The /insights skill is the longest. If it ships at >800 words, trim the rationale section before commit.

**STOP signal honored:** If F1 step 9 (full vitest run) is still red after 2 hours of attempts, write a checkpoint memo at `~/.creature/sprint/F1-blocked.md` and stop. F2-F5 remain valuable but they should not run on a broken bridge — the brief explicitly defers to weekend in that case.
