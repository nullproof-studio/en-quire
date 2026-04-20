// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ToolRegistry } from '@nullproof-studio/en-core';
import { TextReadSchema, handleTextRead } from './tools/read/text-read.js';

/**
 * Register all en-scribe tools into a registry.
 *
 * Step 8 registers only `text_read` for smoke-testing the plumbing.
 * Steps 9 and 10 add the rest (text_find, text_replace_range, text_create,
 * text_append, text_edit, text_insert_at_anchor, text_list, text_rename,
 * text_delete, text_status, and the text_proposals_* family).
 */
export function registerEnScribeTools(registry: ToolRegistry): void {
  registry.register({
    name: 'text_read',
    description: 'Read a plain-text file with optional 1-indexed line range. Returns content, etag, and total line count. Use for inspecting a file before an edit; pass the etag to subsequent write tools to detect concurrent changes.',
    schema: TextReadSchema.shape,
    handler: handleTextRead,
  });
}
