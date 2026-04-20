// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import {
  readDocument,
  resolveFilePath,
  requirePermission,
  executeWrite,
} from '@nullproof-studio/en-core';

export const TextAppendSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.txt").'),
  content: z.string().describe('Content to append at EOF. Typically begins with "\\n" if the existing file does not already end with a trailing newline.'),
  if_match: z.string().optional().describe('ETag from a prior read. Required when require_read_before_write is enabled.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleTextAppend(
  args: z.infer<typeof TextAppendSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const resolved = resolveFilePath(ctx.config.document_roots, args.file);
  const { content, encoding } = readDocument(resolved.root.path, resolved.relativePath);
  const newContent = content + args.content;

  return await executeWrite(
    ctx,
    {
      file: args.file,
      operation: 'Append to text file',
      target: args.file,
      mode: args.mode,
      message: args.message,
      if_match: args.if_match,
    },
    content,
    newContent,
    encoding,
  );
}
