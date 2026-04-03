/**
 * @forgeframe/server — Ollama Organ Adapter
 *
 * Auto-discovers models from a local Ollama instance and registers
 * each as a ForgeFrame organ with manifest, lifecycle, and provenance.
 */

import type {
  OrganManifest,
  OrganLifecycle,
  OrganInput,
  OrganOutput,
  OrganHealth,
  OrganProvenanceRecord,
  OrganRegistry,
  OrganCapability,
  OrganCategory,
  OrganResources,
  OrganTrust,
  OrganIO,
} from '@forgeframe/core';
import type { Logger } from '@forgeframe/core';
import { randomUUID, createHash } from 'crypto';

// -- Ollama API types --

export interface OllamaModelDetails {
  family: string;
  parameter_size: string;
  quantization_level: string;
}

export interface OllamaModel {
  name: string;
  size: number;
  details: OllamaModelDetails;
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

interface OllamaGenerateResponse {
  response: string;
}

interface OllamaEmbedResponse {
  embeddings: number[][];
}

// -- Config --

export interface OllamaOrgansConfig {
  ollamaUrl: string;
  registry: OrganRegistry;
  logger?: Logger;
}

// -- Helpers --

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function sanitizeModelName(name: string): string {
  return name.replace(/[:/]/g, '.');
}

function hashData(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

function isEmbedModel(name: string): boolean {
  return name.toLowerCase().includes('embed');
}

function isCodeModel(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes('code') || lower.includes('coder');
}

// -- Adapter --

export class OllamaOrganAdapter {
  private readonly ollamaUrl: string;
  private readonly registry: OrganRegistry;
  private readonly logger: Logger;

  constructor(config: OllamaOrgansConfig) {
    this.ollamaUrl = config.ollamaUrl || DEFAULT_OLLAMA_URL;
    this.registry = config.registry;
    this.logger = config.logger ?? silentLogger;
  }

  /** Discover and register all Ollama models as organs */
  async discoverAndRegister(): Promise<string[]> {
    let models: OllamaModel[];
    try {
      const res = await fetch(`${this.ollamaUrl}/api/tags`);
      if (!res.ok) {
        this.logger.error(`Ollama API returned ${res.status}`);
        return [];
      }
      const data = (await res.json()) as OllamaTagsResponse;
      models = data.models ?? [];
    } catch (err) {
      this.logger.error('Ollama unavailable:', err);
      return [];
    }

    const registered: string[] = [];
    for (const model of models) {
      const manifest = this.generateManifest(model);
      const lifecycle = this.createLifecycle(model);
      try {
        await this.registry.register(manifest, lifecycle);
        registered.push(manifest.id);
        this.logger.info(`Registered Ollama organ: ${manifest.id}`);
      } catch (err) {
        this.logger.error(`Failed to register ${manifest.id}:`, err);
      }
    }

    return registered;
  }

  /** Generate a manifest for a specific model */
  generateManifest(model: OllamaModel): OrganManifest {
    const id = `ollama.${sanitizeModelName(model.name)}`;
    const embed = isEmbedModel(model.name);
    const code = isCodeModel(model.name);
    const sizeBytes = model.size;

    const capabilities = embed
      ? this.buildEmbedCapabilities()
      : this.buildInferenceCapabilities(sizeBytes, code);

    const categories: OrganCategory[] = embed ? ['embedding'] : ['inference'];

    const resources = this.estimateResources(sizeBytes);
    const trust = this.buildTrust();
    const io = embed ? this.buildEmbedIO() : this.buildInferenceIO();

    return {
      id,
      name: model.name,
      version: '0.1.0',
      description: `Ollama model: ${model.name} (${model.details.parameter_size}, ${model.details.quantization_level})`,
      categories,
      capabilities,
      resources,
      trust,
      io,
      provenance: {
        origin: 'ollama',
        license: 'varies',
        importedAt: Date.now(),
        adaptedBy: 'OllamaOrganAdapter',
        upstreamVersion: model.details.parameter_size,
      },
    };
  }

  /** Create a lifecycle implementation for a model */
  createLifecycle(model: OllamaModel): OrganLifecycle {
    const embed = isEmbedModel(model.name);
    const modelName = model.name;
    const ollamaUrl = this.ollamaUrl;
    const organId = `ollama.${sanitizeModelName(model.name)}`;

    return {
      async register(): Promise<boolean> {
        return true;
      },

      async activate(): Promise<void> {
        // Ollama manages model loading; nothing to do here.
      },

      async execute(input: OrganInput): Promise<OrganOutput> {
        const start = Date.now();

        if (embed) {
          const text = input.slots.text as string;
          const res = await fetch(`${ollamaUrl}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelName, input: text }),
          });
          if (!res.ok) {
            throw new Error(`Ollama embed failed: ${res.status} ${res.statusText}`);
          }
          const data = (await res.json()) as OllamaEmbedResponse;
          const durationMs = Date.now() - start;
          const outputSlots = { embedding: data.embeddings[0] };

          const provenance: OrganProvenanceRecord = {
            invocationId: randomUUID(),
            requestId: input.requestId,
            organId,
            organVersion: '0.1.0',
            timestamp: start,
            durationMs,
            inputHash: hashData(input.slots),
            outputHash: hashData(outputSlots),
            classificationsProcessed: ['internal'],
            trustLevel: 'local-only',
          };

          return { slots: outputSlots, provenance };
        }

        // Inference
        const prompt = input.slots.prompt as string;
        const system = input.slots.system as string | undefined;
        const body: Record<string, unknown> = {
          model: modelName,
          prompt,
          stream: false,
        };
        if (system) body.system = system;

        const res = await fetch(`${ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          throw new Error(`Ollama generate failed: ${res.status} ${res.statusText}`);
        }
        const data = (await res.json()) as OllamaGenerateResponse;
        const durationMs = Date.now() - start;
        const outputSlots = { response: data.response, model: modelName };

        const provenance: OrganProvenanceRecord = {
          invocationId: randomUUID(),
          requestId: input.requestId,
          organId,
          organVersion: '0.1.0',
          timestamp: start,
          durationMs,
          inputHash: hashData(input.slots),
          outputHash: hashData(outputSlots),
          classificationsProcessed: ['internal'],
          trustLevel: 'local-only',
        };

        return { slots: outputSlots, provenance };
      },

      async deactivate(): Promise<void> {
        // No-op: Ollama manages model lifecycle
      },

      async health(): Promise<OrganHealth> {
        try {
          const res = await fetch(`${ollamaUrl}/api/tags`);
          if (!res.ok) {
            return { status: 'unavailable', message: `Ollama returned ${res.status}` };
          }
          const data = (await res.json()) as OllamaTagsResponse;
          const found = data.models?.some((m) => m.name === modelName);
          if (!found) {
            return { status: 'unavailable', message: `Model ${modelName} no longer listed` };
          }
          return { status: 'healthy', message: `Model ${modelName} available` };
        } catch {
          return { status: 'unavailable', message: 'Ollama unreachable' };
        }
      },
    };
  }

  // -- Private capability builders --

  private buildEmbedCapabilities(): OrganCapability[] {
    return [
      {
        action: 'embed',
        quality: 0.80,
        speed: 'instant',
        inputModalities: ['text'],
        outputModalities: ['embedding-vector'],
      },
    ];
  }

  private buildInferenceCapabilities(sizeBytes: number, isCode: boolean): OrganCapability[] {
    const sizeGb = sizeBytes / (1024 * 1024 * 1024);
    const caps: OrganCapability[] = [];

    if (sizeGb < 2) {
      caps.push(
        this.cap('classify', 0.65, 'instant'),
        this.cap('summarize', 0.65, 'fast'),
      );
    } else if (sizeGb < 10) {
      caps.push(
        this.cap('reason', 0.80, 'fast'),
        this.cap('code', isCode ? 0.85 : 0.80, 'fast'),
        this.cap('summarize', 0.80, 'moderate'),
      );
    } else if (sizeGb < 25) {
      caps.push(
        this.cap('reason', 0.88, 'moderate'),
        this.cap('code', isCode ? 0.93 : 0.88, 'moderate'),
        this.cap('summarize', 0.88, 'moderate'),
        this.cap('analyze', 0.88, 'moderate'),
      );
    } else {
      caps.push(
        this.cap('reason', 0.92, 'slow'),
        this.cap('code', isCode ? 0.97 : 0.92, 'slow'),
        this.cap('analyze', 0.92, 'slow'),
        this.cap('architecture', 0.92, 'slow'),
      );
    }

    return caps;
  }

  private cap(action: string, quality: number, speed: OrganCapability['speed']): OrganCapability {
    return {
      action,
      quality,
      speed,
      inputModalities: ['text'],
      outputModalities: ['text'],
    };
  }

  private estimateResources(sizeBytes: number): OrganResources {
    const mb = Math.ceil(sizeBytes / (1024 * 1024));
    return {
      ramMb: mb,
      vramMb: mb,
      diskMb: mb,
      network: false,
      warmupTime: sizeBytes < 5 * 1024 * 1024 * 1024 ? 'seconds' : 'minutes',
      concurrent: true,
    };
  }

  private buildTrust(): OrganTrust {
    return {
      execution: 'local-only',
      dataClassifications: ['public', 'internal', 'sensitive', 'cognitive', 'constitutional'],
      canPersist: false,
      telemetry: false,
    };
  }

  private buildInferenceIO(): OrganIO {
    return {
      inputs: [
        { name: 'prompt', modality: 'text', required: true, classification: 'internal' },
        { name: 'system', modality: 'text', required: false, classification: 'internal' },
      ],
      outputs: [
        { name: 'response', modality: 'text', required: true, classification: 'internal' },
        { name: 'model', modality: 'text', required: true, classification: 'public' },
      ],
    };
  }

  private buildEmbedIO(): OrganIO {
    return {
      inputs: [
        { name: 'text', modality: 'text', required: true, classification: 'internal' },
      ],
      outputs: [
        { name: 'embedding', modality: 'embedding-vector', required: true, classification: 'internal' },
      ],
    };
  }
}
