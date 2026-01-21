import type { EmbeddingProvider } from "./base.js";

export class VoyageAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private dimensions: number;
  private baseUrl: string;

  constructor(apiKey: string, model: string = "voyage-3") {
    this.apiKey = apiKey;
    this.model = model;
    // voyage-3 has 1024 dimensions
    // voyage-large-2 has 1536 dimensions
    this.dimensions = model.includes("large") ? 1536 : 1024;
    this.baseUrl = "https://api.voyageai.com/v1";
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`VoyageAI API error: ${error}`);
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`VoyageAI API error: ${error}`);
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return data.data.map((item) => item.embedding);
  }

  getDimensions(): number {
    return this.dimensions;
  }
}
