import { parseDirectory, type ChunkingOptions, type FileInfo, chunkText } from "./parser.js";
import { RAGDatabase } from "./database.js";
import type { EmbeddingProvider } from "./embeddings/base.js";
import type { QuickRAGConfig } from "./config.js";
import { readFile } from "fs/promises";

export async function indexDirectory(
  dirPath: string,
  dbPath: string,
  embeddingProvider: EmbeddingProvider,
  chunkingOptions: ChunkingOptions,
  clear: boolean = false,
  config?: QuickRAGConfig
): Promise<void> {
  console.log(`Parsing documents from ${dirPath}...`);
  const { chunks: allChunks, files } = await parseDirectory(dirPath, chunkingOptions);
  
  if (files.length === 0) {
    console.log("No documents found to index.");
    return;
  }
  
  // Initialize embedding provider dimensions
  let dimensions: number;
  if (allChunks.length > 0) {
    const testEmbedding = await embeddingProvider.embed(allChunks[0].text);
    dimensions = testEmbedding.length;
  } else {
    const testEmbedding = await embeddingProvider.embed("test");
    dimensions = testEmbedding.length;
  }
  console.log(`Detected embedding dimensions: ${dimensions}`);
  
  const db = new RAGDatabase(dbPath, dimensions, config);
  await db.initialize();
  
  if (clear) {
    console.log("Clearing existing index...");
    await db.clearDatabase();
    await db.initialize();
  }
  
  const indexedFiles = await db.getIndexedFiles();
  const filesToIndex: FileInfo[] = [];
  
  for (const file of files) {
    if (clear || !indexedFiles.has(file.path) || !(await db.isFileIndexed(file.path, file.mtime))) {
      filesToIndex.push(file);
    }
  }
  
  if (filesToIndex.length === 0) {
    console.log("All files are already indexed and up to date.");
    const stats = await db.getStats();
    console.log(`Total chunks in database: ${stats.count}`);
    return;
  }
  
  console.log(`Found ${filesToIndex.length} file(s) to index (${files.length - filesToIndex.length} already indexed)`);
  
  // Collect all chunks from all files first (cross-file batching like YAMS)
  console.log("Collecting chunks from all files...");
  const allChunksToIndex: Array<{ chunk: DocumentChunk; filePath: string; mtime: number }> = [];
  
  for (const file of filesToIndex) {
    try {
      // Don't remove file chunks upfront - let deduplication handle it
      // Only remove from file index if we're re-indexing
      if (!clear) {
        await db.removeFileFromIndex(file.path);
      }
      
      let content: string;
      try {
        content = await readFile(file.path, "utf-8");
      } catch (readError) {
        console.warn(`  Warning: Could not read ${file.path} as UTF-8, trying with error handling...`);
        const buffer = await readFile(file.path);
        const decoder = new TextDecoder("utf-8", { fatal: false });
        content = decoder.decode(buffer);
      }
      
      const fileChunks = chunkText(content, file.path, chunkingOptions);
      
      for (const chunk of fileChunks) {
        allChunksToIndex.push({ chunk, filePath: file.path, mtime: file.mtime });
      }
      
      console.log(`  Collected ${fileChunks.length} chunks from ${file.path}`);
    } catch (error) {
      console.error(`  Error reading ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  if (allChunksToIndex.length === 0) {
    console.log("No chunks to index.");
    return;
  }
  
  // Process all chunks together (cross-file batching)
  console.log(`\nProcessing ${allChunksToIndex.length} chunks across ${filesToIndex.length} files...`);
  
  let statsBefore = { count: 0 };
  try {
    statsBefore = await db.getStats();
  } catch {
    // Table might not exist yet, that's okay
  }
  
  const chunksToIndex = allChunksToIndex.map(item => item.chunk);
  await db.indexChunks(chunksToIndex, embeddingProvider);
  
  let statsAfter = { count: 0 };
  try {
    statsAfter = await db.getStats();
  } catch {
    // Table might not exist, that's okay
  }
  
  const totalNewChunks = statsAfter.count - statsBefore.count;
  
  // Mark all files as indexed
  for (const file of filesToIndex) {
    try {
      await db.markFileIndexed(file.path, file.mtime);
    } catch (error) {
      console.warn(`  Warning: Could not mark ${file.path} as indexed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  const totalChunks = allChunksToIndex.length;
  const skippedChunks = totalChunks - totalNewChunks;
  
  let stats = { count: 0 };
  try {
    stats = await db.getStats();
  } catch {
    // Table might not exist, that's okay
  }
  console.log(`\nIndexing complete! Processed ${totalChunks} chunks across ${filesToIndex.length} files, added ${totalNewChunks} new chunks (${skippedChunks} already existed). Total chunks in database: ${stats.count}`);
}
