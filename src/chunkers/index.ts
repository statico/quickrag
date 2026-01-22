import type { Chunker, ChunkerOptions } from "./base.js";
import { RecursiveTokenChunker } from "./recursive-token.js";
import { SimpleChunker } from "./simple.js";

export type ChunkerType = "recursive-token" | "simple";

export function createChunker(type: ChunkerType = "recursive-token"): Chunker {
  switch (type) {
    case "recursive-token":
      return new RecursiveTokenChunker();
    case "simple":
      return new SimpleChunker();
    default:
      throw new Error(`Unknown chunker type: ${type}. Supported types: recursive-token, simple`);
  }
}

export { type Chunker, type ChunkerOptions, type DocumentChunk } from "./base.js";
export { RecursiveTokenChunker } from "./recursive-token.js";
export { SimpleChunker } from "./simple.js";
