# @nullproof-studio/en-quire

Structured document management for agent systems, with governance. An MCP server.

**Positioning** — investigative: reads and edits with structural understanding (sections, outlines, frontmatter, TOC). For literal plain-text editing without interpretation, use [@nullproof-studio/en-scribe](https://www.npmjs.com/package/@nullproof-studio/en-scribe).

## Install

```bash
npm install -g @nullproof-studio/en-quire
```

Provides the `enquire` binary.

## Supported formats

| Extensions | Parser | Notes |
|---|---|---|
| `.md`, `.mdx` | markdown | Section tree from ATX headings. Full TOC, frontmatter, GFM. |
| `.yaml`, `.yml` | yaml | Keys are sections. Dot-path + bracket addressing for `doc_set_value`. |
| `.jsonl`, `.ndjson` | jsonl | One section per record. Heading auto-coalesced from identifier fields (`name`, `id`, `description`, `title`, `role`, `type`, `kind`); falls back to `<firstKey>: <snippet>`. Each write re-validates every line. |

All parsers implement the same `DocumentParser` interface, so every `doc_*` tool works across formats — `doc_outline`, `doc_read_section`, `doc_replace_section`, `doc_insert_section`, `doc_delete_section`, `doc_search`, `doc_proposals_*`, etc.

## Usage

See the [repo README](https://github.com/nullproof-studio/en-quire#readme) for configuration, tool reference, and the full spec.
