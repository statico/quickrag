import type { Chunker, ChunkerOptions, DocumentChunk } from "./base.js";

export class SimpleChunker implements Chunker {
  chunk(text: string, filePath: string, options: ChunkerOptions): DocumentChunk[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const chunks: DocumentChunk[] = [];
    const { chunkSize, chunkOverlap } = options;
    
    const lines = text.split("\n");
    const lineStarts: number[] = [0];
    let currentPos = 0;
    for (const line of lines) {
      currentPos += line.length + 1;
      lineStarts.push(currentPos);
    }
    
    function getLineNumber(charPos: number): number {
      if (lineStarts.length <= 1) return 0;
      if (charPos < 0) return 0;
      
      const lastLineStart = lineStarts[lineStarts.length - 1];
      if (charPos >= lastLineStart) {
        return Math.max(0, lineStarts.length - 2);
      }
      
      let left = 0;
      let right = lineStarts.length - 2;
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
      
      return Math.max(0, lineStarts.length - 2);
    }
    
    let startChar = 0;
    
    while (startChar < text.length) {
      const endChar = Math.min(startChar + chunkSize, text.length);
      let chunkText = text.slice(startChar, endChar);
      
      let actualEnd = endChar;
      if (endChar < text.length) {
        const searchStart = Math.max(startChar, endChar - 100);
        const searchText = text.slice(searchStart, endChar);
        
        const sentenceEndMatch = searchText.match(/[.!?](?:\s+|$)/);
        if (sentenceEndMatch && sentenceEndMatch.index !== undefined) {
          const matchPos = searchStart + sentenceEndMatch.index;
          const beforeMatch = text.slice(Math.max(0, matchPos - 3), matchPos);
          const commonAbbrevs = /\b(Dr|Mr|Mrs|Ms|Prof|Sr|Jr|vs|etc|Inc|Ltd|Corp|St|Ave|Blvd|Rd)\.$/i;
          if (!commonAbbrevs.test(beforeMatch.trim())) {
            actualEnd = matchPos + 1;
            chunkText = text.slice(startChar, actualEnd);
          }
        }
      }
      
      const trimmedChunk = chunkText.trim();
      if (trimmedChunk.length > 0) {
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
      
      const nextStart = Math.max(0, actualEnd - chunkOverlap);
      startChar = Math.max(startChar + 1, nextStart);
      
      if (startChar >= actualEnd) {
        startChar = actualEnd;
      }
    }
    
    return chunks;
  }
}
