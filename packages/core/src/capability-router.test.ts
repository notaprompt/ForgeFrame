import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilityRouter } from './capability-router.js';
import { OrganRegistryImpl } from './organ-registry.js';
import { detectResourceBudget } from './resource-budget.js';
import type {
  OrganManifest,
  OrganLifecycle,
  OrganContext,
} from './organ-types.js';
import type { Logger } from './types.js';

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// -- Mock organ manifests --

function makeManifest(overrides: Partial<OrganManifest> & { id: string }): OrganManifest {
  return {
    name: overrides.id,
    version: '0.1.0',
    description: `Mock organ ${overrides.id}`,
    categories: ['inference'],
    capabilities: [],
    resources: {
      ramMb: 100,
      vramMb: 0,
      diskMb: 50,
      network: false,
      warmupTime: 'instant',
      concurrent: true,
    },
    trust: {
      execution: 'local-only',
      dataClassifications: ['public', 'internal', 'sensitive', 'cognitive', 'constitutional'],
      canPersist: false,
      telemetry: false,
    },
    io: {
      inputs: [{ name: 'input', modality: 'text', required: true, classification: 'internal' }],
      outputs: [{ name: 'output', modality: 'text', required: true, classification: 'internal' }],
    },
    ...overrides,
  };
}

function makeLifecycle(): OrganLifecycle {
  return {
    async register() { return true; },
    async activate() {},
    async execute(input) {
      return { slots: { result: 'ok' }, provenance: {} as never };
    },
    async deactivate() {},
    async health() { return { status: 'healthy' }; },
  };
}

const fastOrgan = makeManifest({
  id: 'test.fast-reasoner',
  capabilities: [
    { action: 'classify', quality: 0.6, speed: 'fast', inputModalities: ['text'], outputModalities: ['text'] },
    { action: 'summarize', quality: 0.5, speed: 'fast', inputModalities: ['text'], outputModalities: ['text'] },
  ],
});

const deepOrgan = makeManifest({
  id: 'test.deep-reasoner',
  capabilities: [
    { action: 'reason', quality: 0.95, speed: 'slow', inputModalities: ['text'], outputModalities: ['text'] },
  ],
  resources: { ramMb: 500, vramMb: 0, diskMb: 200, network: false, warmupTime: 'seconds', concurrent: false },
});

const codeOrgan = makeManifest({
  id: 'test.code-assistant',
  capabilities: [
    { action: 'code', quality: 0.85, speed: 'moderate', inputModalities: ['text'], outputModalities: ['text'] },
  ],
});

const cloudOrgan = makeManifest({
  id: 'test.cloud-reasoner',
  capabilities: [
    { action: 'reason', quality: 0.98, speed: 'moderate', inputModalities: ['text'], outputModalities: ['text'] },
    { action: 'classify', quality: 0.90, speed: 'fast', inputModalities: ['text'], outputModalities: ['text'] },
  ],
  trust: {
    execution: 'cloud-raw',
    dataClassifications: ['public', 'internal'],
    canPersist: false,
    telemetry: false,
  },
});

describe('CapabilityRouter', () => {
  let registry: OrganRegistryImpl;
  let router: CapabilityRouter;

  beforeEach(async () => {
    const budget = detectResourceBudget();
    registry = new OrganRegistryImpl({ logger: silentLogger, budget });

    await registry.register(fastOrgan, makeLifecycle());
    await registry.register(deepOrgan, makeLifecycle());
    await registry.register(codeOrgan, makeLifecycle());
    await registry.register(cloudOrgan, makeLifecycle());

    router = new CapabilityRouter(registry, silentLogger);
  });

  describe('action classification', () => {
    it('classifies short message as quick action', () => {
      const action = router.classifyAction('What is TypeScript?');
      expect(action).toBe('classify');
    });

    it('classifies long analytical message as reason', () => {
      const msg = 'Please analyze the architecture of this distributed system and evaluate the trade-offs between consistency and availability';
      const action = router.classifyAction(msg);
      expect(action).toBe('reason');
    });

    it('classifies code-related message as code', () => {
      const action = router.classifyAction('Implement a function that sorts an array');
      expect(action).toBe('code');
    });

    it('classifies OCR-related message as ocr', () => {
      const action = router.classifyAction('Extract text from this image');
      expect(action).toBe('ocr');
    });

    it('classifies summarize request correctly', () => {
      const action = router.classifyAction('Can you summarize this article for me');
      expect(action).toBe('summarize');
    });

    it('returns reason for empty or invalid input', () => {
      expect(router.classifyAction('')).toBe('reason');
    });
  });

  describe('routing', () => {
    it('short message resolves to fast organ', () => {
      const matches = router.route('What is a monad?');
      expect(matches.length).toBeGreaterThan(0);
      // Fast organ should score highly for classify action with speed preference
      const fastMatch = matches.find((m) => m.organ.id === 'test.fast-reasoner');
      expect(fastMatch).toBeDefined();
    });

    it('long analytical message resolves to high-quality organ', () => {
      const msg = 'Analyze the architecture of this system and evaluate the trade-offs between the microservice approach and the monolith';
      const matches = router.route(msg);
      expect(matches.length).toBeGreaterThan(0);
      // Deep organ should appear for reason action
      const deepMatch = matches.find((m) => m.organ.id === 'test.deep-reasoner');
      expect(deepMatch).toBeDefined();
    });

    it('code-related message resolves to code organ', () => {
      const matches = router.route('Implement a binary search function');
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].organ.id).toBe('test.code-assistant');
    });

    it('constitutional context excludes cloud organs', () => {
      const context: OrganContext = {
        memories: [
          { content: 'sovereignty first', strength: 1.0, tags: ['principle'] },
        ],
      };
      const matches = router.route('Analyze this data carefully', context);
      const cloudMatch = matches.find((m) => m.organ.id === 'test.cloud-reasoner');
      expect(cloudMatch).toBeUndefined();
    });
  });

  describe('explain', () => {
    it('produces readable decision with all candidates', () => {
      const matches = router.route('What is a closure?');
      const decision = router.explain('What is a closure?', matches);

      expect(decision.classifiedAction).toBe('classify');
      expect(decision.messagePreview).toBe('What is a closure?');
      expect(decision.candidates.length).toBe(matches.length);
      expect(decision.timestamp).toBeGreaterThan(0);
      expect(decision.requestId).toBeTruthy();

      if (matches.length > 0) {
        expect(decision.selected).toBe(matches[0].organ.id);
      }

      for (const c of decision.candidates) {
        expect(c.organId).toBeTruthy();
        expect(typeof c.score).toBe('number');
        expect(c.reason).toContain('capability=');
      }
    });

    it('returns null selected when no matches', () => {
      // OCR action with no OCR organs registered
      const matches = router.route('Extract text from this screenshot');
      const decision = router.explain('Extract text from this screenshot', matches);
      expect(decision.selected).toBeNull();
      expect(decision.candidates).toHaveLength(0);
    });
  });

  describe('empty registry', () => {
    it('returns empty matches gracefully', async () => {
      const budget = detectResourceBudget();
      const emptyRegistry = new OrganRegistryImpl({ logger: silentLogger, budget });
      const emptyRouter = new CapabilityRouter(emptyRegistry, silentLogger);

      const matches = emptyRouter.route('Analyze this architecture');
      expect(matches).toEqual([]);
    });
  });

  describe('data level classification', () => {
    it('returns constitutional for principle-tagged memories', () => {
      const level = router.classifyDataLevel({
        memories: [{ content: 'test', strength: 1, tags: ['principle'] }],
      });
      expect(level).toBe('constitutional');
    });

    it('returns cognitive for cognitive-tagged memories', () => {
      const level = router.classifyDataLevel({
        memories: [{ content: 'test', strength: 1, tags: ['cognitive'] }],
      });
      expect(level).toBe('cognitive');
    });

    it('returns internal by default', () => {
      const level = router.classifyDataLevel();
      expect(level).toBe('internal');
    });
  });

  describe('regression: legacy router equivalence', () => {
    it('short messages produce quick-equivalent action (classify)', () => {
      // Legacy router: short message (<20 chars, no deep signals) -> quick tier
      const action = router.classifyAction('Hello there');
      expect(action).toBe('classify'); // quick equivalent
    });

    it('deep signals produce reason action', () => {
      // Legacy router: deep signals -> deep tier
      expect(router.classifyAction('analyze this codebase')).toBe('reason');
      expect(router.classifyAction('Describe the architecture')).toBe('reason');
      expect(router.classifyAction('What are the implications of this design')).toBe('reason');
    });

    it('quick signals produce classify/summarize action', () => {
      // Legacy router: quick signals -> quick tier
      expect(router.classifyAction('What is JavaScript?')).toBe('classify');
      expect(router.classifyAction('Give me the tldr')).toBe('classify');
      expect(router.classifyAction('Summarize this document')).toBe('summarize');
    });

    it('long messages (>500 chars) produce reason action', () => {
      // Legacy router: >500 chars -> deep tier
      const long = 'a'.repeat(501);
      expect(router.classifyAction(long)).toBe('reason');
    });
  });
});
