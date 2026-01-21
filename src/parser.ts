import { readdir, readFile, stat } from "fs/promises";
import { join, extname } from "path";

export interface FileInfo {
  path: string;
  mtime: number;
}

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

function validateChunkingOptions(options: ChunkingOptions): void {
  if (options.chunkSize <= 0) {
    throw new Error("chunkSize must be greater than 0");
  }
  if (options.chunkOverlap < 0) {
    throw new Error("chunkOverlap must be non-negative");
  }
  if (options.chunkOverlap >= options.chunkSize) {
    throw new Error("chunkOverlap must be less than chunkSize");
  }
}

const SUPPORTED_EXTENSIONS = [".txt", ".md", ".markdown"];

export async function parseDirectory(
  dirPath: string,
  options: ChunkingOptions
): Promise<{ chunks: DocumentChunk[]; files: FileInfo[] }> {
  validateChunkingOptions(options);
  const chunks: DocumentChunk[] = [];
  const files: FileInfo[] = [];
  const filePaths = await getAllFiles(dirPath);
  
  for (const filePath of filePaths) {
    const ext = extname(filePath).toLowerCase();
    if (SUPPORTED_EXTENSIONS.includes(ext)) {
      try {
        const fileStat = await stat(filePath);
        files.push({ path: filePath, mtime: fileStat.mtimeMs });
        const fileChunks = await parseFile(filePath, options);
        chunks.push(...fileChunks);
      } catch (error) {
        console.warn(`Skipping file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  
  return { chunks, files };
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

export async function parseFile(
  filePath: string,
  options: ChunkingOptions
): Promise<DocumentChunk[]> {
  const content = await readFile(filePath, "utf-8");
  return chunkText(content, filePath, options);
}

export function chunkText(
  text: string,
  filePath: string,
  options: ChunkingOptions
): DocumentChunk[] {
  // Handle empty text
  if (!text || text.trim().length === 0) {
    return [];
  }

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
    if (lineStarts.length <= 1) return 0;
    if (charPos < 0) return 0;
    
    // If position is at or beyond the end of text, return the last line (0-indexed)
    const lastLineStart = lineStarts[lineStarts.length - 1];
    if (charPos >= lastLineStart) {
      // Return the last line index (lineStarts.length - 2 because lineStarts has length + 1)
      return Math.max(0, lineStarts.length - 2);
    }
    
    // Binary search for the line containing this character
    let left = 0;
    let right = lineStarts.length - 2; // -2 because we check lineStarts[mid + 1]
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const lineStart = lineStarts[mid];
      const nextLineStart = lineStarts[mid + 1];
      
      if (lineStart <= charPos && charPos < nextLineStart) {
        return mid;
      } else if (charPos < lineStart) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }
    
    // Fallback: should not reach here, but return last line if we do
    return Math.max(0, lineStarts.length - 2);
  }
  
  let startChar = 0;
  
  while (startChar < text.length) {
    const endChar = Math.min(startChar + chunkSize, text.length);
    let chunkText = text.slice(startChar, endChar);
    
    // Try to break at sentence boundaries
    let actualEnd = endChar;
    if (endChar < text.length) {
      // Look for sentence endings within the last 100 chars
      // Improved regex: look for sentence endings followed by space/newline
      // or at end of text, but avoid common abbreviations
      const searchStart = Math.max(startChar, endChar - 100);
      const searchText = text.slice(searchStart, endChar);
      
      // Match sentence endings (. ! ?) followed by whitespace or end of text
      // But avoid matching if preceded by common abbreviations
      const sentenceEndMatch = searchText.match(/[.!?](?:\s+|$)/);
      if (sentenceEndMatch && sentenceEndMatch.index !== undefined) {
        // Check if it's not a common abbreviation
        const matchPos = searchStart + sentenceEndMatch.index;
        const beforeMatch = text.slice(Math.max(0, matchPos - 3), matchPos);
        const commonAbbrevs = /\b(Dr|Mr|Mrs|Ms|Prof|Sr|Jr|vs|etc|Inc|Ltd|Corp|St|Ave|Blvd|Rd)\.$/i;
        if (!commonAbbrevs.test(beforeMatch.trim())) {
          actualEnd = matchPos + 1;
          chunkText = text.slice(startChar, actualEnd);
        }
      }
    }
    
    // Ensure we don't create empty chunks
    const trimmedChunk = chunkText.trim();
    if (trimmedChunk.length > 0) {
      // Calculate line numbers (1-indexed for user display)
      const startLine = getLineNumber(startChar) + 1;
      const endLine = getLineNumber(actualEnd - 1) + 1;
      
      chunks.push({
        text: trimmedChunk,
        filePath,
        startLine,
        endLine,
        startChar,
        endChar: actualEnd,
      });
    }
    
    // Move start forward with overlap, ensuring progress
    // Ensure nextStart is never negative (safety check)
    const nextStart = Math.max(0, actualEnd - chunkOverlap);
    // Ensure we always make progress: move forward by at least 1 character
    startChar = Math.max(startChar + 1, nextStart);
    
    // Safety check: ensure we always make progress and don't get stuck
    if (startChar >= actualEnd) {
      startChar = actualEnd;
    }
  }
  
  return chunks;
}
