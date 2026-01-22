#!/usr/bin/env bun

import { Command } from "commander";
import { indexDirectory } from "./indexer.js";
import { queryDatabase, formatResults } from "./query.js";
import { OpenAIEmbeddingProvider } from "./embeddings/openai.js";
import { VoyageAIEmbeddingProvider } from "./embeddings/voyageai.js";
import { OllamaEmbeddingProvider } from "./embeddings/ollama.js";
import { loadConfig, createDefaultConfig, type QuickRAGConfig } from "./config.js";
import type { EmbeddingProvider } from "./embeddings/base.js";
import type { ChunkerType } from "./chunkers/index.js";
import { logger } from "./utils/logger.js";

interface EmbeddingOptions {
  provider: "openai" | "voyageai" | "ollama";
  apiKey?: string;
  model: string;
  baseUrl: string;
}

interface QueryOptions extends EmbeddingOptions {
  topK: number;
}

async function parseEmbeddingOptions(
  options: any,
  config: QuickRAGConfig
): Promise<EmbeddingOptions> {
  const provider = (options.provider || config.provider || "ollama") as "openai" | "voyageai" | "ollama";
  const model = options.model || config.model || "nomic-embed-text";
  const baseUrl = options.baseUrl || config.baseUrl || "http://localhost:11434";
  
  // Get API key from CLI, config, or environment
  let apiKey = options.apiKey;
  if (!apiKey) {
    if (provider === "openai") {
      apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    } else if (provider === "voyageai") {
      apiKey = config.apiKey || process.env.VOYAGE_API_KEY;
    }
  }
  
  return { provider, apiKey, model, baseUrl };
}

function parseTopK(options: any, defaultValue: number = 5): number {
  // Commander.js converts --top-k to topK (camelCase)
  const topK = options.topK ?? options["top-k"];
  if (typeof topK === "number") {
    return Math.max(1, Math.floor(topK));
  }
  if (typeof topK === "string") {
    const parsed = parseInt(topK, 10);
    if (isNaN(parsed) || parsed < 1) {
      return defaultValue;
    }
    return parsed;
  }
  return defaultValue;
}

const program = new Command();

program
  .name("quickrag")
  .description("A fast and flexible RAG tool for indexing and querying documents")
  .version("1.1.0");

program
  .command("init")
  .description("Initialize default configuration file")
  .action(async () => {
    await createDefaultConfig();
  });

program
  .command("index")
  .description("Index documents from a directory")
  .argument("<directory>", "Directory containing documents to index")
  .option("-p, --provider <provider>", "Embedding provider (openai, voyageai, ollama)")
  .option("-k, --api-key <key>", "API key for the embedding provider")
  .option("-m, --model <model>", "Model name")
  .option("-u, --base-url <url>", "Base URL (for Ollama)")
  .option("-o, --output <path>", "Output database path", "index.rag")
  .option("--config <path>", "Path to config file (default: ~/.config/quickrag/config.yaml)")
  .option("--chunker <type>", "Chunking strategy (recursive-token, simple)")
  .option("--chunk-size <number>", "Chunk size in tokens/characters")
  .option("--chunk-overlap <number>", "Chunk overlap in tokens/characters")
  .option("--min-chunk-size <number>", "Minimum chunk size in tokens (default: 50)")
  .option("--clear", "Clear existing index before indexing (default: skip already indexed files)")
  .action(async (directory, options) => {
    const config = await loadConfig(options.config);
    const embeddingOpts = await parseEmbeddingOptions(options, config);
    
    // Chunking options
    const chunkerType = (options.chunker || config.chunking?.strategy || "recursive-token") as ChunkerType;
    const chunkSize = options.chunkSize 
      ? parseInt(String(options.chunkSize), 10) 
      : (config.chunking?.chunkSize || 500);
    const chunkOverlap = options.chunkOverlap 
      ? parseInt(String(options.chunkOverlap), 10) 
      : (config.chunking?.chunkOverlap || 50);
    const minChunkSize = options.minChunkSize 
      ? parseInt(String(options.minChunkSize), 10) 
      : (config.chunking?.minChunkSize || 50);
    
    if (isNaN(chunkSize) || chunkSize <= 0) {
      throw new Error("chunk-size must be a positive number");
    }
    if (isNaN(chunkOverlap) || chunkOverlap < 0) {
      throw new Error("chunk-overlap must be a non-negative number");
    }
    if (isNaN(minChunkSize) || minChunkSize <= 0) {
      throw new Error("min-chunk-size must be a positive number");
    }
    if (minChunkSize >= chunkSize) {
      throw new Error("min-chunk-size must be less than chunk-size");
    }
    
    // Update config with chunker type if provided
    if (options.chunker) {
      config.chunking = { ...config.chunking, strategy: chunkerType };
    }
    
    const embeddingProvider = createEmbeddingProvider(
      embeddingOpts.provider,
      embeddingOpts.apiKey,
      embeddingOpts.model,
      embeddingOpts.baseUrl
    );
    
    await indexDirectory(
      directory, 
      options.output, 
      embeddingProvider,
      { chunkSize, chunkOverlap, minChunkSize },
      options.clear || false,
      config
    );
  });

program
  .command("query")
  .description("Query the indexed database")
  .argument("<database>", "Path to the .rag database file")
  .argument("<query>", "Query string")
  .option("-p, --provider <provider>", "Embedding provider (openai, voyageai, ollama)")
  .option("-k, --api-key <key>", "API key for the embedding provider")
  .option("-m, --model <model>", "Model name")
  .option("-u, --base-url <url>", "Base URL (for Ollama)")
  .option("--config <path>", "Path to config file (default: ~/.config/quickrag/config.yaml)")
  .option("-t, --top-k <number>", "Number of results to return", "5")
  .action(async (database, query, options) => {
    const config = await loadConfig(options.config);
    const embeddingOpts = await parseEmbeddingOptions(options, config);
    const topK = parseTopK(options, 5);
    
    const embeddingProvider = createEmbeddingProvider(
      embeddingOpts.provider,
      embeddingOpts.apiKey,
      embeddingOpts.model,
      embeddingOpts.baseUrl
    );
    
    const results = await queryDatabase(
      database,
      query,
      embeddingProvider,
      topK
    );
    
    logger.log(formatResults(results));
  });

program
  .command("interactive")
  .description("Start an interactive query session")
  .argument("<database>", "Path to the .rag database file")
  .option("-p, --provider <provider>", "Embedding provider (openai, voyageai, ollama)")
  .option("-k, --api-key <key>", "API key for the embedding provider")
  .option("-m, --model <model>", "Model name")
  .option("-u, --base-url <url>", "Base URL (for Ollama)")
  .option("--config <path>", "Path to config file (default: ~/.config/quickrag/config.yaml)")
  .option("-t, --top-k <number>", "Number of results to return", "5")
  .action(async (database, options) => {
    const config = await loadConfig(options.config);
    const embeddingOpts = await parseEmbeddingOptions(options, config);
    const topK = parseTopK(options, 5);
    
    const embeddingProvider = createEmbeddingProvider(
      embeddingOpts.provider,
      embeddingOpts.apiKey,
      embeddingOpts.model,
      embeddingOpts.baseUrl
    );
    
    logger.info("Interactive mode. Type 'exit' or 'quit' to exit.\n");
    
    const readline = await import("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    const askQuestion = (): void => {
      rl.question("Query: ", async (query: string) => {
        if (query.toLowerCase() === "exit" || query.toLowerCase() === "quit") {
          rl.close();
          process.exit(0);
          return;
        }
        
        if (query.trim()) {
          try {
            const results = await queryDatabase(
              database,
              query,
              embeddingProvider,
              topK
            );
            logger.log("\n" + formatResults(results) + "\n");
          } catch (error) {
            logger.error("Error:", error instanceof Error ? error.message : String(error));
          }
        }
        
        askQuestion();
      });
    };
    
    askQuestion();
  });

function createEmbeddingProvider(
  provider: string,
  apiKey: string | undefined,
  model: string,
  baseUrl: string
): EmbeddingProvider {
  switch (provider.toLowerCase()) {
    case "openai":
      if (!apiKey) {
        throw new Error("API key required for OpenAI provider. Use --api-key, set in config, or set OPENAI_API_KEY environment variable.");
      }
      return new OpenAIEmbeddingProvider(apiKey, model);
    
    case "voyageai":
      if (!apiKey) {
        throw new Error("API key required for VoyageAI provider. Use --api-key, set in config, or set VOYAGE_API_KEY environment variable.");
      }
      return new VoyageAIEmbeddingProvider(apiKey, model);
    
    case "ollama":
      return new OllamaEmbeddingProvider(model, baseUrl);
    
    default:
      throw new Error(`Unknown provider: ${provider}. Supported providers: openai, voyageai, ollama`);
  }
}

program.parse();
