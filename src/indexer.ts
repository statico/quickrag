import { parseDirectory, type ChunkingOptions, type FileInfo, chunkText } from "./parser.js";
import { RAGDatabase } from "./database.js";
import type { EmbeddingProvider } from "./embeddings/base.js";
import { readFile } from "fs/promises";

export async function indexDirectory(
  dirPath: string,
  dbPath: string,
  embeddingProvider: EmbeddingProvider,
  chunkingOptions: ChunkingOptions,
  clear: boolean = false
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
  
  const db = new RAGDatabase(dbPath, dimensions);
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
  
  let totalChunks = 0;
  for (const file of filesToIndex) {
    try {
      console.log(`Indexing ${file.path}...`);
      
      await db.removeFileChunks(file.path);
      await db.removeFileFromIndex(file.path);
      
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
      
      if (fileChunks.length > 0) {
        await db.indexChunks(fileChunks, embeddingProvider);
        await db.markFileIndexed(file.path, file.mtime);
        totalChunks += fileChunks.length;
        console.log(`  Indexed ${fileChunks.length} chunks from ${file.path}`);
      } else {
        console.log(`  No chunks generated from ${file.path} (file may be empty)`);
      }
    } catch (error) {
      console.error(`  Error indexing ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  const stats = await db.getStats();
  console.log(`\nIndexing complete! Indexed ${totalChunks} new chunks. Total chunks in database: ${stats.count}`);
}
