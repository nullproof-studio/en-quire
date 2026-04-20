// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ToolRegistry } from '@nullproof-studio/en-core';

// Read tools
import { DocOutlineSchema, handleDocOutline } from './tools/read/doc-outline.js';
import { DocReadSectionSchema, handleDocReadSection } from './tools/read/doc-read-section.js';
import { DocReadSchema, handleDocRead } from './tools/read/doc-read.js';
import { DocListSchema, handleDocList } from './tools/read/doc-list.js';

// Write tools
import { DocReplaceSectionSchema, handleDocReplaceSection } from './tools/write/doc-replace-section.js';
import { DocInsertSectionSchema, handleDocInsertSection } from './tools/write/doc-insert-section.js';
import { DocAppendSectionSchema, handleDocAppendSection } from './tools/write/doc-append-section.js';
import { DocDeleteSectionSchema, handleDocDeleteSection } from './tools/write/doc-delete-section.js';
import { DocMoveSectionSchema, handleDocMoveSection } from './tools/write/doc-move-section.js';
import { DocCreateSchema, handleDocCreate } from './tools/write/doc-create.js';
import { DocFindReplaceSchema, handleDocFindReplace } from './tools/write/doc-find-replace.js';
import { DocInsertTextSchema, handleDocInsertText } from './tools/write/doc-insert-text.js';
import { DocRenameSchema, handleDocRename } from './tools/write/doc-rename.js';
import { DocGenerateTocSchema, handleDocGenerateToc } from './tools/write/doc-generate-toc.js';
import { DocSetValueSchema, handleDocSetValue } from './tools/write/doc-set-value.js';

// Status
import { DocStatusSchema, handleDocStatus } from './tools/status/doc-status.js';

// Search
import { DocSearchSchema, handleDocSearch } from './tools/search/doc-search.js';

// Governance
import {
  DocProposalsListSchema, handleDocProposalsList,
  DocProposalDiffSchema, handleDocProposalDiff,
  DocProposalApproveSchema, handleDocProposalApprove,
  DocProposalRejectSchema, handleDocProposalReject,
} from './tools/governance/doc-proposals.js';

// Admin
import { DocExecSchema, handleDocExec } from './tools/admin/doc-exec.js';

/**
 * Register all en-quire tools into a registry.
 *
 * Held separate from bin.ts so tool-registration tests can introspect the
 * registered set without spinning up a real MCP server, and so a future
 * third-party plugin pack can compose more tools onto the same registry.
 */
export function registerEnQuireTools(registry: ToolRegistry): void {
  // Read tools
  registry.register({ name: 'doc_outline', description: 'Get the heading/key structure of a document. Returns level, text, path, line numbers, and char count for each section. For markdown documents, also returns word_count per section and total_word_count at root (fenced code blocks are excluded from word counts). Use this first to understand document structure before making changes. Returns an etag for use with write operations.', schema: DocOutlineSchema.shape, handler: handleDocOutline });
  registry.register({ name: 'doc_read_section', description: 'Read a specific section by heading text or path. By default returns the section body AND all children. Set include_children=false to read only the body text (before the first child heading). Use doc_outline first to find the correct section address. Returns an etag for use with write operations.', schema: DocReadSectionSchema.shape, handler: handleDocReadSection });
  registry.register({ name: 'doc_read', description: 'Read a document with line-based pagination. Returns content, page number, total pages, and total lines. Use for reading raw document content or large documents that exceed context limits. Returns an etag for use with write operations.', schema: DocReadSchema.shape, handler: handleDocRead });
  registry.register({ name: 'doc_list', description: 'List documents across all roots or within a scope. Returns file path, root, size, and modification date. Set include_outline=true to also get each document\'s heading structure.', schema: DocListSchema.shape, handler: handleDocList });

  // Write tools
  registry.register({ name: 'doc_replace_section', description: 'Replace a section\'s content. The heading is preserved automatically — do NOT include it in content. IMPORTANT: if content contains subsection headings (e.g. ### child), the body AND all existing children are replaced with the new content. If content is plain text (no subsection headings), only the body is replaced and children are preserved. WARNING: replacing a top-level (h1) section with subsection headings replaces the entire document body beneath that heading — use doc_outline to check structure first. For correcting specific text within a section, prefer doc_find_replace — it is more precise and avoids unintended formatting changes. When replace_heading is true, content must include the full heading line (e.g. "## New Title\\nBody"). Pass if_match (from a prior read) to prevent stale writes.', schema: DocReplaceSectionSchema.shape, handler: handleDocReplaceSection });
  registry.register({ name: 'doc_insert_section', description: 'Insert a new section relative to an anchor section. Heading must be plain text without # markers (e.g. "My Section", not "## My Section") — level is set automatically or via the level parameter. Fails if a sibling with the same heading already exists; use doc_replace_section to update existing sections. Not supported for YAML files. Pass if_match (from a prior read) to prevent stale writes.', schema: DocInsertSectionSchema.shape, handler: handleDocInsertSection });
  registry.register({ name: 'doc_append_section', description: 'Append content to the end of a section\'s body (before its children). Content must not contain headings at or above the section\'s level — use doc_insert_section to add sibling sections. Children are not affected. Pass if_match (from a prior read) to prevent stale writes.', schema: DocAppendSectionSchema.shape, handler: handleDocAppendSection });
  registry.register({ name: 'doc_delete_section', description: 'Delete a section including its heading, body, AND all children. WARNING: deleting a top-level (h1) section removes the entire document body beneath that heading. Use doc_outline to check what will be affected. Pass if_match (from a prior read) to prevent stale writes.', schema: DocDeleteSectionSchema.shape, handler: handleDocDeleteSection });
  registry.register({ name: 'doc_move_section', description: 'Atomically move a section (heading, body, and all children) to a new position within the same document. Equivalent to cut-and-paste. Heading levels adjust automatically — moving an h2 to become a child of another h2 makes it h3, and all descendants shift accordingly. Use this instead of separate delete + insert calls to prevent data loss. Fails if a sibling with the same heading already exists at the destination.', schema: DocMoveSectionSchema.shape, handler: handleDocMoveSection });
  registry.register({ name: 'doc_create', description: 'Create a new document. Fails if the file already exists — use doc_replace_section or doc_find_replace to modify existing files. Content is validated for structural issues before writing. Returns an etag for the new document.', schema: DocCreateSchema.shape, handler: handleDocCreate });
  registry.register({ name: 'doc_find_replace', description: 'Find and replace text across a document. Preferred over doc_replace_section for targeted corrections — avoids re-serialising the entire section through the model, which can introduce formatting drift. Use preview=true first to see matches with their line numbers and section paths before applying changes. Supports literal and regex patterns. Use expected_count as a safety check to abort if the match count is unexpected. Preview returns an etag; pass if_match on apply to prevent stale writes.', schema: DocFindReplaceSchema.shape, handler: handleDocFindReplace });
  registry.register({ name: 'doc_insert_text', description: 'Insert a new paragraph at a specific position within a section body, anchored to existing text. Use when you want to add prose between two existing paragraphs or at the start/end of a paragraph — not when adding a new subsection (use doc_insert_section) or appending to the end of a section body (use doc_append_section). The anchor must be a distinctive literal string that appears exactly once in the document; short anchors at paragraph boundaries (first/last few words of a paragraph) work best. If the anchor is ambiguous, the error returns each candidate match with its section path and line number so you can pick a longer/more distinctive anchor. If you want to replace existing text rather than insert new text, use doc_find_replace.', schema: DocInsertTextSchema.shape, handler: handleDocInsertText });
  registry.register({ name: 'doc_rename', description: 'Rename a document within the same root. Source must exist and destination must not. Cross-root rename is not supported — use doc_read + doc_create + doc_delete instead. Pass if_match (from a prior read) to prevent stale writes.', schema: DocRenameSchema.shape, handler: handleDocRename });
  registry.register({ name: 'doc_generate_toc', description: 'Generate or update a table of contents from the document\'s heading structure. If a TOC already exists, it is replaced in place. Markdown only — not supported for YAML. Pass if_match (from a prior read) to prevent stale writes.', schema: DocGenerateTocSchema.shape, handler: handleDocGenerateToc });
  registry.register({ name: 'doc_set_value', description: 'Set a scalar value at a specific path. For YAML: directly sets the value, preserving quote style (e.g. path: "services.api.port", value: "8080"). For markdown: replaces the section body. Fails on container nodes (maps/sequences with children) — use doc_replace_section for those. Pass if_match (from a prior read) to prevent stale writes.', schema: DocSetValueSchema.shape, handler: handleDocSetValue });

  // Status
  registry.register({ name: 'doc_status', description: 'Check document status across roots. Returns: active roots, modified files, pending proposals, indexed/unindexed document counts. Use to verify system health or check for uncommitted changes.', schema: DocStatusSchema.shape, handler: handleDocStatus });

  // Search
  registry.register({ name: 'doc_search', description: 'Search document content across all roots. Returns matching sections with file path, section path, line numbers, and optional surrounding context. Use scope to limit to a specific root, subfolder, or single file.', schema: DocSearchSchema.shape, handler: handleDocSearch });

  // Governance
  registry.register({ name: 'doc_proposals_list', description: 'List pending proposals across all git-enabled roots', schema: DocProposalsListSchema.shape, handler: handleDocProposalsList });
  registry.register({ name: 'doc_proposal_diff', description: 'View the diff of a proposal', schema: DocProposalDiffSchema.shape, handler: handleDocProposalDiff });
  registry.register({ name: 'doc_proposal_approve', description: 'Approve and merge a proposal', schema: DocProposalApproveSchema.shape, handler: handleDocProposalApprove });
  registry.register({ name: 'doc_proposal_reject', description: 'Reject and delete a proposal', schema: DocProposalRejectSchema.shape, handler: handleDocProposalReject });

  // Admin
  registry.register({ name: 'doc_exec', description: 'Execute a command in a document root (admin)', schema: DocExecSchema.shape, handler: handleDocExec });
}
