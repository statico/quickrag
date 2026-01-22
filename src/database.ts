import * as lancedb from "@lancedb/lancedb";
import { createHash } from "crypto";
import type { DocumentChunk } from "./parser.js";
import type { EmbeddingProvider } from "./embeddings/base.js";
import type { QuickRAGConfig } from "./config.js";
import { ConcurrencyLimiter } from "./utils/concurrency.js";
import { estimateTokens } from "./utils/tokens.js";
import { logger } from "./utils/logger.js";
import type { ListrTaskWrapper } from "listr2";

export interface IndexedChunk {
  id: string;
  text: string;
  filePath: string;
  startLine: number;
  endLine: number;
  startChar: number;
  endChar: number;
  vector: number[];
  hash: string;
}

export class RAGDatabase {
  private dbPath: string;
  private table: lancedb.Table | null = null;
  private fileIndexTable: lancedb.Table | null = null;
  private dimensions: number;
  private db: Awaited<ReturnType<typeof lancedb.connect>> | null = null;
  private concurrencyLimiter: ConcurrencyLimiter;
  private batchingConfig: {
    maxTextsPerBatch: number;
    maxCharsPerBatch: number;
    maxTokensPerBatch: number;
    maxConcurrentEmbeddings: number;
  };

  constructor(dbPath: string, dimensions: number, config?: QuickRAGConfig) {
    this.dbPath = dbPath;
    this.dimensions = dimensions;
    
    // Use config with defaults
    const defaultBatching = {
      maxTextsPerBatch: 64,
      maxCharsPerBatch: 150000,
      maxTokensPerBatch: 20000,
      maxConcurrentEmbeddings: 4,
    };
    
    this.batchingConfig = {
      ...defaultBatching,
      ...(config?.batching || {}),
    };
    
    this.concurrencyLimiter = new ConcurrencyLimiter(this.batchingConfig.maxConcurrentEmbeddings);
  }

  getDimensions(): number {
    return this.dimensions;
  }

  private computeChunkHash(text: string): string {
    // Use a faster hash for deduplication - we don't need cryptographic security
    // Just need to detect identical chunks
    return createHash("sha256").update(text).digest("hex");
  }

  private async embedWithRetry(
    texts: string[],
    embeddingProvider: EmbeddingProvider,
    maxRetries: number
  ): Promise<number[][]> {
    try {
      return await embeddingProvider.embedBatch(texts);
    } catch (error) {
      if (maxRetries === 0 || texts.length <= 1) {
        throw error;
      }
      
      const mid = Math.floor(texts.length / 2);
      logger.warn(`Batch failed, splitting into ${mid} and ${texts.length - mid} chunks and retrying...`);
      
      const left = await this.embedWithRetry(
        texts.slice(0, mid),
        embeddingProvider,
        maxRetries - 1
      );
      const right = await this.embedWithRetry(
        texts.slice(mid),
        embeddingProvider,
        maxRetries - 1
      );
      
      return [...left, ...right];
    }
  }

  async getExistingChunkHashes(): Promise<Set<string>> {
    if (!this.table) {
      return new Set();
    }
    
    try {
      const allChunks = await this.table.query().select(["hash"]).toArray();
      const hashes = new Set<string>();
      for (const row of allChunks) {
        const record = row as Record<string, unknown>;
        const hash = record.hash;
        if (hash && typeof hash === "string") {
          hashes.add(hash);
        }
      }
      return hashes;
    } catch (error) {
      logger.debug(`Failed to get existing chunk hashes: ${error instanceof Error ? error.message : String(error)}`);
      return new Set();
    }
  }

  async initialize(): Promise<void> {
    this.db = await lancedb.connect(this.dbPath);
    
    // Check if file index table exists
    try {
      this.fileIndexTable = await this.db.openTable("file_index");
    } catch {
      this.fileIndexTable = null;
    }
    
    // Check if documents table exists
    try {
      this.table = await this.db.openTable("documents");
      
      // If table exists, detect dimensions from the first vector
      // This ensures we use the correct dimensions even if a different embedding provider is used for querying
      // Use vectorSearch with a dummy query to get the first row
      // Create a dummy vector with the expected dimensions (will be adjusted if wrong)
      const dummyVector = new Array(this.dimensions).fill(0);
      try {
        const sample = await this.table
          .vectorSearch(dummyVector)
          .limit(1)
          .toArray();
        if (sample.length > 0) {
          const firstRow = sample[0] as Record<string, unknown>;
          const vector = firstRow.vector;
          // Handle different vector formats (Array, Float32Array, etc.)
          let vectorArray: number[];
          if (Array.isArray(vector)) {
            vectorArray = vector as number[];
          } else if (vector && typeof vector === 'object' && 'length' in vector) {
            // Handle typed arrays like Float32Array
            vectorArray = Array.from(vector as ArrayLike<number>);
          } else {
            throw new Error(`Unable to read vector from database - unexpected format: ${typeof vector}, ${vector?.constructor?.name || 'unknown'}`);
          }
          
          if (vectorArray.length > 0) {
            // Always update to match the database dimensions
            this.dimensions = vectorArray.length;
          } else {
            throw new Error("Vector from database is empty");
          }
        } else {
          throw new Error("No rows found in database table");
        }
      } catch (searchError) {
        // If vectorSearch fails due to dimension mismatch, try common dimension sizes
        // This handles the case where the initial dimension guess is wrong
        const commonDimensions = [512, 768, 1024, 1536, 2048, 3072];
        for (const testDim of commonDimensions) {
          try {
            const testVector = new Array(testDim).fill(0);
            const sample = await this.table
              .vectorSearch(testVector)
              .limit(1)
              .toArray();
            if (sample.length > 0) {
              const firstRow = sample[0] as Record<string, unknown>;
              const vector = firstRow.vector;
              let vectorArray: number[];
              if (Array.isArray(vector)) {
                vectorArray = vector as number[];
              } else if (vector && typeof vector === 'object' && 'length' in vector) {
                vectorArray = Array.from(vector as ArrayLike<number>);
              } else {
                continue;
              }
              if (vectorArray.length > 0) {
                this.dimensions = vectorArray.length;
                break;
              }
            }
          } catch {
            // Try next dimension
            continue;
          }
        }
      }
    } catch (error) {
      // Table doesn't exist, will be created in indexChunks with first batch
      this.table = null;
    }
  }

  async indexChunks(
    chunks: DocumentChunk[],
    embeddingProvider: EmbeddingProvider,
    existingHashes?: Set<string>,
    task?: ListrTaskWrapper<any, any, any>
  ): Promise<{ indexed: number; skipped: number }> {
    if (!this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    if (chunks.length === 0) {
      logger.warn("No chunks to index.");
      return { indexed: 0, skipped: 0 };
    }

    // Compute hashes for all chunks and check which ones already exist
    const hashes = existingHashes ?? await this.getExistingChunkHashes();
    const chunksToIndex: Array<DocumentChunk & { hash: string }> = [];
    let skippedCount = 0;

    // Yield to event loop periodically to prevent blocking
    const YIELD_INTERVAL = 50;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const hash = this.computeChunkHash(chunk.text);
      if (!hashes.has(hash)) {
        chunksToIndex.push({ ...chunk, hash });
        hashes.add(hash);
      } else {
        skippedCount++;
      }
      
      // Yield to event loop every YIELD_INTERVAL chunks to keep spinner alive
      if (i > 0 && i % YIELD_INTERVAL === 0) {
        await Promise.resolve();
        if (task && chunks.length > 50) {
          task.title = `${task.title.split('(')[0].trim()} (${i + 1}/${chunks.length} processed)`;
        }
      }
    }

    if (chunksToIndex.length === 0) {
      return { indexed: 0, skipped: skippedCount };
    }
    
    if (chunksToIndex.length > 100) {
      if (task) {
        task.title = `Indexing ${chunksToIndex.length} new chunks (${skippedCount} already exist)...`;
      } else {
        logger.info(`Indexing ${chunksToIndex.length} new chunks (${skippedCount} already exist)...`);
      }
    }
    
    // Generate embeddings in batches with improved sizing
    // Token-aware batching: estimate tokens instead of just characters
    // Use configurable batch limits from config
    const maxTokensPerBatch = this.batchingConfig.maxTokensPerBatch;
    const maxTextsPerBatch = this.batchingConfig.maxTextsPerBatch;
    const maxCharsPerBatch = this.batchingConfig.maxCharsPerBatch;
    const indexedChunks: IndexedChunk[] = [];
    
    // Calculate total batches for accurate progress reporting
    const totalTokens = chunksToIndex.reduce((sum, chunk) => sum + estimateTokens(chunk.text), 0);
    const estimatedBatchesByTokens = Math.ceil(totalTokens / maxTokensPerBatch);
    const estimatedBatchesByCount = Math.ceil(chunksToIndex.length / maxTextsPerBatch);
    let totalBatches = Math.max(estimatedBatchesByTokens, estimatedBatchesByCount, 1);
    
    let batchNum = 0;
    let i = 0;
    
    // First, collect all batches with their metadata
    interface BatchInfo {
      batch: typeof chunksToIndex;
      batchNum: number;
      batchTokenCount: number;
    }
    const batches: BatchInfo[] = [];
    
    while (i < chunksToIndex.length) {
      const batch: typeof chunksToIndex = [];
      let batchTokenCount = 0;
      let batchCharCount = 0;
      
      while (i < chunksToIndex.length && batch.length < maxTextsPerBatch) {
        const chunk = chunksToIndex[i];
        const chunkTokens = estimateTokens(chunk.text);
        const chunkChars = chunk.text.length;
        
        // Check both token and character limits
        if (batch.length === 0 || 
            (batchTokenCount + chunkTokens <= maxTokensPerBatch && 
             batchCharCount + chunkChars <= maxCharsPerBatch)) {
          batch.push(chunk);
          batchTokenCount += chunkTokens;
          batchCharCount += chunkChars;
          i++;
        } else {
          break;
        }
      }
      
      if (batch.length === 0) {
        throw new Error(`Chunk at index ${i} is too large (${chunksToIndex[i].text.length} chars, ${estimateTokens(chunksToIndex[i].text)} tokens) for batch limits`);
      }
      
      batchNum++;
      batches.push({ batch, batchNum, batchTokenCount });
    }
    
    totalBatches = batches.length;
    
    const batchResults: Array<{ batchInfo: BatchInfo; embeddings: number[][] }> = [];
    let completedBatches = 0;
    
    const batchPromises = batches.map((batchInfo) => {
      const texts = batchInfo.batch.map((chunk) => chunk.text);
      
      return this.concurrencyLimiter.execute(async () => {
        try {
          logger.debug(`Starting batch ${batchInfo.batchNum}/${totalBatches} (${texts.length} texts)`);
          const embeddings = await this.embedWithRetry(texts, embeddingProvider, 3);
          batchResults.push({ batchInfo, embeddings });
          completedBatches++;
          if (task) {
            task.title = `Generating embeddings: ${completedBatches}/${totalBatches} batches`;
          }
          logger.debug(`Completed batch ${batchInfo.batchNum}/${totalBatches}`);
        } catch (error) {
          logger.error(`Error in batch ${batchInfo.batchNum}: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
      });
    });
    
    logger.debug(`Waiting for ${batchPromises.length} batch promises to complete...`);
    await Promise.all(batchPromises);
    logger.debug(`All batches completed, sorting results...`);
    
    // Sort results by batch number to maintain order
    batchResults.sort((a, b) => a.batchInfo.batchNum - b.batchInfo.batchNum);
    
    // Combine all results in order
    logger.debug(`Combining ${batchResults.length} batch results into indexed chunks...`);
    for (const { batchInfo, embeddings } of batchResults) {
      for (let j = 0; j < batchInfo.batch.length; j++) {
        const chunk = batchInfo.batch[j];
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
          hash: chunk.hash,
        });
      }
    }
    
    logger.debug(`Writing ${indexedChunks.length} chunks to database...`);
    if (!this.table) {
      const tableData = indexedChunks.map(chunk => ({
        id: chunk.id,
        text: chunk.text,
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        startChar: chunk.startChar,
        endChar: chunk.endChar,
        vector: chunk.vector,
        hash: chunk.hash,
      }));
      this.table = await this.db.createTable("documents", tableData);
      logger.debug(`Created new documents table`);
    } else {
      const tableData = indexedChunks.map(chunk => ({
        id: chunk.id,
        text: chunk.text,
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        startChar: chunk.startChar,
        endChar: chunk.endChar,
        vector: chunk.vector,
        hash: chunk.hash,
      }));
      await this.table.add(tableData);
      logger.debug(`Added chunks to existing table`);
    }
    
    return { indexed: indexedChunks.length, skipped: skippedCount };
  }

  async search(
    queryVector: number[],
    topK: number = 5
  ): Promise<IndexedChunk[]> {
    if (!this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    if (!this.table) {
      throw new Error("Table 'documents' does not exist. Please index documents first.");
    }
    if (queryVector.length !== this.dimensions) {
      throw new Error(
        `Query vector dimension mismatch: expected ${this.dimensions}, got ${queryVector.length}`
      );
    }

    const results = await this.table
      .vectorSearch(queryVector)
      .limit(topK)
      .toArray();

    return results.map((result: Record<string, unknown>) => ({
      id: String(result.id ?? ""),
      text: String(result.text ?? ""),
      filePath: String(result.filePath ?? ""),
      startLine: Number(result.startLine ?? 0),
      endLine: Number(result.endLine ?? 0),
      startChar: Number(result.startChar ?? 0),
      endChar: Number(result.endChar ?? 0),
      vector: Array.isArray(result.vector) ? result.vector as number[] : [],
      hash: String(result.hash ?? ""),
    }));
  }

  async getStats(): Promise<{ count: number }> {
    if (!this.table) {
      throw new Error("Database not initialized. Call initialize() first.");
    }

    const count = await this.table.countRows();
    return { count };
  }

  async clearDatabase(): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    
    try {
      await this.db.dropTable("documents");
    } catch {
      // Table might not exist
    }
    
    try {
      await this.db.dropTable("file_index");
    } catch {
      // Table might not exist
    }
    
    this.table = null;
    this.fileIndexTable = null;
  }

  async getIndexedFiles(): Promise<Set<string>> {
    if (!this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    
    if (!this.fileIndexTable) {
      return new Set();
    }
    
    try {
      const allFiles = await this.fileIndexTable
        .query()
        .toArray();
      
      return new Set(allFiles.map((row: Record<string, unknown>) => String(row.filePath || "")));
    } catch {
      return new Set();
    }
  }

  async markFileIndexed(filePath: string, mtime: number): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    
    if (!this.fileIndexTable) {
      const initialData = [{
        filePath,
        mtime,
        indexedAt: Date.now(),
      }];
      this.fileIndexTable = await this.db.createTable("file_index", initialData);
      return;
    }
    
    try {
      await this.removeFileFromIndex(filePath);
      await this.fileIndexTable.add([{
        filePath,
        mtime,
        indexedAt: Date.now(),
      }]);
    } catch (error) {
      logger.debug(`Error in markFileIndexed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      await this.fileIndexTable.add([{
        filePath,
        mtime,
        indexedAt: Date.now(),
      }]);
    }
  }

  async removeFileFromIndex(filePath: string): Promise<void> {
    if (!this.fileIndexTable) {
      return;
    }
    
    try {
      const escapedPath = filePath.replace(/'/g, "''");
      await this.fileIndexTable.delete(`filePath = '${escapedPath}'`);
    } catch (error) {
      logger.debug(`Failed to remove file from index ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async isFileIndexed(filePath: string, mtime: number): Promise<boolean> {
    if (!this.fileIndexTable) {
      return false;
    }
    
    try {
      const escapedPath = filePath.replace(/'/g, "''");
      const results = await this.fileIndexTable
        .query()
        .where(`filePath = '${escapedPath}'`)
        .toArray();
      
      if (results.length === 0) {
        return false;
      }
      
      const record = results[0] as Record<string, unknown>;
      const indexedMtime = Number(record.mtime || 0);
      return indexedMtime === mtime;
    } catch {
      return false;
    }
  }

  async removeFileChunks(filePath: string): Promise<void> {
    if (!this.table) {
      return;
    }
    
    try {
      const escapedPath = filePath.replace(/'/g, "''");
      await this.table.delete(`filePath = '${escapedPath}'`);
    } catch (error) {
      logger.debug(`Failed to remove chunks for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
