---
name: en-quire
description: >
  Instructions for using en-quire MCP tools to read, search, edit, and manage 
  markdown documents. Use this skill whenever working with .md or .mdx files — 
  SOPs, skill files, session memory, codex articles, specs. Covers section-addressed 
  editing, structural search, find-replace, document creation, governance modes, 
  and the hybrid outline+filesystem workflow for full-document review.
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
    - doc_generate_toc
---
# Skill: en-quire — Markdown Document Management

**Purpose:** Instructions for agents using en-quire MCP tools to read, search, edit, and manage markdown documents.

---

## When to Use en-quire

Use en-quire tools (`doc_*`) instead of filesystem tools (`read_file`, `write_file`, `edit_file`) for any operation on markdown files (.md, .mdx). en-quire provides section-level addressing, structural search, and diff responses that eliminate the need to read or rewrite whole files.

Use filesystem tools only when:
- You need the full file including pre-heading content (frontmatter, imports, JSX preamble)
- You are working with non-markdown files
- You need to move or copy files between directories

---

## Core Workflow: Outline → Read → Edit

Every interaction with a document follows this sequence:

1. **`doc_outline`** — Get the heading structure first. This is non-negotiable. Never read a whole file to orient yourself.
2. **`doc_read_section`** — Read only the section you need. Use the heading text or path from the outline.
3. **Edit with the right tool:**
   - `doc_replace_section` — when you need to rewrite a section's content
   - `doc_append_section` — when you need to add content to the end of a section (table rows, list items, paragraphs)
   - `doc_find_replace` — when you need to change a term or phrase across the whole document
   - `doc_insert_section` — when you need to add a new section before or after an existing one
   - `doc_delete_section` — when you need to remove a section entirely

Every write tool returns a diff. You do not need to re-read the file to verify your edit landed correctly.

---

## Hybrid Pattern: Outline + Filesystem Read

For tasks that require seeing the whole document (proofreading, tone review, cross-section consistency checks):

1. **`doc_outline`** first — get the structural map
2. **Filesystem `read_text_file`** — read the full file with the structure already in context

This is 2 calls instead of 10+ (reading every section individually). The outline primes the read — you scan the file against a known structure rather than discovering the structure while reading.

Use en-quire for all subsequent edits after the full-file review.

---

## Search

Use `doc_search` to find content across documents. Results include:
- `section_path` — the full heading breadcrumb (e.g. "RBAC Model > Permission Types")
- `breadcrumb[]` — ancestor headings for triaging relevance
- `score` — structural ranking that boosts heading matches

Search is section-level, not line-level. Use the section path to navigate directly to the relevant content via `doc_read_section`.

Use `section_filter` to narrow results to specific parts of the document structure: "find metrics, but only within escalation procedures."

---

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

## Document Creation

Use `doc_create` for new documents. For session memory files, structure them with heading hierarchy so future agents can `doc_search` and `doc_append_section` into specific sections.

Recommended memory file structure:
- Design Decisions (with subsections by topic)
- Bugs Found / Issues
- Test Results
- Key Learnings (the primary append target)
- Open Questions
- Pending Actions

The heading hierarchy is the filing system. Classify the insight, map it to a section name, append.

---

## Governance: Write vs Propose

- **`mode: "write"`** — edits go directly to the file. Use for your own documents, session memory, and when git is not initialised.
- **`mode: "propose"`** — edits land on a git branch for review. Use for shared documents, skill files, specs, and other agents' system prompts. Requires git.

If propose mode returns `proposal_requires_git`, git is not initialised in the document root. Use write mode and inform the user.

---

## Self-Modification Pattern

When you identify an improvement to your own system prompt or skill files:
1. `doc_read` your own prompt file to review current content
2. Draft the specific change
3. Apply via `doc_append_section` or `doc_replace_section` (use propose mode when available, write mode when git is not initialised)
4. Inform the user what you changed and why

---

## Tone Editing Workflow

When editing for voice or style consistency:
1. **`doc_search`** across the corpus for a tonally strong reference passage — this is your voice calibration
2. **`doc_read_section`** on the reference passage to load it as context
3. **Filesystem `read_text_file`** on the target document for full-file voice calibration
4. **Edit section by section** via en-quire, holding the reference voice in context

Tool selection during tone edits:
- Single-sentence fixes → `doc_find_replace`
- Whole-section rewrites → `doc_replace_section`

The full-file read prevents tone drift between section edits.

---

## Common Mistakes to Avoid

- **Never read a whole file to orient yourself.** Use `doc_outline` first. Always.
- **Never use filesystem `edit_file` for markdown when en-quire is available.** en-quire's section addressing eliminates line-counting errors.
- **Never re-read after writing.** The diff in the response tells you what changed.
- **Never skip the preview step on find-replace.** One false positive can corrupt a document.
- **Never modify another agent's system prompt in write mode** when propose mode is available.

---

## Tool Quick Reference

| Task | Tool | Key params |
|------|------|------------|
| See document structure | `doc_outline` | `file`, `max_depth?` |
| Read a section | `doc_read_section` | `file`, `section` |
| Read full document | `doc_read` | `file`, `page?`, `page_size?` |
| List all documents | `doc_list` | `scope?` |
| Search across documents | `doc_search` | `query`, `section_filter?` |
| Replace section content | `doc_replace_section` | `file`, `section`, `content` |
| Append to a section | `doc_append_section` | `file`, `section`, `content` |
| Find and replace | `doc_find_replace` | `file`, `find`, `replace`, `preview?` |
| Create new document | `doc_create` | `file`, `content` |
| Insert new section | `doc_insert_section` | `file`, `anchor`, `position`, `heading`, `content` |
| Delete a section | `doc_delete_section` | `file`, `section` |
