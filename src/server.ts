// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import type { ResolvedConfig, CallerIdentity } from './shared/types.js';
import type { GitOperations } from './git/operations.js';
import type { ToolContext } from './tools/context.js';
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
  git: GitOperations | null;
  caller: CallerIdentity;
}

export function createServer(deps: ServerDependencies): McpServer {
  const server = new McpServer({
    name: 'en-quire',
    version: '0.1.0',
  });

  const ctx: ToolContext = {
    config: deps.config,
    documentRoot: deps.config.document_root,
    caller: deps.caller,
    db: deps.db,
    git: deps.git,
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
  server.tool('doc_outline', 'Get the heading structure of a document', DocOutlineSchema.shape, wrapHandler(handleDocOutline));
  server.tool('doc_read_section', 'Read a specific section by address', DocReadSectionSchema.shape, wrapHandler(handleDocReadSection));
  server.tool('doc_read', 'Read a document with pagination', DocReadSchema.shape, wrapHandler(handleDocRead));
  server.tool('doc_list', 'List documents in scope', DocListSchema.shape, wrapHandler(handleDocList));

  // Write tools
  server.tool('doc_replace_section', 'Replace a section body or heading', DocReplaceSectionSchema.shape, wrapHandler(handleDocReplaceSection));
  server.tool('doc_insert_section', 'Insert a new section relative to an anchor', DocInsertSectionSchema.shape, wrapHandler(handleDocInsertSection));
  server.tool('doc_append_section', 'Append content to a section body', DocAppendSectionSchema.shape, wrapHandler(handleDocAppendSection));
  server.tool('doc_delete_section', 'Delete a section and its children', DocDeleteSectionSchema.shape, wrapHandler(handleDocDeleteSection));
  server.tool('doc_create', 'Create a new document', DocCreateSchema.shape, wrapHandler(handleDocCreate));
  server.tool('doc_find_replace', 'Find and replace text in a document', DocFindReplaceSchema.shape, wrapHandler(handleDocFindReplace));
  server.tool('doc_rename', 'Rename a document', DocRenameSchema.shape, wrapHandler(handleDocRename));
  server.tool('doc_generate_toc', 'Generate or update table of contents', DocGenerateTocSchema.shape, wrapHandler(handleDocGenerateToc));

  // Status
  server.tool('doc_status', 'Check document status, pending proposals, and index health', DocStatusSchema.shape, wrapHandler(handleDocStatus));

  // Search
  server.tool('doc_search', 'Search documents with full-text or semantic search', DocSearchSchema.shape, wrapHandler(handleDocSearch));

  // Governance
  server.tool('doc_proposals_list', 'List pending proposals', DocProposalsListSchema.shape, wrapHandler(handleDocProposalsList));
  server.tool('doc_proposal_diff', 'View the diff of a proposal', DocProposalDiffSchema.shape, wrapHandler(handleDocProposalDiff));
  server.tool('doc_proposal_approve', 'Approve and merge a proposal', DocProposalApproveSchema.shape, wrapHandler(handleDocProposalApprove));
  server.tool('doc_proposal_reject', 'Reject and delete a proposal', DocProposalRejectSchema.shape, wrapHandler(handleDocProposalReject));

  // Admin
  server.tool('doc_exec', 'Execute a command in the document root (admin)', DocExecSchema.shape, wrapHandler(handleDocExec));

  return server;
}
