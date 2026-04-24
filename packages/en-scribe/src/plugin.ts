// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ToolRegistry } from '@nullproof-studio/en-core';
import { TextReadSchema, handleTextRead } from './tools/read/text-read.js';
import { TextFindSchema, handleTextFind } from './tools/read/text-find.js';
import { TextListSchema, handleTextList } from './tools/read/text-list.js';
import {
  TextHeadSchema, handleTextHead,
  TextTailSchema, handleTextTail,
} from './tools/read/text-head-tail.js';
import { TextReplaceRangeSchema, handleTextReplaceRange } from './tools/write/text-replace-range.js';
import { TextCreateSchema, handleTextCreate } from './tools/write/text-create.js';
import { TextAppendSchema, handleTextAppend } from './tools/write/text-append.js';
import { TextEditSchema, handleTextEdit } from './tools/write/text-edit.js';
import { TextInsertAtAnchorSchema, handleTextInsertAtAnchor } from './tools/write/text-insert-at-anchor.js';
import { TextRenameSchema, handleTextRename } from './tools/write/text-rename.js';
import { TextDeleteSchema, handleTextDelete } from './tools/write/text-delete.js';
import { TextStatusSchema, handleTextStatus } from './tools/status/text-status.js';
import {
  TextProposalsListSchema, handleTextProposalsList,
  TextProposalDiffSchema, handleTextProposalDiff,
  TextProposalApproveSchema, handleTextProposalApprove,
  TextProposalRejectSchema, handleTextProposalReject,
} from './tools/governance/text-proposals.js';

/**
 * Register all en-scribe tools into a registry.
 *
 * Positioning: en-scribe tools are literal — no regex, no structural
 * interpretation. The primitives (text_find + text_replace_range) can
 * express every edit; the sugar tools (text_edit, text_insert_at_anchor)
 * compose them for the common unique-match case and error with a clear
 * hint on ambiguity so agents can fall back to the primitives without
 * getting stuck.
 */
export function registerEnScribeTools(registry: ToolRegistry): void {
  // Read primitives
  registry.register({
    name: 'text_read',
    description: 'Read a plain-text file with optional 1-indexed line range. Returns content, etag, and total line count. Use for inspecting a file before an edit; pass the etag to subsequent write tools to detect concurrent changes.',
    schema: TextReadSchema.shape,
    handler: handleTextRead,
  });
  registry.register({
    name: 'text_find',
    description: 'Find all literal occurrences of a substring. Not a regex — matches are literal. Supports case_sensitive (default true) and whole_word (default false). Returns every match with line, column, byte offset, the actual matched text, and surrounding context. Use before text_replace_range to pick a specific match by line, or to debug a text_edit multi-match error.',
    schema: TextFindSchema.shape,
    handler: handleTextFind,
  });
  registry.register({
    name: 'text_head',
    description: 'Read the first N lines of a file (default 10). Equivalent to `head -n N`. Returns the content along with the line range covered and the file\'s total line count.',
    schema: TextHeadSchema.shape,
    handler: handleTextHead,
  });
  registry.register({
    name: 'text_tail',
    description: 'Read the last N lines of a file (default 10). Equivalent to `tail -n N`. Returns the content along with the line range covered and the file\'s total line count. Useful for inspecting the end of log files.',
    schema: TextTailSchema.shape,
    handler: handleTextTail,
  });

  // Lifecycle
  registry.register({
    name: 'text_list',
    description: 'List plain-text files (.txt, .text, .log) in a scope. Omit scope to list across all roots.',
    schema: TextListSchema.shape,
    handler: handleTextList,
  });

  // Write primitives
  registry.register({
    name: 'text_replace_range',
    description: 'Replace lines N to M (1-indexed, inclusive) with new content. For a zero-length insertion before line N, set line_end = line_start - 1. Pass if_match (from a prior read) to prevent stale writes. Use text_edit or text_insert_at_anchor for the common unique-anchor case; reach for this primitive when an agent needs explicit line targeting.',
    schema: TextReplaceRangeSchema.shape,
    handler: handleTextReplaceRange,
  });
  registry.register({
    name: 'text_create',
    description: 'Create a new plain-text file. Fails if the file already exists — use text_replace_range, text_edit, or text_append to modify existing files.',
    schema: TextCreateSchema.shape,
    handler: handleTextCreate,
  });
  registry.register({
    name: 'text_append',
    description: 'Append content to the end of a plain-text file. Pass if_match (from a prior read) to prevent stale writes. Ensure your content begins with "\\n" if the existing file does not already end with a trailing newline.',
    schema: TextAppendSchema.shape,
    handler: handleTextAppend,
  });

  // Write sugar
  registry.register({
    name: 'text_edit',
    description: 'Atomic find-and-replace of a unique literal substring. Errors if old_string appears zero or more than once, listing each candidate match with context so you can either supply a more distinctive old_string or fall back to text_find + text_replace_range. Case-sensitive, no regex — mirror the positioning of en-scribe: predictable, no hidden semantics.',
    schema: TextEditSchema.shape,
    handler: handleTextEdit,
  });
  registry.register({
    name: 'text_insert_at_anchor',
    description: 'Insert content before or after the line containing a unique literal anchor substring. Multi-match errors list each candidate with context. Use when you know a neighbouring line\'s text but not its line number.',
    schema: TextInsertAtAnchorSchema.shape,
    handler: handleTextInsertAtAnchor,
  });

  // Lifecycle writes
  registry.register({
    name: 'text_rename',
    description: 'Rename a plain-text file within the same root. Source must exist and destination must not. Cross-root rename is not supported — use text_read + text_create + text_delete instead.',
    schema: TextRenameSchema.shape,
    handler: handleTextRename,
  });
  registry.register({
    name: 'text_delete',
    description: 'Delete a plain-text file. Pass if_match (from a prior read) to prevent stale deletes. Proposal mode recommended when operating in a git-enabled root.',
    schema: TextDeleteSchema.shape,
    handler: handleTextDelete,
  });

  // Status
  registry.register({
    name: 'text_status',
    description: 'Check plain-text file status across roots. Returns active roots, modified files, pending proposals, indexed/unindexed document counts. Use to verify system health or check for uncommitted changes.',
    schema: TextStatusSchema.shape,
    handler: handleTextStatus,
  });

  // Governance
  registry.register({
    name: 'text_proposals_list',
    description: 'List pending proposals across all git-enabled roots.',
    schema: TextProposalsListSchema.shape,
    handler: handleTextProposalsList,
  });
  registry.register({
    name: 'text_proposal_diff',
    description: 'View the diff of a proposal.',
    schema: TextProposalDiffSchema.shape,
    handler: handleTextProposalDiff,
  });
  registry.register({
    name: 'text_proposal_approve',
    description: 'Approve and merge a proposal.',
    schema: TextProposalApproveSchema.shape,
    handler: handleTextProposalApprove,
  });
  registry.register({
    name: 'text_proposal_reject',
    description: 'Reject and delete a proposal.',
    schema: TextProposalRejectSchema.shape,
    handler: handleTextProposalReject,
  });
}
