// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import { insertText } from '@nullproof-studio/en-core';
import { requirePermission } from '@nullproof-studio/en-core';
import { loadDocument, executeWrite } from './write-helpers.js';

export const DocInsertTextSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md").'),
  anchor: z.string().describe('A distinctive string of existing text that appears exactly once in the document. Used to locate the insertion point. Whitespace, punctuation, and case must match the document exactly. Short anchors at paragraph boundaries work well — pick the first few words of a paragraph, or a distinctive phrase at the end of one.'),
  position: z.enum(['before', 'after']).describe('Insert content immediately "before" the anchor or immediately "after" it.'),
  content: z.string().describe('The text to insert. Inserted as a separate paragraph (with blank-line separators). Leading and trailing whitespace are trimmed.'),
  if_match: z.string().optional().describe('ETag from a prior read. Required when require_read_before_write is enabled. Obtain from doc_read, doc_read_section, or doc_outline.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleDocInsertText(
  args: z.infer<typeof DocInsertTextSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const { content, encoding, tree } = loadDocument(ctx, args.file);
  const insertResult = insertText(content, tree, args.anchor, args.position, args.content);

  const writeResult = await executeWrite(ctx, {
    file: args.file,
    operation: 'Insert text',
    target: args.anchor,
    mode: args.mode,
    message: args.message,
    if_match: args.if_match,
  }, content, insertResult.result, encoding);

  return {
    ...writeResult,
    anchor: args.anchor,
    position: args.position,
    line: insertResult.line,
    section_path: insertResult.sectionPath,
  };
}
