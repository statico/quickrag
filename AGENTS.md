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
