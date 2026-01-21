import { readdir, readFile, stat } from "fs/promises";
import { join, extname } from "path";

export interface DocumentChunk {
  text: string;
  filePath: string;
  chunkIndex: number;
  startChar: number;
  endChar: number;
}

const SUPPORTED_EXTENSIONS = [".txt", ".md", ".markdown"];
const CHUNK_SIZE = 1000; // characters
const CHUNK_OVERLAP = 200; // characters

export async function parseDirectory(dirPath: string): Promise<DocumentChunk[]> {
  const chunks: DocumentChunk[] = [];
  const files = await getAllFiles(dirPath);
  
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (SUPPORTED_EXTENSIONS.includes(ext)) {
      const fileChunks = await parseFile(file);
      chunks.push(...fileChunks);
    }
  }
  
  return chunks;
}

async function getAllFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dirPath, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await getAllFiles(fullPath);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  
  return files;
}

async function parseFile(filePath: string): Promise<DocumentChunk[]> {
  const content = await readFile(filePath, "utf-8");
  return chunkText(content, filePath);
}

function chunkText(text: string, filePath: string): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let startChar = 0;
  let chunkIndex = 0;
  
  while (startChar < text.length) {
    const endChar = Math.min(startChar + CHUNK_SIZE, text.length);
    const chunkText = text.slice(startChar, endChar);
    
    // Try to break at sentence boundaries
    let actualEnd = endChar;
    if (endChar < text.length) {
      // Look for sentence endings within the last 100 chars
      const searchStart = Math.max(startChar, endChar - 100);
      const searchText = text.slice(searchStart, endChar);
      const sentenceEnd = searchText.search(/[.!?]\s+/);
      if (sentenceEnd !== -1) {
        actualEnd = searchStart + sentenceEnd + 1;
      }
    }
    
    chunks.push({
      text: text.slice(startChar, actualEnd).trim(),
      filePath,
      chunkIndex,
      startChar,
      endChar: actualEnd,
    });
    
    // Move start forward with overlap
    startChar = Math.max(startChar + 1, actualEnd - CHUNK_OVERLAP);
    chunkIndex++;
  }
  
  return chunks;
}
