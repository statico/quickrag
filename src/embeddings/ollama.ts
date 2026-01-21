import type { EmbeddingProvider } from "./base.js";

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;
  private model: string;
  private dimensions: number;

  constructor(model: string, baseUrl: string = "http://localhost:11434") {
    this.baseUrl = baseUrl;
    this.model = model;
    // Common Ollama embedding models and their dimensions
    // nomic-embed-text: 768
    // This will be determined dynamically on first call
    this.dimensions = 768; // default, will be updated
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${error}`);
    }

    const data = await response.json() as { embedding: number[] };
    const embedding = data.embedding;
    
    // Update dimensions on first call
    if (this.dimensions === 768 && embedding.length !== 768) {
      this.dimensions = embedding.length;
    }
    
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama doesn't have native batch support, so we'll do it sequentially
    // but with some concurrency
    const batchSize = 5;
    const results: number[][] = [];
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((text) => this.embed(text))
      );
      results.push(...batchResults);
    }
    
    return results;
  }

  getDimensions(): number {
    return this.dimensions;
  }
}
