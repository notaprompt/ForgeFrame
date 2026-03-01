import { describe, it, expect, beforeEach } from 'vitest';
import { ForgeFrameRouter } from './router.js';
import type { ConfigStore, Model, Logger } from './types.js';

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function createMemoryConfigStore(): ConfigStore {
  const data = new Map<string, unknown>();
  return {
    read: <T>(key: string, fallback: T): T => (data.get(key) as T) ?? fallback,
    write: (key: string, value: unknown) => data.set(key, value),
  };
}

const quickModel: Model = {
  id: 'qwen-3b',
  label: 'Qwen 3B',
  provider: 'ollama',
  providerType: 'ollama',
  description: 'Fast local',
  tier: 'quick',
};

const balancedModel: Model = {
  id: 'gpt-4o',
  label: 'GPT-4o',
  provider: 'openai',
  providerType: 'openai-compatible',
  description: 'Balanced',
  tier: 'balanced',
};

const deepModel: Model = {
  id: 'claude-opus',
  label: 'Claude Opus',
  provider: 'anthropic',
  providerType: 'anthropic',
  description: 'Deep',
  tier: 'deep',
};

describe('ForgeFrameRouter', () => {
  let router: ForgeFrameRouter;

  beforeEach(() => {
    router = new ForgeFrameRouter({
      logger: silentLogger,
      models: [quickModel, balancedModel, deepModel],
    });
  });

  describe('detectIntent', () => {
    it('returns deep for "analyze"', () => {
      expect(router.detectIntent('Please analyze this codebase carefully')).toBe('deep');
    });

    it('returns deep for "architecture"', () => {
      expect(router.detectIntent('Describe the architecture of this system')).toBe('deep');
    });

    it('returns deep for "compare and contrast"', () => {
      expect(router.detectIntent('Compare and contrast these two approaches')).toBe('deep');
    });

    it('returns quick for "What is JavaScript?"', () => {
      expect(router.detectIntent('What is JavaScript?')).toBe('quick');
    });

    it('returns quick for "summarize this"', () => {
      expect(router.detectIntent('Can you summarize this for me please')).toBe('quick');
    });

    it('returns quick for "tl;dr"', () => {
      expect(router.detectIntent('Give me the tl;dr of this document')).toBe('quick');
    });

    it('returns quick for short messages without deep signals', () => {
      expect(router.detectIntent('Hello there')).toBe('quick');
    });

    it('returns deep for messages over 500 characters', () => {
      const long = 'a'.repeat(501);
      expect(router.detectIntent(long)).toBe('deep');
    });

    it('returns balanced for mid-length messages with no signals', () => {
      const msg = 'I would like you to help me write some code for my project that handles data';
      expect(router.detectIntent(msg)).toBe('balanced');
    });
  });

  describe('resolveModel', () => {
    it('returns null when no models are loaded', () => {
      const empty = new ForgeFrameRouter({ logger: silentLogger });
      expect(empty.resolveModel('hello')).toBeNull();
    });

    it('returns the explicit override model with auto: false', () => {
      const result = router.resolveModel('hello', 'claude-opus');
      expect(result).toEqual({
        provider: 'anthropic',
        modelId: 'claude-opus',
        tier: 'deep',
        auto: false,
      });
    });

    it('falls through to auto-route when override is unknown', () => {
      const result = router.resolveModel('hello', 'nonexistent-model');
      expect(result).not.toBeNull();
      expect(result!.auto).toBe(true);
    });

    it('auto-routes quick tier to cheapest quick model', () => {
      const result = router.resolveModel('hi');
      expect(result).toEqual({
        provider: 'ollama',
        modelId: 'qwen-3b',
        tier: 'quick',
        auto: true,
      });
    });

    it('auto-routes deep tier to matching deep model', () => {
      const result = router.resolveModel('Please analyze this architecture in detail');
      expect(result).toEqual({
        provider: 'anthropic',
        modelId: 'claude-opus',
        tier: 'deep',
        auto: true,
      });
    });
  });

  describe('loadModels + getModels', () => {
    it('round-trips models through loadModels and getModels', () => {
      const fresh = new ForgeFrameRouter({ logger: silentLogger });
      fresh.loadModels([quickModel, deepModel]);
      const infos = fresh.getModels();
      expect(infos).toHaveLength(2);
      expect(infos[0].id).toBe('qwen-3b');
      expect(infos[1].id).toBe('claude-opus');
    });
  });

  describe('getCheapestModel', () => {
    it('returns the cheapest model by provider cost order', () => {
      const result = router.getCheapestModel('quick');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('qwen-3b');
    });

    it('returns null when no models match the tier', () => {
      const fresh = new ForgeFrameRouter({
        logger: silentLogger,
        models: [deepModel],
      });
      expect(fresh.getCheapestModel('quick')).toBeNull();
    });
  });

  describe('ConfigStore integration', () => {
    it('persists selectedModel and autoRoute through config store', () => {
      const store = createMemoryConfigStore();
      const r = new ForgeFrameRouter({
        logger: silentLogger,
        configStore: store,
        models: [quickModel, balancedModel, deepModel],
      });

      expect(r.getSelectedModel()).toBeNull();
      expect(r.getAutoRoute()).toBe(true);

      r.setSelectedModel('gpt-4o');
      expect(r.getSelectedModel()).toBe('gpt-4o');

      r.setAutoRoute(false);
      expect(r.getAutoRoute()).toBe(false);

      r.setAutoRoute(true);
      expect(r.getAutoRoute()).toBe(true);
    });
  });
});
