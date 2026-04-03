import { describe, it, expect, beforeEach } from 'vitest';
import { ROUTER_ORGAN_MANIFEST, createRouterOrganLifecycle } from './router-organ.js';
import { ForgeFrameRouter } from './router.js';
import type { OrganLifecycle } from './organ-types.js';
import type { Model } from './types.js';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const testModels: Model[] = [
  {
    id: 'local-small',
    label: 'Local Small',
    provider: 'ollama',
    providerType: 'ollama',
    description: 'Fast local model',
    tier: 'quick',
  },
  {
    id: 'local-medium',
    label: 'Local Medium',
    provider: 'ollama',
    providerType: 'ollama',
    description: 'Balanced local model',
    tier: 'balanced',
  },
  {
    id: 'local-large',
    label: 'Local Large',
    provider: 'ollama',
    providerType: 'ollama',
    description: 'Deep reasoning model',
    tier: 'deep',
  },
];

describe('Router Organ', () => {
  let router: ForgeFrameRouter;
  let lifecycle: OrganLifecycle;

  beforeEach(() => {
    router = new ForgeFrameRouter({ logger: silentLogger, models: testModels });
    lifecycle = createRouterOrganLifecycle(router);
  });

  describe('ROUTER_ORGAN_MANIFEST', () => {
    it('has correct id', () => {
      expect(ROUTER_ORGAN_MANIFEST.id).toBe('forgeframe.routing.intent');
    });

    it('has routing category', () => {
      expect(ROUTER_ORGAN_MANIFEST.categories).toContain('routing');
    });

    it('has route capability', () => {
      const actions = ROUTER_ORGAN_MANIFEST.capabilities.map((c) => c.action);
      expect(actions).toContain('route');
    });

    it('declares local-only execution trust', () => {
      expect(ROUTER_ORGAN_MANIFEST.trust.execution).toBe('local-only');
    });
  });

  describe('register', () => {
    it('returns true', async () => {
      const result = await lifecycle.register();
      expect(result).toBe(true);
    });
  });

  describe('execute', () => {
    it('resolves short message to quick tier', async () => {
      const output = await lifecycle.execute({
        requestId: 'req-quick-1',
        slots: { message: 'hi' },
      });

      const resolved = output.slots.resolved_model as { tier: string };
      expect(resolved.tier).toBe('quick');
    });

    it('resolves analytical message to deep tier', async () => {
      const output = await lifecycle.execute({
        requestId: 'req-deep-1',
        slots: { message: 'Analyze the architecture trade-offs between microservices and monoliths' },
      });

      const resolved = output.slots.resolved_model as { tier: string };
      expect(resolved.tier).toBe('deep');
    });

    it('returns a resolved model with provider and modelId', async () => {
      const output = await lifecycle.execute({
        requestId: 'req-model-1',
        slots: { message: 'what is 2+2' },
      });

      const resolved = output.slots.resolved_model as {
        provider: string;
        modelId: string;
        tier: string;
        auto: boolean;
      };
      expect(resolved.provider).toBeTypeOf('string');
      expect(resolved.modelId).toBeTypeOf('string');
      expect(resolved.auto).toBe(true);
    });
  });

  describe('provenance', () => {
    it('includes provenance record in output', async () => {
      const output = await lifecycle.execute({
        requestId: 'req-prov-1',
        slots: { message: 'hello' },
      });

      expect(output.provenance).toBeDefined();
      expect(output.provenance.organId).toBe('forgeframe.routing.intent');
      expect(output.provenance.requestId).toBe('req-prov-1');
      expect(output.provenance.inputHash).toBeTypeOf('string');
      expect(output.provenance.outputHash).toBeTypeOf('string');
      expect(output.provenance.inputHash).toHaveLength(64);
      expect(output.provenance.outputHash).toHaveLength(64);
      expect(output.provenance.durationMs).toBeGreaterThanOrEqual(0);
      expect(output.provenance.trustLevel).toBe('local-only');
    });
  });

  describe('health', () => {
    it('returns healthy', async () => {
      const health = await lifecycle.health();
      expect(health.status).toBe('healthy');
      expect(health.message).toContain('router');
    });
  });
});
