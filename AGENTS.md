# QuickRAG 

## Releasing
1. Update version: `npm version <major|minor|patch> --no-git-tag-version`
2. Commit and tag: `git add package.json && git commit -m "vX.Y.Z" && git tag vX.Y.Z`
3. Push: `git push && git push origin vX.Y.Z`
4. Add release notes: `gh release edit vX.Y.Z --notes "..."` (summarize changes since last version)

## Code Style
- Keep code brief and concise
- Minimize comments - code should be self-explanatory
- Use official npm packages, not local references

## Testing with test/ Data

The test directory contains sample documents for testing. Use the test config file to ensure consistent testing.

### Setup
1. Ensure Ollama is running with `nomic-embed-text` model available
2. The test config is at `test/config.yaml` (defaults to ollama)

### Basic Test Commands

**Index test data:**
```bash
bun run src/index.ts index test/ --config test/config.yaml --clear
```

**Query the indexed data:**
```bash
bun run src/index.ts query index.rag "who is sherlock holmes" --config test/config.yaml
bun run src/index.ts query index.rag "what is frankenstein" --config test/config.yaml
```

**Test deduplication:**
```bash
# First index
bun run src/index.ts index test/ --config test/config.yaml --clear

# Index again (should skip existing chunks)
bun run src/index.ts index test/ --config test/config.yaml

# Modify a file and re-index (should only index new chunks)
echo "test" >> test/sherlock-holmes.txt
bun run src/index.ts index test/ --config test/config.yaml
git checkout test/sherlock-holmes.txt  # restore file
```

### Expected Results
- Indexing should process chunks across files (cross-file batching)
- Batch sizes should respect config (default: 64 texts per batch)
- Deduplication should skip chunks that already exist by hash
- Queries should return relevant results from both test files
