// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import {
  readDocument,
  resolveFilePath,
  requirePermission,
  findText,
  replaceLineRange,
  executeWrite,
  ValidationError,
} from '@nullproof-studio/en-core';

export const TextInsertAtAnchorSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.txt").'),
  anchor: z.string().min(1).describe('Literal substring that uniquely identifies the target line. Must match exactly one line; multi-match errors list candidates with context.'),
  position: z.enum(['before', 'after']).describe('"before" inserts as a new line preceding the anchor line; "after" inserts immediately after.'),
  content: z.string().describe('Content to insert. Must end with "\\n" when inserting a single line; multi-line content should have interior newlines as needed.'),
  if_match: z.string().optional().describe('ETag from a prior read. Required when require_read_before_write is enabled.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleTextInsertAtAnchor(
  args: z.infer<typeof TextInsertAtAnchorSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const resolved = resolveFilePath(ctx.config.document_roots, args.file);
  const { content, encoding } = readDocument(resolved.root.path, resolved.relativePath);

  const matches = findText(content, args.anchor, { case_sensitive: true, whole_word: false });

  if (matches.length === 0) {
    throw new ValidationError(
      `text_insert_at_anchor: anchor "${args.anchor}" not found in ${args.file}. Verify the exact text (case and whitespace matter) or use text_find to inspect what's there.`,
    );
  }

  if (matches.length > 1) {
    throw new ValidationError(
      `text_insert_at_anchor requires a unique anchor: found ${matches.length} matches for "${args.anchor}" in ${args.file}. ` +
      `Supply a more distinctive anchor, or use text_find + text_replace_range for explicit line targeting. ` +
      `Matches: ${JSON.stringify(matches, null, 2)}`,
    );
  }

  const anchorLine = matches[0].line;
  // "before": insert a zero-length range at anchorLine (endLine = anchorLine - 1)
  // "after":  insert a zero-length range at anchorLine + 1 (endLine = anchorLine)
  const insertBeforeLine = args.position === 'before' ? anchorLine : anchorLine + 1;
  const newContent = replaceLineRange(content, insertBeforeLine, insertBeforeLine - 1, args.content);

  return await executeWrite(
    ctx,
    {
      file: args.file,
      operation: `Insert ${args.position} anchor`,
      target: `line ${anchorLine}`,
      mode: args.mode,
      message: args.message,
      if_match: args.if_match,
    },
    content,
    newContent,
    encoding,
  );
}
