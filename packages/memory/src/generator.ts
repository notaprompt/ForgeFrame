/**
 * @forgeframe/memory — Generator Interface + Ollama Implementation
 *
 * Provides LLM text generation for consolidation summaries.
 * Follows OllamaEmbedder pattern: fail-silent, never blocks critical paths.
 * Constitutional: consolidation always uses local models (cognitive data never cloud).
 */

export interface Generator {
  generate(prompt: string): Promise<string | null>;
}

export interface GeneratorConfig {
  ollamaUrl: string;
  model: string;
}

const MAX_INPUT_CHARS = 16000;

export class OllamaGenerator implements Generator {
  private _url: string;
  private _model: string;

  constructor(config: GeneratorConfig) {
    this._url = config.ollamaUrl.replace(/\/$/, '');
    this._model = config.model;
  }

  async generate(prompt: string): Promise<string | null> {
    try {
      const input = prompt.length > MAX_INPUT_CHARS
        ? prompt.slice(0, MAX_INPUT_CHARS)
        : prompt;

      const res = await fetch(`${this._url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this._model,
          prompt: input,
          stream: false,
        }),
      });

      if (!res.ok) return null;

      const data = await res.json() as { response?: string };
      return data.response?.trim() || null;
    } catch {
      return null;
    }
  }
}
