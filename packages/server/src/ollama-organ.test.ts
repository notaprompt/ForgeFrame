import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OllamaOrganAdapter } from './ollama-organ.js';
import { OrganRegistryImpl } from '@forgeframe/core';
import type { ResourceBudget } from '@forgeframe/core';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const testBudget: ResourceBudget = {
  totalRamMb: 65536,
  totalVramMb: 65536,
  availableRamMb: 65536,
  availableVramMb: 65536,
  compute: ['metal'],
  networkAllowed: true,
};

const MOCK_MODELS = {
  models: [
    {
      name: 'qwen3.5:27b',
      size: 17_000_000_000,
      details: { family: 'qwen3', parameter_size: '27B', quantization_level: 'Q4_K_M' },
    },
    {
      name: 'nomic-embed-text',
      size: 274_000_000,
      details: { family: 'nomic', parameter_size: '137M', quantization_level: 'F16' },
    },
    {
      name: 'llama3.2:1b',
      size: 1_300_000_000,
      details: { family: 'llama', parameter_size: '1B', quantization_level: 'Q4_K_M' },
    },
    {
      name: 'deepseek-coder:6.7b',
      size: 4_000_000_000,
      details: { family: 'deepseek', parameter_size: '6.7B', quantization_level: 'Q4_K_M' },
    },
    {
      name: 'qwen3:32b',
      size: 20_000_000_000,
      details: { family: 'qwen3', parameter_size: '32B', quantization_level: 'Q4_K_M' },
    },
  ],
};

function mockFetchSuccess(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: async () => body,
  });
}

describe('OllamaOrganAdapter', () => {
  let registry: OrganRegistryImpl;
  let adapter: OllamaOrganAdapter;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    registry = new OrganRegistryImpl({ logger: silentLogger, budget: testBudget });
    adapter = new OllamaOrganAdapter({
      ollamaUrl: 'http://localhost:11434',
      registry,
      logger: silentLogger,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('discoverAndRegister', () => {
    it('discovers and registers all models', async () => {
      globalThis.fetch = mockFetchSuccess(MOCK_MODELS) as unknown as typeof fetch;

      const ids = await adapter.discoverAndRegister();

      expect(ids).toHaveLength(5);
      expect(ids).toContain('ollama.qwen3.5.27b');
      expect(ids).toContain('ollama.nomic-embed-text');
      expect(ids).toContain('ollama.llama3.2.1b');
      expect(ids).toContain('ollama.deepseek-coder.6.7b');
      expect(ids).toContain('ollama.qwen3.32b');

      // Verify they are in the registry
      expect(registry.list()).toHaveLength(5);
    });

    it('returns empty array when Ollama is unavailable', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

      const ids = await adapter.discoverAndRegister();
      expect(ids).toEqual([]);
    });

    it('returns empty array on non-OK response', async () => {
      globalThis.fetch = mockFetchSuccess({}, 500) as unknown as typeof fetch;

      const ids = await adapter.discoverAndRegister();
      expect(ids).toEqual([]);
    });
  });

  describe('generateManifest', () => {
    it('small model gets classify and summarize capabilities', () => {
      const manifest = adapter.generateManifest(MOCK_MODELS.models[2]); // llama3.2:1b, 1.3GB
      const actions = manifest.capabilities.map((c) => c.action);

      expect(manifest.id).toBe('ollama.llama3.2.1b');
      expect(actions).toContain('classify');
      expect(actions).toContain('summarize');
      expect(actions).not.toContain('reason');
      expect(actions).not.toContain('analyze');
    });

    it('large model gets reason, analyze, architecture capabilities', () => {
      const manifest = adapter.generateManifest({
        name: 'mega:70b',
        size: 40_000_000_000,
        details: { family: 'mega', parameter_size: '70B', quantization_level: 'Q4_K_M' },
      });
      const actions = manifest.capabilities.map((c) => c.action);

      expect(actions).toContain('reason');
      expect(actions).toContain('analyze');
      expect(actions).toContain('architecture');
      expect(actions).not.toContain('classify');
      expect(actions).not.toContain('summarize');
    });

    it('medium model (10-25GB) gets reason, code, summarize, analyze', () => {
      const manifest = adapter.generateManifest(MOCK_MODELS.models[0]); // qwen3.5:27b, 17GB
      const actions = manifest.capabilities.map((c) => c.action);

      expect(actions).toContain('reason');
      expect(actions).toContain('code');
      expect(actions).toContain('summarize');
      expect(actions).toContain('analyze');
    });

    it('embed model detected by name', () => {
      const manifest = adapter.generateManifest(MOCK_MODELS.models[1]); // nomic-embed-text
      const actions = manifest.capabilities.map((c) => c.action);

      expect(manifest.categories).toContain('embedding');
      expect(actions).toEqual(['embed']);
      expect(manifest.capabilities[0].quality).toBe(0.80);
      expect(manifest.capabilities[0].speed).toBe('instant');
      expect(manifest.capabilities[0].outputModalities).toContain('embedding-vector');
    });

    it('code model gets boosted code quality', () => {
      const manifest = adapter.generateManifest(MOCK_MODELS.models[3]); // deepseek-coder:6.7b, 4GB
      const codeCap = manifest.capabilities.find((c) => c.action === 'code');

      expect(codeCap).toBeDefined();
      // 2-10GB range: base quality 0.80, code boost +0.05 = 0.85
      expect(codeCap!.quality).toBe(0.85);
    });

    it('non-code model in same size range has lower code quality', () => {
      const manifest = adapter.generateManifest({
        name: 'generic:7b',
        size: 4_000_000_000,
        details: { family: 'generic', parameter_size: '7B', quantization_level: 'Q4_K_M' },
      });
      const codeCap = manifest.capabilities.find((c) => c.action === 'code');

      expect(codeCap).toBeDefined();
      expect(codeCap!.quality).toBe(0.80);
    });

    it('organ ID sanitizes colons and slashes', () => {
      const manifest = adapter.generateManifest({
        name: 'kwangsuklee/Qwen3.5-27B-Claude',
        size: 16_000_000_000,
        details: { family: 'qwen', parameter_size: '27B', quantization_level: 'Q4_K_M' },
      });

      expect(manifest.id).toBe('ollama.kwangsuklee.Qwen3.5-27B-Claude');
      expect(manifest.id).not.toContain('/');
      expect(manifest.id).not.toContain(':');
    });

    it('trust is always local-only with full data classifications', () => {
      const manifest = adapter.generateManifest(MOCK_MODELS.models[0]);

      expect(manifest.trust.execution).toBe('local-only');
      expect(manifest.trust.dataClassifications).toEqual([
        'public', 'internal', 'sensitive', 'cognitive', 'constitutional',
      ]);
      expect(manifest.trust.canPersist).toBe(false);
      expect(manifest.trust.telemetry).toBe(false);
    });

    it('resources estimated from model size', () => {
      const manifest = adapter.generateManifest(MOCK_MODELS.models[0]); // 17GB
      const expectedMb = Math.ceil(17_000_000_000 / (1024 * 1024));

      expect(manifest.resources.ramMb).toBe(expectedMb);
      expect(manifest.resources.vramMb).toBe(expectedMb);
      expect(manifest.resources.diskMb).toBe(expectedMb);
      expect(manifest.resources.network).toBe(false);
      expect(manifest.resources.concurrent).toBe(true);
      expect(manifest.resources.warmupTime).toBe('minutes'); // > 5GB
    });

    it('small model has seconds warmup time', () => {
      const manifest = adapter.generateManifest(MOCK_MODELS.models[2]); // 1.3GB
      expect(manifest.resources.warmupTime).toBe('seconds');
    });
  });

  describe('lifecycle execute', () => {
    it('calls /api/generate for inference models', async () => {
      const mockResponse = { response: 'Hello world' };
      globalThis.fetch = mockFetchSuccess(mockResponse) as unknown as typeof fetch;

      const lifecycle = adapter.createLifecycle(MOCK_MODELS.models[0]); // qwen3.5:27b
      const output = await lifecycle.execute({
        requestId: 'test-1',
        slots: { prompt: 'Say hello', system: 'Be brief' },
      });

      expect(output.slots.response).toBe('Hello world');
      expect(output.slots.model).toBe('qwen3.5:27b');
      expect(output.provenance).toBeDefined();
      expect(output.provenance.organId).toBe('ollama.qwen3.5.27b');

      // Verify fetch was called with correct args
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({
          method: 'POST',
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.model).toBe('qwen3.5:27b');
      expect(body.prompt).toBe('Say hello');
      expect(body.system).toBe('Be brief');
      expect(body.stream).toBe(false);
    });

    it('calls /api/embed for embedding models', async () => {
      const mockResponse = { embeddings: [[0.1, 0.2, 0.3]] };
      globalThis.fetch = mockFetchSuccess(mockResponse) as unknown as typeof fetch;

      const lifecycle = adapter.createLifecycle(MOCK_MODELS.models[1]); // nomic-embed-text
      const output = await lifecycle.execute({
        requestId: 'test-2',
        slots: { text: 'Embed this' },
      });

      expect(output.slots.embedding).toEqual([0.1, 0.2, 0.3]);
      expect(output.provenance.organId).toBe('ollama.nomic-embed-text');

      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:11434/api/embed',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ model: 'nomic-embed-text', input: 'Embed this' }),
        }),
      );
    });

    it('omits system from body when not provided', async () => {
      const mockResponse = { response: 'Hi' };
      globalThis.fetch = mockFetchSuccess(mockResponse) as unknown as typeof fetch;

      const lifecycle = adapter.createLifecycle(MOCK_MODELS.models[0]);
      await lifecycle.execute({
        requestId: 'test-3',
        slots: { prompt: 'Hello' },
      });

      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.system).toBeUndefined();
    });
  });

  describe('lifecycle health', () => {
    it('returns healthy when model is listed', async () => {
      globalThis.fetch = mockFetchSuccess(MOCK_MODELS) as unknown as typeof fetch;

      const lifecycle = adapter.createLifecycle(MOCK_MODELS.models[0]);
      const health = await lifecycle.health();

      expect(health.status).toBe('healthy');
    });

    it('returns unavailable when model is not listed', async () => {
      globalThis.fetch = mockFetchSuccess({ models: [] }) as unknown as typeof fetch;

      const lifecycle = adapter.createLifecycle(MOCK_MODELS.models[0]);
      const health = await lifecycle.health();

      expect(health.status).toBe('unavailable');
      expect(health.message).toContain('no longer listed');
    });

    it('returns unavailable when Ollama is unreachable', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

      const lifecycle = adapter.createLifecycle(MOCK_MODELS.models[0]);
      const health = await lifecycle.health();

      expect(health.status).toBe('unavailable');
      expect(health.message).toBe('Ollama unreachable');
    });
  });
});
