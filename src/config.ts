import { readFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import yaml from "js-yaml";

export interface QuickRAGConfig {
  provider?: "openai" | "voyageai" | "ollama";
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  chunking?: {
    strategy?: "recursive-token" | "simple";
    chunkSize?: number;
    chunkOverlap?: number;
  };
  batching?: {
    maxTextsPerBatch?: number;
    maxCharsPerBatch?: number;
    maxTokensPerBatch?: number;
    maxConcurrentEmbeddings?: number;
  };
}

const CONFIG_DIR = join(homedir(), ".config", "quickrag");
const CONFIG_FILE = join(CONFIG_DIR, "config.yaml");

const DEFAULT_CONFIG: QuickRAGConfig = {
  provider: "ollama",
  model: "nomic-embed-text",
  baseUrl: "http://localhost:11434",
  chunking: {
    strategy: "recursive-token",
    chunkSize: 500,
    chunkOverlap: 50,
  },
  batching: {
    maxTextsPerBatch: 64,
    maxCharsPerBatch: 150000,
    maxTokensPerBatch: 20000,
    maxConcurrentEmbeddings: 4,
  },
};

export async function loadConfig(configPath?: string): Promise<QuickRAGConfig> {
  const filePath = configPath || CONFIG_FILE;
  
  try {
    const content = await readFile(filePath, "utf-8");
    const config = yaml.load(content) as QuickRAGConfig;
    // Merge with defaults to ensure all fields are present
    return { ...DEFAULT_CONFIG, ...config };
  } catch (error: any) {
    if (error.code === "ENOENT") {
      // Config file doesn't exist, return defaults
      return DEFAULT_CONFIG;
    }
    throw error;
  }
}

export async function saveConfig(config: QuickRAGConfig): Promise<void> {
  // Ensure config directory exists
  await mkdir(CONFIG_DIR, { recursive: true });
  
  // Merge with defaults
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  
  // Write to file
  const yamlContent = yaml.dump(fullConfig, {
    indent: 2,
    lineWidth: -1,
  });
  
  await writeFile(CONFIG_FILE, yamlContent, "utf-8");
}

export async function createDefaultConfig(): Promise<void> {
  await saveConfig(DEFAULT_CONFIG);
  console.log(`Created default config at: ${CONFIG_FILE}`);
  console.log("\nYou can edit this file to customize your settings:");
  console.log("  - provider: openai, voyageai, or ollama");
  console.log("  - apiKey: Your API key (or set via environment variables)");
  console.log("  - model: Model name for the embedding provider");
  console.log("  - baseUrl: Base URL for Ollama (default: http://localhost:11434)");
  console.log("  - chunking.strategy: Chunking strategy - recursive-token or simple (default: recursive-token)");
  console.log("  - chunking.chunkSize: Size of text chunks in tokens/characters (default: 500)");
  console.log("  - chunking.chunkOverlap: Overlap between chunks in tokens/characters (default: 50)");
  console.log("  - batching.maxTextsPerBatch: Maximum texts per embedding batch (default: 64)");
  console.log("  - batching.maxCharsPerBatch: Maximum characters per batch (default: 150000)");
  console.log("  - batching.maxTokensPerBatch: Maximum tokens per batch (default: 20000)");
  console.log("  - batching.maxConcurrentEmbeddings: Max concurrent embedding requests (default: 4)");
}
