/**
 * @forgeframe/server — Agent CLI
 *
 * Implements `forgeframe agent run|stop|log` subcommands.
 * The agent runs as a foreground process, separate from the daemon.
 * PID tracked at ~/.forgeframe/agent.pid.
 * Run logs saved to ~/.forgeframe/agent-runs/{timestamp}.json.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { ForgeAgent } from './agent.js';
import type { AgentConfig, AgentStep } from './agent.js';
import { ForgeFrameRouter, ProviderRegistry, OpenAIProvider, AnthropicAPIProvider } from '@forgeframe/core';
import type { Tier, Model } from '@forgeframe/core';

const FORGEFRAME_DIR = resolve(homedir(), '.forgeframe');
const AGENT_PID_PATH = resolve(FORGEFRAME_DIR, 'agent.pid');
const AGENT_RUNS_DIR = resolve(FORGEFRAME_DIR, 'agent-runs');

// -- Arg Parsing --

function flagValue(args: string[], name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function extractTask(args: string[]): string | null {
  // Find first positional arg, skipping --flag value pairs
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      i++; // skip the flag's value
      continue;
    }
    return args[i];
  }
  return null;
}

// -- Config Loading --

interface FileConfig {
  models?: Model[];
  embedding?: { url?: string; model?: string };
}

function loadFileConfig(): FileConfig {
  const configPath = resolve(FORGEFRAME_DIR, 'config.json');
  try {
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, 'utf-8')) as FileConfig;
    }
  } catch { /* ignore corrupt config */ }
  return {};
}

function createRouterAndRegistry(): { router: ForgeFrameRouter; registry: ProviderRegistry } {
  const fileConfig = loadFileConfig();
  const registry = new ProviderRegistry();
  const router = new ForgeFrameRouter();

  // Register providers
  // Ollama: always available, no auth, local
  registry.register('ollama', new OpenAIProvider({
    baseUrl: process.env.OLLAMA_HOST || 'http://localhost:11434',
    noAuth: true,
    name: 'Ollama',
  }));

  // Anthropic: available if API key set
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    registry.register('anthropic', new AnthropicAPIProvider({
      keyStore: { getKey: (id: string) => id === 'anthropic' ? anthropicKey : null },
    }));
  }

  // Load models from config, or fall back to a sensible default
  const models: Model[] = fileConfig.models ?? [
    { id: 'qwen3:32b', label: 'Qwen 3 32B', provider: 'ollama', tier: 'balanced', description: 'Local balanced' },
    { id: 'llama3.2:1b', label: 'Llama 3.2 1B', provider: 'ollama', tier: 'quick', description: 'Fast local' },
  ];

  router.loadModels(models);
  return { router, registry };
}

// -- Run Log --

interface AgentRunLog {
  task: string;
  startedAt: string;
  finishedAt: string;
  steps: number;
  cost: number;
  outcome: 'completed' | 'aborted' | 'budget_exceeded' | 'error';
  model: string;
}

function determineOutcome(steps: AgentStep[]): AgentRunLog['outcome'] {
  if (steps.length === 0) return 'error';
  const last = steps[steps.length - 1];
  if (last.content.includes('aborted')) return 'aborted';
  if (last.content.includes('Budget exhausted')) return 'budget_exceeded';
  if (last.type === 'done' && !last.content.toLowerCase().includes('failed')) return 'completed';
  return 'error';
}

function saveRunLog(log: AgentRunLog): void {
  mkdirSync(AGENT_RUNS_DIR, { recursive: true });
  const ts = log.startedAt.replace(/[:.]/g, '-');
  const logPath = resolve(AGENT_RUNS_DIR, `${ts}.json`);
  writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n', 'utf-8');
}

// -- PID Management --

function writeAgentPid(): void {
  mkdirSync(FORGEFRAME_DIR, { recursive: true });
  writeFileSync(AGENT_PID_PATH, String(process.pid), 'utf-8');
}

function cleanAgentPid(): void {
  try { unlinkSync(AGENT_PID_PATH); } catch { /* already gone */ }
}

// -- Subcommands --

export async function runAgent(args: string[]): Promise<void> {
  const task = extractTask(args);
  if (!task) {
    process.stderr.write('Error: task is required.\n');
    process.stderr.write('Usage: forgeframe agent run "task" [--tier quick|balanced|deep] [--budget N] [--leash ask|auto]\n');
    process.exit(1);
  }

  const tierArg = flagValue(args, 'tier', '') as Tier | '';
  const tier = (['quick', 'balanced', 'deep'].includes(tierArg) ? tierArg : undefined) as Tier | undefined;
  const budget = parseFloat(flagValue(args, 'budget', '5'));
  const leash = flagValue(args, 'leash', 'ask') as 'ask' | 'auto';

  const { router, registry } = createRouterAndRegistry();
  const agent = new ForgeAgent({ router, registry });

  // Write PID so `forge agent stop` can find us
  writeAgentPid();

  // Handle SIGINT/SIGTERM for graceful abort
  let interrupted = false;
  const onSignal = () => {
    if (!interrupted) {
      interrupted = true;
      process.stderr.write('\n[forge-agent] Aborting...\n');
      agent.abort();
    }
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const startedAt = new Date().toISOString();
  process.stdout.write(`[forge-agent] Task: ${task}\n`);
  process.stdout.write(`[forge-agent] Budget: $${budget.toFixed(2)} | Leash: ${leash} | Tier: ${tier ?? 'auto'}\n`);
  process.stdout.write(`[forge-agent] Running...\n\n`);

  const config: AgentConfig = {
    task,
    cwd: process.cwd(),
    tier,
    budget,
    leash,
  };

  let steps: AgentStep[] = [];
  let resolvedModel = 'unknown';

  try {
    steps = await agent.run(config);

    // Print each step
    for (const step of steps) {
      const ts = new Date(step.timestamp).toISOString().slice(11, 19);
      const costStr = step.cost ? ` ($${step.cost.toFixed(4)})` : '';
      process.stdout.write(`  [${ts}] ${step.type}: ${step.content.slice(0, 200)}${costStr}\n`);
    }

    // Try to get the model from the router
    const resolved = router.resolveModel(task);
    if (resolved) resolvedModel = resolved.modelId;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[forge-agent] Error: ${message}\n`);
    steps.push({
      type: 'done',
      content: `Fatal error: ${message}`,
      timestamp: Date.now(),
    });
  }

  const finishedAt = new Date().toISOString();
  const totalCost = steps.reduce((sum, s) => sum + (s.cost ?? 0), 0);
  const outcome = determineOutcome(steps);

  // Save run log
  const runLog: AgentRunLog = {
    task,
    startedAt,
    finishedAt,
    steps: steps.length,
    cost: totalCost,
    outcome,
    model: resolvedModel,
  };
  saveRunLog(runLog);

  process.stdout.write(`\n[forge-agent] ${outcome} | ${steps.length} steps | $${totalCost.toFixed(4)} | ${resolvedModel}\n`);

  // Clean up
  cleanAgentPid();
  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);

  process.exit(outcome === 'completed' ? 0 : 1);
}

export function stopAgent(): void {
  if (!existsSync(AGENT_PID_PATH)) {
    process.stderr.write('No running agent found.\n');
    process.exit(1);
  }

  let pid: number;
  try {
    pid = parseInt(readFileSync(AGENT_PID_PATH, 'utf-8').trim(), 10);
  } catch {
    process.stderr.write('Could not read agent PID file.\n');
    process.exit(1);
    return; // unreachable, satisfies TS
  }

  if (isNaN(pid)) {
    process.stderr.write('Malformed agent PID file.\n');
    cleanAgentPid();
    process.exit(1);
  }

  try {
    process.kill(pid, 'SIGTERM');
    process.stdout.write(`Agent stopped (pid ${pid}).\n`);
  } catch {
    process.stderr.write(`Agent process ${pid} not running. Cleaning up PID file.\n`);
  }

  cleanAgentPid();
}

export async function showAgentLog(): Promise<void> {
  if (!existsSync(AGENT_RUNS_DIR)) {
    process.stdout.write('No agent runs found.\n');
    return;
  }

  const files = readdirSync(AGENT_RUNS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .slice(-10); // last 10 runs

  if (files.length === 0) {
    process.stdout.write('No agent runs found.\n');
    return;
  }

  process.stdout.write('Recent agent runs:\n\n');

  for (const file of files) {
    try {
      const raw = readFileSync(resolve(AGENT_RUNS_DIR, file), 'utf-8');
      const log = JSON.parse(raw) as AgentRunLog;
      const started = log.startedAt.slice(0, 19).replace('T', ' ');
      const outcomeColor = log.outcome === 'completed' ? '\x1b[32m' : '\x1b[31m';
      process.stdout.write(
        `  ${started}  ${outcomeColor}${log.outcome}\x1b[0m  ${log.steps} steps  $${log.cost.toFixed(4)}  ${log.model}\n` +
        `    ${log.task.slice(0, 80)}\n\n`,
      );
    } catch {
      // Skip corrupt log files
    }
  }
}
