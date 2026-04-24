// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import {
  readDocument,
  resolveFilePath,
  computeEtag,
  requirePermission,
  readLineRange,
  countLines,
} from '@nullproof-studio/en-core';

export const TextReadSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.txt").'),
  line_start: z.number().int().positive().optional().describe('1-indexed start line for a range read. Omit to read the whole file.'),
  line_end: z.number().int().positive().optional().describe('1-indexed end line (inclusive) for a range read. Defaults to the last line when line_start is set.'),
});

export async function handleTextRead(
  args: z.infer<typeof TextReadSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const resolved = resolveFilePath(ctx.config.document_roots, args.file);
  const { content } = readDocument(resolved.root.path, resolved.relativePath);
  const etag = computeEtag(content);
  const totalLines = countLines(content);

  if (args.line_start === undefined) {
    return { content, etag, total_lines: totalLines };
  }

  const startLine = args.line_start;
  const endLine = args.line_end ?? totalLines;
  const excerpt = readLineRange(content, startLine, endLine);
  return {
    content: excerpt,
    etag,
    line_start: startLine,
    line_end: endLine,
    total_lines: totalLines,
  };
}
