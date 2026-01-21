#!/usr/bin/env bun

import { Command } from "commander";
import { indexDirectory } from "./indexer.js";
import { queryDatabase, formatResults } from "./query.js";
import { OpenAIEmbeddingProvider } from "./embeddings/openai.js";
import { VoyageAIEmbeddingProvider } from "./embeddings/voyageai.js";
import { OllamaEmbeddingProvider } from "./embeddings/ollama.js";
import type { EmbeddingProvider } from "./embeddings/base.js";

const program = new Command();

program
  .name("quickrag")
  .description("A fast and flexible RAG tool for indexing and querying documents")
  .version("0.1.0");

program
  .command("index")
  .description("Index documents from a directory")
  .argument("<directory>", "Directory containing documents to index")
  .option("-p, --provider <provider>", "Embedding provider (openai, voyageai, ollama)", "ollama")
  .option("-k, --api-key <key>", "API key for the embedding provider")
  .option("-m, --model <model>", "Model name", "nomic-embed-text")
  .option("-u, --base-url <url>", "Base URL (for Ollama)", "http://localhost:11434")
  .option("-o, --output <path>", "Output database path", "index.rag")
  .action(async (directory, options) => {
    const apiKey = options.apiKey || 
      (options.provider === "openai" ? process.env.OPENAI_API_KEY : undefined) ||
      (options.provider === "voyageai" ? process.env.VOYAGE_API_KEY : undefined);
    
    const provider = createEmbeddingProvider(
      options.provider,
      apiKey,
      options.model,
      options.baseUrl
    );
    
    await indexDirectory(directory, options.output, provider);
  });

program
  .command("query")
  .description("Query the indexed database")
  .argument("<database>", "Path to the .rag database file")
  .argument("<query>", "Query string")
  .option("-p, --provider <provider>", "Embedding provider (openai, voyageai, ollama)", "ollama")
  .option("-k, --api-key <key>", "API key for the embedding provider")
  .option("-m, --model <model>", "Model name", "nomic-embed-text")
  .option("-u, --base-url <url>", "Base URL (for Ollama)", "http://localhost:11434")
  .option("-t, --top-k <number>", "Number of results to return", "5")
  .action(async (database, query, options) => {
    const apiKey = options.apiKey || 
      (options.provider === "openai" ? process.env.OPENAI_API_KEY : undefined) ||
      (options.provider === "voyageai" ? process.env.VOYAGE_API_KEY : undefined);
    
    const provider = createEmbeddingProvider(
      options.provider,
      apiKey,
      options.model,
      options.baseUrl
    );
    
    const results = await queryDatabase(
      database,
      query,
      provider,
      parseInt(options.topK || "5")
    );
    
    console.log(formatResults(results));
  });

program
  .command("interactive")
  .description("Start an interactive query session")
  .argument("<database>", "Path to the .rag database file")
  .option("-p, --provider <provider>", "Embedding provider (openai, voyageai, ollama)", "ollama")
  .option("-k, --api-key <key>", "API key for the embedding provider")
  .option("-m, --model <model>", "Model name", "nomic-embed-text")
  .option("-u, --base-url <url>", "Base URL (for Ollama)", "http://localhost:11434")
  .option("-t, --top-k <number>", "Number of results to return", "5")
  .action(async (database, options) => {
    const apiKey = options.apiKey || 
      (options.provider === "openai" ? process.env.OPENAI_API_KEY : undefined) ||
      (options.provider === "voyageai" ? process.env.VOYAGE_API_KEY : undefined);
    
    const provider = createEmbeddingProvider(
      options.provider,
      apiKey,
      options.model,
      options.baseUrl
    );
    
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
              provider,
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
        throw new Error("API key required for OpenAI provider. Use --api-key or set OPENAI_API_KEY environment variable.");
      }
      return new OpenAIEmbeddingProvider(apiKey, model);
    
    case "voyageai":
      if (!apiKey) {
        throw new Error("API key required for VoyageAI provider. Use --api-key or set VOYAGE_API_KEY environment variable.");
      }
      return new VoyageAIEmbeddingProvider(apiKey, model);
    
    case "ollama":
      return new OllamaEmbeddingProvider(model, baseUrl);
    
    default:
      throw new Error(`Unknown provider: ${provider}. Supported providers: openai, voyageai, ollama`);
  }
}

program.parse();
