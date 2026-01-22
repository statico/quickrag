import type { Chunker, ChunkerOptions, DocumentChunk } from "./base.js";
import { estimateTokens } from "../utils/tokens.js";

export class RecursiveTokenChunker implements Chunker {
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

    function splitBySeparator(text: string, separator: string): string[] {
      if (separator === "") {
        return text.split("");
      }
      return text.split(separator);
    }

    function trySplit(text: string, separators: string[], targetTokens: number): { chunks: string[]; success: boolean } {
      for (const separator of separators) {
        const splits = splitBySeparator(text, separator);
        if (splits.length > 1) {
          const chunks: string[] = [];
          let currentChunk = "";
          
          for (const split of splits) {
            const testChunk = currentChunk + (currentChunk ? separator : "") + split;
            const tokens = estimateTokens(testChunk);
            
            if (tokens <= targetTokens) {
              currentChunk = testChunk;
            } else {
              if (currentChunk) {
                chunks.push(currentChunk);
                currentChunk = split;
              } else {
                chunks.push(split);
              }
            }
          }
          
          if (currentChunk) {
            chunks.push(currentChunk);
          }
          
          if (chunks.length > 1) {
            return { chunks, success: true };
          }
        }
      }
      
      return { chunks: [text], success: false };
    }

    function recursiveSplit(text: string, targetTokens: number): string[] {
      const tokens = estimateTokens(text);
      
      if (tokens <= targetTokens) {
        return [text];
      }
      
      const separators = [
        "\n\n",
        "\n",
        ". ",
        "! ",
        "? ",
        "; ",
        ", ",
        " ",
        "",
      ];
      
      const result = trySplit(text, separators, targetTokens);
      
      if (result.success) {
        const allChunks: string[] = [];
        for (const chunk of result.chunks) {
          allChunks.push(...recursiveSplit(chunk, targetTokens));
        }
        return allChunks;
      }
      
      return [text.slice(0, Math.floor(text.length * targetTokens / tokens))];
    }

    let startChar = 0;
    
    while (startChar < text.length) {
      const remainingText = text.slice(startChar);
      const targetTokens = chunkSize;
      
      const textChunks = recursiveSplit(remainingText, targetTokens);
      const chunkText = textChunks[0] || remainingText;
      
      const actualEnd = startChar + chunkText.length;
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
      
      if (actualEnd >= text.length) {
        break;
      }
      
      const chunkTokens = estimateTokens(chunkText);
      const overlapRatio = chunkOverlap > 0 ? Math.min(chunkOverlap / chunkTokens, 0.5) : 0;
      const overlapChars = Math.floor(chunkText.length * overlapRatio);
      const nextStart = Math.max(startChar + 1, actualEnd - overlapChars);
      
      if (nextStart >= actualEnd) {
        startChar = actualEnd;
      } else {
        startChar = nextStart;
      }
      
      if (startChar >= text.length) {
        break;
      }
    }
    
    return chunks;
  }
}
