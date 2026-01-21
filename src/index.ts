#!/usr/bin/env bun

import { Command } from "commander";
import { indexDirectory } from "./indexer.js";
import { queryDatabase, formatResults } from "./query.js";
import { OpenAIEmbeddingProvider } from "./embeddings/openai.js";
import { VoyageAIEmbeddingProvider } from "./embeddings/voyageai.js";
import { OllamaEmbeddingProvider } from "./embeddings/ollama.js";
import { loadConfig, createDefaultConfig, type QuickRAGConfig } from "./config.js";
import type { EmbeddingProvider } from "./embeddings/base.js";

const program = new Command();

program
  .name("quickrag")
  .description("A fast and flexible RAG tool for indexing and querying documents")
  .version("1.0.0");

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
  .option("--chunk-size <number>", "Chunk size in characters")
  .option("--chunk-overlap <number>", "Chunk overlap in characters")
  .action(async (directory, options) => {
    const config = await loadConfig();
    
    // Merge config with CLI options (CLI takes precedence)
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
    
    // Chunking options
    const chunkSize = options.chunkSize 
      ? parseInt(options.chunkSize) 
      : (config.chunking?.chunkSize || 1000);
    const chunkOverlap = options.chunkOverlap 
      ? parseInt(options.chunkOverlap) 
      : (config.chunking?.chunkOverlap || 200);
    
    const embeddingProvider = createEmbeddingProvider(provider, apiKey, model, baseUrl);
    
    await indexDirectory(
      directory, 
      options.output, 
      embeddingProvider,
      { chunkSize, chunkOverlap }
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
  .option("-t, --top-k <number>", "Number of results to return", "5")
  .action(async (database, query, options) => {
    const config = await loadConfig();
    
    // Merge config with CLI options (CLI takes precedence)
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
    
    const embeddingProvider = createEmbeddingProvider(provider, apiKey, model, baseUrl);
    
    const results = await queryDatabase(
      database,
      query,
      embeddingProvider,
      parseInt(options.topK || "5")
    );
    
    console.log(formatResults(results));
  });

program
  .command("interactive")
  .description("Start an interactive query session")
  .argument("<database>", "Path to the .rag database file")
  .option("-p, --provider <provider>", "Embedding provider (openai, voyageai, ollama)")
  .option("-k, --api-key <key>", "API key for the embedding provider")
  .option("-m, --model <model>", "Model name")
  .option("-u, --base-url <url>", "Base URL (for Ollama)")
  .option("-t, --top-k <number>", "Number of results to return", "5")
  .action(async (database, options) => {
    const config = await loadConfig();
    
    // Merge config with CLI options (CLI takes precedence)
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
    
    const embeddingProvider = createEmbeddingProvider(provider, apiKey, model, baseUrl);
    
    console.log("Interactive mode. Type 'exit' or 'quit' to exit.\n");
    
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
              parseInt(options.topK || "5")
            );
            console.log("\n" + formatResults(results) + "\n");
          } catch (error) {
            console.error("Error:", error);
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
