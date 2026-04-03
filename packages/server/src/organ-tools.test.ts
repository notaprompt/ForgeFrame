import { describe, it, expect, beforeEach } from 'vitest';
import { registerOrganTools } from './organ-tools.js';
import { OrganRegistryImpl } from '@forgeframe/core';
import type { OrganManifest, OrganLifecycle, ResourceBudget } from '@forgeframe/core';

type ToolHandler = (...args: unknown[]) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

const silentLogger = {
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

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    handlers,
    tool(_name: string, _desc: string, _schema: unknown, handler: ToolHandler) {
      handlers.set(_name, handler);
    },
  };
}

function createMockLifecycle(): OrganLifecycle {
  return {
    register: async () => true,
    activate: async () => {},
    execute: async () => ({ slots: { result: 'mock' }, provenance: {} as never }),
    deactivate: async () => {},
    health: async () => ({ status: 'healthy' }),
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

describe('organ MCP tools', () => {
  let mockServer: ReturnType<typeof createMockServer>;
  let registry: OrganRegistryImpl;

  beforeEach(async () => {
    mockServer = createMockServer();
    registry = new OrganRegistryImpl({ logger: silentLogger, budget: testBudget });

    await registry.register(
      createManifest({ id: 'memory.organ', name: 'Memory Organ', categories: ['memory'] }),
      createMockLifecycle(),
    );
    await registry.register(
      createManifest({
        id: 'router.organ',
        name: 'Router Organ',
        categories: ['routing'],
        capabilities: [{
          action: 'route',
          quality: 0.7,
          speed: 'instant',
          inputModalities: ['text'],
          outputModalities: ['structured-data'],
        }],
      }),
      createMockLifecycle(),
    );
    await registry.register(
      createManifest({
        id: 'cloud.organ',
        name: 'Cloud Organ',
        categories: ['inference'],
        trust: {
          execution: 'cloud-raw',
          dataClassifications: ['public', 'internal'],
          canPersist: false,
          telemetry: true,
        },
      }),
      createMockLifecycle(),
    );

    registerOrganTools(
      mockServer as unknown as Parameters<typeof registerOrganTools>[0],
      registry,
    );
  });

  describe('organ_list', () => {
    it('returns all registered organs', async () => {
      const handler = mockServer.handlers.get('organ_list')!;
      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toHaveLength(3);
      const ids = parsed.map((o: { id: string }) => o.id);
      expect(ids).toContain('memory.organ');
      expect(ids).toContain('router.organ');
      expect(ids).toContain('cloud.organ');
    });

    it('includes status fields in each entry', async () => {
      const handler = mockServer.handlers.get('organ_list')!;
      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);

      const organ = parsed[0];
      expect(organ).toHaveProperty('id');
      expect(organ).toHaveProperty('name');
      expect(organ).toHaveProperty('version');
      expect(organ).toHaveProperty('categories');
      expect(organ).toHaveProperty('state');
      expect(organ).toHaveProperty('executionCount');
    });
  });

  describe('organ_status', () => {
    it('returns status for a specific organ', async () => {
      const handler = mockServer.handlers.get('organ_status')!;
      const result = await handler({ organ_id: 'memory.organ' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.manifest.id).toBe('memory.organ');
      expect(parsed.state).toBe('registered');
      expect(parsed.executionCount).toBe(0);
    });

    it('returns error for unknown organ', async () => {
      const handler = mockServer.handlers.get('organ_status')!;
      const result = await handler({ organ_id: 'nonexistent.organ' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.error).toContain('Organ not found');
      expect(parsed.error).toContain('nonexistent.organ');
    });
  });

  describe('organ_resolve', () => {
    it('returns matches for known capability', async () => {
      const handler = mockServer.handlers.get('organ_resolve')!;
      const result = await handler({ action: 'reason' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.length).toBeGreaterThanOrEqual(1);
      expect(parsed.every((m: { capability: string }) => m.capability === 'reason')).toBe(true);
    });

    it('returns empty array for unknown capability', async () => {
      const handler = mockServer.handlers.get('organ_resolve')!;
      const result = await handler({ action: 'nonexistent-action' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual([]);
    });

    it('respects data_classification filter', async () => {
      const handler = mockServer.handlers.get('organ_resolve')!;

      // cognitive classification should exclude cloud organs
      const result = await handler({ action: 'reason', data_classification: 'cognitive' });
      const parsed = JSON.parse(result.content[0].text);

      const organIds = parsed.map((m: { organId: string }) => m.organId);
      expect(organIds).not.toContain('cloud.organ');
    });
  });
});
