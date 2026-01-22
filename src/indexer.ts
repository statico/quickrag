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
  existingHashes: Set<string>;
  chunker: ReturnType<typeof createChunker>;
  totalIndexed: number;
  totalSkipped: number;
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
  const ctx: IndexContext = {
    chunkerType: config?.chunking?.strategy || "recursive-token",
    dimensions: 0,
    db: null as any,
    allFiles: [],
    filesToIndex: [],
    existingHashes: new Set(),
    chunker: null as any,
    totalIndexed: 0,
    totalSkipped: 0,
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
        for (const file of ctx.allFiles) {
          if (clear || !indexedFiles.has(file.path) || !(await ctx.db.isFileIndexed(file.path, file.mtime))) {
            ctx.filesToIndex.push(file);
          }
        }
        if (ctx.filesToIndex.length === 0) {
          ctx.stats = await ctx.db.getStats();
          throw new Error("All files are already indexed and up to date.");
        }
      },
    },
    {
      title: "Preparing for indexing",
      task: async (ctx) => {
        ctx.existingHashes = await ctx.db.getExistingChunkHashes();
        ctx.chunker = createChunker(ctx.chunkerType);
      },
    },
    {
      title: "Indexing files",
      task: (ctx, task) =>
        task.newListr(
          ctx.filesToIndex.map((file) => ({
            title: file.path,
            task: async (ctx, task) => {
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
                task.title = `Chunking ${file.path}...`;
              }
              const fileChunks = chunkText(content, file.path, chunkingOptions, ctx.chunker);
              
              if (task && fileChunks.length > 0) {
                task.title = `${file.path} (${fileChunks.length} chunks)`;
              }

              if (fileChunks.length > 0) {
                try {
                  const result = await ctx.db.indexChunks(fileChunks, embeddingProvider, ctx.existingHashes, task);
                  ctx.totalIndexed += result.indexed;
                  ctx.totalSkipped += result.skipped;
                } catch (error) {
                  logger.error(`Failed to index ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
                  throw error;
                }
              }

              await ctx.db.markFileIndexed(file.path, file.mtime);
            },
          })),
          { concurrent: false, exitOnError: false }
        ),
    },
    {
      title: "Finalizing",
      task: async (ctx) => {
        try {
          ctx.stats = await ctx.db.getStats();
        } catch {
          ctx.stats = { count: 0 };
        }
      },
    },
  ]);

  try {
    await tasks.run(ctx);
    logger.info(
      `Indexing complete! Processed ${ctx.totalIndexed + ctx.totalSkipped} chunks across ${ctx.filesToIndex.length} files`
    );
    logger.info(
      `Added ${ctx.totalIndexed} new chunks (${ctx.totalSkipped} already existed). Total chunks in database: ${ctx.stats.count}`
    );
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
