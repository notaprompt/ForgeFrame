/**
 * @forgeframe/memory — Embedding Interface + Ollama Implementation
 *
 * Provides vector embeddings for semantic search.
 * Graceful — never blocks a save on embedding failure.
 */

export interface Embedder {
  embed(text: string): Promise<number[] | null>;
}

export interface EmbedderConfig {
  ollamaUrl: string;
  model: string;
}

const MAX_INPUT_CHARS = 8000;

export class OllamaEmbedder implements Embedder {
  private _url: string;
  private _model: string;

  constructor(config: EmbedderConfig) {
    this._url = config.ollamaUrl.replace(/\/$/, '');
    this._model = config.model;
  }

  async embed(text: string): Promise<number[] | null> {
    try {
      const input = text.length > MAX_INPUT_CHARS
        ? text.slice(0, MAX_INPUT_CHARS)
        : text;

      const res = await fetch(`${this._url}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this._model, input }),
      });

      if (!res.ok) return null;

      const data = await res.json() as { embeddings?: number[][] };
      if (!data.embeddings || data.embeddings.length === 0) return null;

      return data.embeddings[0];
    } catch {
      return null;
    }
  }
}
