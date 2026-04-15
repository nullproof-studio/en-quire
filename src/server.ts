// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import type { ResolvedConfig, CallerIdentity } from './shared/types.js';
import type { ToolContext, RootContext } from './tools/context.js';
import { EnquireError } from './shared/errors.js';
import { getLogger } from './shared/logger.js';

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

  const logger = getLogger();

  // Helper to wrap handlers with error handling and diagnostic logging
  function wrapHandler<T>(
    tool: string,
    handler: (args: T, ctx: ToolContext) => Promise<unknown>,
  ) {
    return async (args: T) => {
      const start = performance.now();
      const argsSummary = extractArgsSummary(args);
      logger.info('tool:start', { tool, ...argsSummary });
      try {
        const result = await handler(args, ctx);
        const durationMs = Math.round(performance.now() - start);
        logger.info('tool:complete', { tool, durationMs });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const durationMs = Math.round(performance.now() - start);
        const error = err instanceof EnquireError
          ? {
              error: err.code,
              message: err.message,
              ...('current_etag' in err && { current_etag: (err as any).current_etag }),
            }
          : { error: 'internal_error', message: String(err) };
        logger.error('tool:error', { tool, error: error.error, message: error.message, durationMs });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(error, null, 2) }],
          isError: true,
        };
      }
    };
  }

  // Register all tools

  // Read tools
  server.tool('doc_outline', 'Get the heading/key structure of a document. Returns level, text, path, line numbers, and char count for each section. For markdown documents, also returns word_count per section and total_word_count at root (fenced code blocks are excluded from word counts). Use this first to understand document structure before making changes. Returns an etag for use with write operations.', DocOutlineSchema.shape, wrapHandler('doc_outline', handleDocOutline));
  server.tool('doc_read_section', 'Read a specific section by heading text or path. By default returns the section body AND all children. Set include_children=false to read only the body text (before the first child heading). Use doc_outline first to find the correct section address. Returns an etag for use with write operations.', DocReadSectionSchema.shape, wrapHandler('doc_read_section', handleDocReadSection));
  server.tool('doc_read', 'Read a document with line-based pagination. Returns content, page number, total pages, and total lines. Use for reading raw document content or large documents that exceed context limits. Returns an etag for use with write operations.', DocReadSchema.shape, wrapHandler('doc_read', handleDocRead));
  server.tool('doc_list', 'List documents across all roots or within a scope. Returns file path, root, size, and modification date. Set include_outline=true to also get each document\'s heading structure.', DocListSchema.shape, wrapHandler('doc_list', handleDocList));

  // Write tools
  server.tool('doc_replace_section', 'Replace a section\'s content. The heading is preserved automatically — do NOT include it in content. IMPORTANT: if content contains subsection headings (e.g. ### child), the body AND all existing children are replaced with the new content. If content is plain text (no subsection headings), only the body is replaced and children are preserved. WARNING: replacing a top-level (h1) section with subsection headings replaces the entire document body beneath that heading — use doc_outline to check structure first. For correcting specific text within a section, prefer doc_find_replace — it is more precise and avoids unintended formatting changes. When replace_heading is true, content must include the full heading line (e.g. "## New Title\\nBody"). Pass if_match (from a prior read) to prevent stale writes.', DocReplaceSectionSchema.shape, wrapHandler('doc_replace_section', handleDocReplaceSection));
  server.tool('doc_insert_section', 'Insert a new section relative to an anchor section. Heading must be plain text without # markers (e.g. "My Section", not "## My Section") — level is set automatically or via the level parameter. Fails if a sibling with the same heading already exists; use doc_replace_section to update existing sections. Not supported for YAML files. Pass if_match (from a prior read) to prevent stale writes.', DocInsertSectionSchema.shape, wrapHandler('doc_insert_section', handleDocInsertSection));
  server.tool('doc_append_section', 'Append content to the end of a section\'s body (before its children). Content must not contain headings at or above the section\'s level — use doc_insert_section to add sibling sections. Children are not affected. Pass if_match (from a prior read) to prevent stale writes.', DocAppendSectionSchema.shape, wrapHandler('doc_append_section', handleDocAppendSection));
  server.tool('doc_delete_section', 'Delete a section including its heading, body, AND all children. WARNING: deleting a top-level (h1) section removes the entire document body beneath that heading. Use doc_outline to check what will be affected. Pass if_match (from a prior read) to prevent stale writes.', DocDeleteSectionSchema.shape, wrapHandler('doc_delete_section', handleDocDeleteSection));
  server.tool('doc_move_section', 'Atomically move a section (heading, body, and all children) to a new position within the same document. Equivalent to cut-and-paste. Heading levels adjust automatically — moving an h2 to become a child of another h2 makes it h3, and all descendants shift accordingly. Use this instead of separate delete + insert calls to prevent data loss. Fails if a sibling with the same heading already exists at the destination.', DocMoveSectionSchema.shape, wrapHandler('doc_move_section', handleDocMoveSection));
  server.tool('doc_create', 'Create a new document. Fails if the file already exists — use doc_replace_section or doc_find_replace to modify existing files. Content is validated for structural issues before writing. Returns an etag for the new document.', DocCreateSchema.shape, wrapHandler('doc_create', handleDocCreate));
  server.tool('doc_find_replace', 'Find and replace text across a document. Preferred over doc_replace_section for targeted corrections — avoids re-serialising the entire section through the model, which can introduce formatting drift. Use preview=true first to see matches with their line numbers and section paths before applying changes. Supports literal and regex patterns. Use expected_count as a safety check to abort if the match count is unexpected. Preview returns an etag; pass if_match on apply to prevent stale writes.', DocFindReplaceSchema.shape, wrapHandler('doc_find_replace', handleDocFindReplace));
  server.tool('doc_rename', 'Rename a document within the same root. Source must exist and destination must not. Cross-root rename is not supported — use doc_read + doc_create + doc_delete instead. Pass if_match (from a prior read) to prevent stale writes.', DocRenameSchema.shape, wrapHandler('doc_rename', handleDocRename));
  server.tool('doc_generate_toc', 'Generate or update a table of contents from the document\'s heading structure. If a TOC already exists, it is replaced in place. Markdown only — not supported for YAML. Pass if_match (from a prior read) to prevent stale writes.', DocGenerateTocSchema.shape, wrapHandler('doc_generate_toc', handleDocGenerateToc));
  server.tool('doc_set_value', 'Set a scalar value at a specific path. For YAML: directly sets the value, preserving quote style (e.g. path: "services.api.port", value: "8080"). For markdown: replaces the section body. Fails on container nodes (maps/sequences with children) — use doc_replace_section for those. Pass if_match (from a prior read) to prevent stale writes.', DocSetValueSchema.shape, wrapHandler('doc_set_value', handleDocSetValue));

  // Status
  server.tool('doc_status', 'Check document status across roots. Returns: active roots, modified files, pending proposals, indexed/unindexed document counts. Use to verify system health or check for uncommitted changes.', DocStatusSchema.shape, wrapHandler('doc_status', handleDocStatus));

  // Search
  server.tool('doc_search', 'Search document content across all roots. Returns matching sections with file path, section path, line numbers, and optional surrounding context. Use scope to limit to a specific root, subfolder, or single file.', DocSearchSchema.shape, wrapHandler('doc_search', handleDocSearch));

  // Governance
  server.tool('doc_proposals_list', 'List pending proposals across all git-enabled roots', DocProposalsListSchema.shape, wrapHandler('doc_proposals_list', handleDocProposalsList));
  server.tool('doc_proposal_diff', 'View the diff of a proposal', DocProposalDiffSchema.shape, wrapHandler('doc_proposal_diff', handleDocProposalDiff));
  server.tool('doc_proposal_approve', 'Approve and merge a proposal', DocProposalApproveSchema.shape, wrapHandler('doc_proposal_approve', handleDocProposalApprove));
  server.tool('doc_proposal_reject', 'Reject and delete a proposal', DocProposalRejectSchema.shape, wrapHandler('doc_proposal_reject', handleDocProposalReject));

  // Admin
  server.tool('doc_exec', 'Execute a command in a document root (admin)', DocExecSchema.shape, wrapHandler('doc_exec', handleDocExec));

  return server;
}

/** Extract loggable fields from tool args (file, section, scope, query) — avoids logging content blobs. */
function extractArgsSummary(args: unknown): Record<string, string> {
  if (!args || typeof args !== 'object') return {};
  const summary: Record<string, string> = {};
  const a = args as Record<string, unknown>;
  if (typeof a.file === 'string') summary.file = a.file;
  if (typeof a.section === 'string') summary.section = a.section;
  if (typeof a.scope === 'string') summary.scope = a.scope;
  if (typeof a.query === 'string') summary.query = a.query;
  return summary;
}
