import { readdir, readFile, stat } from "fs/promises";
import { join, extname } from "path";
import type { Chunker, ChunkerOptions, DocumentChunk } from "./chunkers/index.js";
import { createChunker, type ChunkerType } from "./chunkers/index.js";
import { logger } from "./utils/logger.js";

export interface FileInfo {
  path: string;
  mtime: number;
}

export { type DocumentChunk, type ChunkerOptions } from "./chunkers/index.js";

function validateChunkingOptions(options: ChunkerOptions): void {
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
  options: ChunkerOptions,
  chunkerType: ChunkerType = "recursive-token"
): Promise<{ chunks: DocumentChunk[]; files: FileInfo[] }> {
  validateChunkingOptions(options);
  const chunker = createChunker(chunkerType);
  const chunks: DocumentChunk[] = [];
  const files: FileInfo[] = [];
  const filePaths = await getAllFiles(dirPath);
  
  for (const filePath of filePaths) {
    const ext = extname(filePath).toLowerCase();
    if (SUPPORTED_EXTENSIONS.includes(ext)) {
      try {
        const fileStat = await stat(filePath);
        files.push({ path: filePath, mtime: fileStat.mtimeMs });
        const fileChunks = await parseFile(filePath, options, chunker);
        chunks.push(...fileChunks);
      } catch (error) {
        logger.warn(`Skipping file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  
  return { chunks, files };
}

export async function getAllFiles(dirPath: string): Promise<string[]> {
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

export async function getFiles(dirPath: string): Promise<FileInfo[]> {
  const files: FileInfo[] = [];
  const filePaths = await getAllFiles(dirPath);
  
  for (const filePath of filePaths) {
    const ext = extname(filePath).toLowerCase();
    if (SUPPORTED_EXTENSIONS.includes(ext)) {
      try {
        const fileStat = await stat(filePath);
        files.push({ path: filePath, mtime: fileStat.mtimeMs });
      } catch (error) {
        logger.warn(`Skipping file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  
  return files;
}

export async function parseFile(
  filePath: string,
  options: ChunkerOptions,
  chunker?: Chunker
): Promise<DocumentChunk[]> {
  const content = await readFile(filePath, "utf-8");
  const actualChunker = chunker || createChunker("recursive-token");
  return chunkText(content, filePath, options, actualChunker);
}

export function chunkText(
  text: string,
  filePath: string,
  options: ChunkerOptions,
  chunker?: Chunker
): DocumentChunk[] {
  const actualChunker = chunker || createChunker("recursive-token");
  return actualChunker.chunk(text, filePath, options);
}
