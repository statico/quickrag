import type { EmbeddingProvider } from "./base.js";
import { fetchWithTimeout } from "../utils/timeout.js";
import { logger } from "../utils/logger.js";

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;
  private model: string;
  private dimensions: number;
  private dimensionsInitialized: boolean = false;
  private timeoutMs: number;

  constructor(model: string, baseUrl: string = "http://localhost:11434", dimensions?: number, timeoutMs: number = 60000) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.timeoutMs = timeoutMs; // Default 60 seconds instead of 5 minutes
    // If dimensions provided, use them; otherwise will be determined on first call
    this.dimensions = dimensions ?? 768; // Common default for nomic-embed-text
    this.dimensionsInitialized = dimensions !== undefined;
  }

  async embed(text: string): Promise<number[]> {
    const textPreview = text.length > 50 ? text.substring(0, 50) + "..." : text;
    logger.debug(`Ollama embed: calling ${this.baseUrl}/api/embeddings with model ${this.model} (text: "${textPreview}")`);
    const startTime = Date.now();
    
    try {
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
      
      const fetchDuration = Date.now() - startTime;
      logger.debug(`Ollama embed: fetch completed in ${fetchDuration}ms, status=${response.status}`);

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
      const totalDuration = Date.now() - startTime;
      logger.debug(`Ollama embed: total time ${totalDuration}ms, embedding dims=${embedding.length}`);
      
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
    } catch (error) {
      const duration = Date.now() - startTime;
      if (error instanceof Error && error.message.includes("timed out")) {
        logger.error(`Ollama embed timed out after ${duration}ms (timeout=${this.timeoutMs}ms). Is Ollama running at ${this.baseUrl}?`);
      }
      throw error;
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    
    // Ollama doesn't have native batch support, so we'll do it with concurrency
    // Reduced batch size to avoid overwhelming Ollama
    const batchSize = 8;
    const results: number[][] = [];
    
    logger.debug(`Ollama embedBatch: processing ${texts.length} texts in batches of ${batchSize}`);
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(texts.length / batchSize);
      
      try {
        logger.debug(`Ollama batch ${batchNum}/${totalBatches}: embedding ${batch.length} texts...`);
        const startTime = Date.now();
        const batchResults = await Promise.all(
          batch.map((text, idx) => {
            logger.debug(`  Embedding text ${i + idx + 1}/${texts.length} (${text.length} chars)`);
            return this.embed(text);
          })
        );
        const duration = Date.now() - startTime;
        logger.debug(`Ollama batch ${batchNum}/${totalBatches} completed in ${duration}ms`);
        results.push(...batchResults);
      } catch (error) {
        logger.error(`Error in Ollama batch ${batchNum}/${totalBatches} at index ${i}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }
    
    logger.debug(`Ollama embedBatch: completed all ${texts.length} texts`);
    return results;
  }

  getDimensions(): number {
    return this.dimensions;
  }
}
