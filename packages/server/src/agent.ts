/**
 * @forgeframe/server — Forge Agent
 *
 * Autonomous task execution loop with routing, memory, budget control,
 * and self-evaluation. Runs as a separate process from the daemon,
 * connecting via HTTP for memory operations.
 */

import { EventEmitter } from 'events';
import { ForgeFrameRouter, ProviderRegistry } from '@forgeframe/core';
import type { Tier, ResolvedModel, Message, Model } from '@forgeframe/core';

// -- Interfaces --

export interface AgentConfig {
  task: string;
  cwd: string;
  tier?: Tier;
  budget?: number;
  leash?: 'ask' | 'auto';
  thinking?: boolean;
  principles?: string[];
}

export interface AgentStep {
  type: 'think' | 'tool_call' | 'tool_result' | 'evaluate' | 'done';
  content: string;
  cost?: number;
  timestamp: number;
}

const DEFAULTS = {
  budget: 5.00,
  leash: 'ask' as const,
  maxSteps: 50,
  daemonUrl: 'http://127.0.0.1:3001',
};

// -- Agent --

export class ForgeAgent {
  private _router: ForgeFrameRouter;
  private _registry: ProviderRegistry;
  private _daemonUrl: string;
  private _token: string | undefined;
  private _aborted = false;

  constructor(opts: {
    router: ForgeFrameRouter;
    registry: ProviderRegistry;
    daemonUrl?: string;
    token?: string;
  }) {
    this._router = opts.router;
    this._registry = opts.registry;
    this._daemonUrl = opts.daemonUrl ?? DEFAULTS.daemonUrl;
    this._token = opts.token;
  }

  async run(config: AgentConfig): Promise<AgentStep[]> {
    this._aborted = false;
    const budget = config.budget ?? DEFAULTS.budget;
    const maxSteps = DEFAULTS.maxSteps;

    // Load constitutional principles from daemon memory
    const principles = config.principles ?? await this.loadPrinciples();

    // Resolve model via router
    const resolved = this.resolveModel(config.task, config.tier);
    if (!resolved) {
      return [{
        type: 'done',
        content: 'No model available for this task. Check router configuration.',
        timestamp: Date.now(),
      }];
    }

    const isLocal = this.isLocalModel(resolved);
    const thinkingEnabled = isLocal ? false : (config.thinking ?? true);

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(config.task, config.cwd, principles);

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: config.task },
    ];

    const steps: AgentStep[] = [];
    let totalCost = 0;

    // Core loop: step until done or budget exhausted
    for (let i = 0; i < maxSteps; i++) {
      if (this._aborted) {
        steps.push({
          type: 'done',
          content: 'Agent aborted by user.',
          timestamp: Date.now(),
        });
        break;
      }

      if (!this.checkBudget(totalCost, budget)) {
        steps.push({
          type: 'done',
          content: `Budget exhausted ($${totalCost.toFixed(2)} / $${budget.toFixed(2)}).`,
          timestamp: Date.now(),
        });
        break;
      }

      const step = await this.step(messages, resolved, thinkingEnabled);
      steps.push(step);
      totalCost += step.cost ?? 0;

      // Add assistant response to conversation
      messages.push({ role: 'assistant', content: step.content });

      if (step.type === 'done') break;

      // For tool_call steps, we'd execute the tool and add the result.
      // Tool execution is wired in step 5 (CLI). For now, mark the
      // loop as done after a single think/propose cycle.
      if (step.type === 'tool_call') {
        steps.push({
          type: 'done',
          content: 'Tool execution not yet wired. Stopping after proposal.',
          timestamp: Date.now(),
        });
        break;
      }
    }

    // Self-evaluation pass
    if (!this._aborted && steps.length > 0) {
      const evalStep = await this.evaluate(steps, resolved, thinkingEnabled);
      steps.push(evalStep);
    }

    // Remember findings
    await this.remember(config.task, steps);

    return steps;
  }

  abort(): void {
    this._aborted = true;
  }

  // -- Private: Model Resolution --

  private resolveModel(task: string, tierOverride?: Tier): ResolvedModel | null {
    if (tierOverride) {
      // Find a model matching the explicit tier
      const models = this._router.getModels();
      const match = models.find((m) => m.tier === tierOverride);
      if (match) {
        return {
          provider: match.provider,
          modelId: match.id,
          tier: tierOverride,
          auto: false,
        };
      }
    }
    // Let the router auto-detect from the task string
    return this._router.resolveModel(task);
  }

  private isLocalModel(resolved: ResolvedModel): boolean {
    // Ollama models are local and free
    return resolved.provider === 'ollama';
  }

  // -- Private: Core Loop Step --

  private async step(
    messages: Message[],
    resolved: ResolvedModel,
    thinking: boolean,
  ): Promise<AgentStep> {
    const timestamp = Date.now();

    try {
      const { text, cost } = await this.callModel(messages, resolved, thinking);

      // Classify the response
      const type = this.classifyStep(text);

      return { type, content: text, cost, timestamp };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: 'done',
        content: `Model call failed: ${message}`,
        timestamp,
      };
    }
  }

  private classifyStep(text: string): AgentStep['type'] {
    const lower = text.toLowerCase();
    // If the model indicates it wants to run a tool
    if (lower.includes('tool_call:') || lower.includes('execute:') || lower.includes('```bash')) {
      return 'tool_call';
    }
    // If the model says it's done
    if (lower.includes('task complete') || lower.includes('done.') || lower.includes('finished')) {
      return 'done';
    }
    return 'think';
  }

  // -- Private: Model Communication --

  private async callModel(
    messages: Message[],
    resolved: ResolvedModel,
    thinking: boolean,
  ): Promise<{ text: string; cost: number }> {
    const provider = this._registry.getProvider(resolved.provider);
    if (!provider) {
      throw new Error(`Provider "${resolved.provider}" not registered`);
    }

    // For local models, prepend /no_think to suppress reasoning loops
    const finalMessages = (!thinking && this.isLocalModel(resolved))
      ? this.injectNoThink(messages)
      : messages;

    return new Promise((resolve, reject) => {
      const emitter = provider.sendMessage(finalMessages, {
        model: resolved.modelId,
        stream: false,
        maxTokens: 4096,
      });

      let text = '';
      let inputTokens = 0;
      let outputTokens = 0;

      emitter.on('text_delta', (event: { text: string }) => {
        text += event.text;
      });

      emitter.on('result', (event: { usage: { input_tokens: number; output_tokens: number } }) => {
        inputTokens = event.usage.input_tokens;
        outputTokens = event.usage.output_tokens;
      });

      emitter.on('error', (event: { error: string }) => {
        reject(new Error(event.error));
      });

      emitter.on('done', () => {
        // Rough cost estimate: $3/M input, $15/M output (Claude pricing)
        // Local models are free
        const cost = this.isLocalModel(resolved as ResolvedModel)
          ? 0
          : (inputTokens * 3 + outputTokens * 15) / 1_000_000;
        resolve({ text, cost });
      });

      // Fallback: message_stop without done
      emitter.on('message_stop', () => {
        // Some providers emit message_stop but not done
        // We handle this via the done event primarily
      });
    });
  }

  private injectNoThink(messages: Message[]): Message[] {
    if (messages.length === 0) return messages;
    // Prepend /no_think directive to the system prompt for Qwen models
    const [first, ...rest] = messages;
    if (first.role === 'system') {
      return [
        { role: 'system', content: `/no_think\n${first.content}` },
        ...rest,
      ];
    }
    return [{ role: 'system', content: '/no_think' }, ...messages];
  }

  // -- Private: Budget --

  private checkBudget(spent: number, limit: number): boolean {
    return spent < limit;
  }

  // -- Private: System Prompt --

  private buildSystemPrompt(task: string, cwd: string, principles: string[]): string {
    const parts: string[] = [
      'You are a Forge Agent — an autonomous task executor.',
      `Working directory: ${cwd}`,
      `Task: ${task}`,
      '',
      'Instructions:',
      '- Analyze the task and propose concrete actions.',
      '- For tool calls, prefix with "tool_call:" followed by the tool and arguments.',
      '- For bash commands, wrap in ```bash code blocks.',
      '- When finished, say "Task complete." with a summary of what was done.',
      '- Be precise. Do not speculate. If unsure, say so.',
    ];

    if (principles.length > 0) {
      parts.push('', 'Constitutional constraints:');
      for (const p of principles) {
        parts.push(`- ${p}`);
      }
    }

    return parts.join('\n');
  }

  // -- Private: Memory --

  private async loadPrinciples(): Promise<string[]> {
    try {
      const url = `${this._daemonUrl}/api/memories/by-tag/principle`;
      const headers: Record<string, string> = {};
      if (this._token) {
        headers['Authorization'] = `Bearer ${this._token}`;
      }
      const response = await fetch(url, { headers });
      if (!response.ok) {
        process.stderr.write(`[forge-agent] Failed to load principles: HTTP ${response.status}\n`);
        return [];
      }
      const memories = await response.json() as Array<{ content: string }>;
      return memories.map((m) => m.content);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[forge-agent] Could not reach daemon for principles: ${message}\n`);
      return [];
    }
  }

  private async remember(task: string, steps: AgentStep[]): Promise<void> {
    // The daemon HTTP API is read-only (no POST endpoints for memory writes).
    // Format what we would save and log it. MCP integration will wire this later.
    const thinkSteps = steps.filter((s) => s.type === 'think' || s.type === 'evaluate');
    if (thinkSteps.length === 0) return;

    const totalCost = steps.reduce((sum, s) => sum + (s.cost ?? 0), 0);
    const summary = [
      `Agent run: ${task}`,
      `Steps: ${steps.length}, Cost: $${totalCost.toFixed(4)}`,
      `Outcome: ${steps[steps.length - 1]?.content.slice(0, 200)}`,
    ].join('\n');

    // TODO: Wire to MCP memory_save when available via daemon API
    process.stderr.write(`[forge-agent] Would save to memory:\n${summary}\n`);
  }

  // -- Private: Self-Evaluation (Skeptic) --

  private async evaluate(
    steps: AgentStep[],
    resolved: ResolvedModel,
    thinking: boolean,
  ): Promise<AgentStep> {
    const timestamp = Date.now();

    const stepSummary = steps.map((s, i) =>
      `Step ${i + 1} [${s.type}]: ${s.content.slice(0, 300)}`
    ).join('\n');

    const skepticPrompt: Message[] = [
      {
        role: 'system',
        content: [
          'You are a skeptic reviewer. Review the agent execution log below.',
          'Check for:',
          '- Missed steps or incomplete work',
          '- Dangerous operations (destructive commands, data loss, security issues)',
          '- Incorrect assumptions or hallucinated facts',
          '- Wasted budget or unnecessary steps',
          '',
          'Rate your confidence in the execution: high / medium / low.',
          'If confidence is low, explain what went wrong.',
          'Be concise.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `Execution log:\n${stepSummary}`,
      },
    ];

    try {
      const { text, cost } = await this.callModel(skepticPrompt, resolved, thinking);

      const confidence = this.parseConfidence(text);
      const content = `[confidence: ${confidence}] ${text}`;

      return { type: 'evaluate', content, cost, timestamp };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: 'evaluate',
        content: `Evaluation failed: ${message}`,
        timestamp,
      };
    }
  }

  private parseConfidence(text: string): 'high' | 'medium' | 'low' {
    const lower = text.toLowerCase();
    if (lower.includes('confidence: high') || lower.includes('high confidence')) {
      return 'high';
    }
    if (lower.includes('confidence: low') || lower.includes('low confidence')) {
      return 'low';
    }
    return 'medium';
  }
}
