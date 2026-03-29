#!/usr/bin/env node
/**
 * ForgeFrame session-extract — heuristic session summary extractor
 * Standalone script: no ForgeFrame imports, uses sqlite3 CLI.
 * Reads Claude Code session hook JSON from stdin, parses the JSONL
 * transcript, extracts topics/actions/decisions, writes to memory.db.
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';

const DB_PATH = `${process.env.HOME}/.forgeframe/memory.db`;

// -- Inline regex scrubber (mirrors @forgeframe/proxy/scrub/regex.ts) --
const SCRUB_RULES: { pattern: RegExp; label: string }[] = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, label: 'SSN' },
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, label: 'EMAIL' },
  { pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, label: 'PHONE' },
  { pattern: /AKIA[0-9A-Z]{16}/g, label: 'SECRET' },
  { pattern: /sk-ant-[a-zA-Z0-9_-]{40,}/g, label: 'SECRET' },
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, label: 'SECRET' },
  { pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g, label: 'SECRET' },
  { pattern: /npm_[A-Za-z0-9]{36,}/g, label: 'SECRET' },
  { pattern: /(?:password|secret|token|api[_-]?key)\s*[:=]\s*['"]?[^\s'"]{8,}/gi, label: 'SECRET' },
  { pattern: /-----BEGIN [A-Z ]+ PRIVATE KEY-----/g, label: 'SECRET' },
  { pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, label: 'SECRET' },
  { pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s]+:[^\s@]+@/g, label: 'SECRET' },
];

function scrubContent(text: string): string {
  let result = text;
  for (const rule of SCRUB_RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    result = result.replace(pattern, `[REDACTED:${rule.label}]`);
  }
  return result;
}

interface StdinData {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  reason?: string;
}

function main() {
  let raw = '';
  try {
    raw = readFileSync('/dev/stdin', 'utf-8').trim();
  } catch {
    process.exit(0);
  }
  if (!raw) process.exit(0);

  let input: StdinData;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const { session_id, transcript_path, cwd, reason } = input;
  if (!transcript_path || !existsSync(transcript_path)) process.exit(0);
  if (!existsSync(DB_PATH)) process.exit(0);

  // Read and parse JSONL transcript
  const lines = readFileSync(transcript_path, 'utf-8')
    .split('\n')
    .filter(Boolean);

  const userMessages: string[] = [];
  const assistantMessages: string[] = [];
  const toolCalls: { name: string; input?: string }[] = [];
  const decisions: string[] = [];

  for (const line of lines) {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    // User messages
    if (entry.type === 'user' && entry.message?.role === 'user') {
      const content = entry.message.content;
      if (typeof content === 'string') {
        userMessages.push(content);
        checkDecision(content, decisions);
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === 'text') {
            userMessages.push(part.text);
            checkDecision(part.text, decisions);
          }
        }
      }
    }

    // Assistant messages
    if (entry.type === 'assistant' && entry.message?.role === 'assistant') {
      const content = entry.message.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === 'text') {
            assistantMessages.push(part.text);
          } else if (part.type === 'tool_use') {
            toolCalls.push({ name: part.name, input: summarizeInput(part.input) });
          }
        }
      }
    }
  }

  // Extract topics from file paths and project names
  const topics = extractTopics(userMessages, assistantMessages, toolCalls);

  // Extract actions from tool calls
  const actions = extractActions(toolCalls);

  // Get files changed via git
  const filesChanged = getFilesChanged(cwd);

  // Build summary from last few assistant messages
  const summary = buildSummary(assistantMessages, userMessages);

  // Detect domain tags
  const domainTags = detectDomainTags(topics, toolCalls, cwd);
  const tags = JSON.stringify(['session-log', 'auto-observed', ...domainTags]);

  const now = Date.now();
  const id = randomUUID();
  const content = [
    `Session ${session_id || 'unknown'} (${reason || 'ended'})`,
    '',
    `## Summary`,
    summary,
    '',
    topics.length ? `## Topics\n${topics.join(', ')}` : '',
    actions.length ? `## Actions\n${actions.map(a => `- ${a}`).join('\n')}` : '',
    decisions.length ? `## Decisions\n${decisions.map(d => `- ${d}`).join('\n')}` : '',
    filesChanged.length ? `## Files changed\n${filesChanged.map(f => `- ${f}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const metadata = JSON.stringify({
    source: 'session-hook',
    session_id: session_id || null,
    cwd: cwd || null,
    reason: reason || null,
    transcript_path,
    user_message_count: userMessages.length,
    tool_call_count: toolCalls.length,
  });

  // Scrub secrets/PII before writing to DB
  const scrubbedContent = scrubContent(content);

  // Escape for sqlite3 CLI: double single quotes
  const esc = (s: string) => s.replace(/'/g, "''");

  const sql = `INSERT INTO memories (id, content, strength, access_count, created_at, last_accessed_at, session_id, tags, metadata) VALUES ('${esc(id)}', '${esc(scrubbedContent)}', 0.6, 0, ${now}, ${now}, '${esc(session_id || '')}', '${esc(tags)}', '${esc(metadata)}');`;

  try {
    execSync(`sqlite3 "${DB_PATH}" "${sql.replace(/"/g, '\\"')}"`, {
      timeout: 5000,
    });
  } catch {
    // Don't block Claude — silent fail
    process.exit(0);
  }
}

// --- Helpers ---

function checkDecision(text: string, decisions: string[]) {
  const lower = text.toLowerCase().trim();
  const triggers = ['yes', 'do it', 'ship it', 'kill it', 'keep it', 'go ahead', 'approved', 'lgtm', 'sounds good', 'go for it'];
  for (const t of triggers) {
    if (lower === t || lower.startsWith(t + ' ') || lower.startsWith(t + ',') || lower.startsWith(t + '.')) {
      decisions.push(text.slice(0, 120));
      return;
    }
  }
}

function summarizeInput(input: any): string {
  if (!input) return '';
  if (typeof input === 'string') return input.slice(0, 100);
  if (input.file_path) return input.file_path;
  if (input.command) return input.command.slice(0, 100);
  if (input.pattern) return input.pattern;
  return '';
}

function extractTopics(user: string[], assistant: string[], tools: { name: string; input?: string }[]): string[] {
  const seen = new Set<string>();
  const all = [...user, ...assistant, ...tools.map(t => t.input || '')].join(' ');

  // File paths
  const pathRe = /(?:\/[\w.-]+){2,}/g;
  for (const m of all.matchAll(pathRe)) {
    const p = m[0];
    if (p.includes('/node_modules/') || p.includes('/.claude/')) continue;
    // Extract project-level path
    const parts = p.split('/');
    const reposIdx = parts.indexOf('repos');
    if (reposIdx >= 0 && parts[reposIdx + 1]) {
      seen.add(parts[reposIdx + 1]);
    }
  }

  // Key terms from user messages
  const keywords = ['guardian', 'forgeframe', 'trim', 'resume', 'mcp', 'memory', 'hook', 'session', 'deploy', 'build', 'test', 'refactor', 'bug', 'fix'];
  const combined = user.join(' ').toLowerCase();
  for (const kw of keywords) {
    if (combined.includes(kw)) seen.add(kw);
  }

  return [...seen].slice(0, 10);
}

function extractActions(tools: { name: string; input?: string }[]): string[] {
  const actions: string[] = [];
  const writes = tools.filter(t => t.name === 'Write');
  const edits = tools.filter(t => t.name === 'Edit');
  const bashes = tools.filter(t => t.name === 'Bash');

  if (writes.length) actions.push(`Created ${writes.length} file(s): ${writes.map(w => w.input || '').filter(Boolean).slice(0, 3).join(', ')}`);
  if (edits.length) actions.push(`Edited ${edits.length} file(s): ${edits.map(e => e.input || '').filter(Boolean).slice(0, 3).join(', ')}`);
  if (bashes.length) actions.push(`Ran ${bashes.length} command(s)`);

  return actions;
}

function getFilesChanged(cwd?: string): string[] {
  if (!cwd) return [];
  try {
    const out = execSync('git diff --name-only HEAD~1 2>/dev/null', {
      cwd,
      timeout: 3000,
      encoding: 'utf-8',
    });
    return out.trim().split('\n').filter(Boolean).slice(0, 20);
  } catch {
    return [];
  }
}

function buildSummary(assistant: string[], user: string[]): string {
  // Use last substantive assistant message as summary basis
  const substantive = assistant.filter(m => m.length > 40);
  if (substantive.length) {
    const last = substantive[substantive.length - 1];
    return last.length > 300 ? last.slice(0, 300) + '...' : last;
  }
  // Fallback: summarize from user messages
  if (user.length) {
    return `User asked about: ${user.slice(0, 3).map(m => m.slice(0, 80)).join('; ')}`;
  }
  return 'Short or empty session.';
}

function detectDomainTags(topics: string[], tools: { name: string; input?: string }[], cwd?: string): string[] {
  const tags: string[] = [];
  const topicSet = new Set(topics.map(t => t.toLowerCase()));

  if (topicSet.has('guardian')) tags.push('guardian');
  if (topicSet.has('forgeframe')) tags.push('forgeframe');
  if (topicSet.has('trim')) tags.push('trim');
  if (topicSet.has('resume') || topicSet.has('reframed')) tags.push('career');
  if (topicSet.has('memory') || topicSet.has('mcp')) tags.push('memory');

  // Detect from cwd
  if (cwd) {
    if (cwd.includes('guardian')) tags.push('guardian');
    if (cwd.includes('ForgeFrame') || cwd.includes('forgeframe')) tags.push('forgeframe');
    if (cwd.includes('reframed') || cwd.includes('resume')) tags.push('career');
  }

  return [...new Set(tags)];
}

main();
