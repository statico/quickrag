# QuickRAG

[![Build](https://github.com/statico/quickrag/actions/workflows/build.yml/badge.svg)](https://github.com/statico/quickrag/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/statico/quickrag)](https://github.com/statico/quickrag/releases)
[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](http://unlicense.org/)

A fast RAG tool that indexes documents using your choice of embedding provider and stores them in LanceDB for efficient similarity search.

## Quick Example

```sh
# Create a config
$ quickrag init

# Index documents
$ quickrag index gutenberg/ --output gutenberg.rag
✔ Parsing documents from gutenberg/... (using recursive-token chunker)
✔ Detecting embedding dimensions
✔ Initializing database
✔ Finding files to index
✔ Removing deleted files from index
✔ Preparing for indexing
✔ Indexing files
✔ Finalizing
Indexing complete! Processed 622 chunks across 2 files. Removed 1 deleted file.
Added 619 new chunks (3 already existed). Total chunks in database: 619

# Search
$ quickrag query gutenberg.rag "Who is Sherlock Holmes?"
```

## Features

- Multiple embedding providers (VoyageAI, OpenAI, Ollama)
- Token-based recursive chunking (default) or character-based chunking
- LanceDB vector storage with persistent `.rag` files
- Idempotent indexing (tracks indexed files, skips unchanged)
- Automatic cleanup of deleted files from index
- UTF-8 sanitization for PDF conversions
- TypeScript & Bun

## Installation

### Homebrew (macOS)

```sh
brew install statico/quickrag/quickrag
```

### Download Binary

```sh
# macOS (Apple Silicon)
curl -L https://github.com/statico/quickrag/releases/latest/download/quickrag-darwin-arm64 -o /usr/local/bin/quickrag
chmod +x /usr/local/bin/quickrag

# macOS (Intel)
curl -L https://github.com/statico/quickrag/releases/latest/download/quickrag-darwin-x64 -o /usr/local/bin/quickrag
chmod +x /usr/local/bin/quickrag

# Linux (ARM64)
curl -L https://github.com/statico/quickrag/releases/latest/download/quickrag-linux-arm64 -o /usr/local/bin/quickrag
chmod +x /usr/local/bin/quickrag

# Linux (x64)
curl -L https://github.com/statico/quickrag/releases/latest/download/quickrag-linux-x64 -o /usr/local/bin/quickrag
chmod +x /usr/local/bin/quickrag
```

Note: macOS binaries are not codesigned. You may need to run `xattr -d com.apple.quarantine /usr/local/bin/quickrag` to bypass Gatekeeper.

### Build from Source

Requires [Bun](https://bun.sh).

```sh
git clone https://github.com/statico/quickrag.git
cd quickrag
bun install
bun run dev --help
```

## Quick Start

### 1. Initialize Configuration

```sh
quickrag init
```

This creates `~/.config/quickrag/config.yaml`:

```yaml
provider: ollama
model: nomic-embed-text
baseUrl: http://localhost:11434
chunking:
  strategy: recursive-token
  chunkSize: 500
  chunkOverlap: 50
  minChunkSize: 50
```

### 2. Configure Settings

Edit `~/.config/quickrag/config.yaml` to set API keys and preferences:

```yaml
provider: openai
apiKey: sk-your-key-here
model: text-embedding-3-small
chunking:
  strategy: recursive-token
  chunkSize: 500
  chunkOverlap: 50
  minChunkSize: 50
```

### 3. Index Documents

```sh
quickrag index ./documents --output my-docs.rag
```

### 4. Query

```sh
quickrag query my-docs.rag "What is the main topic?"
```

## Configuration

**Configuration Options:**

- `provider`: Embedding provider (`openai`, `voyageai`, or `ollama`)
- `apiKey`: API key (can also use environment variables)
- `model`: Model name for the embedding provider
- `baseUrl`: Base URL for Ollama (default: `http://localhost:11434`)
- `chunking.strategy`: `recursive-token` (default) or `simple`
- `chunking.chunkSize`: Tokens (for `recursive-token`, default: 500) or characters (for `simple`, default: 1000)
- `chunking.chunkOverlap`: Tokens (for `recursive-token`, default: 50) or characters (for `simple`, default: 200)
- `chunking.minChunkSize`: Minimum chunk size in tokens (default: 50). Chunks smaller than this are filtered out to prevent tiny fragments.

## Chunking Strategies

### Recursive Token Chunker (Default)

Token-based splitting that respects semantic boundaries. Splits at paragraph breaks, line breaks, sentence endings, then word boundaries. Chunks are sized by estimated tokens (default: 500), aligning with embedding model expectations. Maintains configurable overlap (default: 50 tokens, ~10%).

### Simple Chunker

Character-based chunking for backward compatibility. Chunks are sized by characters (default: 1000) with sentence boundary detection. Overlap is character-based (default: 200).

### Performance Comparison

Benchmarked on test corpus (2 files: sherlock-holmes.txt, frankenstein.txt):

| Metric | Recursive Token | Simple |
|--------|----------------|--------|
| **Chunks Created** | 622 chunks | 2,539 chunks (4.1x more) |
| **Indexing Time** | ~19 seconds | ~37 seconds |
| **Query Quality** | ✅ Better semantic matches, more context | ⚠️ More fragments, some irrelevant results |

**Recommendation**: Use `recursive-token` for production. The indexing time difference is negligible compared to improved retrieval quality.

### Tuning Recommendations

**Most Use Cases:**
- `strategy: recursive-token`
- `chunkSize: 400-512` (tokens) - Research-backed sweet spot for 85-90% recall
- `chunkOverlap: 50-100` (tokens, ~10-20%)

**Technical Documentation:**
- `strategy: recursive-token`
- `chunkSize: 500-600` (tokens)
- `chunkOverlap: 75-100` (tokens)

**Narrative Text:**
- `strategy: recursive-token`
- `chunkSize: 400-500` (tokens)
- `chunkOverlap: 50-75` (tokens)

**Academic Papers:**
- `strategy: recursive-token`
- `chunkSize: 600-800` (tokens)
- `chunkOverlap: 100-150` (tokens)

## Usage

### Indexing

```sh
# Basic indexing
quickrag index ./documents --output my-docs.rag

# Override chunking parameters
quickrag index ./documents --chunker recursive-token --chunk-size 500 --chunk-overlap 50 --min-chunk-size 50 --output my-docs.rag

# Use different provider
quickrag index ./documents --provider openai --model text-embedding-3-small --output my-docs.rag

# Clear existing index
quickrag index ./documents --clear --output my-docs.rag
```

**Note**: QuickRAG automatically detects and removes deleted files from the index. If a file was previously indexed but no longer exists in the source directory, it will be removed from the database during the next indexing run.

### Querying

```sh
quickrag query my-docs.rag "What is the main topic?"
```

### Interactive Mode

```sh
quickrag interactive my-docs.rag
```

## Embedding Providers

### VoyageAI

```yaml
provider: voyageai
apiKey: your-voyage-api-key
model: voyage-3
```

### OpenAI

```yaml
provider: openai
apiKey: sk-your-openai-key
model: text-embedding-3-small
```

### Ollama

```yaml
provider: ollama
model: nomic-embed-text
baseUrl: http://localhost:11434
```

## Supported File Types

- `.txt` - Plain text files
- `.md` - Markdown files
- `.markdown` - Markdown files

## Development

```sh
bun install
bun run dev index ./documents --provider ollama --output test.rag
bun run build
bun run typecheck
```

## Requirements

- **Bun** >= 1.0.0
- **TypeScript** >= 5.0.0
- For Ollama: A running Ollama instance with an embedding model installed (e.g., `ollama pull nomic-embed-text`)

## License

This is free and unencumbered software released into the public domain.

For more information, see [UNLICENSE](UNLICENSE) or visit <https://unlicense.org>
