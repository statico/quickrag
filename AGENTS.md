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

**Index test data (with timing):**
```bash
time bun run src/index.ts index test/ --config test/config.yaml --clear
```

**Query the indexed data:**
```bash
time bun run src/index.ts query index.rag "who is sherlock holmes" --config test/config.yaml
time bun run src/index.ts query index.rag "what is frankenstein" --config test/config.yaml
```

**Test deduplication (with timing):**
```bash
# First index
time bun run src/index.ts index test/ --config test/config.yaml --clear

# Index again (should skip existing chunks - should be very fast)
time bun run src/index.ts index test/ --config test/config.yaml

# Modify a file and re-index (should only index new chunks)
echo "test" >> test/sherlock-holmes.txt
time bun run src/index.ts index test/ --config test/config.yaml
git checkout test/sherlock-holmes.txt  # restore file
```

### Performance Testing

**Compare indexing performance:**
```bash
# Full index (should show batch counts and timing)
time bun run src/index.ts index test/ --config test/config.yaml --clear

# Re-index (should be fast, skipping existing chunks)
time bun run src/index.ts index test/ --config test/config.yaml
```

**Expected timing:**
- Initial indexing: Depends on model speed, typically 10-60 seconds for test data
- Re-indexing (all chunks exist): Should be < 1 second (just checks hashes)
- Partial re-indexing: Time proportional to new chunks only

### Expected Results
- Indexing should process chunks across files (cross-file batching)
- Batch sizes should use defaults (64 texts per batch)
- Deduplication should skip chunks that already exist by hash
- Queries should return relevant results from both test files
- Re-indexing should be very fast when chunks already exist
