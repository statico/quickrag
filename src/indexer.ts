import { type ChunkerOptions, type FileInfo, chunkText, getFiles } from "./parser.js";
import { RAGDatabase } from "./database.js";
import type { EmbeddingProvider } from "./embeddings/base.js";
import type { QuickRAGConfig } from "./config.js";
import { createChunker, type ChunkerType } from "./chunkers/index.js";
import { readFile } from "fs/promises";
import { logger } from "./utils/logger.js";
import cliProgress from "cli-progress";

export async function indexDirectory(
  dirPath: string,
  dbPath: string,
  embeddingProvider: EmbeddingProvider,
  chunkingOptions: ChunkerOptions,
  clear: boolean = false,
  config?: QuickRAGConfig
): Promise<void> {
  const chunkerType: ChunkerType = config?.chunking?.strategy || "recursive-token";
  logger.info(`Parsing documents from ${dirPath}... (using ${chunkerType} chunker)`);
  
  logger.info("Detecting embedding dimensions...");
  const testEmbedding = await embeddingProvider.embed("test");
  const dimensions = testEmbedding.length;
  logger.success(`Detected embedding dimensions: ${dimensions}`);
  
  const db = new RAGDatabase(dbPath, dimensions, config);
  await db.initialize();
  
  if (clear) {
    logger.info("Clearing existing index...");
    await db.clearDatabase();
    await db.initialize();
    logger.success("Cleared existing index");
  }
  
  const allFiles = await getFiles(dirPath);
  
  if (allFiles.length === 0) {
    logger.warn("No documents found to index.");
    return;
  }
  
  const indexedFiles = await db.getIndexedFiles();
  const filesToIndex: FileInfo[] = [];
  
  for (const file of allFiles) {
    if (clear || !indexedFiles.has(file.path) || !(await db.isFileIndexed(file.path, file.mtime))) {
      filesToIndex.push(file);
    }
  }
  
  if (filesToIndex.length === 0) {
    logger.success("All files are already indexed and up to date.");
    const stats = await db.getStats();
    logger.info(`Total chunks in database: ${stats.count}`);
    return;
  }
  
  logger.info(`Found ${filesToIndex.length} file(s) to index (${allFiles.length - filesToIndex.length} already indexed)`);
  
  const existingHashes = await db.getExistingChunkHashes();
  let totalIndexed = 0;
  let totalSkipped = 0;
  
  const multibar = new cliProgress.MultiBar({
    clearOnComplete: false,
    hideCursor: true,
    format: "{label} |{bar}| {percentage}% | {value}/{total}",
    barCompleteChar: "\u2588",
    barIncompleteChar: "\u2591",
  }, cliProgress.Presets.shades_classic);
  
  const fileProgressBar = multibar.create(filesToIndex.length, 0, { label: "Files" });
  
  const chunker = createChunker(chunkerType);
  
  for (let i = 0; i < filesToIndex.length; i++) {
    const file = filesToIndex[i];
    
    try {
      if (!clear) {
        await db.removeFileChunks(file.path);
        await db.removeFileFromIndex(file.path);
      }
      
      let content: string;
      try {
        content = await readFile(file.path, "utf-8");
      } catch (readError) {
        logger.warn(`Could not read ${file.path} as UTF-8, trying with error handling...`);
        const buffer = await readFile(file.path);
        const decoder = new TextDecoder("utf-8", { fatal: false });
        content = decoder.decode(buffer);
      }
      
      const fileChunks = chunkText(content, file.path, chunkingOptions, chunker);
      
      if (fileChunks.length > 0) {
        const result = await db.indexChunks(fileChunks, embeddingProvider, existingHashes, multibar);
        totalIndexed += result.indexed;
        totalSkipped += result.skipped;
      }
      
      await db.markFileIndexed(file.path, file.mtime);
      fileProgressBar.update(i + 1);
    } catch (error) {
      logger.error(`Error processing ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
      fileProgressBar.update(i + 1);
    }
  }
  
  multibar.stop();
  
  let stats = { count: 0 };
  try {
    stats = await db.getStats();
  } catch {
    // Table might not exist, that's okay
  }
  
  logger.success(`Indexing complete! Processed ${totalIndexed + totalSkipped} chunks across ${filesToIndex.length} files`);
  logger.info(`Added ${totalIndexed} new chunks (${totalSkipped} already existed). Total chunks in database: ${stats.count}`);
}
