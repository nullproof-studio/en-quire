// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import type { ResolvedConfig, CallerIdentity } from './shared/types.js';
import type { ToolContext, RootContext } from './tools/context.js';
import { EnquireError } from './shared/errors.js';

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
import { DocCreateSchema, handleDocCreate } from './tools/write/doc-create.js';
import { DocFindReplaceSchema, handleDocFindReplace } from './tools/write/doc-find-replace.js';
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

export interface ServerDependencies {
  config: ResolvedConfig;
  db: Database.Database;
  roots: Record<string, RootContext>;
  caller: CallerIdentity;
}

export function createServer(deps: ServerDependencies): McpServer {
  const server = new McpServer({
    name: 'en-quire',
    version: '0.2.0',
  });

  const ctx: ToolContext = {
    config: deps.config,
    roots: deps.roots,
    caller: deps.caller,
    db: deps.db,
  };

  // Helper to wrap handlers with error handling
  function wrapHandler<T>(
    handler: (args: T, ctx: ToolContext) => Promise<unknown>,
  ) {
    return async (args: T) => {
      try {
        const result = await handler(args, ctx);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const error = err instanceof EnquireError
          ? { error: err.code, message: err.message }
          : { error: 'internal_error', message: String(err) };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(error, null, 2) }],
          isError: true,
        };
      }
    };
  }

  // Register all tools

  // Read tools
  server.tool('doc_outline', 'Get the heading/key structure of a document. Returns level, text, path, line numbers, and char count for each section. Use this first to understand document structure before making changes.', DocOutlineSchema.shape, wrapHandler(handleDocOutline));
  server.tool('doc_read_section', 'Read a specific section by heading text or path. By default returns the section body AND all children. Set include_children=false to read only the body text (before the first child heading). Use doc_outline first to find the correct section address.', DocReadSectionSchema.shape, wrapHandler(handleDocReadSection));
  server.tool('doc_read', 'Read a document with line-based pagination. Returns content, page number, total pages, and total lines. Use for reading raw document content or large documents that exceed context limits.', DocReadSchema.shape, wrapHandler(handleDocRead));
  server.tool('doc_list', 'List documents across all roots or within a scope. Returns file path, root, size, and modification date. Set include_outline=true to also get each document\'s heading structure.', DocListSchema.shape, wrapHandler(handleDocList));

  // Write tools
  server.tool('doc_replace_section', 'Replace a section\'s content. The heading is preserved automatically — do NOT include it in content. IMPORTANT: if content contains subsection headings (e.g. ### child), the body AND all existing children are replaced with the new content. If content is plain text (no subsection headings), only the body is replaced and children are preserved. WARNING: replacing a top-level (h1) section with subsection headings replaces the entire document body beneath that heading — use doc_outline to check structure first. When replace_heading is true, content must include the full heading line (e.g. "## New Title\\nBody").', DocReplaceSectionSchema.shape, wrapHandler(handleDocReplaceSection));
  server.tool('doc_insert_section', 'Insert a new section relative to an anchor section. Heading must be plain text without # markers (e.g. "My Section", not "## My Section") — level is set automatically or via the level parameter. Fails if a sibling with the same heading already exists; use doc_replace_section to update existing sections. Not supported for YAML files.', DocInsertSectionSchema.shape, wrapHandler(handleDocInsertSection));
  server.tool('doc_append_section', 'Append content to the end of a section\'s body (before its children). Content must not contain headings at or above the section\'s level — use doc_insert_section to add sibling sections. Children are not affected.', DocAppendSectionSchema.shape, wrapHandler(handleDocAppendSection));
  server.tool('doc_delete_section', 'Delete a section including its heading, body, AND all children. WARNING: deleting a top-level (h1) section removes the entire document body beneath that heading. Use doc_outline to check what will be affected.', DocDeleteSectionSchema.shape, wrapHandler(handleDocDeleteSection));
  server.tool('doc_create', 'Create a new document. Fails if the file already exists — use doc_replace_section or doc_find_replace to modify existing files. Content is validated for structural issues before writing.', DocCreateSchema.shape, wrapHandler(handleDocCreate));
  server.tool('doc_find_replace', 'Find and replace text across a document. Use preview=true first to see matches with their line numbers and section paths before applying changes. Supports literal and regex patterns. Use expected_count as a safety check to abort if the match count is unexpected.', DocFindReplaceSchema.shape, wrapHandler(handleDocFindReplace));
  server.tool('doc_rename', 'Rename a document within the same root. Source must exist and destination must not. Cross-root rename is not supported — use doc_read + doc_create + doc_delete instead.', DocRenameSchema.shape, wrapHandler(handleDocRename));
  server.tool('doc_generate_toc', 'Generate or update a table of contents from the document\'s heading structure. If a TOC already exists, it is replaced in place. Markdown only — not supported for YAML.', DocGenerateTocSchema.shape, wrapHandler(handleDocGenerateToc));
  server.tool('doc_set_value', 'Set a scalar value at a specific path. For YAML: directly sets the value, preserving quote style (e.g. path: "services.api.port", value: "8080"). For markdown: replaces the section body. Fails on container nodes (maps/sequences with children) — use doc_replace_section for those.', DocSetValueSchema.shape, wrapHandler(handleDocSetValue));

  // Status
  server.tool('doc_status', 'Check document status across roots. Returns: active roots, modified files, pending proposals, indexed/unindexed document counts. Use to verify system health or check for uncommitted changes.', DocStatusSchema.shape, wrapHandler(handleDocStatus));

  // Search
  server.tool('doc_search', 'Search document content across all roots. Returns matching sections with file path, section path, and optional surrounding context. Use scope to limit to a specific root or subfolder.', DocSearchSchema.shape, wrapHandler(handleDocSearch));

  // Governance
  server.tool('doc_proposals_list', 'List pending proposals across all git-enabled roots', DocProposalsListSchema.shape, wrapHandler(handleDocProposalsList));
  server.tool('doc_proposal_diff', 'View the diff of a proposal', DocProposalDiffSchema.shape, wrapHandler(handleDocProposalDiff));
  server.tool('doc_proposal_approve', 'Approve and merge a proposal', DocProposalApproveSchema.shape, wrapHandler(handleDocProposalApprove));
  server.tool('doc_proposal_reject', 'Reject and delete a proposal', DocProposalRejectSchema.shape, wrapHandler(handleDocProposalReject));

  // Admin
  server.tool('doc_exec', 'Execute a command in a document root (admin)', DocExecSchema.shape, wrapHandler(handleDocExec));

  return server;
}
