# Code Structure Documentation

This document explores and documents the structure of the en-quire codebase.

## Overview

This document contains findings from exploring the en-quire codebase structure.
## Project Overview

**en-quire** is a structured document management system for agent systems with governance features. It's implemented as an MCP (Model Context Protocol) server.

## Entry Point and Server Setup

## Core Modules

## Shared Utilities ([`src/shared/`](src/shared/))

- [`file-utils.ts`](src/shared/file-utils.ts): File I/O with path traversal protection, encoding normalization
- [`diff.ts`](src/shared/diff.ts): Unified diff generation using `diff` package
- [`errors.ts`](src/shared/errors.ts): Custom error classes (EnquireError, NotFoundError, AddressResolutionError, PermissionDeniedError, etc.)
- [`logger.ts`](src/shared/logger.ts): Winston logger with console and optional file output
- [`types.ts`](src/shared/types.ts): Core type definitions (SectionNode, SectionAddress variants, OutlineEntry, SearchResult, etc.)

## Git Integration ([`src/git/`](src/git/))

- [`operations.ts`](src/git/operations.ts): Git operations wrapper (commit, branch, switch, status)
- [`detector.ts`](src/git/detector.ts): Auto-detect git repository presence
- [`commit-message.ts`](src/git/commit-message.ts): Structured commit message and proposal branch naming

## RBAC ([`src/rbac/`](src/rbac/))

- [`permissions.ts`](src/rbac/permissions.ts): Permission checking with micromatch path matching
- [`resolver.ts`](src/rbac/resolver.ts): Resolve caller identity from config
- [`types.ts`](src/rbac/types.ts): Permission type definitions

## Testing ([`test/`](test/))

- **Unit tests**: [`test/unit/`](test/unit/) - Individual module tests
- **Integration tests**: [`test/integration/`](test/integration/) - Tool integration tests
- **E2E tests**: [`test/e2e/`](test/e2e/) - End-to-end scenarios
- **Fixtures**: [`test/fixtures/docs/`](test/fixtures/docs/) - Test markdown/YAML files

## Key Design Patterns

1. **Section Tree**: Documents parsed into hierarchical section nodes with byte offsets
2. **Address Resolution**: Multiple address types (text, path, index, pattern) for section targeting
3. **Parser Registry**: Extensible format support (Markdown, YAML) with extension mapping
4. **Write Mode**: Two modes - direct write or proposal (git branch + PR)
5. **Search Index**: FTS5 with structural ranking (heading boost, depth penalty)
6. **Permission Scopes**: Path-based permissions with glob patterns
### Tools ([`src/tools/`](src/tools/))

**Read Tools:**
- [`doc-outline.ts`](src/tools/read/doc-outline.ts): Get document heading structure with depth control
- [`doc-read.ts`](src/tools/read/doc-read.ts): Read document with pagination
- [`doc-read-section.ts`](src/tools/read/doc-read-section.ts): Read specific section by address
- [`doc-list.ts`](src/tools/read/doc-list.ts): List documents across roots with optional outline

**Write Tools:**
- [`doc-create.ts`](src/tools/write/doc-create.ts): Create new document with optional proposal mode
- [`doc-replace-section.ts`](src/tools/write/doc-replace-section.ts): Replace section content
- [`doc-insert-section.ts`](src/tools/write/doc-insert-section.ts): Insert section before/after anchor
- [`doc-append-section.ts`](src/tools/write/doc-append-section.ts): Append content to section
- [`doc-delete-section.ts`](src/tools/write/doc-delete-section.ts): Delete section and children
- [`doc-find-replace.ts`](src/tools/write/doc-find-replace.ts): Find and replace text with preview
- [`doc-rename.ts`](src/tools/write/doc-rename.ts): Rename document within root
- [`doc-generate-toc.ts`](src/tools/write/doc-generate-toc.ts): Generate table of contents
- [`doc-set-value.ts`](src/tools/write/doc-set-value.ts): Set value at path (YAML) or replace section (Markdown)

**Write Helpers:**
- [`write-helpers.ts`](src/tools/write/write-helpers.ts): Core write execution with git commit, index update, diff generation

**Status/Search/Governance/Admin Tools:**
- [`doc-status.ts`](src/tools/status/doc-status.ts): Check index status, modified files, pending proposals
- [`doc-search.ts`](src/tools/search/doc-search.ts): Full-text search with scope filtering
- [`doc-proposals.ts`](src/tools/governance/doc-proposals.ts): List, diff, approve, reject proposals
- [`doc-exec.ts`](src/tools/admin/doc-exec.ts): Execute commands in root context
### Configuration ([`src/config/`](src/config/))

- [`loader.ts`](src/config/loader.ts): Loads YAML config, validates with Zod schema, resolves document roots
- [`schema.ts`](src/config/schema.ts): Zod schemas for config validation (Callers, Scopes, Permissions, Git settings)
- [`roots.ts`](src/config/roots.ts): File path resolution with root prefix handling, path traversal protection
- [`defaults.ts`](src/config/defaults.ts): Default configuration values

### Document Processing ([`src/document/`](src/document/))

- [`parser.ts`](src/document/parser.ts): Unified processor for Markdown (with frontmatter and GFM)
- [`markdown-parser.ts`](src/document/markdown-parser.ts): Markdown parser implementation with preamble support
- [`yaml-parser.ts`](src/document/yaml-parser.ts): YAML parser that treats keys as section headings
- [`section-tree.ts`](src/document/section-tree.ts): Builds hierarchical section tree from AST
- [`section-address.ts`](src/document/section-address.ts): Parses addresses (text, path, index, pattern)
- [`section-ops.ts`](src/document/section-ops.ts): Read/modify operations on sections
- [`ast-utils.ts`](src/document/ast-utils.ts): AST utilities (toString, countCodePoints, offsetToLine)
- [`serializer.ts`](src/document/serializer.ts): AST to markdown serialization (for validation)
- [`parser-registry.ts`](src/document/parser-registry.ts): Registry for format-specific parsers
- [`encoding.ts`](src/document/encoding.ts): Character encoding detection and normalization

### Search ([`src/search/`](src/search/))

- [`database.ts`](src/search/database.ts): SQLite database with WAL mode and performance pragmas
- [`schema.ts`](src/search/schema.ts): FTS5 table and metadata schema
- [`indexer.ts`](src/search/indexer.ts): Documents sections into FTS5 with mtime tracking
- [`query.ts`](src/search/query.ts): Query sanitization and ranking (heading boost, depth penalty)
- [`sync.ts`](src/search/sync.ts): Batched index synchronization with change detection
### Main Entry Point ([`src/index.ts`](src/index.ts))

The application starts at [`main()`](src/index.ts:20) which:
1. Parses command-line arguments (config path)
2. Loads and validates configuration via [`loadConfig()`](src/config/loader.ts:13)
3. Initializes logging
4. Opens the search database
5. Configures document roots with Git operations
6. Syncs search index (blocking or background based on config)
7. Starts either stdio or HTTP transport server

### Server Creation ([`src/server.ts`](src/server.ts))

The [`createServer()`](src/server.ts:49) function creates an MCP server with:
- **Read Tools**: `doc_outline`, `doc_read_section`, `doc_read`, `doc_list`
- **Write Tools**: `doc_replace_section`, `doc_insert_section`, `doc_append_section`, `doc_delete_section`, `doc_create`, `doc_find_replace`, `doc_rename`, `doc_generate_toc`, `doc_set_value`
- **Status Tools**: `doc_status`
- **Search Tools**: `doc_search`
- **Governance Tools**: `doc_proposals_list`, `doc_proposal_diff`, `doc_proposal_approve`, `doc_proposal_reject`
- **Admin Tools**: `doc_exec`

All handlers are wrapped with error handling that returns structured error responses.
### Key Technologies

- **Language**: TypeScript (Node.js >=22.0.0)
- **MCP SDK**: @modelcontextprotocol/sdk v1.12.1
- **Database**: better-sqlite3 for full-text search indexing
- **Markdown Processing**: unified, remark-parse, remark-frontmatter, remark-gfm
- **Git Integration**: simple-git
- **Configuration**: YAML with Zod schema validation

### Core Functionality

- Document management with hierarchical section addressing
- Multiple document format support (Markdown, YAML)
- Full-text search with optional semantic search
- Git-based governance with proposals and approvals
- RBAC (Role-Based Access Control) for permissions
