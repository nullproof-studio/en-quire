# Code Structure

This is the developer map of the monorepo. For user-facing docs, see the root [README.md](README.md); for the original design rationale, see [en-quire-spec.md](en-quire-spec.md).

## Repository layout

```
/
├── packages/
│   ├── en-core/    @nullproof-studio/en-core   — shared reliability primitives (library)
│   ├── en-quire/   @nullproof-studio/en-quire  — structured-document MCP (bin: enquire)
│   └── en-scribe/  @nullproof-studio/en-scribe — plain-text MCP (bin: enscribe)
├── test/
│   └── fixtures/   shared test fixtures referenced by package tests
├── Dockerfile      multi-stage; default entrypoint enquire, override for enscribe
├── tsconfig.base.json
├── vitest.config.ts
└── package.json    npm workspaces root (private)
```

Root commands orchestrate every package:

| Command | Runs |
|---|---|
| `npm run build` | `tsc` in en-core, then en-quire, then en-scribe |
| `npm run lint` | `tsc --noEmit` per workspace |
| `npm test` | `vitest run` across all packages (config in `vitest.config.ts`) |

## Positioning: en-quire vs. en-scribe

- **en-quire** — investigative: reads and edits with structural understanding (sections, outlines, frontmatter, TOC).
- **en-scribe** — literal: reads and edits without interpretation (ranges, anchors, appends).

Both share the reliability layer in en-core (etag optimistic locking, proposal-gated writes, diffs, git integration, RBAC, the parser registry).

## `@nullproof-studio/en-core`

Location: [`packages/en-core/`](packages/en-core/). Has no `bin`; published as a library.

### `src/shared/` — byte-level primitives

- [`file-utils.ts`](packages/en-core/src/shared/file-utils.ts) — path-traversal-safe file I/O, encoding normalisation, `listDocumentFiles`
- [`encoding.ts`](packages/en-core/src/shared/encoding.ts) — character encoding detection and normalisation
- [`diff.ts`](packages/en-core/src/shared/diff.ts) — unified diff generation
- [`etag.ts`](packages/en-core/src/shared/etag.ts) — content-hash etags; optimistic-locking validation
- [`errors.ts`](packages/en-core/src/shared/errors.ts) — `EnquireError` hierarchy (NotFoundError, PermissionDeniedError, PreconditionFailedError, GitRequiredError, ValidationError, …)
- [`logger.ts`](packages/en-core/src/shared/logger.ts) — Winston logger, exec audit helper
- [`types.ts`](packages/en-core/src/shared/types.ts) — `SectionNode`, `SectionAddress`, `ResolvedConfig`, `CallerIdentity`, …
- [`word-count.ts`](packages/en-core/src/shared/word-count.ts) — Unicode-aware word counting

### `src/config/`

- [`loader.ts`](packages/en-core/src/config/loader.ts) — loads and validates en-\*.config.yaml
- [`schema.ts`](packages/en-core/src/config/schema.ts) — Zod schemas
- [`roots.ts`](packages/en-core/src/config/roots.ts) — path resolution with root-prefix handling
- [`defaults.ts`](packages/en-core/src/config/defaults.ts) — defaults

### `src/rbac/`

- [`permissions.ts`](packages/en-core/src/rbac/permissions.ts) — scope check via micromatch; write-vs-propose resolution
- [`resolver.ts`](packages/en-core/src/rbac/resolver.ts) — caller identity from config
- [`types.ts`](packages/en-core/src/rbac/types.ts) — permission types

### `src/git/`

- [`operations.ts`](packages/en-core/src/git/operations.ts) — `GitOperations` wrapper (commit, branch, diff, merge)
- [`detector.ts`](packages/en-core/src/git/detector.ts) — git-repo auto-detection
- [`commit-message.ts`](packages/en-core/src/git/commit-message.ts) — structured commit messages; `buildProposalBranch` preserves extension so reconstruction is lossless for any format

### `src/search/`

- [`database.ts`](packages/en-core/src/search/database.ts) — SQLite with WAL + performance pragmas
- [`schema.ts`](packages/en-core/src/search/schema.ts) — FTS5 tables
- [`indexer.ts`](packages/en-core/src/search/indexer.ts) — section-level FTS indexing with mtime tracking
- [`query.ts`](packages/en-core/src/search/query.ts) — sanitisation and structural ranking
- [`sync.ts`](packages/en-core/src/search/sync.ts) — batched sync that never holds the WAL write lock during disk I/O

### `src/document/` — format-agnostic

- [`parser-registry.ts`](packages/en-core/src/document/parser-registry.ts) — `DocumentParser` interface + extension-keyed registry
- [`ops-strategy.ts`](packages/en-core/src/document/ops-strategy.ts) — the format hook every parser plugs into (renderHeading, adjustHeadingLevels, …)
- [`section-ops-core.ts`](packages/en-core/src/document/section-ops-core.ts) — `readSection`, `replaceSection`, `insertSection`, `appendToSection`, `moveSection`, `deleteSection`, `setValue`, `buildOutline`, `findReplace`, `insertText`. All format-agnostic via `OpsStrategy`.
- [`section-tree.ts`](packages/en-core/src/document/section-tree.ts) — `flattenTree`, `getSectionPath`, `getBreadcrumb`, `buildPreambleNode`, `fixSectionEndOffsets`
- [`section-address.ts`](packages/en-core/src/document/section-address.ts) — generic resolvers: `resolveAddress`, `resolveSingleSection`
- [`ast-utils.ts`](packages/en-core/src/document/ast-utils.ts) — mdast-agnostic tree helpers (`toString`, `countCodePoints`)
- [`line-utils.ts`](packages/en-core/src/document/line-utils.ts) — line ↔ byte translation, `readLineRange`, `replaceLineRange`, `countLines`
- [`text-find.ts`](packages/en-core/src/document/text-find.ts) — `findText` literal search with line/col/offset + context

### `src/tools/` — shared runtime

- [`context.ts`](packages/en-core/src/tools/context.ts) — `ToolContext`, `RootContext`
- [`registry.ts`](packages/en-core/src/tools/registry.ts) — `ToolRegistry` + `ToolDefinition`
- [`runtime.ts`](packages/en-core/src/tools/runtime.ts) — `wrapHandler`, `extractArgsSummary`, `attachRegistry`
- [`write-helpers.ts`](packages/en-core/src/tools/write-helpers.ts) — `executeWrite` (etag, proposal, diff, commit, index update) and `loadDocument`. Format-agnostic via parser registry.
- [`status.ts`](packages/en-core/src/tools/status.ts) — shared status handler; uses `parserRegistry.supportedExtensions()` so each binary reports on its own file types
- [`proposals.ts`](packages/en-core/src/tools/proposals.ts) — shared proposal list/diff/approve/reject handlers; branch parsing is extension-agnostic

### `src/index.ts`

Public re-export surface. Both en-quire and en-scribe import exclusively via `@nullproof-studio/en-core`.

## `@nullproof-studio/en-quire`

Location: [`packages/en-quire/`](packages/en-quire/). Publishes the `enquire` bin.

- [`src/parsers/`](packages/en-quire/src/parsers/) — `parser.ts` (unified/remark wrapper), `markdown-parser.ts`, `markdown-strategy.ts`, `yaml-parser.ts`, `yaml-strategy.ts`. Each parser self-registers with the core `parserRegistry` on side-effect import.
- [`src/tools/`](packages/en-quire/src/tools/) — `read/`, `write/`, `search/`, `status/`, `governance/`, `admin/`. Section-aware handlers; the section-op tools thread `parser.ops` through to `section-ops-core`. `status/` and `governance/` are thin wrappers over `@nullproof-studio/en-core` so that tests and the tool-registration guard still see an en-quire-named handler.
- [`src/plugin.ts`](packages/en-quire/src/plugin.ts) — `registerEnQuireTools(registry)`
- [`src/bin.ts`](packages/en-quire/src/bin.ts) — entry point; parses args, loads config, opens db, registers parsers, attaches registry, starts stdio or streamable-http transport.

## `@nullproof-studio/en-scribe`

Location: [`packages/en-scribe/`](packages/en-scribe/). Publishes the `enscribe` bin.

- [`src/parsers/`](packages/en-scribe/src/parsers/) — `plaintext-parser.ts` (returns one whole-file pseudo-section so `executeWrite` plumbing works unchanged), `plaintext-strategy.ts` (no-op `OpsStrategy`)
- [`src/tools/`](packages/en-scribe/src/tools/) — `read/` (`text_read`, `text_find`, `text_list`), `write/` (`text_replace_range`, `text_create`, `text_append`, `text_edit`, `text_insert_at_anchor`, `text_rename`, `text_delete`), `status/` (`text_status`), `governance/` (the four `text_proposal_*` tools). Sugar tools (`text_edit`, `text_insert_at_anchor`) compose `findText` + `replaceLineRange` from core; multi-match errors list every candidate so agents can fall back to the primitives. No regex.
- [`src/plugin.ts`](packages/en-scribe/src/plugin.ts) — `registerEnScribeTools(registry)`
- [`src/bin.ts`](packages/en-scribe/src/bin.ts) — entry point; mirrors en-quire's bin with its own config path (`en-scribe.config.yaml`) and only the plaintext parser registered.

## Testing

- [`test/fixtures/docs/`](test/fixtures/docs/) — shared markdown, YAML, and plain-text fixtures
- `packages/*/test/unit/` — per-package tests; each package runs its own vitest alias so cross-package imports resolve to en-core's source, not dist
- `packages/en-quire/test/helpers/md-ops.ts` and `packages/en-scribe/test/helpers/ctx.ts` — test scaffolding (markdown-flavoured ops wrappers; minimal ToolContext factory)
- Tool-registration guards in both `en-quire/test/unit/server/` and `en-scribe/test/unit/server/` fail CI if a handler is exported but never registered

## Key design patterns

1. **OpsStrategy** — `section-ops-core` is format-agnostic by taking the per-format rendering hooks through a strategy object.
2. **Parser registry** — each binary registers its own parsers via side-effect import, so en-quire and en-scribe never share a registry despite sharing the interface.
3. **Declarative tool registry** — `registerEn*Tools(registry)` returns tool definitions; the runtime `attachRegistry` binds each to an MCP server. Makes the tool list introspectable for tests and future plugin packs.
4. **Write path** — every write goes through `executeWrite` (etag → proposal-branch → file write → commit → index update → diff).
5. **Format-agnostic branch names** — `buildProposalBranch` preserves the file extension, so the extension-agnostic proposal handlers can reconstruct the file path regardless of which binary created it.
