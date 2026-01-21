# QuickRAG

[![Build](https://github.com/YOUR_USERNAME/quickrag/actions/workflows/build.yml/badge.svg)](https://github.com/YOUR_USERNAME/quickrag/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/YOUR_USERNAME/quickrag)](https://github.com/YOUR_USERNAME/quickrag/releases)
[![License](https://img.shields.io/github/license/YOUR_USERNAME/quickrag)](LICENSE)

A fast and flexible RAG (Retrieval-Augmented Generation) tool that indexes parseable documents (text, markdown) using your choice of embedding provider and stores them in a LanceDB database for efficient similarity search.

> **Note for AI Tools**: This tool is designed primarily for use by other AI tools and agents for searching data in a corpus. The tool provides extensive `--help` documentation that AI tools can read to understand its full functionality and available options. Run `quickrag --help`, `quickrag index --help`, or `quickrag query --help` to explore all available commands and parameters.

## Features

- **Multiple Embedding Providers** - Support for VoyageAI, OpenAI, and Ollama
- **Flexible Document Parsing** - Automatically processes text and markdown files from directories
- **LanceDB Integration** - Fast vector search using LanceDB with persistent storage (`.rag` files)
- **TypeScript & Bun** - Built with modern TypeScript and powered by Bun for fast execution
- **Easy to Use** - Simple CLI interface for indexing and querying your documents

## Installation

### Download Binary

Grab the latest release for your platform from the [Releases page](../../releases).

```sh
chmod +x quickrag-darwin-arm64
./quickrag-darwin-arm64 --help
```

Note: macOS binaries are not codesigned. You may need to right-click and select "Open" or run `xattr -d com.apple.quarantine <binary>` to bypass Gatekeeper.

### Build from Source

Requires [Bun](https://bun.sh).

```sh
bun install
bun run dev --help
```

## Usage

### Indexing Documents

Index a directory of documents:

```sh
quickrag index ./documents --provider voyageai --output my-docs.rag
```

Or with OpenAI:

```sh
quickrag index ./documents --provider openai --api-key $OPENAI_API_KEY --output my-docs.rag
```

Or with Ollama (local):

```sh
quickrag index ./documents --provider ollama --model nomic-embed-text --output my-docs.rag
```

### Querying

Query your indexed documents:

```sh
quickrag query my-docs.rag "What is the main topic?"
```

Or with a specific number of results:

```sh
quickrag query my-docs.rag "Explain the architecture" --top-k 5
```

### Interactive Mode

Start an interactive session:

```sh
quickrag interactive my-docs.rag
```

## Configuration

### Embedding Providers

#### VoyageAI

```sh
quickrag index ./documents \
  --provider voyageai \
  --api-key $VOYAGE_API_KEY \
  --model voyage-3 \
  --output docs.rag
```

#### OpenAI

```sh
quickrag index ./documents \
  --provider openai \
  --api-key $OPENAI_API_KEY \
  --model text-embedding-3-small \
  --output docs.rag
```

#### Ollama

```sh
quickrag index ./documents \
  --provider ollama \
  --model nomic-embed-text \
  --base-url http://localhost:11434 \
  --output docs.rag
```

### Supported File Types

- `.txt` - Plain text files
- `.md` - Markdown files
- `.markdown` - Markdown files

## Project Structure

```
quickrag/
├── src/
│   ├── index.ts          # CLI entry point
│   ├── indexer.ts         # Document indexing logic
│   ├── query.ts           # Query/search logic
│   ├── embeddings/        # Embedding provider implementations
│   │   ├── voyageai.ts
│   │   ├── openai.ts
│   │   └── ollama.ts
│   └── parser.ts          # Document parsing utilities
├── .github/
│   └── workflows/
│       ├── build.yml      # Build and release workflow
│       └── docker.yml     # Docker build workflow (optional)
├── package.json
└── README.md
```

## Development

### Setup

```sh
bun install
```

### Run Development Mode

```sh
bun run dev index ./documents --provider ollama --output test.rag
```

### Build

```sh
bun run build
```

### Type Checking

```sh
bun run typecheck
```

## How It Works

1. **Indexing**: QuickRAG scans the specified directory for parseable files (text, markdown)
2. **Chunking**: Documents are split into manageable chunks for embedding
3. **Embedding**: Each chunk is converted to a vector using your chosen embedding provider
4. **Storage**: Vectors and metadata are stored in a LanceDB database saved as a `.rag` file
5. **Querying**: When querying, your question is embedded and compared against stored vectors using similarity search

## Database Format

QuickRAG stores all indexed data in a LanceDB database saved with a `.rag` extension. This file contains:
- Document chunks with their embeddings
- Original document metadata (file path, chunk index, etc.)
- Index structures for fast similarity search

The `.rag` file is portable and can be shared or moved between systems.

## Requirements

- **Bun** >= 1.0.0
- **TypeScript** >= 5.0.0
- For Ollama: A running Ollama instance with an embedding model installed

## License

MIT
