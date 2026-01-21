import OpenAI from "openai";
import type { EmbeddingProvider } from "./base.js";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;
  private model: string;
  private dimensions: number;

  constructor(apiKey: string, model: string = "text-embedding-3-small") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    // text-embedding-3-small has 1536 dimensions by default
    // text-embedding-3-large has 3072 dimensions
    this.dimensions = model.includes("large") ? 3072 : 1536;
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    return response.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
    });
    return response.data.map((item) => item.embedding);
  }

  getDimensions(): number {
    return this.dimensions;
  }
}
