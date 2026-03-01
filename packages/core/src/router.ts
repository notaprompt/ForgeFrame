/**
 * @forgeframe/core — ForgeFrameRouter
 *
 * Routes user messages to the optimal model based on intent signals.
 * Supports tier-based routing: quick, balanced, deep.
 *
 * No baked-in models — consumers register models via loadModels() or the constructor.
 */

import type { Tier, Model, ResolvedModel, ModelInfo, ConfigStore, Logger } from './types.js';
import { createConsoleLogger } from './types.js';

// -- Intent Signal Patterns --

const DEEP_SIGNALS: RegExp[] = [
  /\banalyze\b/i,
  /\banalysis\b/i,
  /\bexplain in detail\b/i,
  /\bdeep dive\b/i,
  /\bcompare and contrast\b/i,
  /\bcritique\b/i,
  /\bevaluate\b/i,
  /\bwhy does\b/i,
  /\bwhat are the implications\b/i,
  /\barchitecture\b/i,
  /\bdesign pattern\b/i,
  /\btrade.?offs?\b/i,
  /\bphilosoph/i,
  /\btheor(?:y|etical|ize)\b/i,
  /\bproof\b/i,
  /\bderive\b/i,
  /\bresearch\b/i,
  /\blong.?form\b/i,
];

const QUICK_SIGNALS: RegExp[] = [
  /^(?:what|who|when|where|how) (?:is|are|was|were|do|does|did|can|could|would|should) /i,
  /\bquick(?:ly)?\b/i,
  /\bbrief(?:ly)?\b/i,
  /\btl;?dr\b/i,
  /\bsummar(?:y|ize)\b/i,
  /\bdefine\b/i,
  /\bwhat does .{1,30} mean/i,
  /\bremind me\b/i,
  /\byes or no\b/i,
  /\bone.?liner\b/i,
  /\bshort answer\b/i,
];

const PROVIDER_COST_ORDER: Record<string, number> = {
  'openai-compatible': 0,
  ollama: 0,
  anthropic: 1,
};

// -- Settings shape stored in ConfigStore --

interface ForgeFrameSettings {
  forgeframe?: {
    autoRoute?: boolean;
    selectedModel?: string;
  };
  [key: string]: unknown;
}

// -- Router --

export class ForgeFrameRouter {
  private _models: Model[];
  private _configStore: ConfigStore | null;
  private _log: Logger;

  constructor(opts: { configStore?: ConfigStore; logger?: Logger; models?: Model[] } = {}) {
    this._configStore = opts.configStore ?? null;
    this._log = opts.logger ?? createConsoleLogger();
    this._models = opts.models ? [...opts.models] : [];
  }

  detectIntent(message: string): Tier {
    if (!message || typeof message !== 'string') return 'balanced';

    const text = message.trim();

    if (text.length < 20 && !DEEP_SIGNALS.some((r) => r.test(text))) {
      return 'quick';
    }

    if (text.length > 500) {
      return 'deep';
    }

    if (DEEP_SIGNALS.some((r) => r.test(text))) {
      return 'deep';
    }

    if (QUICK_SIGNALS.some((r) => r.test(text))) {
      return 'quick';
    }

    return 'balanced';
  }

  resolveModel(message: string, override?: string | null): ResolvedModel | null {
    if (this._models.length === 0) return null;

    if (override && override !== 'auto') {
      const model = this._models.find((m) => m.id === override);
      if (model) {
        return { provider: model.provider, modelId: model.id, tier: model.tier, auto: false };
      }
    }

    const settings = this._readSettings();
    const autoRoute = settings.forgeframe?.autoRoute !== false;

    if (autoRoute && override !== 'manual-lock') {
      const tier = this.detectIntent(message);

      if (tier === 'quick') {
        const cheapest = this.getCheapestModel('quick');
        if (cheapest) {
          return { provider: cheapest.provider, modelId: cheapest.id, tier, auto: true };
        }
      }

      const model = this._models.find((m) => m.tier === tier);
      if (model) {
        return { provider: model.provider, modelId: model.id, tier, auto: true };
      }
    }

    const persistedId = settings.forgeframe?.selectedModel;
    const model = (persistedId && this._models.find((m) => m.id === persistedId)) || this._models[0];
    return { provider: model.provider, modelId: model.id, tier: model.tier, auto: false };
  }

  getModels(): ModelInfo[] {
    return this._models.map((m) => ({
      id: m.id,
      label: m.label,
      provider: m.provider,
      providerName: m.providerName || null,
      description: m.description,
      tier: m.tier,
    }));
  }

  getCheapestModel(tier: Tier): Model | null {
    const candidates = this._models.filter((m) => m.tier === tier);
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const costA = PROVIDER_COST_ORDER[a.providerType || a.provider] ?? 0;
      const costB = PROVIDER_COST_ORDER[b.providerType || b.provider] ?? 0;
      return costA - costB;
    });

    return candidates[0];
  }

  loadModels(models: Model[]): void {
    this._models = [...models];
    this._log.info(`ForgeFrame: loaded ${models.length} model(s)`);
  }

  getSelectedModel(): string | null {
    const settings = this._readSettings();
    return settings.forgeframe?.selectedModel ?? null;
  }

  setSelectedModel(modelId: string): void {
    const settings = this._readSettings();
    if (!settings.forgeframe) settings.forgeframe = {};
    settings.forgeframe.selectedModel = modelId;
    this._writeSettings(settings);
    this._log.info('ForgeFrame: model set to', modelId);
  }

  getAutoRoute(): boolean {
    const settings = this._readSettings();
    return settings.forgeframe?.autoRoute !== false;
  }

  setAutoRoute(enabled: boolean): void {
    const settings = this._readSettings();
    if (!settings.forgeframe) settings.forgeframe = {};
    settings.forgeframe.autoRoute = enabled;
    this._writeSettings(settings);
    this._log.info('ForgeFrame: auto-route', enabled ? 'enabled' : 'disabled');
  }

  private _readSettings(): ForgeFrameSettings {
    if (!this._configStore) return {};
    return this._configStore.read<ForgeFrameSettings>('settings', {});
  }

  private _writeSettings(settings: ForgeFrameSettings): void {
    if (!this._configStore) return;
    this._configStore.write('settings', settings);
  }
}
