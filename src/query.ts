import { RAGDatabase } from "./database.js";
import type { EmbeddingProvider } from "./embeddings/base.js";
import type { IndexedChunk } from "./database.js";

export async function queryDatabase(
  dbPath: string,
  query: string,
  embeddingProvider: EmbeddingProvider,
  topK: number = 5
): Promise<IndexedChunk[]> {
  const db = new RAGDatabase(dbPath, embeddingProvider.getDimensions());
  await db.initialize();
  
  const queryVector = await embeddingProvider.embed(query);
  const results = await db.search(queryVector, topK);
  
  return results;
}

export function formatResults(results: IndexedChunk[]): string {
  let output = `Found ${results.length} results:\n\n`;
  
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const lineRange = result.startLine === result.endLine 
      ? `line ${result.startLine}`
      : `lines ${result.startLine}-${result.endLine}`;
    output += `[${i + 1}] ${result.filePath} (${lineRange})\n`;
    output += `${"=".repeat(60)}\n`;
    output += `${result.text}\n\n`;
  }
  
  return output;
}
