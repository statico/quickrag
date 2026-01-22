import type { EmbeddingProvider } from "./base.js";
import { fetchWithTimeout } from "../utils/timeout.js";
import { logger } from "../utils/logger.js";

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;
  private model: string;
  private dimensions: number;
  private dimensionsInitialized: boolean = false;
  private timeoutMs: number;

  constructor(model: string, baseUrl: string = "http://localhost:11434", dimensions?: number, timeoutMs: number = 300000) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.timeoutMs = timeoutMs;
    // If dimensions provided, use them; otherwise will be determined on first call
    this.dimensions = dimensions ?? 768; // Common default for nomic-embed-text
    this.dimensionsInitialized = dimensions !== undefined;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/embeddings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          prompt: text,
        }),
      },
      this.timeoutMs
    );

    if (!response.ok) {
      let errorMessage: string;
      try {
        const errorData = await response.json() as { error?: string };
        errorMessage = errorData.error || `HTTP ${response.status}: ${response.statusText}`;
      } catch {
        errorMessage = await response.text() || `HTTP ${response.status}: ${response.statusText}`;
      }
      throw new Error(`Ollama API error: ${errorMessage}`);
    }

    const data = await response.json() as { embedding?: number[] };
    if (!data.embedding || !Array.isArray(data.embedding)) {
      throw new Error("Invalid response from Ollama API: missing or invalid embedding");
    }
    
    const embedding = data.embedding;
    
    // Update dimensions on first call if not explicitly set
    if (!this.dimensionsInitialized) {
      this.dimensions = embedding.length;
      this.dimensionsInitialized = true;
    } else if (embedding.length !== this.dimensions) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.dimensions}, got ${embedding.length}. ` +
        `This may indicate a model change. Please restart with the correct dimensions.`
      );
    }
    
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    
    // Ollama doesn't have native batch support, so we'll do it sequentially
    // but with some concurrency
    const batchSize = 5;
    const results: number[][] = [];
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      try {
        const batchResults = await Promise.all(
          batch.map((text) => this.embed(text))
        );
        results.push(...batchResults);
      } catch (error) {
        logger.error(`Error in Ollama batch at index ${i}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }
    
    return results;
  }

  getDimensions(): number {
    return this.dimensions;
  }
}
