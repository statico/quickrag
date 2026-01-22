import { type ChunkerOptions, type FileInfo, chunkText, getFiles } from "./parser.js";
import { RAGDatabase } from "./database.js";
import type { EmbeddingProvider } from "./embeddings/base.js";
import type { QuickRAGConfig } from "./config.js";
import { createChunker, type ChunkerType } from "./chunkers/index.js";
import { readFile } from "fs/promises";
import { logger } from "./utils/logger.js";
import { Listr } from "listr2";

interface IndexContext {
  chunkerType: ChunkerType;
  dimensions: number;
  db: RAGDatabase;
  allFiles: FileInfo[];
  filesToIndex: FileInfo[];
  deletedFiles: string[];
  existingHashes: Set<string>;
  chunker: ReturnType<typeof createChunker>;
  totalIndexed: number;
  totalSkipped: number;
  totalDeleted: number;
  stats: { count: number };
}

export async function indexDirectory(
  dirPath: string,
  dbPath: string,
  embeddingProvider: EmbeddingProvider,
  chunkingOptions: ChunkerOptions,
  clear: boolean = false,
  config?: QuickRAGConfig
): Promise<void> {
  if (config?.chunking?.minChunkSize !== undefined) {
    chunkingOptions.minChunkSize = config.chunking.minChunkSize;
  }
  const ctx: IndexContext = {
    chunkerType: config?.chunking?.strategy || "recursive-token",
    dimensions: 0,
    db: null as any,
    allFiles: [],
    filesToIndex: [],
    deletedFiles: [],
    existingHashes: new Set(),
    chunker: null as any,
    totalIndexed: 0,
    totalSkipped: 0,
    totalDeleted: 0,
    stats: { count: 0 },
  };

  const tasks = new Listr<IndexContext>([
    {
      title: `Parsing documents from ${dirPath}... (using ${ctx.chunkerType} chunker)`,
      task: async (ctx) => {
        ctx.allFiles = await getFiles(dirPath);
        if (ctx.allFiles.length === 0) {
          throw new Error("No documents found to index.");
        }
      },
    },
    {
      title: "Detecting embedding dimensions",
      task: async (ctx) => {
        const testEmbedding = await embeddingProvider.embed("test");
        ctx.dimensions = testEmbedding.length;
      },
    },
    {
      title: "Initializing database",
      task: async (ctx) => {
        ctx.db = new RAGDatabase(dbPath, ctx.dimensions, config);
        await ctx.db.initialize();
      },
    },
    {
      title: "Clearing existing index",
      enabled: () => clear,
      task: async (ctx) => {
        await ctx.db.clearDatabase();
        await ctx.db.initialize();
      },
    },
    {
      title: "Finding files to index",
      task: async (ctx) => {
        const indexedFiles = await ctx.db.getIndexedFiles();
        const currentFilePaths = new Set(ctx.allFiles.map(f => f.path));
        
        for (const file of ctx.allFiles) {
          if (clear || !indexedFiles.has(file.path) || !(await ctx.db.isFileIndexed(file.path, file.mtime))) {
            ctx.filesToIndex.push(file);
          }
        }
        
        if (!clear) {
          for (const indexedPath of indexedFiles) {
            if (!currentFilePaths.has(indexedPath)) {
              ctx.deletedFiles.push(indexedPath);
            }
          }
        }
        
        if (ctx.filesToIndex.length === 0 && ctx.deletedFiles.length === 0) {
          ctx.stats = await ctx.db.getStats();
          throw new Error("All files are already indexed and up to date.");
        }
      },
    },
    {
      title: "Removing deleted files from index",
      enabled: (ctx) => ctx.deletedFiles.length > 0,
      task: async (ctx, task) => {
        if (task && ctx.deletedFiles.length > 0) {
          task.title = `Removing ${ctx.deletedFiles.length} deleted file${ctx.deletedFiles.length !== 1 ? 's' : ''} from index...`;
        }
        
        for (const deletedPath of ctx.deletedFiles) {
          await ctx.db.removeFileChunks(deletedPath);
          await ctx.db.removeFileFromIndex(deletedPath);
          ctx.totalDeleted++;
        }
        
        if (task && ctx.deletedFiles.length > 0) {
          task.title = `Removed ${ctx.deletedFiles.length} deleted file${ctx.deletedFiles.length !== 1 ? 's' : ''} from index`;
        }
      },
    },
    {
      title: "Preparing for indexing",
      enabled: (ctx) => ctx.filesToIndex.length > 0,
      task: async (ctx) => {
        ctx.existingHashes = await ctx.db.getExistingChunkHashes();
        ctx.chunker = createChunker(ctx.chunkerType);
      },
    },
    {
      title: `Indexing ${ctx.filesToIndex.length} files`,
      enabled: (ctx) => ctx.filesToIndex.length > 0,
      task: (ctx, task) => {
        if (task && ctx.filesToIndex.length > 0) {
          task.title = `Indexing ${ctx.filesToIndex.length} files (processing in batches of 4)...`;
        }
        return task.newListr(
          ctx.filesToIndex.map((file, index) => ({
            title: file.path,
            task: async (ctx, task) => {
              const fileNum = index + 1;
              if (task && ctx.filesToIndex.length > 10) {
                task.title = `[${fileNum}/${ctx.filesToIndex.length}] ${file.path}`;
              }
              
              if (!clear) {
                await ctx.db.removeFileChunks(file.path);
                await ctx.db.removeFileFromIndex(file.path);
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

              if (task) {
                if (ctx.filesToIndex.length > 10) {
                  task.title = `[${fileNum}/${ctx.filesToIndex.length}] Chunking ${file.path}...`;
                } else {
                  task.title = `Chunking ${file.path}...`;
                }
              }
              const fileChunks = chunkText(content, file.path, chunkingOptions, ctx.chunker);
              
              if (task && fileChunks.length > 0) {
                if (ctx.filesToIndex.length > 10) {
                  task.title = `[${fileNum}/${ctx.filesToIndex.length}] ${file.path} (${fileChunks.length} chunks)`;
                } else {
                  task.title = `${file.path} (${fileChunks.length} chunks)`;
                }
              }

              if (fileChunks.length > 0) {
                try {
                  const result = await ctx.db.indexChunks(fileChunks, embeddingProvider, ctx.existingHashes, task);
                  ctx.totalIndexed += result.indexed;
                  ctx.totalSkipped += result.skipped;
                  if (task && ctx.filesToIndex.length > 10) {
                    task.title = `[${fileNum}/${ctx.filesToIndex.length}] ✓ ${file.path} (${result.indexed} new, ${result.skipped} skipped)`;
                  }
                } catch (error) {
                  logger.error(`Failed to index ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
                  if (task && ctx.filesToIndex.length > 10) {
                    task.title = `[${fileNum}/${ctx.filesToIndex.length}] ✗ ${file.path} (error)`;
                  }
                  throw error;
                }
              }

              await ctx.db.markFileIndexed(file.path, file.mtime);
            },
          })),
          { concurrent: 4, exitOnError: false }
        );
      },
    },
    {
      title: "Finalizing",
      task: async (ctx) => {
        logger.info("Starting finalization...");
        try {
          logger.info("Getting database stats...");
          ctx.stats = await ctx.db.getStats();
          logger.info(`Stats retrieved: ${ctx.stats.count} chunks`);
        } catch (error) {
          logger.error(`Failed to get stats: ${error instanceof Error ? error.message : String(error)}`);
          if (error instanceof Error) {
            logger.error(`Error stack: ${error.stack}`);
          }
          ctx.stats = { count: 0 };
        }
        logger.info("Finalization complete");
      },
    },
  ]);

  try {
    logger.info("Starting task execution...");
    await tasks.run(ctx);
    logger.info("Task execution completed, preparing summary...");
    const deletedMsg = ctx.totalDeleted > 0
      ? ` Removed ${ctx.totalDeleted} deleted file${ctx.totalDeleted !== 1 ? 's' : ''}.`
      : "";
    
    if (ctx.filesToIndex.length > 0) {
      logger.info(
        `Indexing complete! Processed ${ctx.totalIndexed + ctx.totalSkipped} chunks across ${ctx.filesToIndex.length} file${ctx.filesToIndex.length !== 1 ? 's' : ''}.${deletedMsg}`
      );
      logger.info(
        `Added ${ctx.totalIndexed} new chunks (${ctx.totalSkipped} already existed). Total chunks in database: ${ctx.stats.count}`
      );
    } else if (ctx.totalDeleted > 0) {
      logger.info(
        `Indexing complete!${deletedMsg} Total chunks in database: ${ctx.stats.count}`
      );
    }
    logger.info("Indexing function completed successfully");
  } catch (error) {
    if (error instanceof Error && error.message === "All files are already indexed and up to date.") {
      logger.info("All files are already indexed and up to date.");
      logger.info(`Total chunks in database: ${ctx.stats.count}`);
    } else if (error instanceof Error && error.message === "No documents found to index.") {
      logger.warn("No documents found to index.");
    } else {
      throw error;
    }
  }
}
