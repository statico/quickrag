import { readdir, readFile, stat } from "fs/promises";
import { join, extname } from "path";

export interface DocumentChunk {
  text: string;
  filePath: string;
  startLine: number;
  endLine: number;
  startChar: number;
  endChar: number;
}

export interface ChunkingOptions {
  chunkSize: number;
  chunkOverlap: number;
}

const SUPPORTED_EXTENSIONS = [".txt", ".md", ".markdown"];

export async function parseDirectory(
  dirPath: string,
  options: ChunkingOptions
): Promise<DocumentChunk[]> {
  const chunks: DocumentChunk[] = [];
  const files = await getAllFiles(dirPath);
  
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (SUPPORTED_EXTENSIONS.includes(ext)) {
      const fileChunks = await parseFile(file, options);
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

async function parseFile(
  filePath: string,
  options: ChunkingOptions
): Promise<DocumentChunk[]> {
  const content = await readFile(filePath, "utf-8");
  return chunkText(content, filePath, options);
}

function chunkText(
  text: string,
  filePath: string,
  options: ChunkingOptions
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const { chunkSize, chunkOverlap } = options;
  
  // Pre-compute line numbers for each character position
  const lines = text.split("\n");
  const lineStarts: number[] = [0];
  let currentPos = 0;
  for (const line of lines) {
    currentPos += line.length + 1; // +1 for newline
    lineStarts.push(currentPos);
  }
  
  function getLineNumber(charPos: number): number {
    // Binary search for the line containing this character
    let left = 0;
    let right = lineStarts.length - 1;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (lineStarts[mid] <= charPos && charPos < lineStarts[mid + 1]) {
        return mid;
      } else if (charPos < lineStarts[mid]) {
        right = mid;
      } else {
        left = mid + 1;
      }
    }
    return Math.max(0, lineStarts.length - 2); // Return last line if beyond
  }
  
  let startChar = 0;
  
  while (startChar < text.length) {
    const endChar = Math.min(startChar + chunkSize, text.length);
    let chunkText = text.slice(startChar, endChar);
    
    // Try to break at sentence boundaries
    let actualEnd = endChar;
    if (endChar < text.length) {
      // Look for sentence endings within the last 100 chars
      const searchStart = Math.max(startChar, endChar - 100);
      const searchText = text.slice(searchStart, endChar);
      const sentenceEnd = searchText.search(/[.!?]\s+/);
      if (sentenceEnd !== -1) {
        actualEnd = searchStart + sentenceEnd + 1;
        chunkText = text.slice(startChar, actualEnd);
      }
    }
    
    // Calculate line numbers (1-indexed for user display)
    const startLine = getLineNumber(startChar) + 1;
    const endLine = getLineNumber(actualEnd - 1) + 1;
    
    chunks.push({
      text: chunkText.trim(),
      filePath,
      startLine,
      endLine,
      startChar,
      endChar: actualEnd,
    });
    
    // Move start forward with overlap
    startChar = Math.max(startChar + 1, actualEnd - chunkOverlap);
  }
  
  return chunks;
}
