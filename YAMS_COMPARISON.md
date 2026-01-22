# YAMS vs QuickRAG: Performance Comparison & Improvements

## Executive Summary

YAMS is a C++ RAG system with sophisticated batching, concurrency control, and optimization strategies. QuickRAG is a simpler TypeScript implementation. This document identifies key performance improvements that can be applied to QuickRAG.

## Key Performance Differences

### 1. Chunking Strategy

**QuickRAG:**
- Simple fixed-size chunking with basic sentence boundary detection
- Sequential processing per file
- No overlap optimization
- Processes entire file before moving to next

**YAMS:**
- Multiple chunking strategies (fixed-size, sentence-based, paragraph-based, recursive, sliding window)
- Post-processing: merge small chunks, split large chunks, add overlap
- Async chunking support
- Chunk validation and linking

**Improvement Opportunities:**
- Add chunk overlap post-processing
- Implement async chunking for large files
- Add chunk size validation and merging

### 2. Embedding Batching

**QuickRAG:**
```typescript
// Current: Very conservative batching
const maxCharsPerBatch = 30000;
const maxTextsPerBatch = 4;
```
- Fixed batch size limits (4 texts, 30K chars)
- Sequential batch processing
- No token-aware batching
- No concurrency control

**YAMS:**
```cpp
// Dynamic batching with token budgets
DynamicBatcher batcher{bcfg};
batcher.packByTokens(i, documentHashes.size(), texts, hashes, getter);
```
- Token-aware dynamic batching
- Adaptive batch sizing based on model limits
- Concurrency guards to prevent CPU oversubscription
- Batch size: 32-128 (configurable via env)

**Improvement Opportunities:**
1. **Implement token-aware batching** - Use actual token counts instead of character counts
2. **Increase batch sizes** - Current 4 texts is very conservative; can go to 32-128
3. **Add concurrency control** - Limit concurrent embedding requests
4. **Dynamic batch sizing** - Adjust based on model limits and performance

### 3. Processing Flow

**QuickRAG:**
```
For each file:
  1. Read entire file
  2. Chunk entire file
  3. Embed all chunks (in small batches)
  4. Insert all chunks to DB
```

**YAMS:**
```
1. Collect all documents
2. Process in cross-document batches
3. Dynamic batching based on token budget
4. Batch inserts to DB
5. Background repair workers for missing embeddings
```

**Improvement Opportunities:**
- Process chunks across files in batches (not per-file)
- Use batch database inserts
- Add background workers for incremental updates

### 4. Database Operations

**QuickRAG:**
```typescript
// Inserts all chunks at once after processing entire file
await this.table.add(tableData);
```

**YAMS:**
```cpp
// Batch inserts with locking
vectorDb->insertVectorsBatch(records);
```

**Improvement Opportunities:**
- Use batch inserts (already doing this, but can optimize)
- Add file-level locking for concurrent access
- Implement incremental updates

### 5. Error Handling & Retry

**QuickRAG:**
- Basic error handling
- No retry logic
- Fails on batch errors

**YAMS:**
```cpp
// Adaptive retry with batch splitting
generate_with_adapt = [&](const std::vector<std::string>& in) {
    auto out = embGenerator->generateEmbeddings(in);
    if (!out.empty() || in.size() <= 1) return out;
    // Split and try halves
    size_t mid = in.size() / 2;
    auto left = generate_with_adapt(/* first half */);
    auto right = generate_with_adapt(/* second half */);
    return merged;
};
```

**Improvement Opportunities:**
- Add adaptive retry with batch splitting
- Implement exponential backoff
- Better error recovery

## Recommended Performance Improvements

### Priority 1: High Impact, Low Effort

1. **Increase Batch Sizes**
   - Change `maxTextsPerBatch` from 4 to 32-64
   - Change `maxCharsPerBatch` from 30K to 100K-200K (model-dependent)
   - This alone could give 8-16x speedup

2. **Process Chunks Across Files**
   - Instead of processing file-by-file, collect chunks from multiple files
   - Batch embed across files
   - Reduces API overhead

3. **Add Concurrency Control**
   - Limit concurrent embedding requests (e.g., 4-8 concurrent batches)
   - Prevents API rate limiting and CPU oversubscription

### Priority 2: Medium Impact, Medium Effort

4. **Token-Aware Batching**
   - Use a tokenizer to estimate actual tokens instead of character counts
   - More accurate batching, better API usage
   - Libraries: `gpt-tokenizer` or `tiktoken`

5. **Adaptive Batch Splitting on Errors**
   - On API errors, split batch in half and retry
   - Handles transient errors and OOM issues
   - Prevents losing entire batches

6. **Batch Database Inserts**
   - Already doing this, but can optimize chunk size
   - Consider inserting in larger batches (100-500 chunks)

### Priority 3: Lower Impact, Higher Effort

7. **Background Workers**
   - Separate worker for embedding generation
   - Can process in background while indexing continues

8. **Incremental Updates**
   - Track which chunks need re-embedding
   - Only process changed files/chunks

9. **Chunking Improvements**
   - Add overlap post-processing
   - Better sentence boundary detection
   - Chunk size validation

## Implementation Examples

### Example 1: Increase Batch Sizes

```typescript
// Current (database.ts)
const maxCharsPerBatch = 30000;
const maxTextsPerBatch = 4;

// Improved
const maxCharsPerBatch = 150000; // 5x increase
const maxTextsPerBatch = 32;     // 8x increase
```

### Example 2: Cross-File Batching

```typescript
// Instead of processing file-by-file:
async function indexDirectory(...) {
  // Collect all chunks from all files first
  const allChunks: DocumentChunk[] = [];
  for (const file of filesToIndex) {
    const fileChunks = chunkText(content, file.path, chunkingOptions);
    allChunks.push(...fileChunks);
  }
  
  // Then batch embed across all chunks
  await db.indexChunks(allChunks, embeddingProvider);
}
```

### Example 3: Concurrency Control

```typescript
class ConcurrencyLimiter {
  private semaphore: number;
  private queue: Array<() => Promise<void>> = [];
  
  constructor(maxConcurrent: number) {
    this.semaphore = maxConcurrent;
  }
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        this.semaphore--;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.semaphore++;
          if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            next();
          }
        }
      });
      
      if (this.semaphore > 0) {
        const next = this.queue.shift()!;
        next();
      }
    });
  }
}
```

### Example 4: Adaptive Retry

```typescript
async function embedWithRetry(
  texts: string[],
  provider: EmbeddingProvider,
  maxRetries = 3
): Promise<number[][]> {
  try {
    return await provider.embedBatch(texts);
  } catch (error) {
    if (maxRetries === 0 || texts.length <= 1) {
      throw error;
    }
    
    // Split in half and retry
    const mid = Math.floor(texts.length / 2);
    const left = await embedWithRetry(
      texts.slice(0, mid),
      provider,
      maxRetries - 1
    );
    const right = await embedWithRetry(
      texts.slice(mid),
      provider,
      maxRetries - 1
    );
    
    return [...left, ...right];
  }
}
```

## Expected Performance Gains

- **Batch size increase**: 8-16x speedup
- **Cross-file batching**: 2-4x speedup (reduces API overhead)
- **Concurrency control**: 2-4x speedup (better resource utilization)
- **Token-aware batching**: 1.5-2x speedup (more accurate, fewer API calls)
- **Adaptive retry**: Prevents failures, improves reliability

**Combined potential**: 20-50x speedup for large document sets

## Next Steps

1. Start with Priority 1 improvements (batch sizes, cross-file processing)
2. Measure performance improvements
3. Add Priority 2 improvements (token-aware, retry logic)
4. Consider Priority 3 for production use
