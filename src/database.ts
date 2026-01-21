import * as lancedb from "@lancedb/lancedb";
import type { DocumentChunk } from "./parser.js";
import type { EmbeddingProvider } from "./embeddings/base.js";

export interface IndexedChunk {
  id: string;
  text: string;
  filePath: string;
  startLine: number;
  endLine: number;
  startChar: number;
  endChar: number;
  vector: number[];
}

export class RAGDatabase {
  private dbPath: string;
  private table: lancedb.Table | null = null;
  private dimensions: number;
  private db: any = null;

  constructor(dbPath: string, dimensions: number) {
    this.dbPath = dbPath;
    this.dimensions = dimensions;
  }

  async initialize(): Promise<void> {
    this.db = await lancedb.connect(this.dbPath);
    
    // Check if table exists
    try {
      this.table = await this.db.openTable("documents");
    } catch {
      // Table doesn't exist, will be created in indexChunks with first batch
      this.table = null;
    }
  }

  async indexChunks(
    chunks: DocumentChunk[],
    embeddingProvider: EmbeddingProvider
  ): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }

    console.log(`Indexing ${chunks.length} chunks...`);
    
    // Generate embeddings in batches
    const batchSize = 100;
    const indexedChunks: IndexedChunk[] = [];
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map((chunk) => chunk.text);
      
      console.log(`Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chunks.length / batchSize)}...`);
      const embeddings = await embeddingProvider.embedBatch(texts);
      
      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const id = `${chunk.filePath}:${chunk.startLine}:${chunk.endLine}`;
        indexedChunks.push({
          id,
          text: chunk.text,
          filePath: chunk.filePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          startChar: chunk.startChar,
          endChar: chunk.endChar,
          vector: embeddings[j],
        });
      }
    }
    
    // Create table if it doesn't exist, or add to existing table
    if (!this.table) {
      console.log("Creating new table with first batch...");
      this.table = await this.db.createTable("documents", indexedChunks as any);
    } else {
      console.log("Inserting into database...");
      await this.table.add(indexedChunks as any);
    }
    
    console.log(`Successfully indexed ${indexedChunks.length} chunks.`);
  }

  async search(
    queryVector: number[],
    topK: number = 5
  ): Promise<IndexedChunk[]> {
    if (!this.table) {
      throw new Error("Database not initialized. Call initialize() first.");
    }

    const results = await this.table
      .vectorSearch(queryVector)
      .limit(topK)
      .toArray();

    return results.map((result: any) => ({
      id: result.id,
      text: result.text,
      filePath: result.filePath,
      startLine: result.startLine,
      endLine: result.endLine,
      startChar: result.startChar,
      endChar: result.endChar,
      vector: result.vector,
    }));
  }

  async getStats(): Promise<{ count: number }> {
    if (!this.table) {
      throw new Error("Database not initialized. Call initialize() first.");
    }

    const count = await this.table.countRows();
    return { count };
  }
}
