import { RAGDatabase } from "./database.js";
import type { EmbeddingProvider } from "./embeddings/base.js";
import type { IndexedChunk } from "./database.js";
import { logger } from "./utils/logger.js";

export async function queryDatabase(
  dbPath: string,
  query: string,
  embeddingProvider: EmbeddingProvider,
  topK: number = 5
): Promise<IndexedChunk[]> {
  const db = new RAGDatabase(dbPath, embeddingProvider.getDimensions());
  await db.initialize();
  
  const dbDimensions = db.getDimensions();
  
  const queryVector = await embeddingProvider.embed(query);
  
  if (queryVector.length !== dbDimensions) {
    throw new Error(
      `Embedding dimension mismatch: database expects ${dbDimensions} dimensions, ` +
      `but the embedding provider (${embeddingProvider.constructor.name}) produces ${queryVector.length} dimensions. ` +
      `Please use the same embedding model that was used for indexing.`
    );
  }
  
  const results = await db.search(queryVector, topK);
  
  return results;
}

export function formatResults(results: IndexedChunk[]): string {
  if (results.length === 0) {
    return "No results found.";
  }
  
  let output = `\n${"═".repeat(70)}\n`;
  output += `  Found ${results.length} result${results.length !== 1 ? 's' : ''}\n`;
  output += `${"═".repeat(70)}\n\n`;
  
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const lineRange = result.startLine === result.endLine 
      ? `line ${result.startLine}`
      : `lines ${result.startLine}-${result.endLine}`;
    
    output += `${"─".repeat(70)}\n`;
    output += `  [${i + 1}] ${result.filePath}\n`;
    output += `  ${lineRange}\n`;
    output += `${"─".repeat(70)}\n`;
    output += `  ${result.text.split('\n').join('\n  ')}\n\n`;
  }
  
  return output;
}
