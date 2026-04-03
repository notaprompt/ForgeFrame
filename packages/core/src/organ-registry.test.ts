import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrganRegistryImpl } from './organ-registry.js';
import type {
  OrganManifest,
  OrganLifecycle,
  OrganInput,
  ResourceBudget,
} from './organ-types.js';
import type { Logger } from './types.js';

// -- Helpers --

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const testBudget: ResourceBudget = {
  totalRamMb: 16384,
  totalVramMb: 12288,
  availableRamMb: 8192,
  availableVramMb: 6144,
  compute: ['metal'],
  networkAllowed: true,
};

function createMockLifecycle(overrides?: Partial<OrganLifecycle>): OrganLifecycle {
  return {
    register: async () => true,
    activate: async () => {},
    execute: async (_input) => ({
      slots: { result: 'mock-output' },
      provenance: {} as never,
    }),
    deactivate: async () => {},
    health: async () => ({ status: 'healthy' }),
    ...overrides,
  };
}

function createManifest(overrides?: Partial<OrganManifest>): OrganManifest {
  return {
    id: 'test.organ',
    name: 'Test Organ',
    version: '1.0.0',
    description: 'A test organ',
    categories: ['inference'],
    capabilities: [
      {
        action: 'reason',
        quality: 0.8,
        speed: 'fast',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
    ],
    resources: { ramMb: 512, vramMb: 256, diskMb: 100, network: false, warmupTime: 'seconds', concurrent: true },
    trust: {
      execution: 'local-only',
      dataClassifications: ['public', 'internal', 'cognitive'],
      canPersist: false,
      telemetry: false,
    },
    io: {
      inputs: [{ name: 'prompt', modality: 'text', required: true, classification: 'internal' }],
      outputs: [{ name: 'response', modality: 'text', required: true, classification: 'internal' }],
    },
    ...overrides,
  };
}

function createInput(overrides?: Partial<OrganInput>): OrganInput {
  return {
    requestId: 'req-001',
    slots: { prompt: 'Hello' },
    ...overrides,
  };
}

// -- Tests --

describe('OrganRegistryImpl', () => {
  let registry: OrganRegistryImpl;

  beforeEach(() => {
    registry = new OrganRegistryImpl({ logger: silentLogger, budget: testBudget });
  });

  describe('register', () => {
    it('should register an organ and set state to registered', async () => {
      await registry.register(createManifest(), createMockLifecycle());
      const s = registry.status('test.organ');
      expect(s).not.toBeNull();
      expect(s!.state).toBe('registered');
      expect(s!.executionCount).toBe(0);
    });

    it('should throw when registering a duplicate organ', async () => {
      await registry.register(createManifest(), createMockLifecycle());
      await expect(registry.register(createManifest(), createMockLifecycle())).rejects.toThrow(
        'Organ already registered: test.organ',
      );
    });

    it('should throw when a dependency is not registered', async () => {
      const manifest = createManifest({
        id: 'test.dependent',
        dependencies: ['test.missing-dep'],
      });
      await expect(registry.register(manifest, createMockLifecycle())).rejects.toThrow(
        'Missing dependency: test.missing-dep',
      );
    });

    it('should allow registration when dependencies are present', async () => {
      await registry.register(createManifest({ id: 'test.dep' }), createMockLifecycle());
      const manifest = createManifest({ id: 'test.dependent', dependencies: ['test.dep'] });
      await registry.register(manifest, createMockLifecycle());
      expect(registry.status('test.dependent')!.state).toBe('registered');
    });

    it('should throw when lifecycle.register() returns false', async () => {
      const lifecycle = createMockLifecycle({ register: async () => false });
      await expect(registry.register(createManifest(), lifecycle)).rejects.toThrow(
        'Organ registration rejected by lifecycle',
      );
    });
  });

  describe('activate', () => {
    it('should activate an organ and set state to active', async () => {
      await registry.register(createManifest(), createMockLifecycle());
      await registry.activate('test.organ');
      const s = registry.status('test.organ');
      expect(s!.state).toBe('active');
      expect(s!.activeSince).toBeDefined();
    });

    it('should reject activation when budget is exceeded', async () => {
      const tightBudget: ResourceBudget = {
        ...testBudget,
        availableRamMb: 100,
      };
      const reg = new OrganRegistryImpl({ logger: silentLogger, budget: tightBudget });
      await reg.register(createManifest(), createMockLifecycle());
      await expect(reg.activate('test.organ')).rejects.toThrow('Insufficient RAM');
    });

    it('should update budget after activation', async () => {
      await registry.register(createManifest(), createMockLifecycle());
      const before = registry.budget();
      await registry.activate('test.organ');
      const after = registry.budget();
      expect(after.availableRamMb).toBe(before.availableRamMb - 512);
      expect(after.availableVramMb).toBe(before.availableVramMb - 256);
    });
  });

  describe('deactivate', () => {
    it('should deactivate an organ and set state to dormant', async () => {
      await registry.register(createManifest(), createMockLifecycle());
      await registry.activate('test.organ');
      await registry.deactivate('test.organ');
      expect(registry.status('test.organ')!.state).toBe('dormant');
    });

    it('should restore budget after deactivation', async () => {
      await registry.register(createManifest(), createMockLifecycle());
      const before = registry.budget();
      await registry.activate('test.organ');
      await registry.deactivate('test.organ');
      const after = registry.budget();
      expect(after.availableRamMb).toBe(before.availableRamMb);
    });
  });

  describe('execute', () => {
    it('should execute and return output with provenance', async () => {
      await registry.register(createManifest(), createMockLifecycle());
      await registry.activate('test.organ');
      const output = await registry.execute('test.organ', createInput());

      expect(output.slots.result).toBe('mock-output');
      expect(output.provenance).toBeDefined();
      expect(output.provenance.organId).toBe('test.organ');
      expect(output.provenance.requestId).toBe('req-001');
      expect(output.provenance.inputHash).toBeTruthy();
      expect(output.provenance.outputHash).toBeTruthy();
      expect(output.provenance.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should update execution stats', async () => {
      await registry.register(createManifest(), createMockLifecycle());
      await registry.activate('test.organ');
      await registry.execute('test.organ', createInput());
      await registry.execute('test.organ', createInput({ requestId: 'req-002' }));

      const s = registry.status('test.organ')!;
      expect(s.executionCount).toBe(2);
      expect(s.averageLatencyMs).toBeGreaterThanOrEqual(0);
      expect(s.lastExecuted).toBeDefined();
    });

    it('should set state back to active after execution', async () => {
      await registry.register(createManifest(), createMockLifecycle());
      await registry.activate('test.organ');
      await registry.execute('test.organ', createInput());
      expect(registry.status('test.organ')!.state).toBe('active');
    });

    it('should increment errors on execution failure', async () => {
      const lifecycle = createMockLifecycle({
        execute: async () => { throw new Error('boom'); },
      });
      await registry.register(createManifest(), lifecycle);
      await registry.activate('test.organ');
      await expect(registry.execute('test.organ', createInput())).rejects.toThrow('boom');
      expect(registry.status('test.organ')!.errors).toBe(1);
    });
  });

  describe('trust enforcement', () => {
    it('should block cloud organ from processing cognitive data', async () => {
      const manifest = createManifest({
        id: 'cloud.organ',
        trust: {
          execution: 'cloud-raw',
          dataClassifications: ['public'],
          canPersist: false,
          telemetry: false,
        },
        io: {
          inputs: [{ name: 'thought', modality: 'text', required: true, classification: 'cognitive' }],
          outputs: [{ name: 'response', modality: 'text', required: true, classification: 'public' }],
        },
      });

      await registry.register(manifest, createMockLifecycle());
      await registry.activate('cloud.organ');
      await expect(registry.execute('cloud.organ', createInput())).rejects.toThrow(
        'cannot process cognitive/constitutional data',
      );
    });

    it('should block cloud-scrubbed organ from processing constitutional data', async () => {
      const manifest = createManifest({
        id: 'scrubbed.organ',
        trust: {
          execution: 'cloud-scrubbed',
          dataClassifications: ['public'],
          canPersist: false,
          telemetry: false,
        },
        io: {
          inputs: [{ name: 'principle', modality: 'text', required: true, classification: 'constitutional' }],
          outputs: [{ name: 'response', modality: 'text', required: true, classification: 'public' }],
        },
      });

      await registry.register(manifest, createMockLifecycle());
      await registry.activate('scrubbed.organ');
      await expect(registry.execute('scrubbed.organ', createInput())).rejects.toThrow(
        'cannot process cognitive/constitutional data',
      );
    });

    it('should allow local organ to process cognitive data', async () => {
      const manifest = createManifest({
        io: {
          inputs: [{ name: 'thought', modality: 'text', required: true, classification: 'cognitive' }],
          outputs: [{ name: 'response', modality: 'text', required: true, classification: 'internal' }],
        },
      });

      await registry.register(manifest, createMockLifecycle());
      await registry.activate('test.organ');
      const output = await registry.execute('test.organ', createInput());
      expect(output.slots.result).toBe('mock-output');
    });

    it('should emit trust-violation event on block', async () => {
      const manifest = createManifest({
        id: 'cloud.organ',
        trust: {
          execution: 'cloud-raw',
          dataClassifications: ['public'],
          canPersist: false,
          telemetry: false,
        },
        io: {
          inputs: [{ name: 'thought', modality: 'text', required: true, classification: 'cognitive' }],
          outputs: [{ name: 'response', modality: 'text', required: true, classification: 'public' }],
        },
      });

      await registry.register(manifest, createMockLifecycle());
      await registry.activate('cloud.organ');

      const violations: string[] = [];
      registry.events.on('organ:trust-violation', (_id, reason) => violations.push(reason));

      await expect(registry.execute('cloud.organ', createInput())).rejects.toThrow();
      expect(violations).toHaveLength(1);
    });
  });

  describe('resolve', () => {
    const fastOrgan = createManifest({
      id: 'fast.organ',
      capabilities: [{
        action: 'reason',
        quality: 0.5,
        speed: 'instant',
        inputModalities: ['text'],
        outputModalities: ['text'],
      }],
      resources: { ramMb: 256, vramMb: 128, diskMb: 50, network: false, warmupTime: 'instant', concurrent: true },
    });

    const qualityOrgan = createManifest({
      id: 'quality.organ',
      capabilities: [{
        action: 'reason',
        quality: 0.95,
        speed: 'slow',
        inputModalities: ['text'],
        outputModalities: ['text'],
      }],
      resources: { ramMb: 4096, vramMb: 2048, diskMb: 500, network: false, warmupTime: 'minutes', concurrent: false },
    });

    const cloudOrgan = createManifest({
      id: 'cloud.organ',
      capabilities: [{
        action: 'reason',
        quality: 0.9,
        speed: 'fast',
        inputModalities: ['text'],
        outputModalities: ['text'],
      }],
      resources: { ramMb: 64, vramMb: 0, diskMb: 0, network: true, warmupTime: 'instant', concurrent: true },
      trust: {
        execution: 'cloud-raw',
        dataClassifications: ['public', 'internal'],
        canPersist: false,
        telemetry: true,
        networkEndpoints: ['https://api.example.com'],
      },
    });

    it('should return organs matching the queried action', async () => {
      await registry.register(fastOrgan, createMockLifecycle());
      await registry.register(qualityOrgan, createMockLifecycle());

      const matches = registry.resolve({ action: 'reason' });
      expect(matches).toHaveLength(2);
      expect(matches.every((m) => m.capability.action === 'reason')).toBe(true);
    });

    it('should return no matches for unknown action', async () => {
      await registry.register(fastOrgan, createMockLifecycle());
      expect(registry.resolve({ action: 'nonexistent' })).toHaveLength(0);
    });

    it('should sort by score descending', async () => {
      await registry.register(fastOrgan, createMockLifecycle());
      await registry.register(qualityOrgan, createMockLifecycle());

      const matches = registry.resolve({ action: 'reason' });
      for (let i = 1; i < matches.length; i++) {
        expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
      }
    });

    it('should prefer speed-weighted organ with preferSpeed', async () => {
      await registry.register(fastOrgan, createMockLifecycle());
      await registry.register(qualityOrgan, createMockLifecycle());

      const matches = registry.resolve({ action: 'reason', preferSpeed: true });
      expect(matches[0].organ.id).toBe('fast.organ');
    });

    it('should prefer quality-weighted organ with preferQuality', async () => {
      await registry.register(fastOrgan, createMockLifecycle());
      await registry.register(qualityOrgan, createMockLifecycle());

      const matches = registry.resolve({ action: 'reason', preferQuality: true });
      expect(matches[0].organ.id).toBe('quality.organ');
    });

    it('should exclude cloud organs when dataClassification is constitutional', async () => {
      await registry.register(fastOrgan, createMockLifecycle());
      await registry.register(cloudOrgan, createMockLifecycle());

      const matches = registry.resolve({ action: 'reason', dataClassification: 'constitutional' });
      expect(matches).toHaveLength(1);
      expect(matches[0].organ.id).toBe('fast.organ');
    });

    it('should exclude cloud organs when dataClassification is cognitive', async () => {
      await registry.register(fastOrgan, createMockLifecycle());
      await registry.register(cloudOrgan, createMockLifecycle());

      const matches = registry.resolve({ action: 'reason', dataClassification: 'cognitive' });
      expect(matches).toHaveLength(1);
      expect(matches[0].organ.id).toBe('fast.organ');
    });

    it('should filter by maxTrust level', async () => {
      await registry.register(fastOrgan, createMockLifecycle());
      await registry.register(cloudOrgan, createMockLifecycle());

      const matches = registry.resolve({ action: 'reason', maxTrust: 'local-preferred' });
      expect(matches).toHaveLength(1);
      expect(matches[0].organ.id).toBe('fast.organ');
    });

    it('should filter by input modality', async () => {
      await registry.register(fastOrgan, createMockLifecycle());
      const matches = registry.resolve({ action: 'reason', inputModality: 'image' });
      expect(matches).toHaveLength(0);
    });

    it('should boost score for active organs', async () => {
      await registry.register(fastOrgan, createMockLifecycle());
      await registry.register(qualityOrgan, createMockLifecycle());

      const beforeActivation = registry.resolve({ action: 'reason' });
      const qualityBefore = beforeActivation.find((m) => m.organ.id === 'quality.organ')!.score;

      await registry.activate('quality.organ');
      const afterActivation = registry.resolve({ action: 'reason' });
      const qualityAfter = afterActivation.find((m) => m.organ.id === 'quality.organ')!.score;

      expect(qualityAfter).toBeGreaterThan(qualityBefore);
    });
  });

  describe('unregister', () => {
    it('should remove an organ from the registry', async () => {
      await registry.register(createManifest(), createMockLifecycle());
      await registry.unregister('test.organ');
      expect(registry.status('test.organ')).toBeNull();
    });

    it('should deactivate an active organ before unregistering', async () => {
      const deactivateSpy = vi.fn(async () => {});
      const lifecycle = createMockLifecycle({ deactivate: deactivateSpy });
      await registry.register(createManifest(), lifecycle);
      await registry.activate('test.organ');
      await registry.unregister('test.organ');
      expect(deactivateSpy).toHaveBeenCalled();
      expect(registry.status('test.organ')).toBeNull();
    });
  });

  describe('list', () => {
    it('should return all registered organs', async () => {
      await registry.register(createManifest({ id: 'a' }), createMockLifecycle());
      await registry.register(createManifest({ id: 'b' }), createMockLifecycle());
      expect(registry.list()).toHaveLength(2);
    });
  });

  describe('budget', () => {
    it('should return initial budget when no organs active', () => {
      const b = registry.budget();
      expect(b.availableRamMb).toBe(testBudget.availableRamMb);
      expect(b.totalRamMb).toBe(testBudget.totalRamMb);
    });

    it('should subtract active organ resources from available budget', async () => {
      await registry.register(createManifest(), createMockLifecycle());
      await registry.activate('test.organ');
      const b = registry.budget();
      expect(b.availableRamMb).toBe(testBudget.availableRamMb - 512);
      expect(b.availableVramMb).toBe(testBudget.availableVramMb - 256);
    });
  });

  describe('events', () => {
    it('should emit organ:registered on registration', async () => {
      const ids: string[] = [];
      registry.events.on('organ:registered', (id) => ids.push(id));
      await registry.register(createManifest(), createMockLifecycle());
      expect(ids).toEqual(['test.organ']);
    });

    it('should emit organ:activated on activation', async () => {
      const ids: string[] = [];
      registry.events.on('organ:activated', (id) => ids.push(id));
      await registry.register(createManifest(), createMockLifecycle());
      await registry.activate('test.organ');
      expect(ids).toEqual(['test.organ']);
    });

    it('should emit organ:executed on execution', async () => {
      const events: [string, number][] = [];
      registry.events.on('organ:executed', (id, ms) => events.push([id, ms]));
      await registry.register(createManifest(), createMockLifecycle());
      await registry.activate('test.organ');
      await registry.execute('test.organ', createInput());
      expect(events).toHaveLength(1);
      expect(events[0][0]).toBe('test.organ');
    });
  });
});
