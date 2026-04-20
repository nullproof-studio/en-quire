// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import {
  readDocument,
  resolveFilePath,
  requirePermission,
  replaceLineRange,
  executeWrite,
} from '@nullproof-studio/en-core';

export const TextReplaceRangeSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.txt").'),
  line_start: z.number().int().min(1).describe('1-indexed start line. Must be >= 1. For insertion, set line_end = line_start - 1.'),
  line_end: z.number().int().min(0).describe('1-indexed end line (inclusive). Pass line_start - 1 to insert a zero-length range (before line_start, deleting nothing).'),
  content: z.string().describe('Replacement content. Should typically end with "\\n" unless replacing at EOF.'),
  if_match: z.string().optional().describe('ETag from a prior read. Required when require_read_before_write is enabled.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleTextReplaceRange(
  args: z.infer<typeof TextReplaceRangeSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const resolved = resolveFilePath(ctx.config.document_roots, args.file);
  const { content, encoding } = readDocument(resolved.root.path, resolved.relativePath);

  const newContent = replaceLineRange(content, args.line_start, args.line_end, args.content);

  return await executeWrite(
    ctx,
    {
      file: args.file,
      operation: args.line_end === args.line_start - 1 ? 'Insert lines' : 'Replace line range',
      target: `lines ${args.line_start}-${args.line_end}`,
      mode: args.mode,
      message: args.message,
      if_match: args.if_match,
    },
    content,
    newContent,
    encoding,
  );
}
