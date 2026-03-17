# Contributing to en-quire

Contributions welcome. The [spec](en-quire-spec.md) is the design contract. If you're building against it, open an issue to discuss before submitting large PRs.

## Getting Started

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Run tests: `npm test`
5. Run lint: `npm run lint`
6. Run build: `npm run build`
7. Submit a pull request

## Copyright Headers

All contributed code must include the standard copyright header.

**TypeScript source files** (`.ts`):

```typescript
// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
```

Placed as the very first line of every `.ts` file, before any imports.

**Dockerfile and shell scripts** (`.sh`, `Dockerfile`):

```dockerfile
# Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
```

**Configuration and schema files** (`.yaml`, `.json`):

No inline header required. The `LICENSE` file at the repo root covers these.

**Markdown documentation** (`.md`):

No inline header in the document body.

## Areas Where Contributions Are Valuable

- Section addressing edge cases (ambiguous headings, deeply nested structures)
- Git operation reliability (merge conflicts, concurrent access)
- Embedding model integrations
- MCP client compatibility testing

## License

By submitting a PR, you agree that your contribution is licensed under the same MIT license as the project.
