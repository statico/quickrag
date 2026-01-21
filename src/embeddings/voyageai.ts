import type { EmbeddingProvider } from "./base.js";

function sanitizeUTF8(text: string): string {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  
  try {
    let cleaned = text
      .replace(/\uFFFD/g, "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
      .normalize("NFKC");
    
    const encoded = encoder.encode(cleaned);
    let decoded = decoder.decode(encoded);
    
    decoded = decoded.replace(/\uFFFD/g, "");
    
    const reencoded = encoder.encode(decoded);
    const finalDecoded = decoder.decode(reencoded);
    
    return finalDecoded;
  } catch {
    return text
      .replace(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
      .normalize("NFKC");
  }
}

export class VoyageAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private dimensions: number;
  private baseUrl: string;
  private dimensionsInitialized: boolean = false;

  constructor(apiKey: string, model: string = "voyage-3", dimensions?: number) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = "https://api.voyageai.com/v1";
    
    // If dimensions provided, use them; otherwise infer from model name
    if (dimensions !== undefined) {
      this.dimensions = dimensions;
      this.dimensionsInitialized = true;
    } else {
      // voyage-3, voyage-3-lite: 1024 dimensions
      // voyage-large-2, voyage-2: 1536 dimensions
      // Default to 1024 if uncertain
      this.dimensions = model.includes("large") || model.includes("voyage-2") ? 1536 : 1024;
    }
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
      let errorMessage: string;
      try {
        const errorData = await response.json() as { error?: { message?: string } };
        errorMessage = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      } catch {
        errorMessage = await response.text() || `HTTP ${response.status}: ${response.statusText}`;
      }
      throw new Error(`VoyageAI API error: ${errorMessage}`);
    }

    const data = await response.json() as { data?: Array<{ embedding?: number[] }> };
    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
      throw new Error("Invalid response from VoyageAI API: missing or empty data array");
    }
    
    const embedding = data.data[0].embedding;
    if (!embedding || !Array.isArray(embedding)) {
      throw new Error("Invalid response from VoyageAI API: missing or invalid embedding");
    }
    
    // Validate dimensions on first call
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
    
    const filteredTexts = texts.filter(text => text.trim().length > 0);
    if (filteredTexts.length === 0) {
      if (!this.dimensionsInitialized) {
        throw new Error("Cannot create embeddings for empty texts before dimensions are initialized");
      }
      return texts.map(() => new Array(this.dimensions).fill(0));
    }
    
    if (filteredTexts.length !== texts.length) {
      const emptyIndices = new Set<number>();
      texts.forEach((text, idx) => {
        if (text.trim().length === 0) {
          emptyIndices.add(idx);
        }
      });
      
      const embeddings = await this.embedBatch(filteredTexts);
      const result: number[][] = [];
      let filteredIdx = 0;
      const dims = this.dimensionsInitialized ? this.dimensions : embeddings[0]?.length || 1024;
      for (let i = 0; i < texts.length; i++) {
        if (emptyIndices.has(i)) {
          result.push(new Array(dims).fill(0));
        } else {
          result.push(embeddings[filteredIdx++]);
        }
      }
      return result;
    }
    
    const sanitizedTexts = texts.map(text => sanitizeUTF8(text));
    
    const requestBody = {
      model: this.model,
      input: sanitizedTexts,
      truncation: true,
    };
    
    let requestBodyStr: string;
    try {
      requestBodyStr = JSON.stringify(requestBody);
    } catch (error) {
      throw new Error(`Failed to serialize request body: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: requestBodyStr,
    });

    if (!response.ok) {
      let errorMessage: string;
      let errorDetails: any = null;
      let responseText: string = "";
      try {
        responseText = await response.text();
        try {
          errorDetails = JSON.parse(responseText);
          const detail = errorDetails.detail || errorDetails.error?.message;
          errorMessage = detail || JSON.stringify(errorDetails) || `HTTP ${response.status}: ${response.statusText}`;
        } catch {
          errorMessage = responseText || `HTTP ${response.status}: ${response.statusText}`;
        }
      } catch {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      }
      
      if (errorMessage.includes("UTF-8") && texts.length > 1) {
        console.warn(`Batch failed due to UTF-8 encoding issue, retrying texts individually...`);
        const individualEmbeddings: number[][] = [];
        for (let i = 0; i < texts.length; i++) {
          try {
            const singleEmbedding = await this.embedBatch([texts[i]]);
            individualEmbeddings.push(singleEmbedding[0]);
          } catch (singleError) {
            console.warn(`Failed to embed text at index ${i}, using zero vector: ${singleError instanceof Error ? singleError.message : String(singleError)}`);
            const dims = this.dimensionsInitialized ? this.dimensions : 1024;
            individualEmbeddings.push(new Array(dims).fill(0));
          }
        }
        return individualEmbeddings;
      }
      
      const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
      const maxChars = Math.max(...texts.map(t => t.length));
      const fullError = `VoyageAI API error: ${errorMessage} (batch size: ${texts.length}, total chars: ${totalChars}, max chunk chars: ${maxChars}, model: ${this.model})`;
      throw new Error(fullError);
    }

    const data = await response.json() as { data?: Array<{ embedding?: number[] }> };
    if (!data.data || !Array.isArray(data.data) || data.data.length !== texts.length) {
      throw new Error(
        `Invalid response from VoyageAI API: expected ${texts.length} embeddings, got ${data.data?.length ?? 0}`
      );
    }
    
    const embeddings = data.data.map((item, index) => {
      if (!item.embedding || !Array.isArray(item.embedding)) {
        throw new Error(`Invalid embedding at index ${index}`);
      }
      
      // Validate dimensions
      if (this.dimensionsInitialized && item.embedding.length !== this.dimensions) {
        throw new Error(
          `Embedding dimension mismatch at index ${index}: expected ${this.dimensions}, got ${item.embedding.length}`
        );
      } else if (!this.dimensionsInitialized) {
        this.dimensions = item.embedding.length;
        this.dimensionsInitialized = true;
      }
      
      return item.embedding;
    });
    
    return embeddings;
  }

  getDimensions(): number {
    return this.dimensions;
  }
}
