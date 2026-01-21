import { parseDirectory } from "./parser.js";
import { RAGDatabase } from "./database.js";
import type { EmbeddingProvider } from "./embeddings/base.js";

export async function indexDirectory(
  dirPath: string,
  dbPath: string,
  embeddingProvider: EmbeddingProvider
): Promise<void> {
  console.log(`Parsing documents from ${dirPath}...`);
  const chunks = await parseDirectory(dirPath);
  
  if (chunks.length === 0) {
    console.log("No documents found to index.");
    return;
  }
  
  console.log(`Found ${chunks.length} chunks from ${dirPath}`);
  
  const db = new RAGDatabase(dbPath, embeddingProvider.getDimensions());
  await db.initialize();
  await db.indexChunks(chunks, embeddingProvider);
  
  const stats = await db.getStats();
  console.log(`\nIndexing complete! Total chunks in database: ${stats.count}`);
}
