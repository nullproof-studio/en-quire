// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import {
  readDocument,
  resolveFilePath,
  requirePermission,
  findText,
  executeWrite,
  ValidationError,
} from '@nullproof-studio/en-core';

export const TextEditSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.txt").'),
  old_string: z.string().min(1).describe('Literal substring to find and replace. Must appear exactly once in the file — if 0 matches, the error reports that; if >1, the error lists every match with context so you can either supply a more unique old_string or fall back to text_find + text_replace_range.'),
  new_string: z.string().describe('Replacement text. Can be empty to delete the matched substring.'),
  if_match: z.string().optional().describe('ETag from a prior read. Required when require_read_before_write is enabled.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleTextEdit(
  args: z.infer<typeof TextEditSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const resolved = resolveFilePath(ctx.config.document_roots, args.file);
  const { content, encoding } = readDocument(resolved.root.path, resolved.relativePath);

  const matches = findText(content, args.old_string, { case_sensitive: true, whole_word: false });

  if (matches.length === 0) {
    throw new ValidationError(
      `text_edit: old_string not found in ${args.file}. Verify the exact text (case and whitespace matter) or use text_find to inspect what's there.`,
    );
  }

  if (matches.length > 1) {
    throw new ValidationError(
      `text_edit requires a unique match: found ${matches.length} matches for old_string in ${args.file}. ` +
      `Supply a more distinctive old_string, or use text_find + text_replace_range to target a specific line range. ` +
      `Matches: ${JSON.stringify(matches, null, 2)}`,
    );
  }

  const match = matches[0];
  const newContent = content.slice(0, match.offset) + args.new_string + content.slice(match.offset + args.old_string.length);

  return await executeWrite(
    ctx,
    {
      file: args.file,
      operation: 'Edit text',
      target: `line ${match.line} col ${match.col}`,
      mode: args.mode,
      message: args.message,
      if_match: args.if_match,
    },
    content,
    newContent,
    encoding,
  );
}
