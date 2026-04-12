---
name: en-quire
description: >
  Instructions for using en-quire MCP tools to read, search, edit, and manage
  markdown and YAML documents. Use this skill whenever working with .md, .mdx,
  .yaml, or .yml files — specs, documentation, configuration files, and any
  structured text. Covers section-addressed editing, structural search, YAML
  key-path operations, scalar value setting, find-replace, document creation,
  governance modes, multi-root navigation, and the hybrid outline+filesystem
  workflow for full-document review.
compatibility:
  tools:
    - doc_outline
    - doc_read_section
    - doc_read
    - doc_list
    - doc_search
    - doc_replace_section
    - doc_append_section
    - doc_find_replace
    - doc_insert_section
    - doc_delete_section
    - doc_create
    - doc_rename
    - doc_set_value
    - doc_move_section
    - doc_generate_toc
    - doc_status
---

# Skill: en-quire — Structured Document Management

**Purpose:** Instructions for agents using en-quire MCP tools to read, search, edit, and manage markdown and YAML documents.

---

## Orientation: Multi-Root and doc_status

en-quire manages documents across multiple roots — separate directories for different document types (e.g. `docs`, `specs`, `config`). Each root can have its own git configuration and governance model.

Start every session with:
1. **`doc_status`** — see all configured roots, their git status, index health, and pending proposals
2. **`doc_list`** — see all files, or scope to a specific root with `doc_list(scope: "docs")`

File paths include the root prefix: `docs/architecture.md`, `specs/api-v2.md`, `config/production.yaml`. Use the prefix in all tool calls.

Search works across all roots by default. Scope to a single root with `doc_search(query: "...", scope: "specs")`.

## When to Use en-quire

Use en-quire tools (`doc_*`) instead of filesystem tools (`read_file`, `write_file`, `edit_file`) for any operation on:
- **Markdown files** (.md, .mdx) — specs, documentation, READMEs, runbooks, design docs
- **YAML files** (.yaml, .yml) — Docker Compose, config files, CI/CD pipelines

en-quire provides section-level addressing, structural search, and diff responses that eliminate the need to read or rewrite whole files. For YAML, "sections" are key paths (e.g. `services.api.environment`).

Use filesystem tools only when:
- You are working with file types en-quire doesn't support (JSON, JS, etc.)
- You need to move or copy files between directories or roots

## Core Workflow: Outline -> Read -> Edit

Every interaction with a document follows this sequence:

1. **`doc_outline`** — Get the structure first. This is non-negotiable. Never read a whole file to orient yourself. For markdown, this returns the heading tree. For YAML, it returns the key hierarchy with value types.
2. **`doc_read_section`** — Read only the section you need. Use the heading text (markdown) or dot-path (YAML, e.g. `services.api.environment`).
3. **Edit with the right tool:**
   - `doc_set_value` — change a single value (YAML scalar or markdown section body). The simplest edit tool — one path, one value.
   - `doc_replace_section` — rewrite a block's content (mapping values in YAML, section body in markdown)
   - `doc_append_section` — add content to the end of a section (table rows, list items, new YAML keys)
   - `doc_find_replace` — change a term or phrase across the whole document
   - `doc_insert_section` — add a new section before or after an existing one
   - `doc_delete_section` — remove a section entirely
   - `doc_move_section` — atomically delete a section from its current location and insert it at a new position (cut-and-paste). Heading levels adjust automatically including all children. Use this instead of separate delete + insert calls.
   - `doc_generate_toc` — generate or update a table of contents from the heading structure

Every write tool returns a diff. You do not need to re-read the file to verify your edit landed correctly.

For YAML files, en-quire validates the output before writing. If your edit would produce invalid YAML, the write is blocked with a clear error message showing the syntax problem. This means you can trust that successful writes produce valid files.

## Hybrid Pattern: Outline + Filesystem Read

For tasks that require seeing the whole document (proofreading, tone review, cross-section consistency checks):

1. **`doc_outline`** first — get the structural map. This includes `__preamble` for frontmatter/pre-heading content.
2. **Filesystem `read_text_file`** — read the full file with the structure already in context

This is 2 calls instead of 10+ (reading every section individually). The outline primes the read — you scan the file against a known structure rather than discovering the structure while reading.

Use en-quire for all subsequent edits after the full-file review.

### Frontmatter / Preamble Access

Content before the first heading (YAML frontmatter, MDX imports, JSX components) is addressable as `__preamble`:

- `doc_outline` shows `__preamble` at level 0 with `has_content: true`
- `doc_read_section(file, "__preamble")` returns the frontmatter block
- `doc_replace_section(file, "__preamble", content)` replaces frontmatter — include the `---` delimiters

This eliminates the need for filesystem tools to access frontmatter.

## Search

Use `doc_search` to find content across documents and roots. Results include:
- `file` — with root prefix (e.g. `docs/architecture.md`, `config/production.yaml`)
- `section_path` — the full breadcrumb (e.g. `"RBAC Model > Permission Types"` for markdown, `"services > api > environment"` for YAML)
- `breadcrumb[]` — ancestor headings/keys for triaging relevance
- `score` — structural ranking that boosts heading/key name matches

Search works across all roots by default. Scope to a single root: `doc_search(query: "...", scope: "docs")`.

Search works across file formats — a query for "production" will find results in markdown documents and YAML config files simultaneously.

Use `section_filter` to narrow results to specific structural areas: "find metrics, but only within escalation procedures."

## Document Listing

Use `doc_list` to see all documents in scope. This returns file paths, sizes, and modification dates. Use it before searching when you need to know what's available.

---

## Find and Replace

`doc_find_replace` is the tool for bulk changes across a document (terminology renames, consistent corrections).

**Always preview first:**
1. Call with `preview: true` to see all matches with context, section paths, and `in_code_block` flags
2. Review the matches — check for false positives
3. Call again without `preview` to apply, using `expected_count` to verify you're changing the right number of instances

For selective application, use `apply_matches` with specific match IDs from the preview.

---

## Structural Changes: Moving and Reordering Sections

Use `doc_move_section` to atomically delete a section from its current location and insert it at a new position within the same document — equivalent to cut-and-paste. The section's heading, body, and all children are preserved. Never use separate delete + insert calls to move a section — if the content exceeds your context window, the insert will silently lose data.

**Parameters:**
- `section` — the section to move (heading text or path)
- `anchor` — the destination reference point
- `position` — `before`, `after`, `child_start`, or `child_end`

Heading levels adjust automatically. Moving an h2 to become a child of another h2 makes it h3, and all its children shift accordingly.

**After any structural change** (move, insert, or delete), regenerate the table of contents if one exists:
1. `doc_outline` — check if the document has a TOC section
2. `doc_generate_toc` — regenerate it in place

**Heading naming:** Do not use numbered headings (e.g. "2. Background", "Section 3: Design"). The system does not auto-renumber when sections are inserted, moved, or deleted. Use descriptive names instead (e.g. "Background", "Design"). This prevents numbering drift that accumulates over multiple edits.

---

## YAML Operations

YAML files use key-path addressing instead of heading text. The structure maps naturally:

### Addressing

- Dot notation: `services.api.environment` — the primary addressing format
- Arrow notation: `services > api > environment` — also works, matches outline display
- Sequence items: `services.api.volumes[0]` — zero-indexed

### Reading YAML

`doc_outline` returns the full key tree with:
- `level` — nesting depth (top-level keys are level 1)
- `has_children` — mapping or sequence vs scalar
- `has_content` — whether the node has a direct value vs only children

`doc_read_section("services.api.environment")` returns the key and all its nested content with proper indentation.

### Editing YAML

**For scalar values** — use `doc_set_value`:
```
doc_set_value(file: "config.yaml", path: "server.port", value: "8080")
```
One call, path-addressed, preserves the existing quoting style. This is the primary tool for config changes.

**For block replacement** — use `doc_replace_section` with values only (do NOT include the key line):
```
doc_replace_section(file: "compose.yaml", section: "services.api.environment", content: "      NODE_ENV: production\n      PORT: 8080")
```
Including the key line causes a duplicate-key validation error.

**For adding keys to a mapping** — use `doc_append_section`:
```
doc_append_section(file: "config.yaml", section: "callers", content: "  new_caller:\n    key: sk-new")
```

**For text-based changes** — use `doc_find_replace`. Best for scalar value changes when you don't need structural addressing.

### YAML Validation

en-quire validates all YAML writes before committing. If your edit would produce invalid YAML (duplicate keys, broken indentation, syntax errors), the write is blocked with a clear error showing the specific problem. Successful writes are guaranteed valid.

## Document Creation
**Include house rules for document sections and style guides here**

Use `doc_create` for new documents. Structure them with heading hierarchy so future edits can target specific sections via `doc_search` and `doc_append_section`.

Recommended document structure:
```markdown
# Document Title

## Overview
Purpose and context.

## [Domain Sections]
Main content organised by topic.

## Open Questions
Unresolved items.

## Appendix
Supporting material.
```

The heading hierarchy is the filing system. Classify the content, map it to a section name, edit precisely.

---

## Governance: Write vs Propose

- **`mode: "write"`** — edits go directly to the file. Use for your own documents and when git is not initialised.
- **`mode: "propose"`** — edits land on a git branch for review. Use for shared documents, specs, and anything that benefits from review before merging. Requires git.

If propose mode returns `proposal_requires_git`, git is not initialised in the document root. Use write mode and inform the user.

---

## Tone Editing Workflow

When editing for voice or style consistency:
1. **`doc_search`** across the corpus for a tonally strong reference passage — this is your voice calibration
2. **`doc_read_section`** on the reference passage to load it as context
3. **Filesystem `read_text_file`** on the target document for full-file voice calibration
4. **Edit section by section** via en-quire, holding the reference voice in context

Tool selection during tone edits:
- Single-sentence fixes -> `doc_find_replace`
- Whole-section rewrites -> `doc_replace_section`

The full-file read prevents tone drift between section edits.

---

## Common Mistakes to Avoid

- **Never read a whole file to orient yourself.** Use `doc_outline` first. Always.
- **Never use filesystem `edit_file` for markdown or YAML when en-quire is available.** en-quire's section addressing eliminates line-counting and indentation errors.
- **Never re-read after writing.** The diff in the response tells you what changed.
- **Never skip the preview step on find-replace.** One false positive can corrupt a document.
- **Never include the key line in YAML `doc_replace_section` content.** Supply values only — the key is preserved automatically. Including it causes a duplicate-key validation error.
- **Use `doc_set_value` for YAML scalars, not `doc_replace_section`.** It's one call, handles quoting, and can't produce invalid YAML.
- **Never `doc_replace_section` on a section that doesn't exist yet.** If you get "No matching section found", the section needs to be created first with `doc_insert_section` or `doc_create`. Check `doc_outline` to confirm what sections currently exist before editing.
- **Never include headings in `doc_replace_section` or `doc_append_section` content** at the same level or higher than the target section. Supply body content only. Use `doc_insert_section` to add new sibling sections.
- **After any error, call `doc_outline` before retrying.** The document structure may have changed. Don't retry the same operation — understand the current state first.
- **Never use numbered headings** (e.g. "2. Background", "Section 3: Design"). The system does not auto-renumber. Use descriptive names ("Background", "Design") to prevent numbering drift.
- **Never forget to update the TOC after structural changes.** After moving, inserting, or deleting sections, check if the document has a table of contents and regenerate it with `doc_generate_toc`.
- **Never use delete + insert to relocate a section.** Use `doc_move_section` — it is atomic and preserves all content including children. The delete + insert pattern risks permanent data loss when the section content exceeds your context window. You will lose content silently and cannot recover it.

## Tool Quick Reference

| Task | Tool | Key params |
|------|------|------------|
| Check roots and status | `doc_status` | `scope?` |
| See document structure | `doc_outline` | `file`, `max_depth?` |
| Read a section | `doc_read_section` | `file`, `section` |
| Read frontmatter | `doc_read_section` | `file`, `"__preamble"` |
| Read full document | `doc_read` | `file`, `page?`, `page_size?` |
| List all documents | `doc_list` | `scope?` |
| Search across documents | `doc_search` | `query`, `scope?`, `section_filter?` |
| Set a scalar value | `doc_set_value` | `file`, `path`, `value` |
| Replace section content | `doc_replace_section` | `file`, `section`, `content` |
| Append to a section | `doc_append_section` | `file`, `section`, `content` |
| Find and replace | `doc_find_replace` | `file`, `find`, `replace`, `preview?` |
| Create new document | `doc_create` | `file`, `content` |
| Insert new section | `doc_insert_section` | `file`, `anchor`, `position`, `heading`, `content` |
| Delete a section | `doc_delete_section` | `file`, `section` |
| Move a section | `doc_move_section` | `file`, `section`, `anchor`, `position` |
| Generate/update TOC | `doc_generate_toc` | `file`, `max_depth?`, `style?` |
| Rename a document | `doc_rename` | `source`, `destination` |

### YAML-Specific Tool Selection

| Intent | Tool | Why |
|--------|------|-----|
| Change one config value | `doc_set_value` | Path-addressed, preserves quotes, validates output |
| Rewrite a config block | `doc_replace_section` | Values only, no key line |
| Add a key to a mapping | `doc_append_section` | Adds at end of mapping |
| Rename a value across file | `doc_find_replace` | Text-based, preview first |
