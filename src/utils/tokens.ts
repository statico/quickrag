export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  
  // Fast word count without creating arrays or regex
  let words = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Check if character is whitespace (space, tab, newline, etc.)
    const isSpace = code === 32 || code === 9 || code === 10 || code === 13 || code === 160;
    if (!isSpace && !inWord) {
      words++;
      inWord = true;
    } else if (isSpace) {
      inWord = false;
    }
  }
  
  if (words === 0) return 0;
  
  const chars = text.length;
  const avgCharsPerWord = chars / words;
  const avgTokensPerWord = avgCharsPerWord > 5 ? 1.3 : 1.0;
  
  return Math.ceil(words * avgTokensPerWord);
}

export function estimateTokensBatch(texts: string[]): number {
  return texts.reduce((sum, text) => sum + estimateTokens(text), 0);
}
